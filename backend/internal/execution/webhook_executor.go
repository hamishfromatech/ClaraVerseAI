package execution

import (
	"claraverse/internal/models"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// WebhookExecutor executes webhook blocks (HTTP requests)
type WebhookExecutor struct {
	client *http.Client
}

// NewWebhookExecutor creates a new webhook executor
func NewWebhookExecutor() *WebhookExecutor {
	return &WebhookExecutor{
		client: &http.Client{Timeout: 30 * time.Minute},
	}
}

// Execute runs a webhook block
func (e *WebhookExecutor) Execute(ctx context.Context, block models.Block, inputs map[string]any) (map[string]any, error) {
	config := block.Config

	url := getString(config, "url", "")
	method := strings.ToUpper(getString(config, "method", "GET"))
	headers := getMap(config, "headers")
	bodyTemplate := getString(config, "bodyTemplate", "")

	if url == "" {
		return nil, fmt.Errorf("url is required for webhook block")
	}

	// Interpolate variables in URL
	url = interpolateTemplate(url, inputs)

	// Interpolate variables in body
	body := interpolateTemplate(bodyTemplate, inputs)

	log.Printf("🌐 [WEBHOOK-EXEC] Block '%s': %s %s", block.Name, method, url)

	// Create request
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	if headers != nil {
		for key, value := range headers {
			if strVal, ok := value.(string); ok {
				// Interpolate variables in header values (for secrets)
				strVal = interpolateTemplate(strVal, inputs)
				req.Header.Set(key, strVal)
			}
		}
	}

	// Default content type for POST/PUT with body
	if body != "" && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}

	// Execute request
	resp, err := e.client.Do(req)
	if err != nil {
		log.Printf("❌ [WEBHOOK-EXEC] Request failed: %v", err)
		return nil, fmt.Errorf("webhook request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read response body
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	log.Printf("✅ [WEBHOOK-EXEC] Block '%s': status=%d, body_len=%d", block.Name, resp.StatusCode, len(responseBody))

	// Try to parse response as JSON
	var parsedBody any
	if err := json.Unmarshal(responseBody, &parsedBody); err != nil {
		// Not JSON, use as string
		parsedBody = string(responseBody)
	}

	// Convert response headers to map
	respHeaders := make(map[string]string)
	for key, values := range resp.Header {
		if len(values) > 0 {
			respHeaders[key] = values[0]
		}
	}

	return map[string]any{
		"status":  resp.StatusCode,
		"body":    parsedBody,
		"headers": respHeaders,
		"raw":     string(responseBody),
	}, nil
}
