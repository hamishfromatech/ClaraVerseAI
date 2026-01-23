package handlers

import (
	"claraverse/internal/services"
	"fmt"
	"log"
	"net/url"
	"strconv"

	"github.com/gofiber/fiber/v2"
)

// ModelManagementHandler handles model management operations for admin
type ModelManagementHandler struct {
	modelMgmtService *services.ModelManagementService
	modelService     *services.ModelService
	providerService  *services.ProviderService
}

// Helper function to decode URL-encoded model IDs (handles slashes and special characters)
func decodeModelID(encodedID string) (string, error) {
	return url.QueryUnescape(encodedID)
}

// NewModelManagementHandler creates a new model management handler
func NewModelManagementHandler(
	modelMgmtService *services.ModelManagementService,
	modelService *services.ModelService,
	providerService *services.ProviderService,
) *ModelManagementHandler {
	return &ModelManagementHandler{
		modelMgmtService: modelMgmtService,
		modelService:     modelService,
		providerService:  providerService,
	}
}

// ================== MODEL CRUD ENDPOINTS ==================

// GetAllModels returns all models with metadata
// GET /api/admin/models
func (h *ModelManagementHandler) GetAllModels(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	log.Printf("🔍 Admin %s fetching all models", adminUserID)

	// Get all models (including hidden ones)
	models, err := h.modelService.GetAll(false)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch models",
		})
	}

	return c.JSON(models)
}

// CreateModel creates a new model manually
// POST /api/admin/models
func (h *ModelManagementHandler) CreateModel(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)

	var req services.CreateModelRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate required fields
	if req.ModelID == "" || req.ProviderID == 0 || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "model_id, provider_id, and name are required",
		})
	}

	log.Printf("📝 Admin %s creating model: %s (provider %d)", adminUserID, req.ModelID, req.ProviderID)

	model, err := h.modelMgmtService.CreateModel(c.Context(), &req)
	if err != nil {
		log.Printf("❌ Failed to create model: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create model: " + err.Error(),
		})
	}

	return c.Status(fiber.StatusCreated).JSON(model)
}

// UpdateModel updates an existing model's metadata
// PUT /api/admin/models/:modelId
func (h *ModelManagementHandler) UpdateModel(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	encodedModelID := c.Params("modelId")

	if encodedModelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// Decode URL-encoded model ID
	modelID, err := decodeModelID(encodedModelID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid model ID encoding",
		})
	}

	var req services.UpdateModelRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// WORKAROUND: Fiber's BodyParser doesn't handle *bool correctly when value is false
	// Manually parse boolean fields from raw JSON if present
	var rawBody map[string]interface{}
	if err := c.BodyParser(&rawBody); err == nil {
		log.Printf("[DEBUG] Raw request body: %+v", rawBody)

		if val, exists := rawBody["isVisible"]; exists {
			if boolVal, ok := val.(bool); ok {
				req.IsVisible = &boolVal
				log.Printf("[DEBUG] Manually parsed isVisible: %v", boolVal)
			}
		}

		if val, exists := rawBody["smart_tool_router"]; exists {
			if boolVal, ok := val.(bool); ok {
				req.SmartToolRouter = &boolVal
				log.Printf("[DEBUG] Manually parsed smart_tool_router: %v", boolVal)
			}
		}

		if val, exists := rawBody["supports_tools"]; exists {
			if boolVal, ok := val.(bool); ok {
				req.SupportsTools = &boolVal
				log.Printf("[DEBUG] Manually parsed supports_tools: %v", boolVal)
			}
		}

		if val, exists := rawBody["supports_vision"]; exists {
			if boolVal, ok := val.(bool); ok {
				req.SupportsVision = &boolVal
				log.Printf("[DEBUG] Manually parsed supports_vision: %v", boolVal)
			}
		}

		if val, exists := rawBody["supports_streaming"]; exists {
			if boolVal, ok := val.(bool); ok {
				req.SupportsStreaming = &boolVal
				log.Printf("[DEBUG] Manually parsed supports_streaming: %v", boolVal)
			}
		}

		if val, exists := rawBody["free_tier"]; exists {
			if boolVal, ok := val.(bool); ok {
				req.FreeTier = &boolVal
				log.Printf("[DEBUG] Manually parsed free_tier: %v", boolVal)
			}
		}
	}

	log.Printf("📝 Admin %s updating model: %s", adminUserID, modelID)

	model, err := h.modelMgmtService.UpdateModel(c.Context(), modelID, &req)
	if err != nil {
		log.Printf("❌ Failed to update model: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update model: " + err.Error(),
		})
	}

	return c.JSON(model)
}

// DeleteModel deletes a model
// DELETE /api/admin/models/:modelId
func (h *ModelManagementHandler) DeleteModel(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	encodedModelID := c.Params("modelId")

	if encodedModelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// Decode URL-encoded model ID
	modelID, err := decodeModelID(encodedModelID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid model ID encoding",
		})
	}

	log.Printf("🗑️  Admin %s deleting model: %s", adminUserID, modelID)

	if err := h.modelMgmtService.DeleteModel(c.Context(), modelID); err != nil {
		log.Printf("❌ Failed to delete model: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to delete model: " + err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Model deleted successfully",
	})
}

// ================== MODEL FETCHING ENDPOINTS ==================

// FetchModelsFromProvider fetches models from a provider's API
// POST /api/admin/providers/:providerId/fetch
func (h *ModelManagementHandler) FetchModelsFromProvider(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	providerIDStr := c.Params("providerId")

	providerID, err := strconv.Atoi(providerIDStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid provider ID",
		})
	}

	log.Printf("🔄 Admin %s fetching models from provider %d", adminUserID, providerID)

	count, err := h.modelMgmtService.FetchModelsFromProvider(c.Context(), providerID)
	if err != nil {
		log.Printf("❌ Failed to fetch models: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch models: " + err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success":       true,
		"models_fetched": count,
		"message":       "Models fetched and stored successfully",
	})
}

// SyncProviderToJSON forces sync of a provider's models to providers.json
// POST /api/admin/providers/:providerId/sync
func (h *ModelManagementHandler) SyncProviderToJSON(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	providerIDStr := c.Params("providerId")

	providerID, err := strconv.Atoi(providerIDStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid provider ID",
		})
	}

	log.Printf("🔄 Admin %s syncing provider %d to JSON", adminUserID, providerID)

	// The sync is handled automatically by the service, just trigger it
	_, err = h.modelMgmtService.FetchModelsFromProvider(c.Context(), providerID)
	if err != nil {
		log.Printf("❌ Failed to sync provider: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to sync provider: " + err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Provider synced to providers.json successfully",
	})
}

// ================== MODEL TESTING ENDPOINTS ==================

// TestModelConnection tests basic connection to a model
// POST /api/admin/models/:modelId/test/connection
func (h *ModelManagementHandler) TestModelConnection(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	encodedModelID := c.Params("modelId")

	if encodedModelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// Decode URL-encoded model ID
	modelID, err := decodeModelID(encodedModelID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid model ID encoding",
		})
	}

	log.Printf("🔌 Admin %s testing connection for model: %s", adminUserID, modelID)

	result, err := h.modelMgmtService.TestModelConnection(c.Context(), modelID)
	if err != nil {
		log.Printf("❌ Connection test failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Connection test failed: " + err.Error(),
		})
	}

	if result.Passed {
		return c.JSON(fiber.Map{
			"success":    true,
			"passed":     result.Passed,
			"latency_ms": result.LatencyMs,
			"message":    "Connection test passed",
		})
	}

	return c.JSON(fiber.Map{
		"success":    false,
		"passed":     result.Passed,
		"latency_ms": result.LatencyMs,
		"error":      result.Error,
		"message":    "Connection test failed",
	})
}

// TestModelCapability tests model capabilities (tools, vision, streaming)
// POST /api/admin/models/:modelId/test/capability
func (h *ModelManagementHandler) TestModelCapability(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	encodedModelID := c.Params("modelId")

	if encodedModelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// Decode URL-encoded model ID
	modelID, err := decodeModelID(encodedModelID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid model ID encoding",
		})
	}

	log.Printf("🧪 Admin %s testing capabilities for model: %s", adminUserID, modelID)

	// TODO: Implement capability testing
	// This would test tools, vision, streaming support

	return c.JSON(fiber.Map{
		"message": "Capability testing not yet implemented",
	})
}

// RunModelBenchmark runs comprehensive benchmark suite on a model
// POST /api/admin/models/:modelId/benchmark
func (h *ModelManagementHandler) RunModelBenchmark(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	encodedModelID := c.Params("modelId")

	if encodedModelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// Decode URL-encoded model ID
	modelID, err := decodeModelID(encodedModelID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid model ID encoding",
		})
	}

	// URL decode the model ID (handles IDs with slashes)
	decodedModelID, err := url.QueryUnescape(modelID)
	if err != nil {
		log.Printf("❌ Failed to decode model ID: %v", err)
		decodedModelID = modelID // Fallback to original
	}

	log.Printf("📊 Admin %s running benchmark for model: %s (decoded: %s)", adminUserID, modelID, decodedModelID)

	results, err := h.modelMgmtService.RunBenchmark(c.Context(), decodedModelID)
	if err != nil {
		log.Printf("❌ Benchmark failed for model %s: %v", decodedModelID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Benchmark failed: " + err.Error(),
		})
	}

	log.Printf("✅ Benchmark completed for model %s. Results: connection=%v, structured=%v, performance=%v",
		decodedModelID,
		results.ConnectionTest != nil,
		results.StructuredOutput != nil,
		results.Performance != nil)

	return c.JSON(results)
}

// GetModelTestResults retrieves latest test results for a model
// GET /api/admin/models/:modelId/test-results
func (h *ModelManagementHandler) GetModelTestResults(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	encodedModelID := c.Params("modelId")

	if encodedModelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// Decode URL-encoded model ID
	modelID, err := decodeModelID(encodedModelID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid model ID encoding",
		})
	}

	log.Printf("🔍 Admin %s fetching test results for model: %s", adminUserID, modelID)

	// TODO: Query model_capabilities table for test results

	return c.JSON(fiber.Map{
		"message": "Test results retrieval not yet implemented",
	})
}

// ================== ALIAS MANAGEMENT ENDPOINTS ==================

// GetModelAliases retrieves all aliases for a model
// GET /api/admin/models/:modelId/aliases
func (h *ModelManagementHandler) GetModelAliases(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	encodedModelID := c.Params("modelId")

	if encodedModelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// Decode URL-encoded model ID
	modelID, err := decodeModelID(encodedModelID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid model ID encoding",
		})
	}

	// URL decode the model ID (handles IDs with slashes)
	decodedModelID, err := url.QueryUnescape(modelID)
	if err != nil {
		log.Printf("❌ Failed to decode model ID: %v", err)
		decodedModelID = modelID // Fallback to original
	}

	log.Printf("🔍 Admin %s fetching aliases for model: %s (decoded: %s)", adminUserID, modelID, decodedModelID)

	aliases, err := h.modelMgmtService.GetAliases(c.Context(), decodedModelID)
	if err != nil {
		log.Printf("❌ Failed to get aliases: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get aliases: " + err.Error(),
		})
	}

	log.Printf("✅ Returning %d aliases for model %s", len(aliases), decodedModelID)
	return c.JSON(aliases)
}

// CreateModelAlias creates a new alias for a model
// POST /api/admin/models/:modelId/aliases
func (h *ModelManagementHandler) CreateModelAlias(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	encodedModelID := c.Params("modelId")

	if encodedModelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// Decode URL-encoded model ID
	modelID, err := decodeModelID(encodedModelID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid model ID encoding",
		})
	}

	// URL decode the model ID (handles IDs with slashes)
	decodedModelID, err := url.QueryUnescape(modelID)
	if err != nil {
		log.Printf("❌ Failed to decode model ID: %v", err)
		decodedModelID = modelID // Fallback to original
	}

	var req services.CreateAliasRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Set model ID from URL parameter
	req.ModelID = decodedModelID

	// Validate required fields
	if req.AliasName == "" || req.ProviderID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "alias_name and provider_id are required",
		})
	}

	log.Printf("📝 Admin %s creating alias %s for model: %s", adminUserID, req.AliasName, modelID)

	if err := h.modelMgmtService.CreateAlias(c.Context(), &req); err != nil {
		log.Printf("❌ Failed to create alias: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create alias: " + err.Error(),
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"success": true,
		"message": "Alias created successfully",
	})
}

// UpdateModelAlias updates an existing alias
// PUT /api/admin/models/:modelId/aliases/:alias
func (h *ModelManagementHandler) UpdateModelAlias(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	modelID := c.Params("modelId")
	aliasName := c.Params("alias")

	if modelID == "" || aliasName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID and alias name are required",
		})
	}

	log.Printf("📝 Admin %s updating alias %s for model: %s", adminUserID, aliasName, modelID)

	// TODO: Implement alias update

	return c.JSON(fiber.Map{
		"message": "Alias update not yet implemented",
	})
}

// DeleteModelAlias deletes an alias
// DELETE /api/admin/models/:modelId/aliases/:alias
func (h *ModelManagementHandler) DeleteModelAlias(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)
	modelID := c.Params("modelId")
	aliasName := c.Params("alias")

	if modelID == "" || aliasName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID and alias name are required",
		})
	}

	// Get provider ID from query parameter or request body
	providerIDStr := c.Query("provider_id")
	if providerIDStr == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "provider_id query parameter is required",
		})
	}

	providerID, err := strconv.Atoi(providerIDStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid provider ID",
		})
	}

	log.Printf("🗑️  Admin %s deleting alias %s for model: %s", adminUserID, aliasName, modelID)

	if err := h.modelMgmtService.DeleteAlias(c.Context(), aliasName, providerID); err != nil {
		log.Printf("❌ Failed to delete alias: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to delete alias: " + err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Alias deleted successfully",
	})
}

// ImportAliasesFromJSON imports all aliases from providers.json into the database
// POST /api/admin/models/import-aliases
func (h *ModelManagementHandler) ImportAliasesFromJSON(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)

	log.Printf("📥 Admin %s triggering alias import from providers.json", adminUserID)

	if err := h.modelMgmtService.ImportAliasesFromJSON(c.Context()); err != nil {
		log.Printf("❌ Failed to import aliases: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to import aliases: " + err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Aliases imported successfully from providers.json",
	})
}

// ================== BULK OPERATIONS ENDPOINTS ==================

// BulkUpdateAgentsEnabled bulk enables/disables models for agent builder
// PUT /api/admin/models/bulk/agents-enabled
func (h *ModelManagementHandler) BulkUpdateAgentsEnabled(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)

	var req struct {
		ModelIDs []string `json:"model_ids"`
		Enabled  bool     `json:"enabled"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if len(req.ModelIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "model_ids array is required",
		})
	}

	log.Printf("📝 Admin %s bulk updating agents_enabled for %d models", adminUserID, len(req.ModelIDs))

	if err := h.modelMgmtService.BulkUpdateAgentsEnabled(req.ModelIDs, req.Enabled); err != nil {
		log.Printf("❌ Failed to bulk update agents_enabled: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to update models: %v", err),
		})
	}

	return c.JSON(fiber.Map{
		"message": fmt.Sprintf("Updated agents_enabled=%v for %d models", req.Enabled, len(req.ModelIDs)),
	})
}

// BulkUpdateVisibility bulk shows/hides models
// PUT /api/admin/models/bulk/visibility
func (h *ModelManagementHandler) BulkUpdateVisibility(c *fiber.Ctx) error {
	adminUserID := c.Locals("user_id").(string)

	var req struct {
		ModelIDs []string `json:"model_ids"`
		Visible  bool     `json:"visible"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if len(req.ModelIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "model_ids array is required",
		})
	}

	log.Printf("📝 Admin %s bulk updating visibility for %d models", adminUserID, len(req.ModelIDs))

	if err := h.modelMgmtService.BulkUpdateVisibility(req.ModelIDs, req.Visible); err != nil {
		log.Printf("❌ Failed to bulk update visibility: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to update models: %v", err),
		})
	}

	return c.JSON(fiber.Map{
		"message": fmt.Sprintf("Updated isVisible=%v for %d models", req.Visible, len(req.ModelIDs)),
	})
}

// ================== GLOBAL TIER MANAGEMENT ==================

// SetModelTier assigns a model to a global tier (tier1-tier5)
// POST /api/admin/models/:modelId/tier
func (h *ModelManagementHandler) SetModelTier(c *fiber.Ctx) error {
	modelID := c.Params("modelId")
	if modelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// URL decode the model ID (handles slashes and other special characters)
	decodedModelID, err := url.QueryUnescape(modelID)
	if err != nil {
		log.Printf("❌ Failed to decode model ID '%s': %v", modelID, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid model ID encoding",
		})
	}
	modelID = decodedModelID

	var req struct {
		ProviderID int    `json:"provider_id"`
		Tier       string `json:"tier"` // "tier1", "tier2", "tier3", "tier4", "tier5"
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.Tier == "" || req.ProviderID == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "tier and provider_id are required",
		})
	}

	if err := h.modelMgmtService.SetGlobalTier(modelID, req.ProviderID, req.Tier); err != nil {
		log.Printf("❌ Failed to set tier: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to set tier: %v", err),
		})
	}

	return c.JSON(fiber.Map{
		"message": fmt.Sprintf("Model assigned to %s", req.Tier),
	})
}

// ClearModelTier removes a model from its tier
// DELETE /api/admin/models/:modelId/tier
func (h *ModelManagementHandler) ClearModelTier(c *fiber.Ctx) error {
	var req struct {
		Tier string `json:"tier"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.Tier == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "tier is required",
		})
	}

	if err := h.modelMgmtService.ClearTier(req.Tier); err != nil {
		log.Printf("❌ Failed to clear tier: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to clear tier: %v", err),
		})
	}

	return c.JSON(fiber.Map{
		"message": fmt.Sprintf("Tier %s cleared", req.Tier),
	})
}

// GetTiers retrieves all global tier assignments
// GET /api/admin/tiers
func (h *ModelManagementHandler) GetTiers(c *fiber.Ctx) error {
	tiers, err := h.modelMgmtService.GetGlobalTiers()
	if err != nil {
		log.Printf("❌ Failed to get tiers: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve tiers",
		})
	}

	return c.JSON(fiber.Map{
		"tiers": tiers,
	})
}
