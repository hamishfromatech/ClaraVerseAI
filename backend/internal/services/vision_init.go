package services

import (
	"claraverse/internal/database"
	"claraverse/internal/vision"
	"fmt"
	"log"
	"sync"
)

var (
	visionInitOnce       sync.Once
	visionProviderSvc    *ProviderService
	visionDB             *database.DB
)

// SetVisionDependencies sets the dependencies needed for vision service
// Must be called before InitVisionService
func SetVisionDependencies(providerService *ProviderService, db *database.DB) {
	visionProviderSvc = providerService
	visionDB = db
}

// InitVisionService initializes the vision package with provider access
func InitVisionService() {
	if visionProviderSvc == nil {
		log.Println("⚠️ [VISION-INIT] Provider service not set, vision service disabled")
		return
	}

	visionInitOnce.Do(func() {
		configService := GetConfigService()

		// Provider getter callback
		providerGetter := func(id int) (*vision.Provider, error) {
			p, err := visionProviderSvc.GetByID(id)
			if err != nil {
				return nil, err
			}
			return &vision.Provider{
				ID:      p.ID,
				Name:    p.Name,
				BaseURL: p.BaseURL,
				APIKey:  p.APIKey,
				Enabled: p.Enabled,
			}, nil
		}

		// Vision model finder callback
		visionModelFinder := func() (int, string, error) {
			// First check aliases for vision-capable models
			allAliases := configService.GetAllModelAliases()

			for providerID, aliases := range allAliases {
				for _, aliasInfo := range aliases {
					if aliasInfo.SupportsVision != nil && *aliasInfo.SupportsVision {
						provider, err := visionProviderSvc.GetByID(providerID)
						if err == nil && provider.Enabled {
							log.Printf("🖼️ [VISION-INIT] Found vision model via alias: %s -> %s", aliasInfo.DisplayName, aliasInfo.ActualModel)
							return providerID, aliasInfo.ActualModel, nil
						}
					}
				}
			}

			// Fallback: Check database for vision models
			if visionDB == nil {
				return 0, "", fmt.Errorf("database not available")
			}

			var providerID int
			var modelName string
			err := visionDB.QueryRow(`
				SELECT m.provider_id, m.name
				FROM models m
				JOIN providers p ON m.provider_id = p.id
				WHERE m.supports_vision = 1 AND m.isVisible = 1 AND p.enabled = 1
				ORDER BY m.provider_id ASC
				LIMIT 1
			`).Scan(&providerID, &modelName)

			if err != nil {
				return 0, "", fmt.Errorf("no vision model found: %w", err)
			}

			log.Printf("🖼️ [VISION-INIT] Found vision model from database: %s (provider: %d)", modelName, providerID)
			return providerID, modelName, nil
		}

		vision.InitService(providerGetter, visionModelFinder)
		log.Printf("✅ [VISION-INIT] Vision service initialized")
	})
}
