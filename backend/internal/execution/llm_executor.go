package execution

import (
	"bytes"
	"claraverse/internal/models"
	"claraverse/internal/services"
	"claraverse/internal/utils"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// LLMExecutor executes LLM inference blocks
type LLMExecutor struct {
	chatService     *services.ChatService
	providerService *services.ProviderService
	httpClient      *http.Client
}

// NewLLMExecutor creates a new LLM executor
func NewLLMExecutor(chatService *services.ChatService, providerService *services.ProviderService) *LLMExecutor {
	return &LLMExecutor{
		chatService:     chatService,
		providerService: providerService,
		httpClient: &http.Client{
			Timeout: 30 * time.Minute,
		},
	}
}

// getDefaultModel returns the first available model from database
func (e *LLMExecutor) getDefaultModel() string {
	// Use chatService to get optimal text model
	provider, modelID, err := e.chatService.GetTextProviderWithModel()
	if err == nil && modelID != "" {
		log.Printf("🎯 [LLM-EXEC] Using dynamic default model: %s (provider: %s)", modelID, provider.Name)
		return modelID
	}

	// If that fails, try to get default provider with model
	provider, modelID, err = e.chatService.GetDefaultProviderWithModel()
	if err == nil && modelID != "" {
		log.Printf("🎯 [LLM-EXEC] Using fallback default model: %s", modelID)
		return modelID
	}

	// Last resort: return empty string (will cause error later if no model specified)
	log.Printf("⚠️ [LLM-EXEC] No default model available - LLM execution will require explicit model")
	return ""
}

// Execute runs an LLM inference block
func (e *LLMExecutor) Execute(ctx context.Context, block models.Block, inputs map[string]any) (map[string]any, error) {
	config := block.Config

	// Get configuration - support both "model" and "modelId" field names
	modelID := getString(config, "model", "")
	if modelID == "" {
		modelID = getString(config, "modelId", "")
	}

	// Check for workflow-level model override (set in Start block)
	if workflowModelID, ok := inputs["_workflowModelId"].(string); ok && workflowModelID != "" {
		log.Printf("🎯 [LLM-EXEC] Block '%s': Using workflow model override: %s", block.Name, workflowModelID)
		modelID = workflowModelID
	}

	// Default to a sensible model if not specified
	if modelID == "" {
		modelID = e.getDefaultModel()
		if modelID != "" {
			log.Printf("⚠️ [LLM-EXEC] No model specified for block '%s', using default: %s", block.Name, modelID)
		} else {
			return nil, fmt.Errorf("no model specified and no default model available")
		}
	}

	// Support both "systemPrompt" and "system_prompt" field names
	systemPrompt := getString(config, "systemPrompt", "")
	if systemPrompt == "" {
		systemPrompt = getString(config, "system_prompt", "")
	}

	// Support "userPrompt", "userPromptTemplate", "user_prompt" field names
	userPromptTemplate := getString(config, "userPrompt", "")
	if userPromptTemplate == "" {
		userPromptTemplate = getString(config, "userPromptTemplate", "")
	}
	if userPromptTemplate == "" {
		userPromptTemplate = getString(config, "user_prompt", "")
	}
	temperature := getFloat(config, "temperature", 0.7)

	// Get structured output configuration
	outputFormat := getString(config, "outputFormat", "text")
	var outputSchema map[string]interface{}
	if schema, ok := config["outputSchema"].(map[string]interface{}); ok {
		outputSchema = schema
	}

	// Interpolate variables in prompts
	userPrompt := interpolateTemplate(userPromptTemplate, inputs)
	systemPrompt = interpolateTemplate(systemPrompt, inputs)

	log.Printf("🤖 [LLM-EXEC] Block '%s': model=%s, prompt_len=%d", block.Name, modelID, len(userPrompt))

	// Find provider for this model using multi-step resolution
	var provider *models.Provider
	var actualModelID string
	var err error

	// Step 1: Try direct lookup in models table
	provider, err = e.providerService.GetByModelID(modelID)
	if err == nil {
		actualModelID = modelID
		log.Printf("✅ [LLM-EXEC] Found model '%s' via direct lookup", modelID)
	} else {
		// Step 2: Try model alias resolution
		log.Printf("🔄 [LLM-EXEC] Model '%s' not found directly, trying alias resolution...", modelID)
		aliasProvider, aliasModel, found := e.chatService.ResolveModelAlias(modelID)
		if found {
			provider = aliasProvider
			actualModelID = aliasModel
			log.Printf("✅ [LLM-EXEC] Resolved alias '%s' -> '%s'", modelID, actualModelID)
		} else {
			// Step 3: Fallback to default provider with an actual model from the database
			log.Printf("⚠️ [LLM-EXEC] Model '%s' not found, using default provider with default model", modelID)
			defaultProvider, defaultModel, defaultErr := e.chatService.GetDefaultProviderWithModel()
			if defaultErr != nil {
				return nil, fmt.Errorf("failed to find provider for model %s and no default provider available: %w", modelID, defaultErr)
			}
			provider = defaultProvider
			actualModelID = defaultModel
			log.Printf("⚠️ [LLM-EXEC] Using default provider '%s' with model '%s'", provider.Name, actualModelID)
		}
	}

	// Use the resolved model ID
	modelID = actualModelID

	// Build request
	messages := []map[string]string{
		{"role": "user", "content": userPrompt},
	}
	if systemPrompt != "" {
		messages = append([]map[string]string{{"role": "system", "content": systemPrompt}}, messages...)
	}

	requestBody := map[string]interface{}{
		"model":       modelID,
		"messages":    messages,
		"temperature": temperature,
		"stream":      false, // Non-streaming for block execution
	}

	// Add structured output if configured (provider-aware implementation)
	if outputFormat == "json" && outputSchema != nil {
		// Detect provider capability for strict schema support
		supportsStrictSchema := supportsStrictJSONSchema(provider.Name, provider.BaseURL)

		if supportsStrictSchema {
			// Full support: Use strict JSON schema mode (OpenAI, some OpenRouter models)
			requestBody["response_format"] = map[string]interface{}{
				"type": "json_schema",
				"json_schema": map[string]interface{}{
					"name":   fmt.Sprintf("%s_output", block.NormalizedID),
					"strict": true,
					"schema": outputSchema,
				},
			}
			log.Printf("🎯 [LLM-EXEC] Block '%s': Using strict JSON schema mode", block.Name)
		} else {
			// Fallback: JSON mode + schema in system prompt
			requestBody["response_format"] = map[string]interface{}{
				"type": "json_object",
			}

			// Add schema to system prompt for better compliance
			schemaJSON, _ := json.Marshal(outputSchema)
			systemPrompt += fmt.Sprintf("\n\nIMPORTANT: Return your response as valid JSON matching this EXACT schema:\n%s\n\nDo not add any extra fields. Include all required fields.", string(schemaJSON))

			// Update messages with enhanced prompt
			messages = []map[string]string{
				{"role": "user", "content": userPrompt},
			}
			if systemPrompt != "" {
				messages = append([]map[string]string{{"role": "system", "content": systemPrompt}}, messages...)
			}
			requestBody["messages"] = messages

			log.Printf("⚠️ [LLM-EXEC] Block '%s': Using JSON mode with schema in prompt (provider fallback)", block.Name)
		}
	} else if outputFormat == "json" {
		// Fallback to basic JSON mode if no schema provided
		requestBody["response_format"] = map[string]interface{}{
			"type": "json_object",
		}
		log.Printf("🎯 [LLM-EXEC] Block '%s': Using basic JSON output mode", block.Name)
	}

	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create request
	endpoint := strings.TrimSuffix(provider.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+provider.APIKey)

	// Execute request
	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("LLM request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("LLM request failed with status %d: %s", resp.StatusCode, string(body))
	}

	// Parse response
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse LLM response: %w", err)
	}

	// Extract content from OpenAI-style response
	content := ""
	if choices, ok := result["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if message, ok := choice["message"].(map[string]interface{}); ok {
				if c, ok := message["content"].(string); ok {
					content = c
				}
			}
		}
	}

	// Extract token usage
	var inputTokens, outputTokens int
	if usage, ok := result["usage"].(map[string]interface{}); ok {
		if pt, ok := usage["prompt_tokens"].(float64); ok {
			inputTokens = int(pt)
		}
		if ct, ok := usage["completion_tokens"].(float64); ok {
			outputTokens = int(ct)
		}
	}

	log.Printf("✅ [LLM-EXEC] Block '%s': completed, response_len=%d, tokens=%d/%d",
		block.Name, len(content), inputTokens, outputTokens)

	// Parse JSON output if structured output was requested
	if outputFormat == "json" {
		var parsedJSON map[string]interface{}
		jsonContent := utils.ExtractJSON(content)
		if err := json.Unmarshal([]byte(jsonContent), &parsedJSON); err != nil {
			log.Printf("⚠️ [LLM-EXEC] Block '%s': Failed to parse JSON output: %v", block.Name, err)
			// Return raw content if JSON parsing fails
			return map[string]any{
				"response": content,
				"model":    modelID,
				"tokens": map[string]int{
					"input":  inputTokens,
					"output": outputTokens,
				},
				"parseError": err.Error(),
			}, nil
		}

		log.Printf("✅ [LLM-EXEC] Block '%s': Successfully parsed JSON output with %d keys", block.Name, len(parsedJSON))

		// Return both raw and parsed data
		return map[string]any{
			"response": content,      // Raw JSON string (for debugging/logging)
			"data":     parsedJSON,   // Parsed JSON object (for downstream blocks)
			"model":    modelID,
			"tokens": map[string]int{
				"input":  inputTokens,
				"output": outputTokens,
			},
		}, nil
	}

	// Text output (default)
	return map[string]any{
		"response": content,
		"model":    modelID,
		"tokens": map[string]int{
			"input":  inputTokens,
			"output": outputTokens,
		},
	}, nil
}

// interpolateTemplate replaces {{variable}} placeholders with actual values
func interpolateTemplate(template string, inputs map[string]any) string {
	if template == "" {
		return ""
	}

	// Match {{path.to.value}} or {{path[0].value}}
	re := regexp.MustCompile(`\{\{([^}]+)\}\}`)

	return re.ReplaceAllStringFunc(template, func(match string) string {
		// Extract the path (remove {{ and }})
		path := strings.TrimPrefix(strings.TrimSuffix(match, "}}"), "{{")
		path = strings.TrimSpace(path)

		// Debug logging
		log.Printf("🔍 [INTERPOLATE] Resolving '%s' from inputs: %+v", path, inputs)

		// Resolve the path in inputs
		value := resolvePath(inputs, path)
		if value == nil {
			log.Printf("⚠️ [INTERPOLATE] Failed to resolve '%s', keeping original", path)
			return match // Keep original if not found
		}

		log.Printf("✅ [INTERPOLATE] Resolved '%s' = %v", path, value)

		// Convert to string
		switch v := value.(type) {
		case string:
			return v
		case float64:
			if v == float64(int(v)) {
				return fmt.Sprintf("%d", int(v))
			}
			return fmt.Sprintf("%g", v)
		case int:
			return fmt.Sprintf("%d", v)
		case bool:
			return fmt.Sprintf("%t", v)
		default:
			// For complex types, JSON encode
			jsonBytes, err := json.Marshal(v)
			if err != nil {
				return match
			}
			return string(jsonBytes)
		}
	})
}

// interpolateMapValues recursively interpolates template strings in map values
func interpolateMapValues(data map[string]any, inputs map[string]any) map[string]any {
	result := make(map[string]any)

	for key, value := range data {
		result[key] = interpolateValue(value, inputs)
	}

	return result
}

// interpolateValue interpolates a single value (handles strings, maps, slices)
func interpolateValue(value any, inputs map[string]any) any {
	switch v := value.(type) {
	case string:
		// Interpolate string templates
		return interpolateTemplate(v, inputs)
	case map[string]any:
		// Recursively interpolate nested maps
		return interpolateMapValues(v, inputs)
	case []any:
		// Interpolate each element in slices
		result := make([]any, len(v))
		for i, elem := range v {
			result[i] = interpolateValue(elem, inputs)
		}
		return result
	default:
		// Return as-is for other types
		return value
	}
}

// resolvePath resolves a dot-notation path in a map
// Supports: input.field, input.nested.field, input[0].field
// Uses exact string matching with normalized block IDs
func resolvePath(data map[string]any, path string) any {
	parts := strings.Split(path, ".")
	var current any = data

	for _, part := range parts {
		if current == nil {
			return nil
		}

		// Check for array access: field[0]
		if idx := strings.Index(part, "["); idx != -1 {
			fieldName := part[:idx]
			indexStr := strings.TrimSuffix(part[idx+1:], "]")

			// Get the field
			if m, ok := current.(map[string]any); ok {
				current = m[fieldName]
			} else {
				return nil
			}

			// Get the array element
			if arr, ok := current.([]any); ok {
				var index int
				fmt.Sscanf(indexStr, "%d", &index)
				if index >= 0 && index < len(arr) {
					current = arr[index]
				} else {
					return nil
				}
			} else {
				return nil
			}
		} else {
			// Simple field access - exact match only
			if m, ok := current.(map[string]any); ok {
				val, exists := m[part]
				if !exists {
					return nil
				}
				current = val
			} else {
				return nil
			}
		}
	}

	return current
}

// Helper functions for config access
func getString(config map[string]any, key, defaultVal string) string {
	if v, ok := config[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return defaultVal
}

func getFloat(config map[string]any, key string, defaultVal float64) float64 {
	if v, ok := config[key]; ok {
		switch f := v.(type) {
		case float64:
			return f
		case int:
			return float64(f)
		}
	}
	return defaultVal
}

func getMap(config map[string]any, key string) map[string]any {
	if v, ok := config[key]; ok {
		if m, ok := v.(map[string]any); ok {
			return m
		}
	}
	return nil
}

// supportsStrictJSONSchema determines if a provider supports OpenAI's strict JSON schema mode
// Based on comprehensive testing results (Jan 2026) with 100% compliance validation
func supportsStrictJSONSchema(providerName, baseURL string) bool {
	// Normalize provider name and base URL for comparison
	name := strings.ToLower(providerName)
	url := strings.ToLower(baseURL)

	// ✅ TIER 1: Proven 100% compliance with strict mode

	// OpenAI - 100% compliance (tested: gpt-4.1, gpt-4.1-mini)
	// Response time: 3.8-4.1s
	if strings.Contains(name, "openai") || strings.Contains(url, "api.openai.com") {
		return true
	}

	// Gemini via OpenRouter - 100% compliance, FASTEST (819ms-1.4s)
	// Models: gemini-3-flash-preview, gemini-2.5-flash-lite-preview
	if strings.Contains(url, "openrouter.ai") {
		// Enable strict mode for OpenRouter - Gemini models have proven 100% compliance
		return true
	}

	// ClaraVerse Cloud (private TEE) - Mixed results, use fallback for safety
	// ✅ 100% compliance: Kimi-K2-Thinking-TEE, MiMo-V2-Flash
	// ❌ 0% compliance: GLM-4.7-TEE (accepts strict mode but returns invalid JSON)
	// Decision: Use fallback mode to ensure consistency across all models
	if strings.Contains(url, "llm.chutes.ai") || strings.Contains(url, "chutes.ai") {
		return false // Use fallback mode with prompt-based schema
	}

	// ❌ TIER 2: Providers that claim support but fail compliance

	// Z.AI - Accepts strict mode but 0% compliance (returns invalid JSON)
	// Models tested: glm-4.5, glm-4.7 (both 0% compliance)
	if strings.Contains(name, "z.ai") || strings.Contains(url, "api.z.ai") {
		return false
	}

	// 0G AI - Mixed results, some models 0% compliance
	// Use fallback mode for reliability
	if strings.Contains(url, "13.235.83.18:4002") {
		return false
	}

	// Groq - supports json_object but not strict json_schema (as of Jan 2026)
	if strings.Contains(name, "groq") || strings.Contains(url, "groq.com") {
		return false
	}

	// Default: Conservative fallback for untested providers
	// Use JSON mode + prompt-based schema enforcement
	return false
}

