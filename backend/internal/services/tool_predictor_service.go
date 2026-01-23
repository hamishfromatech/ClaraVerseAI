package services

import (
	"bytes"
	"claraverse/internal/database"
	"claraverse/internal/models"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// ToolPredictorService handles dynamic tool selection for chat requests
type ToolPredictorService struct {
	db                    *database.DB
	providerService       *ProviderService
	chatService           *ChatService
	defaultPredictorModel string // "gpt-4.1-mini"
}

// ToolPredictionResult represents selected tools from predictor
type ToolPredictionResult struct {
	SelectedTools []string `json:"selected_tools"` // Array of tool names
	Reasoning     string   `json:"reasoning"`
}

// Tool prediction system prompt (adapted from WorkflowGeneratorV2)
const ToolPredictionSystemPrompt = `You are a tool selection expert for Clara AI chat system. Analyze the user's message and select the MINIMUM set of tools needed to respond effectively.

CRITICAL RULES:
- Select ONLY tools that are DIRECTLY needed for THIS specific request
- Most requests need 0-3 tools. Rarely should you select more than 5 tools
- If no tools are needed (general conversation, advice, explanation), return empty array
- Don't over-select "just in case" - be precise and minimal

WHEN TO SELECT TOOLS:
- Search tools: User asks for current info, news, research, "look up", "search for"
- Time tools: User asks "what time", "current date", mentions time-sensitive info
- File tools: User mentions reading/processing files (CSV, PDF, etc.)
- Communication tools: User wants to send message to specific platform (Discord, Slack, email)
- Calculation tools: Complex math, data analysis
- API tools: Interacting with specific services (GitHub, Jira, etc.)

WHEN NOT TO SELECT TOOLS:
- General questions, explanations, advice, brainstorming
- Coding help (unless explicitly needs to search docs/internet)
- Writing tasks (emails, documents, summaries of provided text)
- Conversation, jokes, casual chat

Return JSON with selected_tools array (just tool names) and reasoning.`

// toolPredictionSchema defines structured output for tool selection
var toolPredictionSchema = map[string]interface{}{
	"type": "object",
	"properties": map[string]interface{}{
		"selected_tools": map[string]interface{}{
			"type": "array",
			"items": map[string]interface{}{
				"type":        "string",
				"description": "Tool name from available tools",
			},
			"description": "Array of tool names needed for this request",
		},
		"reasoning": map[string]interface{}{
			"type":        "string",
			"description": "Brief explanation of tool selection",
		},
	},
	"required":             []string{"selected_tools", "reasoning"},
	"additionalProperties": false,
}

// NewToolPredictorService creates a new tool predictor service
func NewToolPredictorService(
	db *database.DB,
	providerService *ProviderService,
	chatService *ChatService,
) *ToolPredictorService {
	service := &ToolPredictorService{
		db:              db,
		providerService: providerService,
		chatService:     chatService,
	}

	// Dynamically select first available smart_tool_router model
	var modelID string
	err := db.QueryRow(`
		SELECT m.id
		FROM models m
		WHERE m.smart_tool_router = 1 AND m.isVisible = 1
		ORDER BY m.id ASC
		LIMIT 1
	`).Scan(&modelID)

	if err != nil {
		log.Printf("⚠️ [TOOL-PREDICTOR] No smart_tool_router models found, falling back to any available model")
		// Fallback: Use any available visible model
		err = db.QueryRow(`
			SELECT m.id
			FROM models m
			WHERE m.isVisible = 1
			ORDER BY m.id ASC
			LIMIT 1
		`).Scan(&modelID)

		if err != nil {
			log.Printf("❌ [TOOL-PREDICTOR] No models available in database at initialization")
			modelID = "" // Will be handled later when models are loaded
		}
	}

	service.defaultPredictorModel = modelID
	if modelID != "" {
		log.Printf("✅ [TOOL-PREDICTOR] Using default predictor model: %s", modelID)
	}

	return service
}

// PredictTools predicts which tools are needed for a user message
// Returns selected tool definitions and error (nil on success)
// On failure, returns nil (caller should use all tools as fallback)
// conversationHistory: Recent conversation messages for better context-aware tool selection
func (s *ToolPredictorService) PredictTools(
	ctx context.Context,
	userID string,
	userMessage string,
	availableTools []map[string]interface{},
	conversationHistory []map[string]interface{},
) ([]map[string]interface{}, error) {

	// Get predictor model for user (or use default)
	predictorModelID, err := s.getPredictorModelForUser(ctx, userID)
	if err != nil {
		log.Printf("⚠️ [TOOL-PREDICTOR] Could not get predictor model: %v, using default", err)
		predictorModelID = s.defaultPredictorModel
	}

	// Get provider and model
	provider, actualModel, err := s.getProviderAndModel(predictorModelID)
	if err != nil {
		log.Printf("⚠️ [TOOL-PREDICTOR] Failed to get provider for predictor: %v", err)
		return nil, err
	}

	log.Printf("🤖 [TOOL-PREDICTOR] Using model: %s (%s)", predictorModelID, actualModel)

	// Build tool list for prompt
	toolListPrompt := s.buildToolListPrompt(availableTools)

	// Build user prompt
	userPrompt := fmt.Sprintf(`USER MESSAGE:
%s

AVAILABLE TOOLS:
%s

Select the minimal set of tools needed. Return JSON with selected_tools and reasoning.`,
		userMessage, toolListPrompt)

	// Build messages with conversation history for better context
	messages := []map[string]interface{}{
		{
			"role":    "system",
			"content": ToolPredictionSystemPrompt,
		},
	}

	// Add recent conversation history for multi-turn context (exclude current message)
	// Limit to last 6 messages (3 pairs) to avoid token bloat
	historyLimit := 6
	startIdx := len(conversationHistory) - historyLimit
	if startIdx < 0 {
		startIdx = 0
	}
	for i := startIdx; i < len(conversationHistory); i++ {
		msg := conversationHistory[i]
		messages = append(messages, msg)
	}

	// Add current user message with tool selection prompt
	messages = append(messages, map[string]interface{}{
		"role":    "user",
		"content": userPrompt,
	})

	// Build request with structured output
	requestBody := map[string]interface{}{
		"model":       actualModel,
		"messages":    messages,
		"stream":      false,
		"temperature": 0.2, // Low temp for consistency
		"response_format": map[string]interface{}{
			"type": "json_schema",
			"json_schema": map[string]interface{}{
				"name":   "tool_prediction",
				"strict": true,
				"schema": toolPredictionSchema,
			},
		},
	}

	reqBody, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	log.Printf("📤 [TOOL-PREDICTOR] Sending prediction request to %s", provider.BaseURL)

	// Create HTTP request with timeout
	httpReq, err := http.NewRequestWithContext(ctx, "POST", provider.BaseURL+"/chat/completions", bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+provider.APIKey)

	// Send request with 30s timeout
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("⚠️ [TOOL-PREDICTOR] API error: %s", string(body))
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	// Parse response
	var apiResponse struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return nil, fmt.Errorf("failed to parse API response: %w", err)
	}

	if len(apiResponse.Choices) == 0 {
		return nil, fmt.Errorf("no response from predictor model")
	}

	// Parse the prediction result
	var result ToolPredictionResult
	content := apiResponse.Choices[0].Message.Content

	if err := json.Unmarshal([]byte(content), &result); err != nil {
		log.Printf("⚠️ [TOOL-PREDICTOR] Failed to parse prediction: %v, content: %s", err, content)
		return nil, fmt.Errorf("failed to parse prediction: %w", err)
	}

	log.Printf("✅ [TOOL-PREDICTOR] Selected %d tools: %v", len(result.SelectedTools), result.SelectedTools)
	log.Printf("💭 [TOOL-PREDICTOR] Reasoning: %s", result.Reasoning)

	// Filter available tools to only include selected ones
	selectedToolDefs := s.filterToolsByNames(availableTools, result.SelectedTools)

	log.Printf("📊 [TOOL-PREDICTOR] Reduced from %d to %d tools", len(availableTools), len(selectedToolDefs))

	return selectedToolDefs, nil
}

// buildToolListPrompt creates a concise list of tools for the prompt
func (s *ToolPredictorService) buildToolListPrompt(tools []map[string]interface{}) string {
	var builder strings.Builder

	for i, toolDef := range tools {
		fn, ok := toolDef["function"].(map[string]interface{})
		if !ok {
			continue
		}

		name, _ := fn["name"].(string)
		desc, _ := fn["description"].(string)

		builder.WriteString(fmt.Sprintf("%d. %s: %s\n", i+1, name, desc))
	}

	return builder.String()
}

// filterToolsByNames filters tool definitions by selected names
func (s *ToolPredictorService) filterToolsByNames(
	allTools []map[string]interface{},
	selectedNames []string,
) []map[string]interface{} {

	// Build set for O(1) lookup
	nameSet := make(map[string]bool)
	for _, name := range selectedNames {
		nameSet[name] = true
	}

	filtered := make([]map[string]interface{}, 0, len(selectedNames))

	for _, toolDef := range allTools {
		fn, ok := toolDef["function"].(map[string]interface{})
		if !ok {
			continue
		}

		name, ok := fn["name"].(string)
		if !ok {
			continue
		}

		if nameSet[name] {
			filtered = append(filtered, toolDef)
		}
	}

	return filtered
}

// getPredictorModelForUser gets user's preferred predictor model
func (s *ToolPredictorService) getPredictorModelForUser(ctx context.Context, userID string) (string, error) {
	// Query user preferences for tool predictor model
	var predictorModelID sql.NullString
	err := s.db.QueryRow(`
		SELECT preferences->>'toolPredictorModelId'
		FROM users
		WHERE id = ?
	`, userID).Scan(&predictorModelID)

	if err != nil {
		// User not found or no preferences - use default
		log.Printf("⚠️ [TOOL-PREDICTOR] Could not get user predictor preference: %v, using default", err)
		return s.defaultPredictorModel, nil
	}

	// If user has a preference and it's not empty, use it
	if predictorModelID.Valid && predictorModelID.String != "" {
		log.Printf("🎯 [TOOL-PREDICTOR] Using user-preferred model: %s", predictorModelID.String)
		return predictorModelID.String, nil
	}

	// No preference set - use default
	return s.defaultPredictorModel, nil
}

// getProviderAndModel resolves model ID to provider and actual model name
func (s *ToolPredictorService) getProviderAndModel(modelID string) (*models.Provider, string, error) {
	if modelID == "" {
		return s.getDefaultPredictorModel()
	}

	// Try to find model in database
	var providerID int
	var modelName string
	var smartToolRouter int

	err := s.db.QueryRow(`
		SELECT m.name, m.provider_id, COALESCE(m.smart_tool_router, 0)
		FROM models m
		WHERE m.id = ? AND m.isVisible = 1
	`, modelID).Scan(&modelName, &providerID, &smartToolRouter)

	if err != nil {
		// Try as model alias
		if s.chatService != nil {
			if provider, actualModel, found := s.chatService.ResolveModelAlias(modelID); found {
				return provider, actualModel, nil
			}
		}
		// Only fall back to default if this is NOT already the default model (avoid recursion)
		if modelID != s.defaultPredictorModel {
			return s.getDefaultPredictorModel()
		}
		return nil, "", fmt.Errorf("default predictor model %s not found in database", modelID)
	}

	// Verify model is marked as smart tool router
	if smartToolRouter == 0 {
		log.Printf("⚠️ [TOOL-PREDICTOR] Model %s not marked as smart_tool_router", modelID)

		// Search for ANY available smart router model as fallback
		log.Printf("⚠️ [TOOL-PREDICTOR] Searching for any available smart router model...")
		var fallbackModelID string
		var fallbackModelName string
		var fallbackProviderID int

		err := s.db.QueryRow(`
			SELECT m.id, m.name, m.provider_id
			FROM models m
			WHERE m.smart_tool_router = 1 AND m.isVisible = 1
			ORDER BY m.id ASC
			LIMIT 1
		`).Scan(&fallbackModelID, &fallbackModelName, &fallbackProviderID)

		if err != nil {
			return nil, "", fmt.Errorf("no smart_tool_router models available in database")
		}

		log.Printf("✅ [TOOL-PREDICTOR] Found smart router model: %s (%s)", fallbackModelID, fallbackModelName)

		provider, err := s.providerService.GetByID(fallbackProviderID)
		if err != nil {
			return nil, "", fmt.Errorf("failed to get provider for smart router model: %w", err)
		}

		return provider, fallbackModelName, nil
	}

	provider, err := s.providerService.GetByID(providerID)
	if err != nil {
		return nil, "", fmt.Errorf("failed to get provider: %w", err)
	}

	return provider, modelName, nil
}

// getDefaultPredictorModel returns the default predictor model
// This directly looks up the default model to avoid infinite recursion
func (s *ToolPredictorService) getDefaultPredictorModel() (*models.Provider, string, error) {
	// First try to get the hardcoded default model
	var providerID int
	var modelName string
	var smartToolRouter int

	err := s.db.QueryRow(`
		SELECT m.name, m.provider_id, COALESCE(m.smart_tool_router, 0)
		FROM models m
		WHERE m.id = ? AND m.isVisible = 1
	`, s.defaultPredictorModel).Scan(&modelName, &providerID, &smartToolRouter)

	if err != nil {
		// Try as model alias
		if s.chatService != nil {
			if provider, actualModel, found := s.chatService.ResolveModelAlias(s.defaultPredictorModel); found {
				return provider, actualModel, nil
			}
		}
		return nil, "", fmt.Errorf("default predictor model %s not found: %w", s.defaultPredictorModel, err)
	}

	// If default model is not marked as smart_tool_router, find ANY available smart router model
	if smartToolRouter == 0 {
		log.Printf("⚠️ [TOOL-PREDICTOR] Default model %s not marked as smart_tool_router, searching for any available smart router model...", s.defaultPredictorModel)

		var fallbackModelID string
		err := s.db.QueryRow(`
			SELECT m.id, m.name, m.provider_id
			FROM models m
			WHERE m.smart_tool_router = 1 AND m.isVisible = 1
			ORDER BY m.id ASC
			LIMIT 1
		`).Scan(&fallbackModelID, &modelName, &providerID)

		if err != nil {
			return nil, "", fmt.Errorf("no smart_tool_router models available in database")
		}

		log.Printf("✅ [TOOL-PREDICTOR] Found smart router model: %s (%s)", fallbackModelID, modelName)
	}

	provider, err := s.providerService.GetByID(providerID)
	if err != nil {
		return nil, "", fmt.Errorf("failed to get provider for default model: %w", err)
	}

	return provider, modelName, nil
}
