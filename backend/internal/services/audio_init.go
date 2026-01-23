package services

import (
	"claraverse/internal/audio"
	"fmt"
	"log"
	"os"
	"sync"
)

var audioInitOnce sync.Once

// InitAudioService initializes the audio package with provider access
// Priority: Groq (cheaper) -> OpenAI (fallback)
func InitAudioService() {
	if visionProviderSvc == nil {
		log.Println("⚠️ [AUDIO-INIT] Provider service not set, audio service disabled")
		return
	}

	audioInitOnce.Do(func() {
		// Groq provider getter callback (primary - much cheaper)
		groqProviderGetter := func() (*audio.Provider, error) {
			// Try to get Groq provider by name (try both cases)
			provider, err := visionProviderSvc.GetByName("Groq")
			if err != nil || provider == nil {
				// Fallback to lowercase
				provider, err = visionProviderSvc.GetByName("groq")
			}
			if err != nil {
				return nil, fmt.Errorf("Groq provider not found: %w", err)
			}
			if provider == nil {
				return nil, fmt.Errorf("Groq provider not configured")
			}
			if !provider.Enabled {
				return nil, fmt.Errorf("Groq provider is disabled")
			}
			if provider.APIKey == "" {
				return nil, fmt.Errorf("Groq API key not configured")
			}

			return &audio.Provider{
				ID:      provider.ID,
				Name:    provider.Name,
				BaseURL: provider.BaseURL,
				APIKey:  provider.APIKey,
				Enabled: provider.Enabled,
			}, nil
		}

		// OpenAI provider getter callback (fallback)
		openaiProviderGetter := func() (*audio.Provider, error) {
			// Try to get OpenAI provider by name (try both cases)
			provider, err := visionProviderSvc.GetByName("OpenAI")
			if err != nil || provider == nil {
				// Fallback to lowercase
				provider, err = visionProviderSvc.GetByName("openai")
			}
			if err != nil {
				return nil, fmt.Errorf("OpenAI provider not found: %w", err)
			}
			if provider == nil {
				return nil, fmt.Errorf("OpenAI provider not configured")
			}
			if !provider.Enabled {
				return nil, fmt.Errorf("OpenAI provider is disabled")
			}
			if provider.APIKey == "" {
				return nil, fmt.Errorf("OpenAI API key not configured")
			}

			return &audio.Provider{
				ID:      provider.ID,
				Name:    provider.Name,
				BaseURL: provider.BaseURL,
				APIKey:  provider.APIKey,
				Enabled: provider.Enabled,
			}, nil
		}

		// Local Whisper service URL from environment
		localWhisperURL := os.Getenv("WHISPER_SERVICE_URL")

		audio.InitService(groqProviderGetter, openaiProviderGetter, localWhisperURL)

		status := "Groq primary, OpenAI fallback"
		if localWhisperURL != "" {
			status = fmt.Sprintf("Local Whisper primary (%s), Groq fallback", localWhisperURL)
		}
		log.Printf("✅ [AUDIO-INIT] Audio service initialized (%s)", status)
	})
}
