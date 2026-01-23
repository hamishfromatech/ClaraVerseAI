package handlers

import (
	"claraverse/internal/models"
	"claraverse/internal/services"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// aliasKey creates a composite key for tracking aliased models by provider+name
func aliasKey(providerID int, modelName string) string {
	return fmt.Sprintf("%d:%s", providerID, strings.ToLower(modelName))
}

// ModelHandler handles model-related requests
type ModelHandler struct {
	modelService *services.ModelService
}

// NewModelHandler creates a new model handler
func NewModelHandler(modelService *services.ModelService) *ModelHandler {
	return &ModelHandler{modelService: modelService}
}

// List returns all available models
func (h *ModelHandler) List(c *fiber.Ctx) error {
	// Check if we should only return visible models
	visibleOnly := c.Query("visible_only", "true") == "true"

	modelsList, err := h.modelService.GetAll(visibleOnly)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch models",
		})
	}

	// Get config service for alias information
	configService := services.GetConfigService()

	// Build a map of model alias -> global recommendation tier with full tier info
	// Query global tiers from recommended_models table joined with tier_labels
	type TierInfo struct {
		Tier        string
		Label       string
		Description string
		Icon        string
	}
	modelRecommendationTier := make(map[string]TierInfo) // model_alias -> tier info

	rows, err := h.modelService.GetDB().Query(`
		SELECT r.tier, r.model_alias, r.provider_id,
		       t.label, t.description, t.icon
		FROM recommended_models r
		JOIN tier_labels t ON r.tier = t.tier
	`)
	if err != nil {
		log.Printf("⚠️  [MODEL-HANDLER] Failed to load global tiers: %v", err)
	} else {
		defer rows.Close()
		for rows.Next() {
			var tier, modelAlias, label, description, icon string
			var providerID int
			if err := rows.Scan(&tier, &modelAlias, &providerID, &label, &description, &icon); err != nil {
				log.Printf("⚠️  [MODEL-HANDLER] Failed to scan tier row: %v", err)
				continue
			}
			// Use lowercase alias for case-insensitive matching
			key := fmt.Sprintf("%d:%s", providerID, strings.ToLower(modelAlias))
			modelRecommendationTier[key] = TierInfo{
				Tier:        tier,
				Label:       label,
				Description: description,
				Icon:        icon,
			}
			log.Printf("🎯 [MODEL-HANDLER] Loaded global tier: %s -> %s (%s - %s) (provider %d)", modelAlias, tier, label, icon, providerID)
		}
	}

	// Build enriched models with alias structure
	// If a model has an alias, we expose ONLY the alias to the frontend
	enrichedModels := make([]interface{}, 0)
	aliasedModels := make(map[string]bool) // Track which original models have been aliased (key: providerID:lowercase_name)

	// First pass: Add all aliased models
	allAliases := configService.GetAllModelAliases()
	for providerID, aliases := range allAliases {
		for aliasName, aliasInfo := range aliases {
			// Find the original model to get its capabilities
			// Use case-insensitive comparison for model name OR ID matching
			var foundModel *models.Model
			actualModelLower := strings.ToLower(aliasInfo.ActualModel)
			for i := range modelsList {
				if modelsList[i].ProviderID == providerID &&
					(strings.ToLower(modelsList[i].Name) == actualModelLower ||
						strings.ToLower(modelsList[i].ID) == actualModelLower) {
					foundModel = &modelsList[i]
					// Use composite key (providerID:lowercase_name) to track aliased models
					aliasedModels[aliasKey(providerID, modelsList[i].Name)] = true
					aliasedModels[aliasKey(providerID, modelsList[i].ID)] = true
					break
				}
			}

			if foundModel == nil {
				log.Printf("⚠️  [MODEL-ALIAS] Could not find model '%s' for alias '%s' (provider %d)", aliasInfo.ActualModel, aliasName, providerID)
				continue
			}

			// Determine supports_vision: use alias override if set, otherwise use model's value
			supportsVision := foundModel.SupportsVision
			if aliasInfo.SupportsVision != nil {
				supportsVision = *aliasInfo.SupportsVision
			}

			// Determine agents_enabled: use alias Agents flag if set, otherwise default to true
			agentsEnabled := true // Default to true (all models available for agents)
			if aliasInfo.Agents != nil {
				agentsEnabled = *aliasInfo.Agents
			}

			// Get provider security status
			isProviderSecure := configService.IsProviderSecure(providerID)

			// Create model entry using alias as the ID
			modelMap := map[string]interface{}{
				"id":                 aliasName,               // Alias name becomes the ID
				"provider_id":        providerID,
				"provider_name":      foundModel.ProviderName,
				"name":               aliasInfo.DisplayName,  // Use alias display name
				"display_name":       aliasInfo.DisplayName,  // Use alias display name
				"supports_tools":     foundModel.SupportsTools,
				"supports_streaming": foundModel.SupportsStreaming,
				"supports_vision":    supportsVision,
				"agents_enabled":     agentsEnabled,
				"provider_secure":    isProviderSecure,
				"isVisible":         foundModel.IsVisible,
				"fetched_at":         foundModel.FetchedAt,
			}

			// Check if this model (by alias name) is in the recommendation tier
			recommendationKey := fmt.Sprintf("%d:%s", providerID, strings.ToLower(aliasName))
			var tierDescription string
			if tierInfo, exists := modelRecommendationTier[recommendationKey]; exists {
				modelMap["recommendation_tier"] = map[string]interface{}{
					"tier":        tierInfo.Tier,
					"label":       tierInfo.Label,
					"description": tierInfo.Description,
					"icon":        tierInfo.Icon,
				}
				tierDescription = tierInfo.Description
				log.Printf("✅ [MODEL-HANDLER] Added tier '%s' (%s %s) to alias '%s'", tierInfo.Tier, tierInfo.Icon, tierInfo.Label, aliasName)
			}

			// Add description - use tier description as fallback if model description is empty
			if aliasInfo.Description != "" {
				modelMap["description"] = aliasInfo.Description
			} else if tierDescription != "" {
				modelMap["description"] = tierDescription
			}

			if foundModel.ProviderFavicon != "" {
				modelMap["provider_favicon"] = foundModel.ProviderFavicon
			}
			if aliasInfo.StructuredOutputSupport != "" {
				modelMap["structured_output_support"] = aliasInfo.StructuredOutputSupport
			}
			if aliasInfo.StructuredOutputCompliance != nil {
				modelMap["structured_output_compliance"] = *aliasInfo.StructuredOutputCompliance
			}
			if aliasInfo.StructuredOutputWarning != "" {
				modelMap["structured_output_warning"] = aliasInfo.StructuredOutputWarning
			}
			if aliasInfo.StructuredOutputSpeedMs != nil {
				modelMap["structured_output_speed_ms"] = *aliasInfo.StructuredOutputSpeedMs
			}
			if aliasInfo.StructuredOutputBadge != "" {
				modelMap["structured_output_badge"] = aliasInfo.StructuredOutputBadge
			}

			enrichedModels = append(enrichedModels, modelMap)
		}
	}

	// Second pass: Add non-aliased models
	for _, model := range modelsList {
		// Use composite key (providerID:lowercase_name) to check if model is aliased
		if !aliasedModels[aliasKey(model.ProviderID, model.Name)] {
			// Get provider security status
			isProviderSecure := configService.IsProviderSecure(model.ProviderID)

			modelMap := map[string]interface{}{
				"id":                 model.ID,
				"provider_id":        model.ProviderID,
				"provider_name":      model.ProviderName,
				"name":               model.Name,
				"display_name":       model.DisplayName,
				"supports_tools":     model.SupportsTools,
				"supports_streaming": model.SupportsStreaming,
				"supports_vision":    model.SupportsVision,
				"agents_enabled":     model.AgentsEnabled, // Use model's AgentsEnabled field (defaults to false for non-aliased)
				"provider_secure":    isProviderSecure,
				"isVisible":         model.IsVisible,
				"fetched_at":         model.FetchedAt,
			}
			// Check if this model is in the recommendation tier
			recommendationKey := fmt.Sprintf("%d:%s", model.ProviderID, strings.ToLower(model.ID))
			var tierDescription string
			if tierInfo, exists := modelRecommendationTier[recommendationKey]; exists {
				modelMap["recommendation_tier"] = map[string]interface{}{
					"tier":        tierInfo.Tier,
					"label":       tierInfo.Label,
					"description": tierInfo.Description,
					"icon":        tierInfo.Icon,
				}
				tierDescription = tierInfo.Description
				log.Printf("✅ [MODEL-HANDLER] Added tier '%s' (%s %s) to model '%s'", tierInfo.Tier, tierInfo.Icon, tierInfo.Label, model.ID)
			}

			// Add description - use tier description as fallback if model description is empty
			if tierDescription != "" {
				modelMap["description"] = tierDescription
			}

			// Add optional provider favicon if present
			if model.ProviderFavicon != "" {
				modelMap["provider_favicon"] = model.ProviderFavicon
			}

			enrichedModels = append(enrichedModels, modelMap)
		}
	}

	// Check user authentication status
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		userID = "anonymous"
	}

	// Filter models based on authentication
	if userID == "anonymous" {
		// Anonymous users only get free tier models
		var filteredModels []interface{}
		for _, model := range enrichedModels {
			if modelMap, ok := model.(map[string]interface{}); ok {
				modelID, _ := modelMap["id"].(string)

				// Check if this model is marked as free tier
				if h.modelService.IsFreeTier(modelID) {
					filteredModels = append(filteredModels, model)
				}
			}
		}

		log.Printf("🔒 Anonymous user - filtered to %d free tier models", len(filteredModels))
		return c.JSON(fiber.Map{
			"models": filteredModels,
			"count":  len(filteredModels),
			"tier":   "anonymous",
		})
	}

	// Authenticated users get all models
	log.Printf("✅ Authenticated user (%s) - showing all %d models", userID, len(enrichedModels))
	return c.JSON(fiber.Map{
		"models": enrichedModels,
		"count":  len(enrichedModels),
		"tier":   "authenticated",
	})
}

// ListByProvider returns models for a specific provider
func (h *ModelHandler) ListByProvider(c *fiber.Ctx) error {
	providerID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid provider ID",
		})
	}

	visibleOnly := c.Query("visible_only", "true") == "true"

	models, err := h.modelService.GetByProvider(providerID, visibleOnly)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch models",
		})
	}

	return c.JSON(fiber.Map{
		"models": models,
		"count":  len(models),
	})
}

// ListToolPredictorModels returns only models that can be used as tool predictors
// GET /api/models/tool-predictors
func (h *ModelHandler) ListToolPredictorModels(c *fiber.Ctx) error {
	models, err := h.modelService.GetToolPredictorModels()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch tool predictor models",
		})
	}

	return c.JSON(fiber.Map{
		"models": models,
		"count":  len(models),
	})
}
