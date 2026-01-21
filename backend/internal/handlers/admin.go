package handlers

import (
	"claraverse/internal/models"
	"claraverse/internal/services"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
)

// AdminHandler handles admin operations
type AdminHandler struct {
	userService      *services.UserService
	tierService      *services.TierService
	analyticsService *services.AnalyticsService
	providerService  *services.ProviderService
	modelService     *services.ModelService
}

// NewAdminHandler creates a new admin handler
func NewAdminHandler(userService *services.UserService, tierService *services.TierService, analyticsService *services.AnalyticsService, providerService *services.ProviderService, modelService *services.ModelService) *AdminHandler {
	return &AdminHandler{
		userService:      userService,
		tierService:      tierService,
		analyticsService: analyticsService,
		providerService:  providerService,
		modelService:     modelService,
	}
}

// GetUserDetails returns detailed user information (admin only)
// GET /api/admin/users/:userID
func (h *AdminHandler) GetUserDetails(c *fiber.Ctx) error {
	targetUserID := c.Params("userID")
	if targetUserID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "User ID is required",
		})
	}

	adminUserID := c.Locals("user_id").(string)
	log.Printf("🔍 Admin %s viewing details for user %s", adminUserID, targetUserID)

	userDetails, err := h.userService.GetAdminUserDetails(c.Context(), targetUserID, h.tierService)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	return c.JSON(userDetails)
}

// SetLimitOverrides sets tier OR granular limit overrides for a user (admin only)
// POST /api/admin/users/:userID/overrides
func (h *AdminHandler) SetLimitOverrides(c *fiber.Ctx) error {
	targetUserID := c.Params("userID")
	if targetUserID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "User ID is required",
		})
	}

	var req models.SetLimitOverridesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate: must provide either tier OR limits
	if req.Tier == nil && req.Limits == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Must provide either 'tier' or 'limits'",
		})
	}

	if req.Tier != nil && req.Limits != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Cannot set both 'tier' and 'limits' at the same time",
		})
	}

	// Validate tier if provided
	if req.Tier != nil {
		validTiers := []string{
			models.TierFree,
			models.TierPro,
			models.TierMax,
			models.TierEnterprise,
			models.TierLegacyUnlimited,
		}
		isValid := false
		for _, validTier := range validTiers {
			if *req.Tier == validTier {
				isValid = true
				break
			}
		}
		if !isValid {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid tier",
			})
		}
	}

	adminUserID := c.Locals("user_id").(string)

	err := h.userService.SetLimitOverrides(
		c.Context(),
		targetUserID,
		adminUserID,
		req.Reason,
		req.Tier,
		req.Limits,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// Invalidate cache
	h.tierService.InvalidateCache(targetUserID)

	var message string
	if req.Tier != nil {
		message = fmt.Sprintf("Tier override set to %s", *req.Tier)
	} else {
		message = "Granular limit overrides set successfully"
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": message,
	})
}

// RemoveAllOverrides removes all overrides (tier and limits) for a user (admin only)
// DELETE /api/admin/users/:userID/overrides
func (h *AdminHandler) RemoveAllOverrides(c *fiber.Ctx) error {
	targetUserID := c.Params("userID")
	if targetUserID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "User ID is required",
		})
	}

	adminUserID := c.Locals("user_id").(string)

	err := h.userService.RemoveAllOverrides(c.Context(), targetUserID, adminUserID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// Invalidate cache
	h.tierService.InvalidateCache(targetUserID)

	return c.JSON(fiber.Map{
		"success": true,
		"message": "All overrides removed successfully",
	})
}

// ListUsers returns a GDPR-compliant paginated list of users (admin only)
// GET /api/admin/users
func (h *AdminHandler) ListUsers(c *fiber.Ctx) error {
	if h.analyticsService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Analytics service not available",
		})
	}

	// Parse query parameters
	page := c.QueryInt("page", 1)
	pageSize := c.QueryInt("page_size", 50)
	tier := c.Query("tier", "")
	search := c.Query("search", "")

	// Get aggregated user analytics (GDPR-compliant - no PII)
	users, totalCount, err := h.analyticsService.GetUserListGDPR(c.Context(), page, pageSize, tier, search)
	if err != nil {
		log.Printf("❌ [ADMIN] Failed to get user list: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch user list",
		})
	}

	return c.JSON(fiber.Map{
		"users":       users,
		"total_count": totalCount,
		"page":        page,
		"page_size":   pageSize,
		"gdpr_notice": "This data is aggregated and anonymized. Full email addresses are hashed for privacy. Only domains are shown for trend analysis.",
	})
}

// GetGDPRPolicy returns the GDPR data policy
// GET /api/admin/gdpr-policy
func (h *AdminHandler) GetGDPRPolicy(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"data_collected": []string{
			"User ID (anonymized)",
			"Email domain (for trend analysis only)",
			"Subscription tier",
			"Usage counts (chats, messages, agent runs)",
			"Activity timestamps",
		},
		"data_retention_days": 90,
		"purpose":             "Product analytics and performance monitoring",
		"legal_basis":         "Legitimate interest (GDPR Art. 6(1)(f))",
		"user_rights": []string{
			"Right to access (Art. 15)",
			"Right to rectification (Art. 16)",
			"Right to erasure (Art. 17)",
			"Right to data portability (Art. 20)",
			"Right to object (Art. 21)",
		},
	})
}

// GetSystemStats returns system statistics (admin only)
// GET /api/admin/stats
func (h *AdminHandler) GetSystemStats(c *fiber.Ctx) error {
	// TODO: Implement stats like user count by tier, active subscriptions, etc.
	return c.JSON(fiber.Map{
		"message": "System stats endpoint - to be implemented",
	})
}

// GetAdminStatus returns admin status for the authenticated user
// GET /api/admin/me
func (h *AdminHandler) GetAdminStatus(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(string)
	email := c.Locals("email")
	if email == nil {
		email = ""
	}

	return c.JSON(fiber.Map{
		"is_admin": true, // If this endpoint is reached, user is admin (middleware validated)
		"user_id":  userID,
		"email":    email,
	})
}

// GetOverviewAnalytics returns overview analytics
// GET /api/admin/analytics/overview
func (h *AdminHandler) GetOverviewAnalytics(c *fiber.Ctx) error {
	if h.analyticsService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Analytics service not available",
		})
	}

	stats, err := h.analyticsService.GetOverviewStats(c.Context())
	if err != nil {
		log.Printf("❌ [ADMIN] Failed to get overview analytics: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch overview analytics",
		})
	}

	return c.JSON(stats)
}

// GetProviderAnalytics returns provider usage analytics
// GET /api/admin/analytics/providers
func (h *AdminHandler) GetProviderAnalytics(c *fiber.Ctx) error {
	if h.analyticsService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Analytics service not available",
		})
	}

	analytics, err := h.analyticsService.GetProviderAnalytics(c.Context())
	if err != nil {
		log.Printf("❌ [ADMIN] Failed to get provider analytics: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch provider analytics",
		})
	}

	return c.JSON(analytics)
}

// GetChatAnalytics returns chat usage analytics
// GET /api/admin/analytics/chats
func (h *AdminHandler) GetChatAnalytics(c *fiber.Ctx) error {
	if h.analyticsService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Analytics service not available",
		})
	}

	analytics, err := h.analyticsService.GetChatAnalytics(c.Context())
	if err != nil {
		log.Printf("❌ [ADMIN] Failed to get chat analytics: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch chat analytics",
		})
	}

	return c.JSON(analytics)
}

// GetModelAnalytics returns model usage analytics (placeholder)
// GET /api/admin/analytics/models
func (h *AdminHandler) GetModelAnalytics(c *fiber.Ctx) error {
	// TODO: Implement model analytics
	return c.JSON([]fiber.Map{})
}

// GetAgentAnalytics returns comprehensive agent activity analytics
// GET /api/admin/analytics/agents
func (h *AdminHandler) GetAgentAnalytics(c *fiber.Ctx) error {
	if h.analyticsService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Analytics service not available",
		})
	}

	analytics, err := h.analyticsService.GetAgentAnalytics(c.Context())
	if err != nil {
		log.Printf("❌ [ADMIN] Failed to get agent analytics: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch agent analytics",
		})
	}

	return c.JSON(analytics)
}

// MigrateChatSessionTimestamps fixes existing chat sessions without proper timestamps
// POST /api/admin/analytics/migrate-timestamps
func (h *AdminHandler) MigrateChatSessionTimestamps(c *fiber.Ctx) error {
	if h.analyticsService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Analytics service not available",
		})
	}

	count, err := h.analyticsService.MigrateChatSessionTimestamps(c.Context())
	if err != nil {
		log.Printf("❌ [ADMIN] Failed to migrate chat session timestamps: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to migrate chat session timestamps",
			"details": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success":       true,
		"message":       fmt.Sprintf("Successfully migrated %d chat sessions", count),
		"sessions_updated": count,
	})
}

// GetProviders returns all providers from database
// GET /api/admin/providers
func (h *AdminHandler) GetProviders(c *fiber.Ctx) error {
	providers, err := h.providerService.GetAllIncludingDisabled()
	if err != nil {
		log.Printf("❌ [ADMIN] Failed to get providers: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get providers",
		})
	}

	// Get model counts, aliases, and filters for each provider
	var providerViews []fiber.Map
	for _, provider := range providers {
		// Get model count
		models, err := h.modelService.GetByProvider(provider.ID, false)
		modelCount := 0
		if err == nil {
			modelCount = len(models)
		}

		// Get aliases
		aliases, err := h.modelService.LoadAllAliasesFromDB()
		providerAliases := make(map[string]interface{})
		if err == nil && aliases[provider.ID] != nil {
			providerAliases = convertAliasesMapToInterface(aliases[provider.ID])
		}

		// Get filters
		filters, _ := h.providerService.GetFilters(provider.ID)

		// Get recommended models
		recommended, _ := h.modelService.LoadAllRecommendedModelsFromDB()
		var recommendedModels interface{}
		if recommended[provider.ID] != nil {
			recommendedModels = recommended[provider.ID]
		}

		providerView := fiber.Map{
			"id":                 provider.ID,
			"name":               provider.Name,
			"base_url":           provider.BaseURL,
			"enabled":            provider.Enabled,
			"audio_only":         provider.AudioOnly,
			"favicon":            provider.Favicon,
			"model_count":        modelCount,
			"model_aliases":      providerAliases,
			"filters":            filters,
			"recommended_models": recommendedModels,
		}

		providerViews = append(providerViews, providerView)
	}

	return c.JSON(fiber.Map{
		"providers": providerViews,
	})
}

// CreateProvider creates a new provider
// POST /api/admin/providers
func (h *AdminHandler) CreateProvider(c *fiber.Ctx) error {
	var req struct {
		Name          string `json:"name"`
		BaseURL       string `json:"base_url"`
		APIKey        string `json:"api_key"`
		Enabled       *bool  `json:"enabled"`
		AudioOnly     *bool  `json:"audio_only"`
		ImageOnly     *bool  `json:"image_only"`
		ImageEditOnly *bool  `json:"image_edit_only"`
		Secure        *bool  `json:"secure"`
		DefaultModel  string `json:"default_model"`
		SystemPrompt  string `json:"system_prompt"`
		Favicon       string `json:"favicon"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate required fields
	if req.Name == "" || req.BaseURL == "" || req.APIKey == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Name, base_url, and api_key are required",
		})
	}

	// Build provider config
	config := models.ProviderConfig{
		Name:          req.Name,
		BaseURL:       req.BaseURL,
		APIKey:        req.APIKey,
		Enabled:       req.Enabled != nil && *req.Enabled,
		AudioOnly:     req.AudioOnly != nil && *req.AudioOnly,
		ImageOnly:     req.ImageOnly != nil && *req.ImageOnly,
		ImageEditOnly: req.ImageEditOnly != nil && *req.ImageEditOnly,
		Secure:        req.Secure != nil && *req.Secure,
		DefaultModel:  req.DefaultModel,
		SystemPrompt:  req.SystemPrompt,
		Favicon:       req.Favicon,
	}

	provider, err := h.providerService.Create(config)
	if err != nil {
		log.Printf("❌ [ADMIN] Failed to create provider: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to create provider: %v", err),
		})
	}

	log.Printf("✅ [ADMIN] Created provider: %s (ID %d)", provider.Name, provider.ID)

	// Reload image providers if this is an image provider
	if config.ImageOnly || config.ImageEditOnly {
		h.reloadImageProviders()
	}

	return c.Status(fiber.StatusCreated).JSON(provider)
}

// UpdateProvider updates an existing provider
// PUT /api/admin/providers/:id
func (h *AdminHandler) UpdateProvider(c *fiber.Ctx) error {
	providerID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid provider ID",
		})
	}

	var req struct {
		Name          *string `json:"name"`
		BaseURL       *string `json:"base_url"`
		APIKey        *string `json:"api_key"`
		Enabled       *bool   `json:"enabled"`
		AudioOnly     *bool   `json:"audio_only"`
		ImageOnly     *bool   `json:"image_only"`
		ImageEditOnly *bool   `json:"image_edit_only"`
		Secure        *bool   `json:"secure"`
		DefaultModel  *string `json:"default_model"`
		SystemPrompt  *string `json:"system_prompt"`
		Favicon       *string `json:"favicon"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Get existing provider
	existing, err := h.providerService.GetByID(providerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Provider not found",
		})
	}

	// Build update config with existing values as defaults
	config := models.ProviderConfig{
		Name:          existing.Name,
		BaseURL:       existing.BaseURL,
		APIKey:        existing.APIKey,
		Enabled:       existing.Enabled,
		AudioOnly:     existing.AudioOnly,
		SystemPrompt:  existing.SystemPrompt,
		Favicon:       existing.Favicon,
	}

	// Apply updates
	if req.Name != nil {
		config.Name = *req.Name
	}
	if req.BaseURL != nil {
		config.BaseURL = *req.BaseURL
	}
	if req.APIKey != nil {
		config.APIKey = *req.APIKey
	}
	if req.Enabled != nil {
		config.Enabled = *req.Enabled
	}
	if req.AudioOnly != nil {
		config.AudioOnly = *req.AudioOnly
	}
	if req.ImageOnly != nil {
		config.ImageOnly = *req.ImageOnly
	}
	if req.ImageEditOnly != nil {
		config.ImageEditOnly = *req.ImageEditOnly
	}
	if req.Secure != nil {
		config.Secure = *req.Secure
	}
	if req.DefaultModel != nil {
		config.DefaultModel = *req.DefaultModel
	}
	if req.SystemPrompt != nil {
		config.SystemPrompt = *req.SystemPrompt
	}
	if req.Favicon != nil {
		config.Favicon = *req.Favicon
	}

	if err := h.providerService.Update(providerID, config); err != nil {
		log.Printf("❌ [ADMIN] Failed to update provider %d: %v", providerID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to update provider: %v", err),
		})
	}

	// Get updated provider
	updated, err := h.providerService.GetByID(providerID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve updated provider",
		})
	}

	log.Printf("✅ [ADMIN] Updated provider: %s (ID %d)", updated.Name, updated.ID)

	// Reload image providers if image flags changed
	if (req.ImageOnly != nil && *req.ImageOnly) || (req.ImageEditOnly != nil && *req.ImageEditOnly) ||
		updated.ImageOnly || updated.ImageEditOnly {
		h.reloadImageProviders()
	}

	return c.JSON(updated)
}

// DeleteProvider deletes a provider
// DELETE /api/admin/providers/:id
func (h *AdminHandler) DeleteProvider(c *fiber.Ctx) error {
	providerID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid provider ID",
		})
	}

	// Get provider before deleting for logging
	provider, err := h.providerService.GetByID(providerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Provider not found",
		})
	}

	if err := h.providerService.Delete(providerID); err != nil {
		log.Printf("❌ [ADMIN] Failed to delete provider %d: %v", providerID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to delete provider: %v", err),
		})
	}

	log.Printf("✅ [ADMIN] Deleted provider: %s (ID %d)", provider.Name, provider.ID)
	return c.JSON(fiber.Map{
		"message": "Provider deleted successfully",
	})
}

// ToggleProvider toggles a provider's enabled state
// PUT /api/admin/providers/:id/toggle
func (h *AdminHandler) ToggleProvider(c *fiber.Ctx) error {
	providerID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid provider ID",
		})
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Get existing provider
	provider, err := h.providerService.GetByID(providerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Provider not found",
		})
	}

	// Update enabled state
	config := models.ProviderConfig{
		Name:         provider.Name,
		BaseURL:      provider.BaseURL,
		APIKey:       provider.APIKey,
		Enabled:      req.Enabled,
		AudioOnly:    provider.AudioOnly,
		SystemPrompt: provider.SystemPrompt,
		Favicon:      provider.Favicon,
	}

	if err := h.providerService.Update(providerID, config); err != nil {
		log.Printf("❌ [ADMIN] Failed to toggle provider %d: %v", providerID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to toggle provider: %v", err),
		})
	}

	// Get updated provider
	updated, err := h.providerService.GetByID(providerID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve updated provider",
		})
	}

	log.Printf("✅ [ADMIN] Toggled provider %s to enabled=%v", updated.Name, updated.Enabled)
	return c.JSON(updated)
}

// Helper function to convert ModelAlias map to interface{} map for JSON
func convertAliasesMapToInterface(aliases map[string]models.ModelAlias) map[string]interface{} {
	result := make(map[string]interface{})
	for key, alias := range aliases {
		result[key] = fiber.Map{
			"actual_model":                 alias.ActualModel,
			"display_name":                 alias.DisplayName,
			"description":                  alias.Description,
			"supports_vision":              alias.SupportsVision,
			"agents":                       alias.Agents,
			"smart_tool_router":            alias.SmartToolRouter,
			"free_tier":                    alias.FreeTier,
			"structured_output_support":    alias.StructuredOutputSupport,
			"structured_output_compliance": alias.StructuredOutputCompliance,
			"structured_output_warning":    alias.StructuredOutputWarning,
			"structured_output_speed_ms":   alias.StructuredOutputSpeedMs,
			"structured_output_badge":      alias.StructuredOutputBadge,
			"memory_extractor":             alias.MemoryExtractor,
			"memory_selector":              alias.MemorySelector,
		}
	}
	return result
}

// reloadImageProviders reloads image providers from the database
// Called after creating/updating providers with image_only or image_edit_only flags
func (h *AdminHandler) reloadImageProviders() {
	log.Println("🔄 [ADMIN] Reloading image providers...")

	// Get all providers from database
	allProviders, err := h.providerService.GetAll()
	if err != nil {
		log.Printf("⚠️ [ADMIN] Failed to reload providers: %v", err)
		return
	}

	// Convert to ProviderConfig format
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

	// Reload image providers
	imageProviderService := services.GetImageProviderService()
	imageProviderService.LoadFromProviders(providerConfigs)

	// Reload image edit providers
	imageEditProviderService := services.GetImageEditProviderService()
	imageEditProviderService.LoadFromProviders(providerConfigs)

	log.Println("✅ [ADMIN] Image providers reloaded")
}
