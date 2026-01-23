package handlers

import (
	"claraverse/internal/audio"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// AudioHandler handles audio-related API requests
type AudioHandler struct{}

// NewAudioHandler creates a new audio handler
func NewAudioHandler() *AudioHandler {
	return &AudioHandler{}
}

// Transcribe handles audio file transcription via OpenAI Whisper
func (h *AudioHandler) Transcribe(c *fiber.Ctx) error {
	// Get the uploaded file
	file, err := c.FormFile("file")
	if err != nil {
		log.Printf("❌ [AUDIO-API] No file uploaded: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No audio file uploaded",
		})
	}

	// Validate file size (max 25MB for Whisper)
	if file.Size > 25*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Audio file too large. Maximum size is 25MB",
		})
	}

	// Get optional parameters
	language := c.FormValue("language", "")
	prompt := c.FormValue("prompt", "")
	model := c.FormValue("model", "")
	provider := c.FormValue("provider", "") // "local" or "remote"

	// Create temp file to store the upload
	tempDir := os.TempDir()
	ext := filepath.Ext(file.Filename)
	if ext == "" {
		ext = ".webm" // Default extension for browser recordings
	}
	tempFile := filepath.Join(tempDir, fmt.Sprintf("audio_%s%s", uuid.New().String(), ext))

	// Save uploaded file to temp location
	if err := c.SaveFile(file, tempFile); err != nil {
		log.Printf("❌ [AUDIO-API] Failed to save temp file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process audio file",
		})
	}
	defer os.Remove(tempFile) // Clean up temp file

	// Get audio service
	audioService := audio.GetService()
	if audioService == nil {
		log.Printf("❌ [AUDIO-API] Audio service not initialized")
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Audio transcription service not available. Please configure OpenAI provider.",
		})
	}

	// Build transcription request
	req := &audio.TranscribeRequest{
		AudioPath: tempFile,
		Language:  language,
		Prompt:    prompt,
		Model:     model,
	}

	if provider == "remote" {
		req.ForceRemote = true
	} else if provider == "local" {
		req.PreferLocal = true
	}

	// Call transcription service
	log.Printf("🎵 [AUDIO-API] Transcribing audio file: %s (%d bytes, provider: %s, model: %s)",
		file.Filename, file.Size, provider, model)

	resp, err := audioService.Transcribe(req)
	if err != nil {
		log.Printf("❌ [AUDIO-API] Transcription failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Transcription failed: %v", err),
		})
	}

	log.Printf("✅ [AUDIO-API] Transcription complete: %d chars, language: %s", len(resp.Text), resp.Language)

	return c.JSON(fiber.Map{
		"text":     resp.Text,
		"language": resp.Language,
		"duration": resp.Duration,
	})
}
