package handlers

import (
	"bytes"
	"claraverse/internal/config"
	"io"
	"log"
	"mime/multipart"
	"net/http"

	"github.com/gofiber/fiber/v2"
)

// TTSHandler handles text-to-speech API requests by proxying to the internal TTS service
type TTSHandler struct {
	ttsServiceURL string
}

// NewTTSHandler creates a new TTS handler
func NewTTSHandler() *TTSHandler {
	cfg := config.Load()
	// Default to tts-service:3006 for internal Docker network communication
	url := cfg.TTSServiceURL
	if url == "" {
		url = "http://tts-service:3006"
	}
	return &TTSHandler{
		ttsServiceURL: url,
	}
}

// Health handles TTS service health check
func (h *TTSHandler) Health(c *fiber.Ctx) error {
	log.Printf("🎤 [TTS-API] Health check")

	resp, err := http.Get(h.ttsServiceURL + "/health")
	if err != nil {
		log.Printf("❌ [TTS-API] Health check failed: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "TTS service unavailable",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to read health response: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read health response",
		})
	}

	c.Set("Content-Type", "application/json")
	return c.Status(resp.StatusCode).Send(body)
}

// ListVoices handles listing available built-in and custom voices
func (h *TTSHandler) ListVoices(c *fiber.Ctx) error {
	log.Printf("🎤 [TTS-API] Listing voices")

	resp, err := http.Get(h.ttsServiceURL + "/voices")
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to list voices: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "TTS service unavailable",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to read voices response: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read voices response",
		})
	}

	c.Set("Content-Type", "application/json")
	return c.Status(resp.StatusCode).Send(body)
}

// TextToSpeech handles text-to-speech conversion
func (h *TTSHandler) TextToSpeech(c *fiber.Ctx) error {
	// Get request body
	body := c.Body()

	log.Printf("🎤 [TTS-API] Converting text to speech (%d bytes)", len(body))

	// Proxy request to TTS service
	req, err := http.NewRequest("POST", h.ttsServiceURL+"/tts", bytes.NewReader(body))
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to create TTS request: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create TTS request",
		})
	}

	// Forward content type
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ [TTS-API] TTS request failed: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "TTS service unavailable",
		})
	}
	defer resp.Body.Close()

	// Read response body
	audioData, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to read TTS response: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read TTS response",
		})
	}

	if resp.StatusCode != http.StatusOK {
		// Return error response as JSON
		c.Set("Content-Type", "application/json")
		return c.Status(resp.StatusCode).Send(audioData)
	}

	// Stream audio data
	log.Printf("✅ [TTS-API] TTS generated successfully (%d bytes)", len(audioData))

	// Forward all relevant headers
	for k, v := range resp.Header {
		if k == "Content-Type" || k == "Content-Disposition" || k == "X-Sample-Rate" || k == "X-Duration" {
			c.Set(k, v[0])
		}
	}

	return c.Status(resp.StatusCode).Send(audioData)
}

// UploadCustomVoice handles uploading a custom voice file for voice cloning
func (h *TTSHandler) UploadCustomVoice(c *fiber.Ctx) error {
	// Get the uploaded file
	file, err := c.FormFile("file")
	if err != nil {
		log.Printf("❌ [TTS-API] No file uploaded: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No audio file uploaded",
		})
	}

	log.Printf("🎤 [TTS-API] Uploading custom voice: %s (%d bytes)", file.Filename, file.Size)

	// Create multipart form to forward to TTS service
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)

	// Open the uploaded file
	fileReader, err := file.Open()
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to open uploaded file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to open uploaded file",
		})
	}
	defer fileReader.Close()

	// Create form file
	part, err := writer.CreateFormFile("file", file.Filename)
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to create form file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create form file",
		})
	}

	// Copy file content to form
	if _, err := io.Copy(part, fileReader); err != nil {
		log.Printf("❌ [TTS-API] Failed to copy file content: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to copy file content",
		})
	}

	if err := writer.Close(); err != nil {
		log.Printf("❌ [TTS-API] Failed to close multipart writer: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to close multipart writer",
		})
	}

	// Create request to TTS service
	req, err := http.NewRequest("POST", h.ttsServiceURL+"/voices/upload", &requestBody)
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to create upload request: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create upload request",
		})
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ [TTS-API] Upload request failed: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "TTS service unavailable",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to read upload response: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read upload response",
		})
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ [TTS-API] Upload failed: %s", string(body))
	}

	c.Set("Content-Type", "application/json")
	return c.Status(resp.StatusCode).Send(body)
}

// DeleteCustomVoice handles deleting a custom voice
func (h *TTSHandler) DeleteCustomVoice(c *fiber.Ctx) error {
	voiceID := c.Params("id")
	log.Printf("🎤 [TTS-API] Deleting custom voice: %s", voiceID)

	req, err := http.NewRequest("DELETE", h.ttsServiceURL+"/voices/"+voiceID, nil)
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to create delete request: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create delete request",
		})
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ [TTS-API] Delete request failed: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "TTS service unavailable",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("❌ [TTS-API] Failed to read delete response: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read delete response",
		})
	}

	c.Set("Content-Type", "application/json")
	return c.Status(resp.StatusCode).Send(body)
}