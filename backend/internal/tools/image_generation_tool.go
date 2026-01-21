package tools

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"claraverse/internal/filecache"

	"github.com/google/uuid"
)

// ImageProviderConfigKey is the key for injecting image provider config into tool args
const ImageProviderConfigKey = "__image_provider_config__"

// UsageLimiterKey is the key for injecting usage limiter into tool args
const UsageLimiterKey = "__usage_limiter__"

// UsageLimiterInterface defines the methods needed from UsageLimiterService
// This avoids import cycle since tools package can't import services package
type UsageLimiterInterface interface {
	CheckImageGenLimit(ctx context.Context, userID string) error
	IncrementImageGenCount(ctx context.Context, userID string) error
}

// ImageProviderConfig holds the configuration for image generation
// This is injected into the tool args by chat_service
type ImageProviderConfig struct {
	Name         string
	BaseURL      string
	APIKey       string
	DefaultModel string
}

// ImageGenerationRequest represents the OpenAI-compatible request format
type ImageGenerationRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	N              int    `json:"n,omitempty"`
	Size           string `json:"size,omitempty"`
	Quality        string `json:"quality,omitempty"` // "standard" or "hd" (DALL-E 3 only)
	ResponseFormat string `json:"response_format"`
}

// ChutesImageRequest represents the Chutes API request format
type ChutesImageRequest struct {
	Prompt string `json:"prompt"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
}

// ImageSizePresets maps friendly size names to dimensions
// Note: 2K and 4K map to 1920x1080 since higher resolutions may not be supported by all providers
var ImageSizePresets = map[string]struct {
	Width  int
	Height int
}{
	// Square formats
	"square":       {1024, 1024},
	"square_hd":    {1536, 1536},
	"square_small": {512, 512},

	// Landscape formats
	"landscape":      {1344, 768},  // 16:9 ish
	"landscape_wide": {1536, 640},  // Ultra-wide 2.4:1
	"banner":         {1792, 512},  // Web banner style
	"youtube_thumb":  {1280, 720},  // YouTube thumbnail
	"twitter_header": {1500, 500},  // Twitter/X header
	"facebook_cover": {1640, 624},  // Facebook cover

	// Portrait formats
	"portrait":        {768, 1344},  // Vertical 9:16 ish
	"portrait_tall":   {640, 1536},  // Extra tall
	"phone_wallpaper": {1080, 1920}, // Phone wallpaper (9:16)
	"instagram_story": {1080, 1920}, // Instagram story

	// Desktop wallpapers - all map to 1920x1080 (Full HD) for compatibility
	"pc_wallpaper":    {1920, 1080}, // Full HD
	"pc_wallpaper_2k": {1920, 1080}, // Maps to Full HD (2K not supported)
	"pc_wallpaper_4k": {1920, 1080}, // Maps to Full HD (4K not supported)
	"ultrawide":       {1920, 800},  // Ultrawide monitor (reduced for compatibility)

	// Print/poster formats
	"poster":      {1024, 1536}, // 2:3 poster
	"a4_portrait": {1240, 1754}, // A4 ratio portrait
}

// ImageGenerationResponse represents the OpenAI-compatible API response
type ImageGenerationResponse struct {
	Created int64 `json:"created"`
	Data    []struct {
		B64JSON string `json:"b64_json,omitempty"`
		URL     string `json:"url,omitempty"`
	} `json:"data"`
}

// Note: Chutes API returns raw binary PNG, not JSON
// We read the binary response and convert to base64

// NewImageGenerationTool creates a new image generation tool
func NewImageGenerationTool() *Tool {
	return &Tool{
		Name:        "generate_image",
		DisplayName: "Generate Image",
		Description: `Generates an image based on a text prompt using AI image generation.

Use this tool when the user asks you to:
- Create, generate, or make an image
- Draw, illustrate, or visualize something
- Create artwork, pictures, or graphics
- Create wallpapers, banners, or social media images

The generated image will be displayed directly in the chat.

IMPORTANT: Always use the 'size' parameter with a preset value. Available presets:
- square (default), square_hd, square_small - Square formats
- landscape, landscape_wide - Horizontal formats
- banner - Wide banner for headers
- portrait, portrait_tall - Vertical formats
- phone_wallpaper, instagram_story - Mobile formats (9:16)
- pc_wallpaper, pc_wallpaper_2k, pc_wallpaper_4k - Desktop wallpaper (16:9)
- ultrawide - Ultrawide monitor
- youtube_thumb, twitter_header, facebook_cover - Social media formats
- poster, a4_portrait - Print formats

Tips for good prompts:
- Be specific about style (photorealistic, cartoon, watercolor, etc.)
- Describe composition, colors, lighting
- Include details about the subject and background
- Specify mood or atmosphere if relevant`,
		Icon:     "ImagePlus",
		Source:   ToolSourceBuiltin,
		Category: "generation",
		Keywords: []string{"image", "generate", "create", "picture", "art", "illustration", "draw", "render", "flux", "visualize", "artwork", "graphic", "wallpaper", "banner"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"prompt": map[string]interface{}{
					"type":        "string",
					"description": "A detailed description of the image to generate. Be specific about style, composition, colors, and content for best results.",
				},
				"size": map[string]interface{}{
					"type":        "string",
					"description": "Size preset: square, square_hd, landscape, portrait, banner, phone_wallpaper, pc_wallpaper, pc_wallpaper_2k, pc_wallpaper_4k, ultrawide, youtube_thumb, twitter_header, facebook_cover, instagram_story, poster. Default is 'square' (1024x1024).",
					"enum":        []string{"square", "square_hd", "square_small", "landscape", "landscape_wide", "banner", "portrait", "portrait_tall", "phone_wallpaper", "instagram_story", "pc_wallpaper", "pc_wallpaper_2k", "pc_wallpaper_4k", "ultrawide", "youtube_thumb", "twitter_header", "facebook_cover", "poster", "a4_portrait"},
				},
				"width": map[string]interface{}{
					"type":        "integer",
					"description": "Custom width in pixels (64-4096). Use this for custom dimensions instead of size presets. Must be used with height.",
				},
				"height": map[string]interface{}{
					"type":        "integer",
					"description": "Custom height in pixels (64-4096). Use this for custom dimensions instead of size presets. Must be used with width.",
				},
				"model": map[string]interface{}{
					"type":        "string",
					"description": "Optional: Specific model to use for generation. If not specified, the default model will be used.",
				},
			},
			"required": []string{"prompt"},
		},
		Execute: executeImageGeneration,
	}
}

func executeImageGeneration(args map[string]interface{}) (string, error) {
	// Extract prompt
	prompt, ok := args["prompt"].(string)
	if !ok || prompt == "" {
		return "", fmt.Errorf("prompt is required")
	}

	// Get image provider config (injected by chat_service)
	providerConfig, ok := args[ImageProviderConfigKey].(*ImageProviderConfig)
	if !ok || providerConfig == nil {
		return "", fmt.Errorf("no image generation provider configured. Please add an image provider with 'image_only: true' in the database")
	}

	// Get injected context for image registry
	convID, _ := args["__conversation_id__"].(string)
	userID, _ := args["__user_id__"].(string)

	// Check image generation limit
	if usageLimiter, ok := args[UsageLimiterKey].(UsageLimiterInterface); ok && usageLimiter != nil && userID != "" {
		ctx := context.Background()
		if err := usageLimiter.CheckImageGenLimit(ctx, userID); err != nil {
			log.Printf("⚠️  [LIMIT] Image generation limit exceeded for user %s", userID)
			return "", fmt.Errorf("image generation limit exceeded. %v", err)
		}

		// Increment count after successful generation (deferred)
		defer func() {
			if err := usageLimiter.IncrementImageGenCount(context.Background(), userID); err != nil {
				log.Printf("⚠️  [LIMIT] Failed to increment image gen count for user %s: %v", userID, err)
			}
		}()
	}

	// Determine model to use
	model := providerConfig.DefaultModel
	if customModel, ok := args["model"].(string); ok && customModel != "" {
		model = customModel
	}

	// Determine image dimensions
	width, height := 1024, 1024 // Default square

	// Check for size preset first
	if sizePreset, ok := args["size"].(string); ok && sizePreset != "" {
		if preset, exists := ImageSizePresets[strings.ToLower(sizePreset)]; exists {
			width = preset.Width
			height = preset.Height
			log.Printf("🎨 [IMAGE-GEN] Using size preset '%s': %dx%d", sizePreset, width, height)
		} else {
			log.Printf("⚠️ [IMAGE-GEN] Unknown size preset '%s', using default 1024x1024", sizePreset)
		}
	}

	// Custom dimensions override presets
	if customWidth, ok := args["width"].(float64); ok && customWidth > 0 {
		if customHeight, ok := args["height"].(float64); ok && customHeight > 0 {
			width = int(customWidth)
			height = int(customHeight)
			// Clamp to reasonable limits
			if width < 64 {
				width = 64
			} else if width > 4096 {
				width = 4096
			}
			if height < 64 {
				height = 64
			} else if height > 4096 {
				height = 4096
			}
			log.Printf("🎨 [IMAGE-GEN] Using custom dimensions: %dx%d", width, height)
		}
	}

	log.Printf("🎨 [IMAGE-GEN] Generating image with prompt: %s (model: %s, size: %dx%d, provider: %s)",
		truncateString(prompt, 100), model, width, height, providerConfig.Name)

	var imageData string
	var err error

	// Check if this is a Chutes API endpoint (simple /generate endpoint)
	if strings.Contains(providerConfig.BaseURL, "chutes.ai") {
		imageData, err = executeChutesImageGeneration(providerConfig, prompt, width, height)
	} else {
		// Use OpenAI-compatible format
		imageData, err = executeOpenAIImageGeneration(providerConfig, prompt, model, width, height)
	}

	if err != nil {
		return "", err
	}

	// Save generated image and register in image registry (if context available)
	var imageHandle string
	var fileID string
	if convID != "" && userID != "" {
		fileID, err = saveGeneratedImageToCache(imageData, userID, convID)
		if err != nil {
			log.Printf("⚠️ [IMAGE-GEN] Failed to save image to cache: %v", err)
			// Continue without registration - image will still display
		} else {
			// Register in image registry (injected by chat_service)
			if registry, ok := args[ImageRegistryKey].(ImageRegistryInterface); ok && registry != nil {
				imageHandle = registry.RegisterGeneratedImage(convID, fileID, prompt)
				log.Printf("📸 [IMAGE-GEN] Registered generated image as %s (file_id: %s)", imageHandle, fileID)
			} else {
				log.Printf("⚠️ [IMAGE-GEN] Image registry not available, image won't be registered for editing")
			}
		}
	}

	// Build result message
	var message string
	if imageHandle != "" {
		message = fmt.Sprintf("Successfully generated image '%s' for prompt: \"%s\". The image has been displayed to the user. You can reference this image as '%s' for further editing.", imageHandle, truncateString(prompt, 100), imageHandle)
	} else {
		message = fmt.Sprintf("Successfully generated image for prompt: \"%s\". The image has been displayed to the user in the visualization panel.", truncateString(prompt, 100))
	}

	// Return result with plots for frontend rendering
	// The frontend artifact system expects plots array with format and data
	// IMPORTANT: The "plots" array is handled separately by the frontend and stripped before sending to LLM
	// The "message" field is what the LLM sees as the tool result
	result := map[string]interface{}{
		"success":  true,
		"prompt":   prompt,
		"model":    model,
		"image_id": imageHandle, // For agent chaining
		"file_id":  fileID,      // For agent chaining
		"plots": []map[string]interface{}{
			{
				"format": "png",
				"data":   imageData,
			},
		},
		"message": message,
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("failed to marshal result: %w", err)
	}

	log.Printf("✅ [IMAGE-GEN] Successfully generated image for prompt: %s", truncateString(prompt, 50))
	return string(resultJSON), nil
}

// saveGeneratedImageToCache saves a generated image and returns the file ID
func saveGeneratedImageToCache(imageB64, userID, conversationID string) (string, error) {
	// Decode base64
	imageBytes, err := base64.StdEncoding.DecodeString(imageB64)
	if err != nil {
		return "", fmt.Errorf("failed to decode image: %w", err)
	}

	// Generate unique file ID
	fileID := uuid.New().String()
	filename := fmt.Sprintf("%s.png", fileID)

	// Ensure uploads directory exists
	uploadsDir := "./uploads"
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create uploads directory: %w", err)
	}

	// Write to disk
	filePath := fmt.Sprintf("%s/%s", uploadsDir, filename)
	if err := os.WriteFile(filePath, imageBytes, 0644); err != nil {
		return "", fmt.Errorf("failed to write image: %w", err)
	}

	// Register with filecache
	fileCacheService := filecache.GetService()
	cachedFile := &filecache.CachedFile{
		FileID:         fileID,
		UserID:         userID,
		ConversationID: conversationID,
		FilePath:       filePath,
		Filename:       filename,
		MimeType:       "image/png",
		Size:           int64(len(imageBytes)),
		UploadedAt:     time.Now(),
	}
	fileCacheService.Store(cachedFile)

	log.Printf("💾 [IMAGE-GEN] Saved generated image: %s (%d bytes)", fileID, len(imageBytes))

	return fileID, nil
}

// executeChutesImageGeneration handles the Chutes API format
func executeChutesImageGeneration(config *ImageProviderConfig, prompt string, width, height int) (string, error) {
	reqBody := ChutesImageRequest{
		Prompt: prompt,
		Width:  width,
		Height: height,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	// Chutes uses /generate endpoint directly
	url := config.BaseURL + "/generate"
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+config.APIKey)
	}

	// Execute request with timeout (image generation can take a while)
	client := &http.Client{Timeout: 180 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("image generation request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ [IMAGE-GEN] Chutes API returned error (status %d): %s", resp.StatusCode, string(body))
		return "", fmt.Errorf("image generation failed (status %d): %s", resp.StatusCode, string(body))
	}

	// Chutes returns raw binary PNG, convert to base64
	if len(body) == 0 {
		return "", fmt.Errorf("no image data in response")
	}

	// Verify it looks like a PNG (starts with PNG magic bytes)
	if len(body) < 8 || string(body[1:4]) != "PNG" {
		log.Printf("⚠️ [IMAGE-GEN] Response may not be PNG, first bytes: %v", body[:min(16, len(body))])
	}

	// Convert binary PNG to base64
	imageData := base64.StdEncoding.EncodeToString(body)
	log.Printf("✅ [IMAGE-GEN] Converted %d bytes to base64 (%d chars)", len(body), len(imageData))

	return imageData, nil
}

// executeOpenAIImageGeneration handles the OpenAI-compatible API format
func executeOpenAIImageGeneration(config *ImageProviderConfig, prompt, model string, width, height int) (string, error) {
	if model == "" {
		return "", fmt.Errorf("no model specified and no default model configured for image provider")
	}

	// Format size as "WIDTHxHEIGHT" for OpenAI-compatible APIs
	sizeStr := fmt.Sprintf("%dx%d", width, height)

	reqBody := ImageGenerationRequest{
		Model:          model,
		Prompt:         prompt,
		N:              1,
		Size:           sizeStr,
		ResponseFormat: "b64_json",
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	// Normalize base URL - handle cases where /v1 is already included
	// Users may enter: https://api.openai.com or https://api.openai.com/v1
	baseURL := strings.TrimSuffix(config.BaseURL, "/")
	var url string
	if strings.HasSuffix(baseURL, "/v1") {
		// Base URL already has /v1, just append the endpoint
		url = fmt.Sprintf("%s/images/generations", baseURL)
	} else {
		// Base URL doesn't have /v1, add the full path
		url = fmt.Sprintf("%s/v1/images/generations", baseURL)
	}
	log.Printf("🎨 [IMAGE-GEN] Using URL: %s", url)

	// Create HTTP request
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+config.APIKey)
	}

	// Execute request with timeout (image generation can take a while)
	client := &http.Client{Timeout: 180 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("image generation request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ [IMAGE-GEN] API returned error (status %d): %s", resp.StatusCode, string(body))
		return "", fmt.Errorf("image generation failed (status %d): %s", resp.StatusCode, string(body))
	}

	// Parse response
	var genResp ImageGenerationResponse
	if err := json.Unmarshal(body, &genResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	if len(genResp.Data) == 0 {
		return "", fmt.Errorf("no image data in response")
	}

	imageData := genResp.Data[0].B64JSON
	if imageData == "" {
		return "", fmt.Errorf("no base64 image data in response")
	}

	return imageData, nil
}

// truncateString truncates a string to maxLen characters
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
