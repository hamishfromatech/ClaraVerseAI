package handlers

import (
	"claraverse/internal/models"
	"claraverse/internal/services"
	"claraverse/pkg/auth"
	"context"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// LocalAuthHandler handles local JWT authentication endpoints
type LocalAuthHandler struct {
	jwtAuth     *auth.LocalJWTAuth
	userService *services.UserService
}

// NewLocalAuthHandler creates a new local auth handler
func NewLocalAuthHandler(jwtAuth *auth.LocalJWTAuth, userService *services.UserService) *LocalAuthHandler {
	return &LocalAuthHandler{
		jwtAuth:     jwtAuth,
		userService: userService,
	}
}

// RegisterRequest is the request body for registration
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// LoginRequest is the request body for login
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// RefreshTokenRequest is the request body for token refresh
type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// AuthResponse is the response for successful authentication
type AuthResponse struct {
	AccessToken  string             `json:"access_token"`
	RefreshToken string             `json:"refresh_token"`
	User         models.UserResponse `json:"user"`
	ExpiresIn    int                `json:"expires_in"` // seconds
}

// Register creates a new user account
// POST /api/auth/register
func (h *LocalAuthHandler) Register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate email
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Valid email address is required",
		})
	}

	// Validate password
	if err := auth.ValidatePassword(req.Password); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	ctx := context.Background()

	// Check if user already exists
	existingUser, _ := h.userService.GetUserByEmail(ctx, req.Email)
	if existingUser != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "User with this email already exists",
		})
	}

	// Hash password
	passwordHash, err := h.jwtAuth.HashPassword(req.Password)
	if err != nil {
		log.Printf("❌ Failed to hash password: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create account",
		})
	}

	// Check if this is the first user (first user becomes admin)
	userCount, err := h.userService.GetUserCount(ctx)
	if err != nil {
		log.Printf("⚠️ Failed to get user count: %v", err)
		userCount = 1 // Default to non-admin if count check fails
	}

	// Determine user role (first user = admin, others = user)
	userRole := "user"
	if userCount == 0 {
		userRole = "admin"
		log.Printf("🎉 Creating first user as admin: %s", req.Email)
	}

	// Create user
	user := &models.User{
		ID:                  primitive.NewObjectID(),
		Email:               req.Email,
		PasswordHash:        passwordHash,
		EmailVerified:       true, // Auto-verify in dev mode (no SMTP)
		RefreshTokenVersion: 0,
		Role:                userRole,
		CreatedAt:           time.Now(),
		LastLoginAt:         time.Now(),
		SubscriptionTier:    "pro", // Default: all users get Pro tier
		SubscriptionStatus:  "active",
		Preferences: models.UserPreferences{
			StoreBuilderChatHistory: true,
			MemoryEnabled:           false,
		},
	}

	// Save user to database
	if err := h.userService.CreateUser(ctx, user); err != nil {
		log.Printf("❌ Failed to create user: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create account",
		})
	}

	// Generate tokens
	accessToken, refreshToken, err := h.jwtAuth.GenerateTokens(user.ID.Hex(), user.Email, user.Role)
	if err != nil {
		log.Printf("❌ Failed to generate tokens: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate authentication tokens",
		})
	}

	// Set refresh token as httpOnly cookie
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		Expires:  time.Now().Add(7 * 24 * time.Hour), // 7 days
		HTTPOnly: true,
		Secure:   c.Protocol() == "https", // HTTPS only in production
		SameSite: "Strict",
		Path:     "/api/auth",
	})

	log.Printf("✅ User registered: %s (%s)", user.Email, user.ID.Hex())

	return c.Status(fiber.StatusCreated).JSON(AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         user.ToResponse(),
		ExpiresIn:    15 * 60, // 15 minutes in seconds
	})
}

// Login authenticates a user
// POST /api/auth/login
func (h *LocalAuthHandler) Login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	ctx := context.Background()

	// Get user by email
	user, err := h.userService.GetUserByEmail(ctx, req.Email)
	if err != nil || user == nil {
		// Use constant-time response to prevent email enumeration
		time.Sleep(200 * time.Millisecond)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
	}

	// Verify password
	valid, err := h.jwtAuth.VerifyPassword(user.PasswordHash, req.Password)
	if err != nil || !valid {
		log.Printf("⚠️ Failed login attempt for user: %s", req.Email)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
	}

	// Update last login time
	user.LastLoginAt = time.Now()
	if err := h.userService.UpdateUser(ctx, user); err != nil {
		log.Printf("⚠️ Failed to update last login time: %v", err)
		// Non-critical, continue
	}

	// Generate tokens
	accessToken, refreshToken, err := h.jwtAuth.GenerateTokens(user.ID.Hex(), user.Email, user.Role)
	if err != nil {
		log.Printf("❌ Failed to generate tokens: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate authentication tokens",
		})
	}

	// Set refresh token as httpOnly cookie
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		HTTPOnly: true,
		Secure:   c.Protocol() == "https",
		SameSite: "Strict",
		Path:     "/api/auth",
	})

	log.Printf("✅ User logged in: %s (%s)", user.Email, user.ID.Hex())

	return c.JSON(AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         user.ToResponse(),
		ExpiresIn:    15 * 60,
	})
}

// RefreshToken generates a new access token from a refresh token
// POST /api/auth/refresh
func (h *LocalAuthHandler) RefreshToken(c *fiber.Ctx) error {
	// Try to get refresh token from cookie first
	refreshToken := c.Cookies("refresh_token")

	// Fallback to request body
	if refreshToken == "" {
		var req RefreshTokenRequest
		if err := c.BodyParser(&req); err == nil {
			refreshToken = req.RefreshToken
		}
	}

	if refreshToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Refresh token is required",
		})
	}

	// Verify refresh token
	claims, err := h.jwtAuth.VerifyRefreshToken(refreshToken)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid or expired refresh token",
		})
	}

	ctx := context.Background()

	// Get user from database
	userID, err := primitive.ObjectIDFromHex(claims.UserID)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid user ID in token",
		})
	}

	user, err := h.userService.GetUserByID(ctx, userID)
	if err != nil || user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	// Check if refresh token version matches (for revocation)
	// Note: This would require storing token version in claims
	// For now, skip this check - implement later with Redis

	// Generate new access token (refresh token remains valid)
	newAccessToken, _, err := h.jwtAuth.GenerateTokens(user.ID.Hex(), user.Email, user.Role)
	if err != nil {
		log.Printf("❌ Failed to generate new access token: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to refresh token",
		})
	}

	return c.JSON(fiber.Map{
		"access_token": newAccessToken,
		"expires_in":   15 * 60,
	})
}

// Logout invalidates the refresh token
// POST /api/auth/logout
func (h *LocalAuthHandler) Logout(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		// Allow logout even if not authenticated (clear cookie)
		c.ClearCookie("refresh_token")
		return c.JSON(fiber.Map{
			"message": "Logged out successfully",
		})
	}

	ctx := context.Background()

	// Increment refresh token version to invalidate all existing tokens
	objID, err := primitive.ObjectIDFromHex(userID)
	if err == nil {
		// Increment token version in database
		_, err = h.userService.Collection().UpdateOne(ctx,
			bson.M{"_id": objID},
			bson.M{"$inc": bson.M{"refreshTokenVersion": 1}},
		)
		if err != nil {
			log.Printf("⚠️ Failed to increment token version: %v", err)
			// Non-critical, continue
		}
	}

	// Clear refresh token cookie
	c.ClearCookie("refresh_token")

	log.Printf("✅ User logged out: %s", userID)

	return c.JSON(fiber.Map{
		"message": "Logged out successfully",
	})
}

// GetCurrentUser returns the currently authenticated user
// GET /api/auth/me
func (h *LocalAuthHandler) GetCurrentUser(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	ctx := context.Background()
	objID, err := primitive.ObjectIDFromHex(userID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid user ID",
		})
	}

	user, err := h.userService.GetUserByID(ctx, objID)
	if err != nil || user == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	return c.JSON(user.ToResponse())
}

// GetStatus returns system status for unauthenticated users
// GET /api/auth/status
func (h *LocalAuthHandler) GetStatus(c *fiber.Ctx) error {
	ctx := context.Background()

	// Check if any users exist
	userCount, err := h.userService.GetUserCount(ctx)
	if err != nil {
		log.Printf("⚠️ Failed to get user count: %v", err)
		userCount = 0
	}

	return c.JSON(fiber.Map{
		"has_users": userCount > 0,
	})
}
