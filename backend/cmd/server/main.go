package main

import (
	"claraverse/internal/config"
	"claraverse/internal/crypto"
	"claraverse/internal/database"
	"claraverse/internal/document"
	"claraverse/internal/execution"
	"claraverse/internal/filecache"
	"claraverse/internal/handlers"
	"claraverse/internal/jobs"
	"claraverse/internal/middleware"
	"claraverse/internal/models"
	"claraverse/internal/preflight"
	"claraverse/internal/services"
	"claraverse/internal/tools"
	"claraverse/pkg/auth"
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/ansrivas/fiberprometheus/v2"
	"github.com/fsnotify/fsnotify"
	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("🚀 Starting ClaraVerse Server...")

	// Load .env file (ignore error if file doesn't exist)
	if err := godotenv.Load(); err != nil {
		log.Printf("⚠️  No .env file found or error loading it: %v", err)
	} else {
		log.Println("✅ .env file loaded successfully")
	}

	// Load configuration
	cfg := config.Load()
	log.Printf("📋 Configuration loaded (Port: %s, DB: MySQL)", cfg.Port)

	// Initialize MySQL database
	if cfg.DatabaseURL == "" {
		log.Fatal("❌ DATABASE_URL environment variable is required (mysql://user:pass@host:port/dbname?parseTime=true)")
	}
	db, err := database.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("❌ Failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := db.Initialize(); err != nil {
		log.Fatalf("❌ Failed to initialize database: %v", err)
	}

	// Initialize MongoDB (optional - for builder conversations and user data)
	var mongoDB *database.MongoDB
	var encryptionService *crypto.EncryptionService
	var userService *services.UserService
	var builderConvService *services.BuilderConversationService

	mongoURI := os.Getenv("MONGODB_URI")
	if mongoURI != "" {
		log.Println("🔗 Connecting to MongoDB...")
		var err error
		mongoDB, err = database.NewMongoDB(mongoURI)
		if err != nil {
			log.Printf("⚠️ Failed to connect to MongoDB: %v (builder features disabled)", err)
		} else {
			defer mongoDB.Close(context.Background())
			log.Println("✅ MongoDB connected successfully")

			// Initialize encryption service
			masterKey := os.Getenv("ENCRYPTION_MASTER_KEY")
			if masterKey != "" {
				encryptionService, err = crypto.NewEncryptionService(masterKey)
				if err != nil {
					log.Printf("⚠️ Failed to initialize encryption: %v", err)
				} else {
					log.Println("✅ Encryption service initialized")
				}
			} else {
				// SECURITY: In production, encryption is required when MongoDB is enabled
				environment := os.Getenv("ENVIRONMENT")
				if environment == "production" {
					log.Fatal("❌ CRITICAL SECURITY ERROR: ENCRYPTION_MASTER_KEY is required in production when MongoDB is enabled. Generate with: openssl rand -hex 32")
				}
				log.Println("⚠️ ENCRYPTION_MASTER_KEY not set - conversation encryption disabled (development mode only)")
			}

			// Initialize user service
			userService = services.NewUserService(mongoDB, cfg, nil) // usageLimiter set later
			log.Println("✅ User service initialized")

			// Initialize builder conversation service
			if encryptionService != nil {
				builderConvService = services.NewBuilderConversationService(mongoDB, encryptionService)
				log.Println("✅ Builder conversation service initialized")
			}
		}
	} else {
		log.Println("⚠️ MONGODB_URI not set - builder conversation persistence disabled")
	}

	// Initialize chat sync service (requires MongoDB + EncryptionService)
	var chatSyncService *services.ChatSyncService
	if mongoDB != nil && encryptionService != nil {
		chatSyncService = services.NewChatSyncService(mongoDB, encryptionService)
		// Ensure indexes
		if err := chatSyncService.EnsureIndexes(context.Background()); err != nil {
			log.Printf("⚠️ Failed to ensure chat sync indexes: %v", err)
		}
		log.Println("✅ Chat sync service initialized (encrypted cloud storage)")
	}

	// Initialize Redis service (for scheduler + pub/sub)
	var redisService *services.RedisService
	var schedulerService *services.SchedulerService
	var executionLimiter *middleware.ExecutionLimiter

	if cfg.RedisURL != "" {
		log.Println("🔗 Connecting to Redis...")
		var err error
		redisService, err = services.NewRedisService(cfg.RedisURL)
		if err != nil {
			log.Printf("⚠️ Failed to connect to Redis: %v (scheduler disabled)", err)
		} else {
			log.Println("✅ Redis connected successfully")
		}
	} else {
		log.Println("⚠️ REDIS_URL not set - scheduler disabled")
	}

	// Run preflight checks
	checker := preflight.NewChecker(db)
	results := checker.RunAll()

	// Exit if critical checks failed
	if preflight.HasFailures(results) {
		log.Println("\n❌ Pre-flight checks failed. Please fix the issues above before starting the server.")
		os.Exit(1)
	}

	log.Println("✅ All pre-flight checks passed")

	// Initialize services
	providerService := services.NewProviderService(db)
	modelService := services.NewModelService(db)
	connManager := services.NewConnectionManager()

	// Initialize Prometheus metrics
	services.InitMetrics(connManager)
	log.Println("✅ Prometheus metrics initialized")

	// Initialize MCP bridge service
	mcpBridge := services.NewMCPBridgeService(db, tools.GetRegistry())
	log.Println("✅ MCP bridge service initialized")

	chatService := services.NewChatService(db, providerService, mcpBridge, nil) // toolService set later after credential service init

	// Initialize agent service (requires MongoDB for scalable storage)
	var agentService *services.AgentService
	if mongoDB != nil {
		agentService = services.NewAgentService(mongoDB)
		// Ensure indexes for agents, workflows, and workflow_versions
		if err := agentService.EnsureIndexes(context.Background()); err != nil {
			log.Printf("⚠️ Failed to ensure agent indexes: %v", err)
		}
		log.Println("✅ Agent service initialized (MongoDB)")
	} else {
		log.Println("⚠️ MongoDB not available - agent builder features disabled")
	}

	workflowGeneratorService := services.NewWorkflowGeneratorService(db, providerService, chatService)
	log.Println("✅ Workflow generator service initialized")

	workflowGeneratorV2Service := services.NewWorkflowGeneratorV2Service(db, providerService, chatService)
	log.Println("✅ Workflow generator v2 service initialized (multi-step with tool selection)")

	// Initialize tier service (requires MongoDB)
	var tierService *services.TierService
	if mongoDB != nil {
		tierService = services.NewTierService(mongoDB)
		log.Println("✅ Tier service initialized")
	}

	// Initialize execution limiter (requires TierService + Redis)
	if tierService != nil && redisService != nil {
		executionLimiter = middleware.NewExecutionLimiter(tierService, redisService.Client())
		log.Println("✅ Execution limiter initialized")
	} else {
		log.Println("⚠️ Execution limiter disabled (requires TierService and Redis)")
	}

	// Initialize usage limiter service (requires TierService + Redis + MongoDB)
	var usageLimiter *services.UsageLimiterService
	if tierService != nil && redisService != nil && mongoDB != nil {
		usageLimiter = services.NewUsageLimiterService(tierService, redisService.Client(), mongoDB)
		log.Println("✅ Usage limiter service initialized")

		// Inject usage limiter into user service for promo user counter reset
		if userService != nil {
			userService.SetUsageLimiter(usageLimiter)
			log.Println("✅ Usage limiter injected into user service")
		}
	} else {
		log.Println("⚠️ Usage limiter disabled (requires TierService, Redis, and MongoDB)")
	}

	// Initialize execution service (requires MongoDB + TierService)
	var executionService *services.ExecutionService
	if mongoDB != nil {
		executionService = services.NewExecutionService(mongoDB, tierService)
		// Ensure indexes
		if err := executionService.EnsureIndexes(context.Background()); err != nil {
			log.Printf("⚠️ Failed to ensure execution indexes: %v", err)
		}
		log.Println("✅ Execution service initialized")
	}

	// Initialize analytics service (minimal, non-invasive usage tracking)
	var analyticsService *services.AnalyticsService
	if mongoDB != nil {
		analyticsService = services.NewAnalyticsService(mongoDB)
		// Ensure indexes
		if err := analyticsService.EnsureIndexes(context.Background()); err != nil {
			log.Printf("⚠️ Failed to ensure analytics indexes: %v", err)
		}
		log.Println("✅ Analytics service initialized (minimal tracking)")
	}

	// Initialize API key service (requires MongoDB + TierService)
	var apiKeyService *services.APIKeyService
	if mongoDB != nil {
		apiKeyService = services.NewAPIKeyService(mongoDB, tierService)
		// Ensure indexes
		if err := apiKeyService.EnsureIndexes(context.Background()); err != nil {
			log.Printf("⚠️ Failed to ensure API key indexes: %v", err)
		}
		log.Println("✅ API key service initialized")
	}

	// Initialize credential service (requires MongoDB + EncryptionService)
	var credentialService *services.CredentialService
	if mongoDB != nil && encryptionService != nil {
		credentialService = services.NewCredentialService(mongoDB, encryptionService)
		// Ensure indexes
		if err := credentialService.EnsureIndexes(context.Background()); err != nil {
			log.Printf("⚠️ Failed to ensure credential indexes: %v", err)
		}
		log.Println("✅ Credential service initialized")
	}

	// Initialize tool service (provides credential-filtered tools)
	toolService := services.NewToolService(tools.GetRegistry(), credentialService)
	log.Println("✅ Tool service initialized")

	// Set tool service on chat service (was initialized with nil earlier)
	chatService.SetToolService(toolService)

	// Initialize and set tool predictor service for dynamic tool selection
	toolPredictorService := services.NewToolPredictorService(db, providerService, chatService)
	chatService.SetToolPredictorService(toolPredictorService)
	log.Println("✅ Tool predictor service initialized")

	// Initialize memory services (requires MongoDB + EncryptionService)
	var memoryStorageService *services.MemoryStorageService
	var memoryExtractionService *services.MemoryExtractionService
	var memorySelectionService *services.MemorySelectionService
	var memoryDecayService *services.MemoryDecayService
	var memoryModelPool *services.MemoryModelPool
	if mongoDB != nil && encryptionService != nil {
		memoryStorageService = services.NewMemoryStorageService(mongoDB, encryptionService)
		log.Println("✅ Memory storage service initialized")

		// Initialize model pool for dynamic memory model selection
		var err error
		memoryModelPool, err = services.NewMemoryModelPool(chatService, db.DB)
		if err != nil {
			log.Printf("⚠️ Failed to initialize memory model pool: %v", err)
			log.Println("⚠️ Memory extraction/selection services disabled (requires valid memory models)")
		} else {
			log.Println("✅ Memory model pool initialized")

			memoryExtractionService = services.NewMemoryExtractionService(
				mongoDB,
				encryptionService,
				providerService,
				memoryStorageService,
				chatService,
				memoryModelPool,
			)
			log.Println("✅ Memory extraction service initialized")

			memorySelectionService = services.NewMemorySelectionService(
				mongoDB,
				encryptionService,
				providerService,
				memoryStorageService,
				chatService,
				memoryModelPool,
			)
			log.Println("✅ Memory selection service initialized")

			// Set memory services on chat service
			chatService.SetMemoryExtractionService(memoryExtractionService)
			chatService.SetMemorySelectionService(memorySelectionService)
			chatService.SetUserService(userService)
		}

		memoryDecayService = services.NewMemoryDecayService(mongoDB)
		log.Println("✅ Memory decay service initialized")
	} else {
		log.Println("⚠️ Memory services disabled (requires MongoDB + EncryptionService)")
	}

	// Initialize scheduler service (requires Redis + MongoDB + AgentService + ExecutionService)
	if redisService != nil && mongoDB != nil {
		var err error
		schedulerService, err = services.NewSchedulerService(mongoDB, redisService, agentService, executionService)
		if err != nil {
			log.Printf("⚠️ Failed to initialize scheduler: %v", err)
		} else {
			log.Println("✅ Scheduler service initialized")
		}
	}

	// Initialize PubSub service (requires Redis)
	var pubsubService *services.PubSubService
	if redisService != nil {
		instanceID := fmt.Sprintf("instance-%d", time.Now().UnixNano()%10000)
		pubsubService = services.NewPubSubService(redisService, instanceID)
		if err := pubsubService.Start(); err != nil {
			log.Printf("⚠️ Failed to start PubSub service: %v", err)
		} else {
			log.Printf("✅ PubSub service initialized (instance: %s)", instanceID)
		}
	}

	// Initialize workflow execution engine with block checker support
	executorRegistry := execution.NewExecutorRegistry(chatService, providerService, tools.GetRegistry(), credentialService)
	workflowEngine := execution.NewWorkflowEngineWithChecker(executorRegistry, providerService)
	log.Println("✅ Workflow execution engine initialized (with block checker)")

	// Set workflow executor on scheduler and start it
	if schedulerService != nil {
		// Create a workflow executor callback that wraps the workflow engine
		workflowExecutor := func(workflow *models.Workflow, inputs map[string]interface{}) (*models.WorkflowExecuteResult, error) {
			// Create a dummy status channel (scheduled jobs don't need real-time updates)
			statusChan := make(chan models.ExecutionUpdate, 100)
			go func() {
				for range statusChan {
					// Drain channel - in Phase 4, this will publish to Redis pub/sub
				}
			}()

			result, err := workflowEngine.Execute(context.Background(), workflow, inputs, statusChan)
			close(statusChan)

			if err != nil {
				return &models.WorkflowExecuteResult{
					Status: "failed",
					Error:  err.Error(),
				}, err
			}
			return &models.WorkflowExecuteResult{
				Status:      result.Status,
				Output:      result.Output,
				BlockStates: result.BlockStates,
				Error:       result.Error,
			}, nil
		}

		schedulerService.SetWorkflowExecutor(workflowExecutor)
		if err := schedulerService.Start(context.Background()); err != nil {
			log.Printf("⚠️ Failed to start scheduler: %v", err)
		} else {
			log.Println("✅ Scheduler started successfully")
		}
	}

	// Initialize authentication (Local JWT - v2.0)
	var jwtAuth *auth.LocalJWTAuth
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		environment := os.Getenv("ENVIRONMENT")
		if environment == "production" {
			log.Fatal("❌ CRITICAL SECURITY ERROR: JWT_SECRET is required in production. Generate with: openssl rand -hex 64")
		}
		log.Println("⚠️  JWT_SECRET not set - authentication disabled (development mode)")
	} else {
		// Parse JWT expiry durations from environment variables
		accessTokenExpiry := 15 * time.Minute  // Default: 15 minutes
		refreshTokenExpiry := 7 * 24 * time.Hour // Default: 7 days

		if accessExpiryStr := os.Getenv("JWT_ACCESS_TOKEN_EXPIRY"); accessExpiryStr != "" {
			if parsed, err := time.ParseDuration(accessExpiryStr); err == nil {
				accessTokenExpiry = parsed
			} else {
				log.Printf("⚠️  Invalid JWT_ACCESS_TOKEN_EXPIRY: %v, using default 15m", err)
			}
		}

		if refreshExpiryStr := os.Getenv("JWT_REFRESH_TOKEN_EXPIRY"); refreshExpiryStr != "" {
			if parsed, err := time.ParseDuration(refreshExpiryStr); err == nil {
				refreshTokenExpiry = parsed
			} else {
				log.Printf("⚠️  Invalid JWT_REFRESH_TOKEN_EXPIRY: %v, using default 7d", err)
			}
		}

		var err error
		jwtAuth, err = auth.NewLocalJWTAuth(jwtSecret, accessTokenExpiry, refreshTokenExpiry)
		if err != nil {
			log.Fatalf("❌ Failed to initialize JWT authentication: %v", err)
		}
		log.Printf("✅ Local JWT authentication initialized (access: %v, refresh: %v)", accessTokenExpiry, refreshTokenExpiry)
	}

	// Try loading configuration from database first
	_, err = loadConfigFromDatabase(modelService, chatService, providerService)
	if err != nil {
		log.Printf("⚠️  Warning: Could not load config from database: %v", err)
	}

	// Database starts empty - use admin UI to add providers and models

	// Initialize vision service (for describe_image tool)
	// Must be after provider sync so model aliases are available
	services.SetVisionDependencies(providerService, db)
	services.InitVisionService()

	// Initialize audio service (for transcribe_audio tool)
	// Uses the same provider service dependency set above
	services.InitAudioService()

	// NOTE: providers.json file watcher removed - all provider management now in MySQL

	// Start background model refresh job (refreshes from database)
	go startModelRefreshJob(providerService, modelService, chatService)

	// Run startup cleanup to delete orphaned files from previous runs
	// This ensures zero retention policy is enforced even after server restarts
	uploadDir := "./uploads"
	fileCache := filecache.GetService()
	fileCache.RunStartupCleanup(uploadDir)

	// Start background image cleanup job (also cleans orphaned files)
	go startImageCleanupJob(uploadDir)

	// Start background document cleanup job
	go startDocumentCleanupJob()

	// Start memory extraction worker (requires memory extraction service)
	if memoryExtractionService != nil {
		go startMemoryExtractionWorker(memoryExtractionService)
	}

	// Start memory decay worker (requires memory decay service)
	if memoryDecayService != nil {
		go startMemoryDecayWorker(memoryDecayService)
	}

	// Initialize Fiber app
	app := fiber.New(fiber.Config{
		AppName:      "ClaraVerse v1.0",
		ReadTimeout:  360 * time.Second, // 6 minutes to handle long tool executions
		WriteTimeout: 360 * time.Second, // 6 minutes to handle long tool executions
		IdleTimeout:  360 * time.Second, // 6 minutes to handle long tool executions
		BodyLimit:    50 * 1024 * 1024,  // 50MB limit for chat messages with images and large conversations
	})

	// Middleware
	app.Use(recover.New())
	app.Use(logger.New())

	// Prometheus metrics middleware
	prometheus := fiberprometheus.New("claraverse")
	prometheus.RegisterAt(app, "/metrics")
	app.Use(prometheus.Middleware)
	log.Println("📊 Prometheus metrics endpoint enabled at /metrics")

	// Load rate limiting configuration
	rateLimitConfig := middleware.LoadRateLimitConfig()
	log.Printf("🛡️  [RATE-LIMIT] Loaded config: Global=%d/min, Public=%d/min, Auth=%d/min, WS=%d/min",
		rateLimitConfig.GlobalAPIMax,
		rateLimitConfig.PublicReadMax,
		rateLimitConfig.AuthenticatedMax,
		rateLimitConfig.WebSocketMax,
	)

	// CORS configuration with environment-based origins
	allowedOrigins := os.Getenv("ALLOWED_ORIGINS")
	if allowedOrigins == "" {
		// Default to localhost for development
		allowedOrigins = "http://localhost:5173,http://localhost:3000"
		log.Println("⚠️  ALLOWED_ORIGINS not set, using development defaults")
	}

	app.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders:     "Origin,Content-Type,Accept,Authorization",
		AllowCredentials: true, // Required for cookies (JWT refresh tokens)
		// Skip CORS check for external access endpoints - they have their own permissive CORS
		Next: func(c *fiber.Ctx) bool {
			path := c.Path()
			return strings.HasPrefix(path, "/api/trigger") || strings.HasPrefix(path, "/api/external")
		},
	}))

	log.Printf("🔒 [SECURITY] CORS allowed origins: %s (excluding /api/trigger and /api/external)", allowedOrigins)

	// Global API rate limiter - first line of DDoS defense
	// Applies to all /api/* routes, excludes health checks and metrics
	app.Use("/api", middleware.GlobalAPIRateLimiter(rateLimitConfig))
	log.Println("🛡️  [RATE-LIMIT] Global API rate limiter enabled")

	// Initialize handlers
	healthHandler := handlers.NewHealthHandler(connManager)
	providerHandler := handlers.NewProviderHandler(providerService)
	modelHandler := handlers.NewModelHandler(modelService)
	uploadHandler := handlers.NewUploadHandler("./uploads", usageLimiter)
	downloadHandler := handlers.NewDownloadHandler()
	secureDownloadHandler := handlers.NewSecureDownloadHandler()
	conversationHandler := handlers.NewConversationHandler(chatService, builderConvService)
	userHandler := handlers.NewUserHandler(chatService, userService)
	wsHandler := handlers.NewWebSocketHandler(connManager, chatService, analyticsService, usageLimiter)

	// Initialize local auth handler (v2.0)
	var localAuthHandler *handlers.LocalAuthHandler
	if jwtAuth != nil && mongoDB != nil && userService != nil {
		localAuthHandler = handlers.NewLocalAuthHandler(jwtAuth, userService)
		log.Println("✅ Local auth handler initialized")
	}

	// Initialize memory handler (requires memory services)
	var memoryHandler *handlers.MemoryHandler
	if memoryStorageService != nil && memoryExtractionService != nil {
		memoryHandler = handlers.NewMemoryHandler(memoryStorageService, memoryExtractionService, chatService)
		log.Println("✅ Memory handler initialized")
	}

	// Inject usage limiter into chat service for tool execution
	if usageLimiter != nil {
		chatService.SetUsageLimiter(usageLimiter)
	}
	mcpWSHandler := handlers.NewMCPWebSocketHandler(mcpBridge)
	configHandler := handlers.NewConfigHandler()
	// Initialize agent handler (requires agentService)
	var agentHandler *handlers.AgentHandler
	var workflowWSHandler *handlers.WorkflowWebSocketHandler
	if agentService != nil {
		agentHandler = handlers.NewAgentHandler(agentService, workflowGeneratorService)
		// Wire up builder conversation service for sync endpoint
		if builderConvService != nil {
			agentHandler.SetBuilderConversationService(builderConvService)
		}
		// Wire up v2 workflow generator service (multi-step with tool selection)
		agentHandler.SetWorkflowGeneratorV2Service(workflowGeneratorV2Service)
		// Wire up provider service for Ask mode
		agentHandler.SetProviderService(providerService)
		workflowWSHandler = handlers.NewWorkflowWebSocketHandler(agentService, workflowEngine, executionLimiter)
		// Wire up execution service for workflow execution tracking
		if executionService != nil {
			workflowWSHandler.SetExecutionService(executionService)
		}
		log.Println("✅ Agent handler initialized")
	}
	toolsHandler := handlers.NewToolsHandler(tools.GetRegistry(), toolService)
	imageProxyHandler := handlers.NewImageProxyHandler()
	audioHandler := handlers.NewAudioHandler()
	ttsHandler := handlers.NewTTSHandler()
	log.Println("✅ Audio handler initialized")
	log.Println("✅ TTS handler initialized")

	// Initialize schedule handler (requires scheduler service)
	var scheduleHandler *handlers.ScheduleHandler
	if schedulerService != nil {
		scheduleHandler = handlers.NewScheduleHandler(schedulerService, agentService)
		log.Println("✅ Schedule handler initialized")
	}

	// Initialize execution handler (requires execution service)
	var executionHandler *handlers.ExecutionHandler
	if executionService != nil {
		executionHandler = handlers.NewExecutionHandler(executionService)
		log.Println("✅ Execution handler initialized")
	}

	// Initialize API key handler (requires API key service)
	var apiKeyHandler *handlers.APIKeyHandler
	if apiKeyService != nil {
		apiKeyHandler = handlers.NewAPIKeyHandler(apiKeyService)
		log.Println("✅ API key handler initialized")
	}

	// Initialize trigger handler (requires agent service + execution service + workflow engine)
	var triggerHandler *handlers.TriggerHandler
	if executionService != nil {
		triggerHandler = handlers.NewTriggerHandler(agentService, executionService, workflowEngine)
		log.Println("✅ Trigger handler initialized")
	}

	// Initialize credential handler (requires credential service)
	var credentialHandler *handlers.CredentialHandler
	var composioAuthHandler *handlers.ComposioAuthHandler
	if credentialService != nil {
		credentialHandler = handlers.NewCredentialHandler(credentialService)
		log.Println("✅ Credential handler initialized")

		// Initialize Composio OAuth handler
		composioAuthHandler = handlers.NewComposioAuthHandler(credentialService)
		log.Println("✅ Composio OAuth handler initialized")
	}

	// Initialize chat sync handler (requires chat sync service)
	var chatSyncHandler *handlers.ChatSyncHandler
	if chatSyncService != nil {
		chatSyncHandler = handlers.NewChatSyncHandler(chatSyncService)
		log.Println("✅ Chat sync handler initialized")
	}

	// Initialize user preferences handler (requires userService)
	var userPreferencesHandler *handlers.UserPreferencesHandler
	if userService != nil {
		userPreferencesHandler = handlers.NewUserPreferencesHandler(userService)
		log.Println("✅ User preferences handler initialized")
	}

	// Payment service removed in v2.0 - all users default to Pro tier

	// Wire up GDPR services for complete account deletion
	userHandler.SetGDPRServices(
		agentService,
		executionService,
		apiKeyService,
		credentialService,
		chatSyncService,
		schedulerService,
		builderConvService,
	)
	log.Println("✅ GDPR services wired up for account deletion")

	// Routes

	// Health check (public)
	app.Get("/health", healthHandler.Handle)

	// Rate limiter for upload endpoint (10 uploads per minute per user)
	uploadLimiter := limiter.New(limiter.Config{
		Max:        10,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			// Rate limit by user ID
			userID, ok := c.Locals("user_id").(string)
			if !ok || userID == "" {
				// Fallback to IP if no user ID
				return c.IP()
			}
			return "upload:" + userID
		},
		LimitReached: func(c *fiber.Ctx) error {
			log.Printf("⚠️  [RATE-LIMIT] Upload limit reached for user: %v", c.Locals("user_id"))
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "Too many upload requests. Please wait before uploading again.",
			})
		},
	})

	// Create endpoint-specific rate limiters
	publicReadLimiter := middleware.PublicReadRateLimiter(rateLimitConfig)
	imageProxyLimiter := middleware.ImageProxyRateLimiter(rateLimitConfig)
	transcribeLimiter := middleware.TranscribeRateLimiter(rateLimitConfig)

	// API routes (public read-only)
	api := app.Group("/api")
	{
		// Authentication routes (v2.0 - Local JWT)
		if localAuthHandler != nil {
			auth := api.Group("/auth")
			auth.Get("/status", localAuthHandler.GetStatus) // Public - check if users exist
			auth.Post("/register", localAuthHandler.Register)
			auth.Post("/login", localAuthHandler.Login)
			auth.Post("/refresh", localAuthHandler.RefreshToken)
			auth.Post("/logout", middleware.LocalAuthMiddleware(jwtAuth), localAuthHandler.Logout)
			auth.Get("/me", middleware.LocalAuthMiddleware(jwtAuth), localAuthHandler.GetCurrentUser)
			log.Println("✅ Local auth routes registered (/api/auth/*)")
		}

		// Image proxy endpoint (public - used by frontend for image search results)
		// Has its own rate limiter to prevent bandwidth abuse
		api.Get("/proxy/image", imageProxyLimiter, imageProxyHandler.ProxyImage)

		// Public read-only endpoints with rate limiting
		api.Get("/providers", publicReadLimiter, providerHandler.List)
		api.Get("/models", publicReadLimiter, middleware.OptionalLocalAuthMiddleware(jwtAuth), modelHandler.List)
		api.Get("/models/tool-predictors", publicReadLimiter, modelHandler.ListToolPredictorModels) // Specific routes before parameterized ones
		api.Get("/models/provider/:id", publicReadLimiter, modelHandler.ListByProvider)

		// Configuration endpoints (public)
		api.Get("/config/recommended-models", publicReadLimiter, configHandler.GetRecommendedModels)

		// Conversation status check (public)
		api.Get("/conversations/:id/status", publicReadLimiter, conversationHandler.GetStatus)

		// File upload (requires authentication via JWT or API key + rate limiting)
		// API key users need "upload" scope to upload files
		if apiKeyService != nil {
			api.Post("/upload",
				middleware.APIKeyOrJWTMiddleware(apiKeyService, middleware.OptionalLocalAuthMiddleware(jwtAuth)),
				middleware.RequireScope("upload"),
				uploadLimiter,
				uploadHandler.Upload,
			)
		} else {
			api.Post("/upload",
				middleware.OptionalLocalAuthMiddleware(jwtAuth),
				uploadLimiter,
				uploadHandler.Upload,
			)
		}
		api.Delete("/upload/:id", middleware.OptionalLocalAuthMiddleware(jwtAuth), uploadHandler.Delete)

		// File status check endpoint (for pre-execution validation)
		api.Get("/upload/:id/status", middleware.OptionalLocalAuthMiddleware(jwtAuth), uploadHandler.CheckFileStatus)

		// Audio transcription endpoint (requires authentication + rate limiting for expensive GPU operation)
		api.Post("/audio/transcribe", middleware.OptionalLocalAuthMiddleware(jwtAuth), transcribeLimiter, audioHandler.Transcribe)

		// TTS endpoints (proxies to internal pocket-tts service)
		tts := api.Group("/tts")
		tts.Get("/health", ttsHandler.Health)                        // Health check
		tts.Get("/voices", ttsHandler.ListVoices)                     // List voices
		tts.Post("/", ttsHandler.TextToSpeech)                        // Generate speech
		tts.Post("/voices/upload", middleware.OptionalLocalAuthMiddleware(jwtAuth), ttsHandler.UploadCustomVoice) // Upload custom voice
		tts.Delete("/voices/:id", middleware.OptionalLocalAuthMiddleware(jwtAuth), ttsHandler.DeleteCustomVoice) // Delete custom voice
		log.Println("✅ TTS routes registered")

		// Document download (requires authentication for access control)
		api.Get("/download/:id", middleware.OptionalLocalAuthMiddleware(jwtAuth), downloadHandler.Download)

		// Secure file downloads (access code based - no auth required for download)
		api.Get("/files/:id", secureDownloadHandler.Download)                                           // Download with access code
		api.Get("/files/:id/info", secureDownloadHandler.GetInfo)                                       // Get file info with access code
		api.Get("/files", middleware.LocalAuthMiddleware(jwtAuth), secureDownloadHandler.ListUserFiles) // List user's files
		api.Delete("/files/:id", middleware.LocalAuthMiddleware(jwtAuth), secureDownloadHandler.Delete) // Delete file (owner only)

		// User preferences endpoints (requires authentication)
		api.Get("/user/preferences", middleware.LocalAuthMiddleware(jwtAuth), userHandler.GetPreferences)
		api.Put("/user/preferences", middleware.LocalAuthMiddleware(jwtAuth), userHandler.UpdatePreferences)
		api.Post("/user/welcome-popup-seen", middleware.LocalAuthMiddleware(jwtAuth), userHandler.MarkWelcomePopupSeen)

		// GDPR Compliance endpoints (requires authentication)
		api.Get("/user/data", middleware.LocalAuthMiddleware(jwtAuth), userHandler.ExportData)
		api.Delete("/user/account", middleware.LocalAuthMiddleware(jwtAuth), userHandler.DeleteAccount)

		// Privacy policy (public)
		api.Get("/privacy-policy", userHandler.GetPrivacyPolicy)

		// Memory management routes (requires authentication + memory services)
		if memoryHandler != nil {
			memories := api.Group("/memories", middleware.LocalAuthMiddleware(jwtAuth))
			memories.Get("/", memoryHandler.ListMemories)
			memories.Get("/stats", memoryHandler.GetMemoryStats) // Must be before /:id to avoid route conflict
			memories.Get("/:id", memoryHandler.GetMemory)
			memories.Post("/", memoryHandler.CreateMemory)
			memories.Put("/:id", memoryHandler.UpdateMemory)
			memories.Delete("/:id", memoryHandler.DeleteMemory)
			memories.Post("/:id/archive", memoryHandler.ArchiveMemory)
			memories.Post("/:id/unarchive", memoryHandler.UnarchiveMemory)

			// Conversation memory extraction (manual trigger)
			api.Post("/conversations/:id/extract-memories", middleware.LocalAuthMiddleware(jwtAuth), memoryHandler.TriggerMemoryExtraction)
		}

		// Agent builder routes (requires authentication + MongoDB)
		if agentHandler != nil {
			agents := api.Group("/agents", middleware.LocalAuthMiddleware(jwtAuth))
			agents.Post("/", agentHandler.Create)
			agents.Get("/", agentHandler.List)
			agents.Get("/recent", agentHandler.ListRecent) // Must be before /:id to avoid route conflict
			agents.Post("/ask", agentHandler.Ask)          // Ask mode - must be before /:id to avoid route conflict
			agents.Get("/:id", agentHandler.Get)
			agents.Put("/:id", agentHandler.Update)
			agents.Delete("/:id", agentHandler.Delete)
			agents.Post("/:id/sync", agentHandler.SyncAgent) // Sync local agent to backend

			// Workflow version routes - MUST be before /:id/workflow to avoid route conflict
			agents.Get("/:id/workflow/versions", agentHandler.ListWorkflowVersions)
			agents.Get("/:id/workflow/versions/:version", agentHandler.GetWorkflowVersion)
			agents.Post("/:id/workflow/restore/:version", agentHandler.RestoreWorkflowVersion)

			// Workflow routes (less specific, must come after /versions routes)
			agents.Put("/:id/workflow", agentHandler.SaveWorkflow)
			agents.Get("/:id/workflow", agentHandler.GetWorkflow)
			agents.Post("/:id/generate-workflow", agentHandler.GenerateWorkflow)
			agents.Post("/:id/generate-workflow-v2", agentHandler.GenerateWorkflowV2) // Multi-step with tool selection
			agents.Post("/:id/select-tools", agentHandler.SelectTools)               // Tool selection only (step 1)
			agents.Post("/:id/generate-with-tools", agentHandler.GenerateWithTools)  // Generate with pre-selected tools (step 2)
			agents.Post("/:id/generate-sample-input", agentHandler.GenerateSampleInput) // Generate sample JSON input for testing

			// Builder conversation routes (under agents)
			agents.Get("/:id/conversations", conversationHandler.ListBuilderConversations)
			agents.Post("/:id/conversations", conversationHandler.CreateBuilderConversation)
			agents.Get("/:id/conversations/current", conversationHandler.GetOrCreateBuilderConversation)
			agents.Get("/:id/conversations/:convId", conversationHandler.GetBuilderConversation)
			agents.Delete("/:id/conversations/:convId", conversationHandler.DeleteBuilderConversation)
			agents.Post("/:id/conversations/:convId/messages", conversationHandler.AddBuilderMessage)

			// Schedule routes (under agents) - requires scheduler service
			if scheduleHandler != nil {
				agents.Post("/:id/schedule", scheduleHandler.Create)
				agents.Get("/:id/schedule", scheduleHandler.Get)
				agents.Put("/:id/schedule", scheduleHandler.Update)
				agents.Delete("/:id/schedule", scheduleHandler.Delete)
				agents.Post("/:id/schedule/run", scheduleHandler.TriggerNow)
			}

			// Execution routes (under agents)
			if executionHandler != nil {
				agents.Get("/:id/executions", executionHandler.ListByAgent)
				agents.Get("/:id/executions/stats", executionHandler.GetStats)
			}
		}

		// Execution routes (top-level, authenticated) - MongoDB only
		if executionHandler != nil {
			executions := api.Group("/executions", middleware.LocalAuthMiddleware(jwtAuth))
			executions.Get("/", executionHandler.ListAll)
			executions.Get("/:id", executionHandler.GetByID)
		}

		// Schedule routes (top-level, authenticated) - for usage stats
		if scheduleHandler != nil {
			schedules := api.Group("/schedules", middleware.LocalAuthMiddleware(jwtAuth))
			schedules.Get("/usage", scheduleHandler.GetUsage)
		}

		// Tool routes (requires authentication)
		tools := api.Group("/tools", middleware.LocalAuthMiddleware(jwtAuth))
		tools.Get("/", toolsHandler.ListTools)
		tools.Get("/available", toolsHandler.GetAvailableTools) // Returns tools filtered by user's credentials
		tools.Post("/recommend", toolsHandler.RecommendTools)
		if agentHandler != nil {
			tools.Get("/registry", agentHandler.GetToolRegistry) // Tool registry for workflow builder
		}

		// API Key management routes (requires authentication)
		if apiKeyHandler != nil {
			keys := api.Group("/keys", middleware.LocalAuthMiddleware(jwtAuth))
			keys.Post("/", apiKeyHandler.Create)
			keys.Get("/", apiKeyHandler.List)
			keys.Get("/:id", apiKeyHandler.Get)
			keys.Post("/:id/revoke", apiKeyHandler.Revoke)
			keys.Delete("/:id", apiKeyHandler.Delete)
		}

		// Credential management routes (requires authentication)
		if credentialHandler != nil {
			// Integration registry (public read)
			api.Get("/integrations", credentialHandler.GetIntegrations)
			api.Get("/integrations/:id", credentialHandler.GetIntegration)

			// Credential CRUD (authenticated)
			credentials := api.Group("/credentials", middleware.LocalAuthMiddleware(jwtAuth))
			credentials.Post("/", credentialHandler.Create)
			credentials.Get("/", credentialHandler.List)
			credentials.Get("/by-integration", credentialHandler.GetCredentialsByIntegration)
			credentials.Get("/references", credentialHandler.GetCredentialReferences)
			credentials.Get("/:id", credentialHandler.Get)
			credentials.Put("/:id", credentialHandler.Update)
			credentials.Delete("/:id", credentialHandler.Delete)
			credentials.Post("/:id/test", credentialHandler.Test)

			// Composio OAuth routes (authenticated)
			if composioAuthHandler != nil {
				composio := api.Group("/integrations/composio", middleware.LocalAuthMiddleware(jwtAuth))
				composio.Get("/googlesheets/authorize", composioAuthHandler.InitiateGoogleSheetsAuth)
				composio.Get("/gmail/authorize", composioAuthHandler.InitiateGmailAuth)
				composio.Get("/connected-account", composioAuthHandler.GetConnectedAccount)
				composio.Post("/complete-setup", composioAuthHandler.CompleteComposioSetup)

				// Callback endpoint (unauthenticated - Composio calls this)
				api.Get("/integrations/composio/callback", composioAuthHandler.HandleComposioCallback)
			}
		}

		// Chat sync routes (requires authentication + chat sync service)
		if chatSyncHandler != nil {
			chats := api.Group("/chats", middleware.LocalAuthMiddleware(jwtAuth))
			chats.Get("/sync", chatSyncHandler.SyncAll)             // Get all chats for initial sync (must be before /:id)
			chats.Post("/sync", chatSyncHandler.BulkSync)           // Bulk upload chats

			// Folder routes
			chats.Get("/folders", chatSyncHandler.ListFolders)
			chats.Post("/folders", chatSyncHandler.CreateOrUpdateFolder)
			chats.Delete("/folders/:id", chatSyncHandler.DeleteFolder)

			chats.Get("/", chatSyncHandler.List)                    // List chats (paginated)
			chats.Post("/", chatSyncHandler.CreateOrUpdate)         // Create or update a chat
			chats.Get("/:id", chatSyncHandler.Get)                  // Get single chat
			chats.Put("/:id", chatSyncHandler.Update)               // Partial update
			chats.Delete("/:id", chatSyncHandler.Delete)            // Delete single chat
			chats.Post("/:id/messages", chatSyncHandler.AddMessage) // Add message to chat
			chats.Delete("/", chatSyncHandler.DeleteAll)            // Delete all chats (GDPR)
			log.Println("✅ Chat sync routes registered")
		}

		// User preferences routes (requires authentication + userService)
		if userPreferencesHandler != nil {
			prefs := api.Group("/preferences", middleware.LocalAuthMiddleware(jwtAuth))
			prefs.Get("/", userPreferencesHandler.Get)    // Get preferences
			prefs.Put("/", userPreferencesHandler.Update) // Update preferences
			log.Println("✅ User preferences routes registered")
		}

		// Subscription routes removed in v2.0 - no payment processing

		// Admin routes (protected by admin middleware - superadmin only)
		if userService != nil && tierService != nil {
			adminHandler := handlers.NewAdminHandler(userService, tierService, analyticsService, providerService, modelService)
			adminRoutes := api.Group("/admin", middleware.LocalAuthMiddleware(jwtAuth), middleware.AdminMiddleware(cfg))

			// Admin status
			adminRoutes.Get("/me", adminHandler.GetAdminStatus)

			// User management
			adminRoutes.Get("/users/:userID", adminHandler.GetUserDetails)
			adminRoutes.Post("/users/:userID/overrides", adminHandler.SetLimitOverrides)
			adminRoutes.Delete("/users/:userID/overrides", adminHandler.RemoveAllOverrides)
			adminRoutes.Get("/users", adminHandler.ListUsers)

			// Analytics
			adminRoutes.Get("/analytics/overview", adminHandler.GetOverviewAnalytics)
			adminRoutes.Get("/analytics/providers", adminHandler.GetProviderAnalytics)
			adminRoutes.Get("/analytics/chats", adminHandler.GetChatAnalytics)
			adminRoutes.Get("/analytics/models", adminHandler.GetModelAnalytics)
			adminRoutes.Get("/analytics/agents", adminHandler.GetAgentAnalytics)
			adminRoutes.Post("/analytics/migrate-timestamps", adminHandler.MigrateChatSessionTimestamps)

			// Provider management (CRUD)
			adminRoutes.Get("/providers", adminHandler.GetProviders)
			adminRoutes.Post("/providers", adminHandler.CreateProvider)
			adminRoutes.Put("/providers/:id", adminHandler.UpdateProvider)
			adminRoutes.Delete("/providers/:id", adminHandler.DeleteProvider)
			adminRoutes.Put("/providers/:id/toggle", adminHandler.ToggleProvider)

			// Model management (CRUD, testing, benchmarking, aliases)
			if modelService != nil && providerService != nil {
				modelMgmtService := services.NewModelManagementService(db)
				modelMgmtHandler := handlers.NewModelManagementHandler(modelMgmtService, modelService, providerService)

				// Bulk operations (MUST be before parameterized routes to avoid :modelId matching)
				adminRoutes.Post("/models/import-aliases", modelMgmtHandler.ImportAliasesFromJSON)
				adminRoutes.Put("/models/bulk/agents-enabled", modelMgmtHandler.BulkUpdateAgentsEnabled)
				adminRoutes.Put("/models/bulk/visibility", modelMgmtHandler.BulkUpdateVisibility)

				// Model CRUD (list and create don't conflict with specific paths)
				adminRoutes.Get("/models", modelMgmtHandler.GetAllModels)
				adminRoutes.Post("/models", modelMgmtHandler.CreateModel)

				// Global tier management (specific paths before :modelId)
				adminRoutes.Get("/tiers", modelMgmtHandler.GetTiers)

				// Model fetching from provider API
				adminRoutes.Post("/providers/:providerId/fetch", modelMgmtHandler.FetchModelsFromProvider)
				adminRoutes.Post("/providers/:providerId/sync", modelMgmtHandler.SyncProviderToJSON)

				// Model management routes - use middleware to handle model IDs with slashes
				// Model IDs can contain slashes (e.g., qwen/qwen3-4b-2507) which get URL-decoded before routing
				// We use a custom middleware to extract the full model ID from the path

				// Helper middleware to extract model ID from path (handles both single and multi-segment IDs)
				modelIdMiddleware := func(c *fiber.Ctx) error {
					// Get the path after /api/admin/models/
					path := c.Path()
					prefix := "/api/admin/models/"
					if strings.HasPrefix(path, prefix) {
						modelID := strings.TrimPrefix(path, prefix)
						// Remove any trailing segments (like /tier, /aliases, /test/*, etc.)
						if idx := strings.Index(modelID, "/tier"); idx >= 0 {
							modelID = modelID[:idx]
							c.Locals("suffix", "/tier"+modelID[idx+5:])
							modelID = modelID[:idx]
						} else if idx := strings.Index(modelID, "/aliases"); idx >= 0 {
							c.Locals("suffix", "/aliases"+modelID[idx+8:])
							modelID = modelID[:idx]
						} else if idx := strings.Index(modelID, "/test/"); idx >= 0 {
							c.Locals("suffix", "/test/"+modelID[idx+6:])
							modelID = modelID[:idx]
						} else if idx := strings.Index(modelID, "/benchmark"); idx >= 0 {
							c.Locals("suffix", "/benchmark"+modelID[idx+9:])
							modelID = modelID[:idx]
						} else if idx := strings.Index(modelID, "/test-results"); idx >= 0 {
							c.Locals("suffix", "/test-results"+modelID[idx+13:])
							modelID = modelID[:idx]
						}
						c.Locals("model_id", modelID)
					}
					return c.Next()
				}

				// Register routes with wildcard + middleware
				adminRoutes.Put("/models+", modelIdMiddleware, modelMgmtHandler.UpdateModel)
				adminRoutes.Delete("/models+", modelIdMiddleware, modelMgmtHandler.DeleteModel)
				adminRoutes.Post("/models+/*", modelIdMiddleware, func(c *fiber.Ctx) error {
					// Handle /tier, /test/*, /aliases, /benchmark, /test-results
					suffix, _ := c.Locals("suffix").(string)
					if suffix == "/tier" {
						return modelMgmtHandler.SetModelTier(c)
					} else if strings.HasPrefix(suffix, "/test/") {
						if suffix == "/test/connection" {
							return modelMgmtHandler.TestModelConnection(c)
						} else if suffix == "/test/capability" {
							return modelMgmtHandler.TestModelCapability(c)
						}
					} else if suffix == "/benchmark" {
						return modelMgmtHandler.RunModelBenchmark(c)
					} else if suffix == "/test-results" {
						return modelMgmtHandler.GetModelTestResults(c)
					} else if strings.HasPrefix(suffix, "/aliases") {
						if c.Method() == "GET" {
							return modelMgmtHandler.GetModelAliases(c)
						} else if c.Method() == "POST" {
							return modelMgmtHandler.CreateModelAlias(c)
						}
					}
					return c.SendStatus(404)
				})
				adminRoutes.Delete("/models+/*", modelIdMiddleware, func(c *fiber.Ctx) error {
					suffix, _ := c.Locals("suffix").(string)
					if suffix == "/tier" {
						return modelMgmtHandler.ClearModelTier(c)
					} else if strings.HasPrefix(suffix, "/aliases/") {
						// Extract alias name from suffix
						aliasName := strings.TrimPrefix(suffix, "/aliases/")
						c.Locals("alias", aliasName)
						return modelMgmtHandler.DeleteModelAlias(c)
					}
					return c.SendStatus(404)
				})
				adminRoutes.Put("/models*/*", modelIdMiddleware, func(c *fiber.Ctx) error {
					suffix, _ := c.Locals("suffix").(string)
					if strings.HasPrefix(suffix, "/aliases/") {
						// Extract alias name from suffix
						aliasName := strings.TrimPrefix(suffix, "/aliases/")
						c.Locals("alias", aliasName)
						return modelMgmtHandler.UpdateModelAlias(c)
					}
					return c.SendStatus(404)
				})

				log.Println("✅ Model management routes registered (CRUD, testing, tiers, aliases)")
			}

			// Legacy stats endpoint
			adminRoutes.Get("/stats", adminHandler.GetSystemStats)

			log.Println("✅ Admin routes registered (status, analytics, user management, providers)")
		}

		// Webhook endpoint removed in v2.0 - no payment processing

	}

	// Trigger endpoints (API key authenticated, CORS open for external access)
	// These are meant to be called from anywhere (webhooks, external services, etc.)
	if triggerHandler != nil && apiKeyService != nil {
		trigger := app.Group("/api/trigger")

		// Apply permissive CORS for trigger endpoints only
		trigger.Use(cors.New(cors.Config{
			AllowOrigins:     "*",
			AllowMethods:     "GET,POST,OPTIONS",
			AllowHeaders:     "Origin,Content-Type,Accept,Authorization,X-API-Key",
			AllowCredentials: false,
		}))

		// Apply API key authentication
		trigger.Use(middleware.APIKeyMiddleware(apiKeyService))

		trigger.Post("/:agentId", triggerHandler.TriggerAgent)
		trigger.Get("/status/:executionId", triggerHandler.GetExecutionStatus)

		log.Println("✅ Trigger endpoints registered with open CORS (external access enabled)")
	}

	// External upload endpoint (API key authenticated, CORS open for external access)
	// Allows external services to upload files before triggering agents
	if apiKeyService != nil {
		externalUpload := app.Group("/api/external")

		// Apply permissive CORS for external upload
		externalUpload.Use(cors.New(cors.Config{
			AllowOrigins:     "*",
			AllowMethods:     "POST,OPTIONS",
			AllowHeaders:     "Origin,Content-Type,Accept,Authorization,X-API-Key",
			AllowCredentials: false,
		}))

		// Apply API key authentication with upload scope requirement
		externalUpload.Use(middleware.APIKeyMiddleware(apiKeyService))
		externalUpload.Use(middleware.RequireScope("upload"))

		externalUpload.Post("/upload", uploadLimiter, uploadHandler.Upload)

		log.Println("✅ External upload endpoint registered with open CORS (/api/external/upload)")
	}

	// Serve uploaded files (authenticated - replaced static serving for security)
	app.Get("/uploads/:filename", middleware.OptionalLocalAuthMiddleware(jwtAuth), func(c *fiber.Ctx) error {
		filename := c.Params("filename")

		// Get user ID from auth middleware
		userID, ok := c.Locals("user_id").(string)
		if !ok || userID == "" || userID == "anonymous" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Authentication required to access files",
			})
		}

		// Extract file ID from filename (UUID before extension)
		fileID := strings.TrimSuffix(filename, filepath.Ext(filename))

		// Get file from cache and verify ownership
		fileCache := filecache.GetService()
		file, found := fileCache.Get(fileID)

		if !found {
			log.Printf("⚠️  [FILE-ACCESS] File not found or expired: %s (user: %s)", fileID, userID)
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "File not found or has expired",
			})
		}

		// Verify ownership
		if file.UserID != userID {
			log.Printf("🚫 [SECURITY] User %s denied access to file %s (owned by %s)", userID, fileID, file.UserID)
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "Access denied to this file",
			})
		}

		// Verify file exists on disk
		if file.FilePath == "" || !strings.HasSuffix(file.FilePath, filename) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "File not found",
			})
		}

		log.Printf("✅ [FILE-ACCESS] User %s accessing file %s", userID, filename)

		// Serve file
		return c.SendFile(file.FilePath)
	})

	// WebSocket route (requires auth)
	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			c.Locals("allowed", true)
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	// Rate limiter for WebSocket connections (configurable via RATE_LIMIT_WEBSOCKET env var)
	wsConnectionLimiter := middleware.WebSocketRateLimiter(rateLimitConfig)

	app.Use("/ws/chat", wsConnectionLimiter)
	app.Use("/ws/chat", middleware.OptionalLocalAuthMiddleware(jwtAuth))
	app.Get("/ws/chat", websocket.New(wsHandler.Handle))

	// MCP WebSocket endpoint (requires authentication)
	app.Use("/mcp/connect", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			c.Locals("allowed", true)
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	// Rate limiter for MCP WebSocket connections (uses same config as WebSocket)
	mcpConnectionLimiter := middleware.WebSocketRateLimiter(rateLimitConfig)

	app.Use("/mcp/connect", mcpConnectionLimiter)
	app.Use("/mcp/connect", middleware.OptionalLocalAuthMiddleware(jwtAuth))
	app.Get("/mcp/connect", websocket.New(mcpWSHandler.HandleConnection))

	// Workflow execution WebSocket endpoint (requires authentication + MongoDB)
	if workflowWSHandler != nil {
		app.Use("/ws/workflow", func(c *fiber.Ctx) error {
			if websocket.IsWebSocketUpgrade(c) {
				c.Locals("allowed", true)
				return c.Next()
			}
			return fiber.ErrUpgradeRequired
		})

		app.Use("/ws/workflow", wsConnectionLimiter)
		app.Use("/ws/workflow", middleware.LocalAuthMiddleware(jwtAuth))
		app.Get("/ws/workflow", websocket.New(workflowWSHandler.Handle))
	}

	// Initialize background jobs
	var jobScheduler *jobs.JobScheduler
	if mongoDB != nil && tierService != nil && userService != nil {
		jobScheduler = jobs.NewJobScheduler()

		// Register retention cleanup job (runs daily at 2 AM UTC)
		retentionJob := jobs.NewRetentionCleanupJob(mongoDB, tierService)
		jobScheduler.Register("retention_cleanup", retentionJob)

		// Register grace period checker (runs hourly)
		gracePeriodJob := jobs.NewGracePeriodChecker(mongoDB, userService, tierService, 7) // 7 day grace period
		jobScheduler.Register("grace_period_check", gracePeriodJob)

		// Register promo expiration checker (runs hourly)
		promoExpirationJob := jobs.NewPromoExpirationChecker(mongoDB, userService, tierService)
		jobScheduler.Register("promo_expiration_check", promoExpirationJob)

		// Start job scheduler
		if err := jobScheduler.Start(); err != nil {
			log.Printf("⚠️  Failed to start job scheduler: %v", err)
		} else {
			log.Println("✅ Background job scheduler started")
		}
	} else {
		log.Println("⚠️  Background jobs disabled (requires MongoDB, TierService, UserService)")
	}

	// Start server
	log.Printf("✅ Server ready on port %s", cfg.Port)
	log.Printf("🔗 WebSocket endpoint: ws://localhost:%s/ws/chat", cfg.Port)
	log.Printf("🔌 MCP endpoint: ws://localhost:%s/mcp/connect", cfg.Port)
	log.Printf("⚡ Workflow endpoint: ws://localhost:%s/ws/workflow", cfg.Port)
	log.Printf("📡 Health check: http://localhost:%s/health", cfg.Port)
	if schedulerService != nil {
		log.Printf("⏰ Scheduler enabled with Redis")
	}
	if jobScheduler != nil {
		log.Printf("🕐 Background jobs: retention cleanup (daily 2 AM), grace period check (hourly)")
	}

	// Handle graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		log.Println("\n🛑 Shutting down server...")

		// Stop background jobs
		if jobScheduler != nil {
			jobScheduler.Stop()
		}

		// Stop scheduler first
		if schedulerService != nil {
			if err := schedulerService.Stop(); err != nil {
				log.Printf("⚠️ Error stopping scheduler: %v", err)
			}
		}

		// Stop PubSub service
		if pubsubService != nil {
			if err := pubsubService.Stop(); err != nil {
				log.Printf("⚠️ Error stopping PubSub: %v", err)
			}
		}

		// Shutdown Fiber
		if err := app.Shutdown(); err != nil {
			log.Printf("⚠️ Error shutting down server: %v", err)
		}
	}()

	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("❌ Failed to start server: %v", err)
	}
}

// syncProviders syncs providers from JSON file to database
func syncProviders(filePath string, providerService *services.ProviderService, modelService *services.ModelService, chatService *services.ChatService) error {
	log.Println("🔄 Syncing providers from providers.json...")

	providersConfig, err := config.LoadProviders(filePath)
	if err != nil {
		return fmt.Errorf("failed to load providers config: %w", err)
	}

	log.Printf("📋 Syncing %d providers from providers.json...", len(providersConfig.Providers))

	// Build a set of provider names from config
	configProviderNames := make(map[string]bool)
	for _, providerConfig := range providersConfig.Providers {
		configProviderNames[providerConfig.Name] = true
	}

	// Clean up stale providers that are no longer in providers.json
	existingProviders, err := providerService.GetAllIncludingDisabled()
	if err != nil {
		log.Printf("⚠️  Could not check for stale providers: %v", err)
	} else {
		for _, existingProvider := range existingProviders {
			if !configProviderNames[existingProvider.Name] {
				log.Printf("   🗑️  Removing stale provider: %s (ID %d) - no longer in providers.json", existingProvider.Name, existingProvider.ID)
				if err := providerService.Delete(existingProvider.ID); err != nil {
					log.Printf("   ⚠️  Failed to delete stale provider %s: %v", existingProvider.Name, err)
				} else {
					log.Printf("   ✅ Deleted stale provider: %s and its models", existingProvider.Name)
				}
			}
		}
	}

	for _, providerConfig := range providersConfig.Providers {
		// Check if provider exists
		existingProvider, err := providerService.GetByName(providerConfig.Name)
		if err != nil {
			return fmt.Errorf("failed to check provider: %w", err)
		}

		var provider *models.Provider
		if existingProvider == nil {
			// Create new provider
			log.Printf("   ➕ Creating provider: %s", providerConfig.Name)
			provider, err = providerService.Create(providerConfig)
			if err != nil {
				return fmt.Errorf("failed to create provider: %w", err)
			}
		} else {
			// Update existing provider
			log.Printf("   ♻️  Updating provider: %s (ID %d)", providerConfig.Name, existingProvider.ID)
			if err := providerService.Update(existingProvider.ID, providerConfig); err != nil {
				return fmt.Errorf("failed to update provider: %w", err)
			}
			provider = existingProvider
		}

		// Get config service instance
		configService := services.GetConfigService()

		// Load model aliases into both chat service and config service
		if len(providerConfig.ModelAliases) > 0 {
			log.Printf("   🔄 Loading %d model aliases for %s...", len(providerConfig.ModelAliases), providerConfig.Name)
			chatService.SetModelAliases(provider.ID, providerConfig.ModelAliases)
			configService.SetModelAliases(provider.ID, providerConfig.ModelAliases)

			// Save aliases to database
			if err := modelService.SaveAliasesToDB(provider.ID, providerConfig.ModelAliases); err != nil {
				log.Printf("   ⚠️  Failed to save aliases to database for %s: %v", providerConfig.Name, err)
			}
		}

		// Store recommended models
		if providerConfig.RecommendedModels != nil {
			configService.SetRecommendedModels(provider.ID, providerConfig.RecommendedModels)

			// Save recommended models to database
			if err := modelService.SaveRecommendedModelsToDB(provider.ID, providerConfig.RecommendedModels); err != nil {
				log.Printf("   ⚠️  Failed to save recommended models to database for %s: %v", providerConfig.Name, err)
			}
		}

		// Store provider security flag
		configService.SetProviderSecure(provider.ID, providerConfig.Secure)

		// Sync filters
		if len(providerConfig.Filters) > 0 {
			log.Printf("   🔧 Syncing %d filters for %s...", len(providerConfig.Filters), providerConfig.Name)
			if err := providerService.SyncFilters(provider.ID, providerConfig.Filters); err != nil {
				return fmt.Errorf("failed to sync filters: %w", err)
			}
		}

		// Fetch models if provider is enabled
		if providerConfig.Enabled {
			if err := modelService.FetchFromProvider(provider); err != nil {
				log.Printf("   ⚠️  Failed to fetch models for %s: %v", provider.Name, err)
			} else {
				// Sync model alias metadata to database (smart_tool_router, agents, etc.)
				if len(providerConfig.ModelAliases) > 0 {
					if err := modelService.SyncModelAliasMetadata(provider.ID, providerConfig.ModelAliases); err != nil {
						log.Printf("   ⚠️  Failed to sync model alias metadata for %s: %v", provider.Name, err)
					}
				}

				// Apply filters
				if err := providerService.ApplyFilters(provider.ID); err != nil {
					log.Printf("   ⚠️  Failed to apply filters for %s: %v", provider.Name, err)
				}
			}
		}
	}

	// After syncing providers to database, load image providers from database
	log.Println("🎨 Loading image providers from database...")
	allProviders, err := providerService.GetAll()
	if err != nil {
		log.Printf("⚠️  Failed to load providers from database: %v", err)
	} else {
		// Convert database Provider models to ProviderConfig
		var providerConfigs []models.ProviderConfig
		for _, p := range allProviders {
			providerConfigs = append(providerConfigs, models.ProviderConfig{
				Name:          p.Name,
				BaseURL:       p.BaseURL,
				APIKey:        p.APIKey,
				Enabled:       p.Enabled,
				Secure:        p.Secure,
				AudioOnly:     p.AudioOnly,
				ImageOnly:     p.ImageOnly,
				ImageEditOnly: p.ImageEditOnly,
				DefaultModel:  p.DefaultModel,
				SystemPrompt:  p.SystemPrompt,
				Favicon:       p.Favicon,
			})
		}

		// Load image providers into the image provider service
		imageProviderService := services.GetImageProviderService()
		imageProviderService.LoadFromProviders(providerConfigs)

		// Load image edit providers into the image edit provider service
		imageEditProviderService := services.GetImageEditProviderService()
		imageEditProviderService.LoadFromProviders(providerConfigs)
	}

	log.Println("✅ Provider sync completed")
	return nil
}

// loadConfigFromDatabase loads model aliases and recommended models from database
// Returns true if data was successfully loaded, false if database is empty (first run)
func loadConfigFromDatabase(modelService *services.ModelService, chatService *services.ChatService, providerService *services.ProviderService) (bool, error) {
	log.Println("🔄 Loading configuration from database...")

	// Load aliases from database
	aliases, err := modelService.LoadAllAliasesFromDB()
	if err != nil {
		return false, fmt.Errorf("failed to load aliases from database: %w", err)
	}

	// Load recommended models from database
	recommendedModels, err := modelService.LoadAllRecommendedModelsFromDB()
	if err != nil {
		return false, fmt.Errorf("failed to load recommended models from database: %w", err)
	}

	// If database is empty, that's fine - admin will configure via UI
	if len(aliases) == 0 && len(recommendedModels) == 0 {
		log.Println("📋 Database is empty - use admin UI to configure providers and models")
		return false, nil
	}

	// Load into ConfigService
	configService := services.GetConfigService()

	// Load all providers to get security flags
	_, err = providerService.GetAllIncludingDisabled()
	if err != nil {
		return false, fmt.Errorf("failed to load providers: %w", err)
	}

	// Load aliases into both chat service and config service
	for providerID, providerAliases := range aliases {
		if len(providerAliases) > 0 {
			chatService.SetModelAliases(providerID, providerAliases)
			configService.SetModelAliases(providerID, providerAliases)
			log.Printf("   ✅ Loaded %d aliases for provider %d", len(providerAliases), providerID)
		}
	}

	// Load recommended models into config service
	for providerID, recommended := range recommendedModels {
		configService.SetRecommendedModels(providerID, recommended)
		log.Printf("   ✅ Loaded recommended models for provider %d", providerID)
	}

	// Load image providers from database
	log.Println("🎨 Loading image providers from database...")
	allProviders, err := providerService.GetAll()
	if err != nil {
		log.Printf("⚠️  Failed to load providers from database: %v", err)
	} else {
		// Convert database Provider models to ProviderConfig
		var providerConfigs []models.ProviderConfig
		for _, p := range allProviders {
			providerConfigs = append(providerConfigs, models.ProviderConfig{
				Name:          p.Name,
				BaseURL:       p.BaseURL,
				APIKey:        p.APIKey,
				Enabled:       p.Enabled,
				Secure:        p.Secure,
				AudioOnly:     p.AudioOnly,
				ImageOnly:     p.ImageOnly,
				ImageEditOnly: p.ImageEditOnly,
				DefaultModel:  p.DefaultModel,
				SystemPrompt:  p.SystemPrompt,
				Favicon:       p.Favicon,
			})
		}

		// Load image providers into the image provider service
		imageProviderService := services.GetImageProviderService()
		imageProviderService.LoadFromProviders(providerConfigs)

		// Load image edit providers into the image edit provider service
		imageEditProviderService := services.GetImageEditProviderService()
		imageEditProviderService.LoadFromProviders(providerConfigs)
	}

	log.Printf("✅ Loaded configuration from database: %d provider aliases, %d recommended model sets",
		len(aliases), len(recommendedModels))
	return true, nil
}

// startModelRefreshJob starts a background job to refresh models every 24 hours
func startModelRefreshJob(providerService *services.ProviderService, modelService *services.ModelService, chatService *services.ChatService) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	log.Println("⏰ Model refresh job started (every 24 hours)")

	for range ticker.C {
		log.Println("🔄 Running scheduled model refresh...")

		// Reload aliases from database to ensure they stay in sync
		log.Println("🔄 Reloading model aliases from database...")
		if err := reloadModelAliases(providerService, modelService, chatService); err != nil {
			log.Printf("⚠️  Failed to reload model aliases: %v", err)
		} else {
			log.Println("✅ Model aliases reloaded successfully")
		}

		providers, err := providerService.GetAll()
		if err != nil {
			log.Printf("❌ Failed to get providers for refresh: %v", err)
			continue
		}

		for _, provider := range providers {
			if !provider.Enabled {
				continue
			}

			if err := modelService.FetchFromProvider(&provider); err != nil {
				log.Printf("❌ Error refreshing models for %s: %v", provider.Name, err)
			} else {
				// Apply filters after refresh
				if err := providerService.ApplyFilters(provider.ID); err != nil {
					log.Printf("⚠️  Failed to apply filters for %s: %v", provider.Name, err)
				}
			}
		}

		log.Println("✅ Scheduled model refresh completed")
	}
}

// reloadModelAliases reloads model aliases from database into memory
// This is called by the background refresh job to keep in-memory cache fresh
func reloadModelAliases(providerService *services.ProviderService, modelService *services.ModelService, chatService *services.ChatService) error {
	log.Println("🔄 [ALIAS-RELOAD] Loading model aliases from database...")

	// Load aliases from database
	aliases, err := modelService.LoadAllAliasesFromDB()
	if err != nil {
		return fmt.Errorf("failed to load aliases from database: %w", err)
	}

	// Load recommended models from database
	recommendedModels, err := modelService.LoadAllRecommendedModelsFromDB()
	if err != nil {
		return fmt.Errorf("failed to load recommended models from database: %w", err)
	}

	configService := services.GetConfigService()

	// Load aliases into both chat service and config service
	for providerID, providerAliases := range aliases {
		if len(providerAliases) > 0 {
			chatService.SetModelAliases(providerID, providerAliases)
			configService.SetModelAliases(providerID, providerAliases)
			log.Printf("   ✅ Reloaded %d aliases for provider %d", len(providerAliases), providerID)
		}
	}

	// Load recommended models into config service
	for providerID, recommended := range recommendedModels {
		configService.SetRecommendedModels(providerID, recommended)
	}

	log.Printf("✅ [ALIAS-RELOAD] Configuration reloaded from database")
	return nil
}

// startImageCleanupJob starts a background job to clean up expired images every 10 minutes
func startImageCleanupJob(uploadDir string) {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	log.Println("⏰ File cleanup job started (every 10 minutes) - handles images, CSV, Excel, JSON, etc.")

	for range ticker.C {
		log.Println("🧹 Running scheduled file cleanup...")

		// Get file cache service
		fileCache := filecache.GetService()

		// Cleanup expired files tracked in cache (images, CSV, Excel, JSON, etc.)
		fileCache.CleanupExpiredFiles()

		// Cleanup orphaned files on disk (not in cache - e.g., from server restarts)
		// Max age of 1 hour matches our retention policy
		fileCache.CleanupOrphanedFiles(uploadDir, 1*time.Hour)

		log.Println("✅ Scheduled file cleanup completed")
	}
}

// startDocumentCleanupJob starts a background job to clean up downloaded documents every 5 minutes
func startDocumentCleanupJob() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	log.Println("⏰ Document cleanup job started (every 5 minutes)")

	for range ticker.C {
		log.Println("🧹 Running scheduled document cleanup...")

		// Get document service
		documentService := document.GetService()

		// Cleanup downloaded documents
		documentService.CleanupDownloadedDocuments()

		log.Println("✅ Scheduled document cleanup completed")
	}
}

// startMemoryExtractionWorker processes pending memory extraction jobs
func startMemoryExtractionWorker(memoryExtractionService *services.MemoryExtractionService) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	log.Println("⏰ Memory extraction worker started (every 30 seconds)")

	for range ticker.C {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		if err := memoryExtractionService.ProcessPendingJobs(ctx); err != nil {
			log.Printf("⚠️ [MEMORY-WORKER] Failed to process jobs: %v", err)
		}
		cancel()
	}
}

func startMemoryDecayWorker(memoryDecayService *services.MemoryDecayService) {
	// Run immediately on startup
	log.Println("🔄 [MEMORY-DECAY] Running initial decay job")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	if err := memoryDecayService.RunDecayJob(ctx); err != nil {
		log.Printf("⚠️ [MEMORY-DECAY] Initial decay job failed: %v", err)
	}
	cancel()

	// Then run every 6 hours
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()

	log.Println("⏰ Memory decay worker started (every 6 hours)")

	for range ticker.C {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		if err := memoryDecayService.RunDecayJob(ctx); err != nil {
			log.Printf("⚠️ [MEMORY-DECAY] Decay job failed: %v", err)
		}
		cancel()
	}
}

// startProvidersFileWatcher watches providers.json for changes and auto-syncs
func startProvidersFileWatcher(
	filePath string,
	providerService *services.ProviderService,
	modelService *services.ModelService,
	chatService *services.ChatService,
) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("⚠️  Failed to create file watcher: %v", err)
		return
	}

	// Get absolute path for the file
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		log.Printf("⚠️  Failed to get absolute path for %s: %v", filePath, err)
		watcher.Close()
		return
	}

	// Watch the directory containing the file (more reliable than watching the file directly)
	dir := filepath.Dir(absPath)
	filename := filepath.Base(absPath)

	if err := watcher.Add(dir); err != nil {
		log.Printf("⚠️  Failed to watch directory %s: %v", dir, err)
		watcher.Close()
		return
	}

	log.Printf("👁️  Watching %s for changes (hot-reload enabled)", filePath)

	// Debounce timer to avoid multiple syncs for rapid file changes
	var debounceTimer *time.Timer
	debounceDuration := 500 * time.Millisecond

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}

			// Only react to changes to our specific file
			if filepath.Base(event.Name) != filename {
				continue
			}

			// React to write and create events
			if event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Create == fsnotify.Create {
				// Debounce: cancel previous timer and set a new one
				if debounceTimer != nil {
					debounceTimer.Stop()
				}

				debounceTimer = time.AfterFunc(debounceDuration, func() {
					log.Printf("🔄 Detected changes in %s, re-syncing providers...", filePath)

					if err := syncProviders(filePath, providerService, modelService, chatService); err != nil {
						log.Printf("❌ Failed to sync providers after file change: %v", err)
					} else {
						log.Printf("✅ Providers synced successfully from %s", filePath)
					}
				})
			}

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("⚠️  File watcher error: %v", err)
		}
	}
}
