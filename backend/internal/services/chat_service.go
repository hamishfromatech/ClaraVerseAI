package services

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"claraverse/internal/database"
	"claraverse/internal/models"
	"claraverse/internal/tools"

	cache "github.com/patrickmn/go-cache"
)

// truncateToolCallID ensures tool call IDs are max 40 chars (OpenAI API constraint)
// OpenAI may send IDs > 40 chars, but rejects them when sent back
func truncateToolCallID(id string) string {
	if len(id) <= 40 {
		return id
	}
	// Keep prefix (like "call_") and truncate to 40 chars
	return id[:40]
}

// ChatService handles chat operations
type ChatService struct {
	db                      *database.DB
	providerService         *ProviderService
	conversationCache       *cache.Cache // TTL cache for conversation history (30 min)
	summaryCache            *cache.Cache // Cache for AI-generated context summaries
	toolRegistry            *tools.Registry
	toolService             *ToolService              // Tool service for credential-filtered tools
	mcpBridge               *MCPBridgeService         // MCP bridge for local client tools
	modelAliases            map[int]map[string]string // Provider ID -> (Frontend Model -> Actual Model) mapping
	streamBuffer            *StreamBufferService      // Buffer for resumable streaming
	usageLimiter            *UsageLimiterService      // Usage limiter for tier-based limits
	toolPredictorService    *ToolPredictorService     // Tool predictor for dynamic tool selection
	memoryExtractionService *MemoryExtractionService  // Memory extraction service for extracting memories from chats
	memorySelectionService  *MemorySelectionService   // Memory selection service for selecting relevant memories
	userService             *UserService              // User service for getting user preferences
}

// ContextSummary stores AI-generated summary of older messages
type ContextSummary struct {
	Summary          string    // AI-generated summary text
	SummarizedCount  int       // Number of messages that were summarized
	LastMessageIndex int       // Index of the last message that was summarized
	CreatedAt        time.Time // When this summary was created
}

// ImageRegistryAdapter wraps ImageRegistryService to implement tools.ImageRegistryInterface
// This adapter is needed to avoid import cycles between services and tools packages
type ImageRegistryAdapter struct {
	registry *ImageRegistryService
}

// GetByHandle implements tools.ImageRegistryInterface
func (a *ImageRegistryAdapter) GetByHandle(conversationID, handle string) *tools.ImageRegistryEntry {
	entry := a.registry.GetByHandle(conversationID, handle)
	if entry == nil {
		return nil
	}
	return &tools.ImageRegistryEntry{
		Handle:   entry.Handle,
		FileID:   entry.FileID,
		Filename: entry.Filename,
		Source:   entry.Source,
	}
}

// ListHandles implements tools.ImageRegistryInterface
func (a *ImageRegistryAdapter) ListHandles(conversationID string) []string {
	return a.registry.ListHandles(conversationID)
}

// RegisterGeneratedImage implements tools.ImageRegistryInterface
func (a *ImageRegistryAdapter) RegisterGeneratedImage(conversationID, fileID, prompt string) string {
	return a.registry.RegisterGeneratedImage(conversationID, fileID, prompt)
}

// RegisterEditedImage implements tools.ImageRegistryInterface
func (a *ImageRegistryAdapter) RegisterEditedImage(conversationID, fileID, sourceHandle, prompt string) string {
	return a.registry.RegisterEditedImage(conversationID, fileID, sourceHandle, prompt)
}

// NewChatService creates a new chat service
func NewChatService(
	db *database.DB,
	providerService *ProviderService,
	mcpBridge *MCPBridgeService,
	toolService *ToolService,
) *ChatService {
	// Create conversation cache with eviction hook for file cleanup
	conversationCache := cache.New(30*time.Minute, 10*time.Minute)

	// Create summary cache with longer TTL (1 hour) - summaries are expensive to regenerate
	summaryCache := cache.New(1*time.Hour, 15*time.Minute)

	// Set up eviction handler to cleanup associated files
	conversationCache.OnEvicted(func(key string, value interface{}) {
		conversationID := key
		log.Printf("🗑️  [CACHE-EVICT] Conversation %s expired, cleaning up associated files...", conversationID)

		// Get file cache service
		fileCache := GetFileCacheService()

		// Delete all files for this conversation
		fileCache.DeleteConversationFiles(conversationID)

		// Also clean up the summary cache
		summaryCache.Delete(conversationID)

		log.Printf("✅ [CACHE-EVICT] Cleanup completed for conversation %s", conversationID)
	})

	return &ChatService{
		db:                db,
		providerService:   providerService,
		conversationCache: conversationCache,
		summaryCache:      summaryCache,
		toolRegistry:      tools.GetRegistry(),
		toolService:       toolService,
		mcpBridge:         mcpBridge,
		modelAliases:      make(map[int]map[string]string),
		streamBuffer:      NewStreamBufferService(),
	}
}

// SetToolService sets the tool service for credential-filtered tools
// This allows setting the tool service after initialization when there are circular dependencies
func (s *ChatService) SetToolService(toolService *ToolService) {
	s.toolService = toolService
	log.Println("✅ [CHAT-SERVICE] Tool service set for credential-filtered tools")
}

// SetUsageLimiter sets the usage limiter for tier-based usage limits
func (s *ChatService) SetUsageLimiter(usageLimiter *UsageLimiterService) {
	s.usageLimiter = usageLimiter
	log.Println("✅ [CHAT-SERVICE] Usage limiter set for tier-based limits")
}

// SetToolPredictorService sets the tool predictor service for dynamic tool selection
func (s *ChatService) SetToolPredictorService(predictor *ToolPredictorService) {
	s.toolPredictorService = predictor
	log.Println("✅ [CHAT-SERVICE] Tool predictor service set for smart tool routing")
}

// SetMemoryExtractionService sets the memory extraction service for extracting memories from chats
func (s *ChatService) SetMemoryExtractionService(memoryExtraction *MemoryExtractionService) {
	s.memoryExtractionService = memoryExtraction
	log.Println("✅ [CHAT-SERVICE] Memory extraction service set for conversation memory extraction")
}

// SetMemorySelectionService sets the memory selection service for selecting relevant memories
func (s *ChatService) SetMemorySelectionService(memorySelection *MemorySelectionService) {
	s.memorySelectionService = memorySelection
	log.Println("✅ [CHAT-SERVICE] Memory selection service set for memory injection")
}

// SetUserService sets the user service for getting user preferences
func (s *ChatService) SetUserService(userService *UserService) {
	s.userService = userService
	log.Println("✅ [CHAT-SERVICE] User service set for preference checking")
}

// GetStreamBuffer returns the stream buffer service for resume handling
func (s *ChatService) GetStreamBuffer() *StreamBufferService {
	return s.streamBuffer
}

// SetModelAliases sets model aliases for a provider
func (s *ChatService) SetModelAliases(providerID int, aliases map[string]models.ModelAlias) {
	if aliases != nil && len(aliases) > 0 {
		// Convert ModelAlias to string map for internal storage
		stringAliases := make(map[string]string)
		for frontend, alias := range aliases {
			stringAliases[frontend] = alias.ActualModel
		}
		s.modelAliases[providerID] = stringAliases

		log.Printf("🔄 [MODEL-ALIAS] Loaded %d model aliases for provider %d", len(aliases), providerID)
		for frontend, alias := range aliases {
			if alias.Description != "" {
				log.Printf("   %s -> %s (%s)", frontend, alias.ActualModel, alias.Description)
			} else {
				log.Printf("   %s -> %s", frontend, alias.ActualModel)
			}
		}
	}
}

// resolveModelName resolves a frontend model name to the actual model name using aliases
func (s *ChatService) resolveModelName(providerID int, modelName string) string {
	if aliases, exists := s.modelAliases[providerID]; exists {
		if actualModel, found := aliases[modelName]; found {
			log.Printf("🔄 [MODEL-ALIAS] Resolved '%s' -> '%s' for provider %d", modelName, actualModel, providerID)
			return actualModel
		}
	}
	// No alias found, return original model name
	return modelName
}

// resolveModelAlias searches all providers for a model alias and returns the provider ID and actual model name
// Returns (providerID, actualModelName, found)
func (s *ChatService) resolveModelAlias(aliasName string) (int, string, bool) {
	for providerID, aliases := range s.modelAliases {
		if actualModel, found := aliases[aliasName]; found {
			log.Printf("🔄 [MODEL-ALIAS] Resolved alias '%s' -> provider=%d, model='%s'", aliasName, providerID, actualModel)
			return providerID, actualModel, true
		}
	}
	return 0, "", false
}

// ResolveModelAlias is the public version that returns provider and actual model name
// Returns (provider, actualModelName, found)
func (s *ChatService) ResolveModelAlias(aliasName string) (*models.Provider, string, bool) {
	providerID, actualModel, found := s.resolveModelAlias(aliasName)
	if !found {
		return nil, "", false
	}

	provider, err := s.providerService.GetByID(providerID)
	if err != nil {
		log.Printf("⚠️ [MODEL-ALIAS] Found alias but provider %d not found: %v", providerID, err)
		return nil, "", false
	}

	return provider, actualModel, true
}

// GetDefaultProvider returns the first available enabled provider (for fallback)
func (s *ChatService) GetDefaultProvider() (*models.Provider, error) {
	providers, err := s.providerService.GetAll()
	if err != nil {
		return nil, fmt.Errorf("failed to get providers: %w", err)
	}

	if len(providers) == 0 {
		return nil, fmt.Errorf("no providers configured")
	}

	// Return first enabled provider
	return &providers[0], nil
}

// GetDefaultProviderWithModel returns the first available provider and a default model from it
func (s *ChatService) GetDefaultProviderWithModel() (*models.Provider, string, error) {
	provider, err := s.GetDefaultProvider()
	if err != nil {
		return nil, "", err
	}

	// Query for the first visible model from this provider
	var modelID string
	err = s.db.QueryRow(`
		SELECT id FROM models
		WHERE provider_id = ? AND isVisible = 1
		ORDER BY name
		LIMIT 1
	`, provider.ID).Scan(&modelID)

	if err != nil {
		// No models found, try without visibility filter
		err = s.db.QueryRow(`
			SELECT id FROM models
			WHERE provider_id = ?
			ORDER BY name
			LIMIT 1
		`, provider.ID).Scan(&modelID)

		if err != nil {
			return nil, "", fmt.Errorf("no models found for default provider %s: %w", provider.Name, err)
		}
	}

	log.Printf("🔧 [DEFAULT] Using provider '%s' with model '%s'", provider.Name, modelID)
	return provider, modelID, nil
}

// GetTextProviderWithModel returns a text-capable provider and model for internal use (metadata generation, etc.)
// It tries model aliases first, then falls back to finding any enabled text provider
// This filters out audio-only and image-only providers
func (s *ChatService) GetTextProviderWithModel() (*models.Provider, string, error) {
	// Strategy 1: Try to use model aliases from config (these are known good text models)
	configService := GetConfigService()
	allAliases := configService.GetAllModelAliases()

	// Get image-only provider names to filter them out
	imageProviderService := GetImageProviderService()
	imageProviders := imageProviderService.GetAllProviders()
	imageProviderNames := make(map[string]bool)
	for _, ip := range imageProviders {
		imageProviderNames[ip.Name] = true
	}

	// Strategy 1.5: Query database for smallest/fastest available model (prefer smaller models for metadata)
	// Try to get models with lower context length (usually faster/cheaper)
	log.Printf("📋 [TEXT-PROVIDER] Querying database for optimal text model...")
	var modelID string
	var modelProviderID int
	err := s.db.QueryRow(`
		SELECT m.id, m.provider_id
		FROM models m
		JOIN providers p ON m.provider_id = p.id
		WHERE m.isVisible = 1
		AND p.enabled = 1
		AND (p.audio_only = 0 OR p.audio_only IS NULL)
		ORDER BY m.context_length ASC, m.id ASC
		LIMIT 1
	`).Scan(&modelID, &modelProviderID)

	if err == nil {
		provider, err := s.providerService.GetByID(modelProviderID)
		if err == nil && !provider.AudioOnly && !imageProviderNames[provider.Name] {
			log.Printf("📋 [TEXT-PROVIDER] Found optimal model from database: %s (provider: %s)", modelID, provider.Name)
			return provider, modelID, nil
		}
	}

	// Strategy 2: Try any available model alias
	for providerID, aliases := range allAliases {
		for aliasName, aliasInfo := range aliases {
			provider, err := s.providerService.GetByID(providerID)
			if err != nil || !provider.Enabled || provider.AudioOnly {
				continue
			}
			if imageProviderNames[provider.Name] {
				continue
			}

			log.Printf("📋 [TEXT-PROVIDER] Found via any alias: %s -> %s (provider: %s)",
				aliasName, aliasInfo.ActualModel, provider.Name)
			return provider, aliasInfo.ActualModel, nil
		}
	}

	// Strategy 3: Query database for any text-capable provider with models
	log.Printf("📋 [TEXT-PROVIDER] No aliases found, querying database for text provider...")

	var providerID int
	var providerName, baseURL, apiKey string
	var systemPrompt, favicon *string

	// Find first enabled text provider (not audio_only) that has models
	err = s.db.QueryRow(`
		SELECT p.id, p.name, p.base_url, p.api_key, p.system_prompt, p.favicon
		FROM providers p
		WHERE p.enabled = 1 AND (p.audio_only = 0 OR p.audio_only IS NULL)
		AND EXISTS (SELECT 1 FROM models m WHERE m.provider_id = p.id)
		ORDER BY p.id ASC
		LIMIT 1
	`).Scan(&providerID, &providerName, &baseURL, &apiKey, &systemPrompt, &favicon)

	if err != nil {
		return nil, "", fmt.Errorf("no text-capable provider found: %w", err)
	}

	// Check if this provider is an image-only provider
	if imageProviderNames[providerName] {
		// Try to find the next one that's not image-only
		rows, err := s.db.Query(`
			SELECT p.id, p.name, p.base_url, p.api_key, p.system_prompt, p.favicon
			FROM providers p
			WHERE p.enabled = 1 AND (p.audio_only = 0 OR p.audio_only IS NULL)
			AND EXISTS (SELECT 1 FROM models m WHERE m.provider_id = p.id)
			ORDER BY p.id ASC
		`)
		if err != nil {
			return nil, "", fmt.Errorf("failed to query providers: %w", err)
		}
		defer rows.Close()

		found := false
		for rows.Next() {
			if err := rows.Scan(&providerID, &providerName, &baseURL, &apiKey, &systemPrompt, &favicon); err != nil {
				continue
			}
			if !imageProviderNames[providerName] {
				found = true
				break
			}
		}

		if !found {
			return nil, "", fmt.Errorf("no text-capable provider found (all are image-only)")
		}
	}

	// Get first model from this provider
	modelID = "" // Reset modelID for this provider
	err = s.db.QueryRow(`
		SELECT id FROM models
		WHERE provider_id = ? AND isVisible = 1
		ORDER BY name
		LIMIT 1
	`, providerID).Scan(&modelID)

	if err != nil {
		// Try without visibility filter
		err = s.db.QueryRow(`
			SELECT id FROM models
			WHERE provider_id = ?
			ORDER BY name
			LIMIT 1
		`, providerID).Scan(&modelID)

		if err != nil {
			return nil, "", fmt.Errorf("no models found for provider %s: %w", providerName, err)
		}
	}

	provider := &models.Provider{
		ID:      providerID,
		Name:    providerName,
		BaseURL: baseURL,
		APIKey:  apiKey,
		Enabled: true,
	}
	if systemPrompt != nil {
		provider.SystemPrompt = *systemPrompt
	}
	if favicon != nil {
		provider.Favicon = *favicon
	}

	log.Printf("📋 [TEXT-PROVIDER] Found via database: provider=%s, model=%s", providerName, modelID)
	return provider, modelID, nil
}

// getConversationMessages retrieves messages from cache
func (s *ChatService) getConversationMessages(conversationID string) []map[string]interface{} {
	if cached, found := s.conversationCache.Get(conversationID); found {
		if messages, ok := cached.([]map[string]interface{}); ok {
			log.Printf("📖 [CACHE] Retrieved %d messages for conversation %s", len(messages), conversationID)
			return messages
		}
		log.Printf("⚠️  [CACHE] Invalid cache data type for conversation %s", conversationID)
	}
	log.Printf("📖 [CACHE] No cached messages for conversation %s (starting fresh)", conversationID)
	return []map[string]interface{}{}
}

// GetConversationMessages retrieves messages from cache (public)
func (s *ChatService) GetConversationMessages(conversationID string) []map[string]interface{} {
	return s.getConversationMessages(conversationID)
}

// setConversationMessages stores messages in cache with TTL
func (s *ChatService) setConversationMessages(conversationID string, messages []map[string]interface{}) {
	s.conversationCache.Set(conversationID, messages, cache.DefaultExpiration)
	log.Printf("💾 [CACHE] Stored %d messages for conversation %s", len(messages), conversationID)
}

// Context Window Management Constants
const (
	// Maximum tokens to send to the model (conservative limit for safety)
	// Most models support 128K+, but we use 80K to leave room for response
	MaxContextTokens = 80000

	// Threshold to trigger summarization (70% of max)
	SummarizationThreshold = 56000

	// Approximate tokens per character (conservative estimate)
	TokensPerChar = 0.25

	// Number of recent messages to always keep verbatim (higher = more context preserved)
	RecentMessagesToKeep = 20

	// Maximum characters for a single message before truncation
	MaxMessageChars = 50000

	// Minimum messages before summarization kicks in
	MinMessagesForSummary = 15
)

// estimateTokens provides a rough token count for a string
// Uses the conservative estimate of ~4 chars per token
func estimateTokens(s string) int {
	return int(float64(len(s)) * TokensPerChar)
}

// estimateMessagesTokens calculates approximate token count for messages
func estimateMessagesTokens(messages []map[string]interface{}) int {
	total := 0
	for _, msg := range messages {
		if content, ok := msg["content"].(string); ok {
			total += estimateTokens(content)
		}
		// Account for role and structure overhead
		total += 10
	}
	return total
}

// getContextSummary retrieves a cached context summary for a conversation
func (s *ChatService) getContextSummary(conversationID string) *ContextSummary {
	if cached, found := s.summaryCache.Get(conversationID); found {
		if summary, ok := cached.(*ContextSummary); ok {
			return summary
		}
	}
	return nil
}

// setContextSummary stores a context summary in cache
func (s *ChatService) setContextSummary(conversationID string, summary *ContextSummary) {
	s.summaryCache.Set(conversationID, summary, cache.DefaultExpiration)
	log.Printf("💾 [SUMMARY] Stored context summary for %s (%d messages summarized)", conversationID, summary.SummarizedCount)
}

// generateContextSummary uses AI to create a summary of older messages
// This runs asynchronously to not block the main conversation
func (s *ChatService) generateContextSummary(conversationID string, messages []map[string]interface{}, config *models.Config) string {
	// Build the content to summarize
	var contentToSummarize strings.Builder
	for i, msg := range messages {
		role, _ := msg["role"].(string)
		content, _ := msg["content"].(string)
		if role == "system" {
			continue // Skip system messages
		}
		// Truncate very long messages for the summary (keep more context for technical conversations)
		if len(content) > 8000 {
			content = content[:4000] + "\n\n[... middle content truncated for summary ...]\n\n" + content[len(content)-2000:]
		}
		contentToSummarize.WriteString(fmt.Sprintf("[%s #%d]: %s\n\n", role, i+1, content))
	}

	// Create summarization prompt - optimized for technical conversations
	summaryPrompt := []map[string]interface{}{
		{
			"role": "system",
			"content": `You are a technical conversation summarizer. Your job is to create a detailed context summary that preserves ALL important information needed to continue the conversation seamlessly.

CRITICAL - You MUST preserve:
1. **FILE PATHS & CODE** - Every file path, function name, class name, variable name mentioned
2. **TECHNICAL DECISIONS** - Architecture choices, implementation approaches, why certain solutions were chosen/rejected
3. **BUGS & FIXES** - What was broken, what fixed it, error messages encountered
4. **CONFIGURATION** - Settings, thresholds, environment variables, API endpoints discussed
5. **CURRENT STATE** - What has been implemented, what's pending, what's blocked
6. **USER PREFERENCES** - Coding style, frameworks preferred, constraints mentioned
7. **SPECIFIC VALUES** - Numbers, dates, versions, exact strings that were important

FORMAT YOUR SUMMARY AS:
## Project Context
[What is being built/modified]

## Files Modified/Discussed
- path/to/file.ext - what was done
- path/to/another.ext - what was changed

## Key Technical Details
[Specific implementations, code patterns, configurations]

## Current Status
[What's done, what's in progress, what's next]

## Important Decisions Made
[Why certain approaches were chosen]

## Open Issues/Blockers
[Any unresolved problems]

Be THOROUGH - it's better to include too much detail than to lose critical context. Max 1500 words.`,
		},
		{
			"role":    "user",
			"content": fmt.Sprintf("Create a detailed technical summary of this conversation that preserves all context needed to continue:\n\n%s", contentToSummarize.String()),
		},
	}

	// Make a non-streaming request for summary
	chatReq := models.ChatRequest{
		Model:       config.Model,
		Messages:    summaryPrompt,
		Stream:      false,
		Temperature: 0.3, // Low temperature for consistency
	}

	reqBody, err := json.Marshal(chatReq)
	if err != nil {
		log.Printf("❌ [SUMMARY] Failed to marshal request: %v", err)
		return ""
	}

	req, err := http.NewRequest("POST", config.BaseURL+"/chat/completions", bytes.NewBuffer(reqBody))
	if err != nil {
		log.Printf("❌ [SUMMARY] Failed to create request: %v", err)
		return ""
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ [SUMMARY] Request failed: %v", err)
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ [SUMMARY] API error (status %d): %s", resp.StatusCode, string(body))
		return ""
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("❌ [SUMMARY] Failed to decode response: %v", err)
		return ""
	}

	if len(result.Choices) == 0 {
		log.Printf("⚠️  [SUMMARY] No choices in response")
		return ""
	}

	summary := strings.TrimSpace(result.Choices[0].Message.Content)
	log.Printf("✅ [SUMMARY] Generated summary for %s (%d chars)", conversationID, len(summary))
	return summary
}

// optimizeContextWindow manages context to prevent exceeding token limits
// Uses AI-powered summarization for older messages, preserving context
func (s *ChatService) optimizeContextWindow(messages []map[string]interface{}, conversationID string, config *models.Config, writeChan chan models.ServerMessage) []map[string]interface{} {
	totalTokens := estimateMessagesTokens(messages)

	// If within limits, return as-is
	if totalTokens <= SummarizationThreshold {
		return messages
	}

	log.Printf("📊 [CONTEXT] Context optimization needed: %d tokens exceeds %d threshold", totalTokens, SummarizationThreshold)

	// Notify client that context optimization is starting
	if writeChan != nil {
		select {
		case writeChan <- models.ServerMessage{
			Type:     "context_optimizing",
			Status:   "started",
			Progress: 0,
			Content:  "Compacting conversation to keep chatting...",
		}:
		default:
			log.Printf("⚠️ [CONTEXT] WriteChan unavailable for optimization status")
		}
	}

	// Strategy 1: Truncate very long individual messages
	for i := range messages {
		if content, ok := messages[i]["content"].(string); ok {
			if len(content) > MaxMessageChars {
				keepFirst := MaxMessageChars / 2
				keepLast := MaxMessageChars / 4
				truncated := content[:keepFirst] + "\n\n[... content truncated ...]\n\n" + content[len(content)-keepLast:]
				messages[i]["content"] = truncated
				log.Printf("✂️  [CONTEXT] Truncated message %d from %d to %d chars", i, len(content), len(truncated))
			}
		}
	}

	// Recalculate after truncation
	totalTokens = estimateMessagesTokens(messages)
	if totalTokens <= SummarizationThreshold {
		// Truncation was sufficient - notify completion before returning
		if writeChan != nil {
			select {
			case writeChan <- models.ServerMessage{
				Type:     "context_optimizing",
				Status:   "completed",
				Progress: 100,
				Content:  "Context optimized via truncation",
			}:
			default:
			}
		}
		return messages
	}

	// Strategy 2: Use AI summary for older messages
	// Separate system message from conversation
	var systemMsg map[string]interface{}
	nonSystemMessages := make([]map[string]interface{}, 0)

	for _, msg := range messages {
		if role, ok := msg["role"].(string); ok && role == "system" {
			systemMsg = msg
		} else {
			nonSystemMessages = append(nonSystemMessages, msg)
		}
	}

	// Need enough messages to summarize
	if len(nonSystemMessages) < MinMessagesForSummary {
		// Not enough messages for summarization - notify completion
		if writeChan != nil {
			select {
			case writeChan <- models.ServerMessage{
				Type:     "context_optimizing",
				Status:   "completed",
				Progress: 100,
				Content:  "Context optimization complete",
			}:
			default:
			}
		}
		return messages
	}

	// Calculate how many messages to keep vs summarize
	recentCount := RecentMessagesToKeep
	if recentCount > len(nonSystemMessages) {
		recentCount = len(nonSystemMessages)
	}

	oldMessages := nonSystemMessages[:len(nonSystemMessages)-recentCount]
	recentMessages := nonSystemMessages[len(nonSystemMessages)-recentCount:]

	// Check if we have a valid cached summary
	existingSummary := s.getContextSummary(conversationID)
	var summaryText string

	if existingSummary != nil && existingSummary.SummarizedCount >= len(oldMessages)-2 {
		// Use existing summary if it covers most of the old messages
		summaryText = existingSummary.Summary
		log.Printf("📖 [CONTEXT] Using cached summary for %s (covers %d messages)", conversationID, existingSummary.SummarizedCount)

		// Quick progress update for cached summary
		if writeChan != nil {
			select {
			case writeChan <- models.ServerMessage{
				Type:     "context_optimizing",
				Status:   "completed",
				Progress: 100,
				Content:  "Using cached summary...",
			}:
			default:
			}
		}
	} else if config != nil {
		// Generate new AI summary - send progress update
		log.Printf("🤖 [CONTEXT] Generating AI summary for %d messages in %s", len(oldMessages), conversationID)

		if writeChan != nil {
			select {
			case writeChan <- models.ServerMessage{
				Type:     "context_optimizing",
				Status:   "summarizing",
				Progress: 30,
				Content:  "Summarizing older messages...",
			}:
			default:
			}
		}

		summaryText = s.generateContextSummary(conversationID, oldMessages, config)

		if summaryText != "" {
			// Cache the summary
			s.setContextSummary(conversationID, &ContextSummary{
				Summary:          summaryText,
				SummarizedCount:  len(oldMessages),
				LastMessageIndex: len(nonSystemMessages) - recentCount - 1,
				CreatedAt:        time.Now(),
			})

			// Summary complete
			if writeChan != nil {
				select {
				case writeChan <- models.ServerMessage{
					Type:     "context_optimizing",
					Status:   "completed",
					Progress: 100,
					Content:  "Context optimized successfully",
				}:
				default:
				}
			}
		} else {
			// AI summary failed - still notify completion so modal closes
			if writeChan != nil {
				select {
				case writeChan <- models.ServerMessage{
					Type:     "context_optimizing",
					Status:   "completed",
					Progress: 100,
					Content:  "Context trimmed (summary unavailable)",
				}:
				default:
				}
			}
		}
	} else {
		// No cached summary and no config - just notify completion
		if writeChan != nil {
			select {
			case writeChan <- models.ServerMessage{
				Type:     "context_optimizing",
				Status:   "completed",
				Progress: 100,
				Content:  "Context trimmed",
			}:
			default:
			}
		}
	}

	// Build optimized context
	result := make([]map[string]interface{}, 0)

	// Add system message first
	if systemMsg != nil {
		result = append(result, systemMsg)
	}

	// Add summary as a system context message
	if summaryText != "" {
		summaryMsg := map[string]interface{}{
			"role": "system",
			"content": fmt.Sprintf(`[Conversation Context Summary - %d earlier messages]
%s

[End of summary - continuing with recent messages]`, len(oldMessages), summaryText),
		}
		result = append(result, summaryMsg)
	} else {
		// Fallback: just note that context was trimmed
		summaryMsg := map[string]interface{}{
			"role":    "system",
			"content": fmt.Sprintf("[Note: %d earlier messages were condensed. Recent conversation continues below.]", len(oldMessages)),
		}
		result = append(result, summaryMsg)
	}

	// Add recent messages
	result = append(result, recentMessages...)

	newTokens := estimateMessagesTokens(result)
	log.Printf("📉 [CONTEXT] Reduced from %d to %d tokens (kept %d messages + summary)", totalTokens, newTokens, len(recentMessages))

	return result
}

// optimizeContextAfterStream runs context optimization AFTER streaming completes
// This is called asynchronously so it doesn't block the user experience
func (s *ChatService) optimizeContextAfterStream(userConn *models.UserConnection) {
	// Recover from panics (user may disconnect)
	defer func() {
		if r := recover(); r != nil {
			log.Printf("⚠️ [CONTEXT] Recovered from panic during post-stream optimization: %v", r)
		}
	}()

	// Get current messages from cache
	messages := s.getConversationMessages(userConn.ConversationID)
	totalTokens := estimateMessagesTokens(messages)

	// Check if optimization is needed
	if totalTokens <= SummarizationThreshold {
		log.Printf("📊 [CONTEXT] Post-stream check: %d tokens, no optimization needed (threshold: %d)",
			totalTokens, SummarizationThreshold)
		return
	}

	log.Printf("📊 [CONTEXT] Post-stream optimization starting: %d tokens exceeds %d threshold",
		totalTokens, SummarizationThreshold)

	// Get config for summarization API call
	config, err := s.GetEffectiveConfig(userConn, userConn.ModelID)
	if err != nil {
		log.Printf("❌ [CONTEXT] Failed to get config for optimization: %v", err)
		return
	}

	// Run the optimization (this will send UI notifications via WriteChan)
	optimizedMessages := s.optimizeContextWindow(messages, userConn.ConversationID, config, userConn.WriteChan)

	// Save optimized messages back to cache
	s.setConversationMessages(userConn.ConversationID, optimizedMessages)

	log.Printf("✅ [CONTEXT] Post-stream optimization complete for %s", userConn.ConversationID)
}

// checkAndTriggerMemoryExtraction checks if memory extraction threshold is reached
// This is called asynchronously after each assistant message
func (s *ChatService) checkAndTriggerMemoryExtraction(userConn *models.UserConnection) {
	// Recover from panics
	defer func() {
		if r := recover(); r != nil {
			log.Printf("⚠️ [MEMORY] Recovered from panic during memory extraction check: %v", r)
		}
	}()

	// Get user preferences to check if memory is enabled and get threshold
	ctx := context.Background()
	user, err := s.userService.GetUserBySupabaseID(ctx, userConn.UserID)
	if err != nil {
		log.Printf("⚠️ [MEMORY] Failed to get user preferences: %v", err)
		return
	}

	// Check if memory system is enabled for this user
	if !user.Preferences.MemoryEnabled {
		return // Memory system disabled, skip extraction
	}

	// Get user's configured threshold (default to 20 if not set)
	threshold := user.Preferences.MemoryExtractionThreshold
	if threshold <= 0 {
		threshold = 20 // Default to 20 messages (conservative)
	}

	// Get current messages from cache
	messages := s.getConversationMessages(userConn.ConversationID)
	messageCount := len(messages)

	// Check if threshold reached (message count is multiple of threshold)
	if messageCount > 0 && messageCount%threshold == 0 {
		log.Printf("🧠 [MEMORY] Threshold reached (%d messages), enqueuing extraction job for conversation %s",
			messageCount, userConn.ConversationID)

		// Get recent messages (last 'threshold' messages for extraction)
		startIndex := messageCount - threshold
		if startIndex < 0 {
			startIndex = 0
		}
		recentMessages := messages[startIndex:]

		// Enqueue extraction job (non-blocking)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		err := s.memoryExtractionService.EnqueueExtraction(
			ctx,
			userConn.UserID,
			userConn.ConversationID,
			recentMessages,
		)
		if err != nil {
			log.Printf("⚠️ [MEMORY] Failed to enqueue extraction job: %v", err)
		} else {
			log.Printf("✅ [MEMORY] Extraction job enqueued successfully")
		}
	}
}

// SetConversationMessages stores messages in cache with TTL (public)
func (s *ChatService) SetConversationMessages(conversationID string, messages []map[string]interface{}) {
	s.setConversationMessages(conversationID, messages)
}

// clearConversation removes all messages for a conversation (internal)
func (s *ChatService) clearConversation(conversationID string) {
	s.conversationCache.Delete(conversationID)
	log.Printf("🗑️  [CACHE] Cleared conversation %s", conversationID)
}

// ClearConversation removes all messages for a conversation (public)
func (s *ChatService) ClearConversation(conversationID string) {
	s.clearConversation(conversationID)
}

// CreateConversation creates a new conversation in the database with ownership tracking
func (s *ChatService) CreateConversation(conversationID, userID, title string) error {
	_, err := s.db.Exec(`
		INSERT INTO conversations (id, user_id, title, expires_at)
		VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))
		ON DUPLICATE KEY UPDATE
			last_activity_at = NOW(),
			expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
	`, conversationID, userID, title)

	if err != nil {
		return fmt.Errorf("failed to create conversation: %w", err)
	}

	log.Printf("📝 [OWNERSHIP] Created conversation %s for user %s", conversationID, userID)
	return nil
}

// IsConversationOwner checks if a user owns a specific conversation
func (s *ChatService) IsConversationOwner(conversationID, userID string) bool {
	var ownerID string
	err := s.db.QueryRow("SELECT user_id FROM conversations WHERE id = ?", conversationID).Scan(&ownerID)

	if err != nil {
		// Conversation doesn't exist in database - allow access (for backward compatibility with cache-only conversations)
		log.Printf("⚠️  [OWNERSHIP] Conversation %s not in database, allowing access", conversationID)
		return true
	}

	isOwner := ownerID == userID
	if !isOwner {
		log.Printf("🚫 [OWNERSHIP] User %s denied access to conversation %s (owned by %s)", userID, conversationID, ownerID)
	}

	return isOwner
}

// UpdateConversationActivity updates the last activity timestamp and extends expiration
func (s *ChatService) UpdateConversationActivity(conversationID string) error {
	_, err := s.db.Exec(`
		UPDATE conversations
		SET last_activity_at = NOW(),
			expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE),
			updated_at = NOW()
		WHERE id = ?
	`, conversationID)

	if err != nil {
		return fmt.Errorf("failed to update conversation activity: %w", err)
	}

	return nil
}

// DeleteAllConversationsByUser deletes all conversations for a specific user (for GDPR compliance)
func (s *ChatService) DeleteAllConversationsByUser(userID string) error {
	result, err := s.db.Exec("DELETE FROM conversations WHERE user_id = ?", userID)
	if err != nil {
		return fmt.Errorf("failed to delete user conversations: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	log.Printf("🗑️  [GDPR] Deleted %d conversations for user %s", rowsAffected, userID)

	return nil
}

// GetAllConversationsByUser retrieves all conversations for a user (for GDPR data export)
func (s *ChatService) GetAllConversationsByUser(userID string) ([]map[string]interface{}, error) {
	rows, err := s.db.Query(`
		SELECT id, title, created_at, updated_at, last_activity_at, expires_at
		FROM conversations
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, userID)

	if err != nil {
		return nil, fmt.Errorf("failed to query conversations: %w", err)
	}
	defer rows.Close()

	conversations := make([]map[string]interface{}, 0)

	for rows.Next() {
		var id, title, createdAt, updatedAt, lastActivityAt, expiresAt string

		if err := rows.Scan(&id, &title, &createdAt, &updatedAt, &lastActivityAt, &expiresAt); err != nil {
			log.Printf("⚠️  Failed to scan conversation: %v", err)
			continue
		}

		// Get messages from cache if available
		messages := s.getConversationMessages(id)

		conversation := map[string]interface{}{
			"id":               id,
			"title":            title,
			"created_at":       createdAt,
			"updated_at":       updatedAt,
			"last_activity_at": lastActivityAt,
			"expires_at":       expiresAt,
			"message_count":    len(messages),
			"messages":         messages,
		}

		conversations = append(conversations, conversation)
	}

	return conversations, nil
}

// ConversationStatus holds status information about a conversation
type ConversationStatus struct {
	Exists    bool  `json:"exists"`
	HasFiles  bool  `json:"hasFiles"`
	ExpiresIn int64 `json:"expiresIn"` // seconds until expiration, -1 if expired
}

// GetConversationStatus checks if a conversation exists and when it expires
func (s *ChatService) GetConversationStatus(conversationID string) *ConversationStatus {
	status := &ConversationStatus{
		Exists:    false,
		HasFiles:  false,
		ExpiresIn: -1,
	}

	// Check if conversation exists in cache
	if _, expiration, found := s.conversationCache.GetWithExpiration(conversationID); found {
		status.Exists = true

		// Calculate time until expiration
		if !expiration.IsZero() {
			timeUntilExpiration := time.Until(expiration)
			status.ExpiresIn = int64(timeUntilExpiration.Seconds())
		}

		// Check if conversation has files
		fileCache := GetFileCacheService()
		fileIDs := fileCache.GetConversationFiles(conversationID)
		status.HasFiles = len(fileIDs) > 0

		log.Printf("📊 [STATUS] Conversation %s: exists=%v, hasFiles=%v, expiresIn=%ds",
			conversationID, status.Exists, status.HasFiles, status.ExpiresIn)
	} else {
		log.Printf("📊 [STATUS] Conversation %s: not found in cache", conversationID)
	}

	return status
}

// AddUserMessage adds a user message to the conversation cache
func (s *ChatService) AddUserMessage(conversationID string, content interface{}) {
	messages := s.getConversationMessages(conversationID)

	// 🔍 DIAGNOSTIC: Log messages retrieved before adding new one
	log.Printf("🔍 [ADD-USER] Retrieved %d messages from cache for conversation %s",
		len(messages), conversationID)

	messages = append(messages, map[string]interface{}{
		"role":    "user",
		"content": content,
	})

	// 🔍 DIAGNOSTIC: Log messages after adding new user message
	log.Printf("🔍 [ADD-USER] After append: %d messages (added 1 user message)", len(messages))

	s.setConversationMessages(conversationID, messages)
}

// hasImageAttachments checks if messages contain any image attachments
func (s *ChatService) hasImageAttachments(messages []map[string]interface{}) bool {
	for _, msg := range messages {
		content := msg["content"]
		if content == nil {
			continue
		}

		// Try []interface{} first (generic slice)
		if contentArr, ok := content.([]interface{}); ok {
			for _, part := range contentArr {
				if partMap, ok := part.(map[string]interface{}); ok {
					if partType, ok := partMap["type"].(string); ok && partType == "image_url" {
						log.Printf("🖼️ [VISION-CHECK] Found image_url in []interface{} content")
						return true
					}
				}
			}
		}

		// Try []map[string]interface{} (typed slice - this is what websocket handler creates)
		if contentArr, ok := content.([]map[string]interface{}); ok {
			for _, part := range contentArr {
				if partType, ok := part["type"].(string); ok && partType == "image_url" {
					log.Printf("🖼️ [VISION-CHECK] Found image_url in []map[string]interface{} content")
					return true
				}
			}
		}
	}
	return false
}

// modelSupportsVision checks if a model supports vision/image inputs
func (s *ChatService) modelSupportsVision(modelID string) bool {
	// First check if it's an alias and get the actual model info
	configService := GetConfigService()
	var actualModelName string

	for providerID, aliases := range s.modelAliases {
		for aliasKey, aliasValue := range aliases {
			if aliasKey == modelID {
				// Found as alias - check the alias config for vision support
				aliasInfo := configService.GetModelAlias(providerID, aliasKey)
				if aliasInfo != nil && aliasInfo.SupportsVision != nil {
					log.Printf("📊 [VISION CHECK] Alias '%s' has explicit vision support: %v", modelID, *aliasInfo.SupportsVision)
					return *aliasInfo.SupportsVision
				}
				// If not explicitly set in alias, use actual model name for DB lookup
				actualModelName = aliasValue
				log.Printf("📊 [VISION CHECK] Alias '%s' -> actual model '%s' (no explicit vision setting)", modelID, actualModelName)
				break
			}
		}
		if actualModelName != "" {
			break
		}
	}

	// Use actual model name if found via alias, otherwise use the provided modelID
	queryModelName := modelID
	if actualModelName != "" {
		queryModelName = actualModelName
	}

	// Check database for model's vision support
	var supportsVision int
	err := s.db.QueryRow("SELECT supports_vision FROM models WHERE id = ? OR name = ?", queryModelName, queryModelName).Scan(&supportsVision)
	if err != nil {
		// Model not found - assume it doesn't support vision (safer approach)
		log.Printf("📊 [VISION CHECK] Model '%s' not found in database - assuming no vision support", queryModelName)
		return false
	}

	result := supportsVision == 1
	log.Printf("📊 [VISION CHECK] Model '%s' supports_vision=%v", queryModelName, result)
	return result
}

// findVisionCapableModel finds a vision-capable model to use as fallback
// Returns (providerID, modelName, found)
func (s *ChatService) findVisionCapableModel() (int, string, bool) {
	// First, check aliases for vision-capable models (preferred)
	configService := GetConfigService()
	allAliases := configService.GetAllModelAliases()

	for providerID, aliases := range allAliases {
		for aliasKey, aliasInfo := range aliases {
			if aliasInfo.SupportsVision != nil && *aliasInfo.SupportsVision {
				log.Printf("🔍 [VISION FALLBACK] Found vision-capable alias: %s (provider %d)", aliasKey, providerID)
				return providerID, aliasKey, true
			}
		}
	}

	// Query database for any vision-capable model
	var providerID int
	var modelName string
	err := s.db.QueryRow(`
		SELECT m.provider_id, m.name
		FROM models m
		JOIN providers p ON m.provider_id = p.id
		WHERE m.supports_vision = 1 AND m.isVisible = 1 AND p.enabled = 1
		ORDER BY m.provider_id ASC
		LIMIT 1
	`).Scan(&providerID, &modelName)

	if err != nil {
		log.Printf("⚠️  [VISION FALLBACK] No vision-capable model found in database")
		return 0, "", false
	}

	log.Printf("🔍 [VISION FALLBACK] Found vision-capable model: %s (provider %d)", modelName, providerID)
	return providerID, modelName, true
}

// modelSupportsTools checks if a model supports tools (returns true if unknown - optimistic approach)
func (s *ChatService) modelSupportsTools(modelID string) bool {
	log.Printf("🔍 [REQUEST] Checking if model '%s' supports tools...", modelID)
	log.Printf("🔍 [DB CHECK] Querying database for model: '%s'", modelID)

	var supportsTools int
	err := s.db.QueryRow("SELECT supports_tools FROM model_capabilities WHERE model_id = ?", modelID).Scan(&supportsTools)

	if err != nil {
		// Model not in database or error, assume it supports tools (optimistic)
		log.Printf("📊 [DB CHECK] Model '%s' NOT FOUND in database - assuming tools supported (optimistic)", modelID)
		return true
	}

	result := supportsTools == 1
	log.Printf("📊 [DB CHECK] Model '%s' found in database: supports_tools=%d (returning %v)", modelID, supportsTools, result)
	return result
}

// markModelNoToolSupport marks a model as not supporting tools
func (s *ChatService) markModelNoToolSupport(modelID string) error {
	log.Printf("💾 [DB WRITE] Attempting to mark model '%s' as NOT supporting tools", modelID)

	result, err := s.db.Exec(
		"REPLACE INTO model_capabilities (model_id, supports_tools) VALUES (?, 0)",
		modelID,
	)

	if err != nil {
		log.Printf("❌ [DB WRITE] Failed to mark model as no tool support: %v", err)
		return fmt.Errorf("failed to mark model as no tool support: %v", err)
	}

	rowsAffected, _ := result.RowsAffected()
	log.Printf("✅ [DB WRITE] Successfully marked model '%s' as NOT supporting tools (rows affected: %d)", modelID, rowsAffected)
	return nil
}

// getFreeTierConfig returns the configuration for the free tier model
// This is used when anonymous users try to access restricted models
func (s *ChatService) getFreeTierConfig(connID string) (*models.Config, error) {
	// Query for a free tier model
	var freeTierModelID string
	var freeTierModelName string
	var freeTierProviderID int

	err := s.db.QueryRow(`
		SELECT id, name, provider_id
		FROM models
		WHERE free_tier = 1 AND isVisible = 1
		LIMIT 1
	`).Scan(&freeTierModelID, &freeTierModelName, &freeTierProviderID)

	if err != nil {
		log.Printf("❌ [AUTH] No free tier model configured! Anonymous users cannot use the system.")
		return nil, fmt.Errorf("no free tier model available for anonymous users")
	}

	provider, err := s.providerService.GetByID(freeTierProviderID)
	if err != nil || !provider.Enabled {
		log.Printf("❌ [AUTH] Free tier model provider is disabled or not found")
		return nil, fmt.Errorf("free tier provider unavailable")
	}

	log.Printf("🔒 [AUTH] Restricting connection %s to free tier model: %s", connID, freeTierModelName)
	return &models.Config{
		BaseURL: provider.BaseURL,
		APIKey:  provider.APIKey,
		Model:   freeTierModelName,
	}, nil
}

// GetEffectiveConfig returns the appropriate configuration based on user's selection
func (s *ChatService) GetEffectiveConfig(userConn *models.UserConnection, modelID string) (*models.Config, error) {
	// Priority 1: User provided their own API key (BYOK - Bring Your Own Key)
	if userConn.CustomConfig != nil {
		if userConn.CustomConfig.BaseURL != "" &&
			userConn.CustomConfig.APIKey != "" &&
			userConn.CustomConfig.Model != "" {
			log.Printf("🔑 [CONFIG] Using BYOK for user %s: model=%s", userConn.ConnID, userConn.CustomConfig.Model)
			return &models.Config{
				BaseURL: userConn.CustomConfig.BaseURL,
				APIKey:  userConn.CustomConfig.APIKey,
				Model:   userConn.CustomConfig.Model,
			}, nil
		}

		// Partial custom config - fall through to use platform providers if incomplete
		log.Printf("⚠️  [CONFIG] Incomplete custom config for user %s, falling back to platform providers", userConn.ConnID)
	}

	// Priority 2: User selected a model from platform (uses platform API keys)
	if modelID != "" {
		var providerID int
		var modelName string
		var foundModel bool

		// First, check if modelID is a model alias (e.g., "haiku-4.5" -> "glm-4.5-air")
		if aliasProviderID, actualModel, found := s.resolveModelAlias(modelID); found {
			// It's an alias - get the provider directly
			provider, err := s.providerService.GetByID(aliasProviderID)
			if err == nil && provider.Enabled {
				// Check if anonymous user is trying to use non-free-tier model
				if userConn.UserID == "anonymous" {
					// Check if this model is free tier
					var isFreeTier int
					err := s.db.QueryRow(
						"SELECT COALESCE(free_tier, 0) FROM models WHERE id = ?",
						modelID,
					).Scan(&isFreeTier)

					if err != nil || isFreeTier == 0 {
						// Not free tier - redirect to free tier model
						log.Printf("⚠️  [AUTH] Anonymous user %s attempted to use restricted model %s (alias: %s), forcing free tier",
							userConn.ConnID, actualModel, modelID)
						return s.getFreeTierConfig(userConn.ConnID)
					}
				}

				log.Printf("🏢 [CONFIG] Using aliased model for user %s: alias=%s, actual_model=%s, provider=%s",
					userConn.ConnID, modelID, actualModel, provider.Name)

				return &models.Config{
					BaseURL: provider.BaseURL,
					APIKey:  provider.APIKey,
					Model:   actualModel,
				}, nil
			}
		}

		// Not an alias, try to find in database by model ID
		err := s.db.QueryRow(
			"SELECT provider_id, name FROM models WHERE id = ? AND isVisible = 1",
			modelID,
		).Scan(&providerID, &modelName)

		if err == nil {
			foundModel = true
		}

		if foundModel {
			// Check if anonymous user is trying to use non-free-tier model
			if userConn.UserID == "anonymous" {
				var isFreeTier int
				err := s.db.QueryRow(
					"SELECT COALESCE(free_tier, 0) FROM models WHERE id = ? AND isVisible = 1",
					modelID,
				).Scan(&isFreeTier)

				if err != nil || isFreeTier == 0 {
					// Not free tier - redirect to free tier model
					log.Printf("⚠️  [AUTH] Anonymous user %s attempted to use restricted model %s, forcing free tier",
						userConn.ConnID, modelName)
					return s.getFreeTierConfig(userConn.ConnID)
				}
			}

			provider, err := s.providerService.GetByID(providerID)
			if err == nil && provider.Enabled {
				// Resolve model name using aliases (if configured)
				actualModelName := s.resolveModelName(providerID, modelName)

				if actualModelName != modelName {
					log.Printf("🏢 [CONFIG] Using platform model for user %s: frontend_model=%s, actual_model=%s, provider=%s",
						userConn.ConnID, modelName, actualModelName, provider.Name)
				} else {
					log.Printf("🏢 [CONFIG] Using platform model for user %s: model=%s, provider=%s",
						userConn.ConnID, modelName, provider.Name)
				}

				return &models.Config{
					BaseURL: provider.BaseURL,
					APIKey:  provider.APIKey,
					Model:   actualModelName, // Use resolved model name
				}, nil
			}
		}
	}

	// Priority 3: Fallback to first enabled provider with visible models
	log.Printf("⚙️  [CONFIG] No model selected, using fallback for user %s", userConn.ConnID)

	// Get first enabled provider
	var providerID int
	var providerName, baseURL, apiKey string
	err := s.db.QueryRow(`
		SELECT id, name, base_url, api_key
		FROM providers
		WHERE enabled = 1
		ORDER BY id ASC
		LIMIT 1
	`).Scan(&providerID, &providerName, &baseURL, &apiKey)

	if err != nil {
		return nil, fmt.Errorf("no enabled providers found: %w", err)
	}

	// Get first visible model from this provider
	var modelName string
	err = s.db.QueryRow(`
		SELECT name
		FROM models
		WHERE provider_id = ? AND isVisible = 1
		ORDER BY id ASC
		LIMIT 1
	`, providerID).Scan(&modelName)

	if err != nil {
		return nil, fmt.Errorf("no visible models found for provider %s: %w", providerName, err)
	}

	log.Printf("🔄 [CONFIG] Fallback using provider=%s, model=%s for user %s", providerName, modelName, userConn.ConnID)

	return &models.Config{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Model:   modelName,
	}, nil
}

// StreamChatCompletion streams chat completion responses
func (s *ChatService) StreamChatCompletion(userConn *models.UserConnection) error {
	config, err := s.GetEffectiveConfig(userConn, userConn.ModelID)
	if err != nil {
		return fmt.Errorf("failed to get config: %w", err)
	}

	// Get messages from cache instead of userConn.Messages
	messages := s.getConversationMessages(userConn.ConversationID)

	// 🖼️ Auto-switch to vision model if images are present but current model doesn't support vision
	if s.hasImageAttachments(messages) && !s.modelSupportsVision(userConn.ModelID) {
		log.Printf("🖼️ [VISION] Images detected but model '%s' doesn't support vision - finding fallback", userConn.ModelID)

		if fallbackProviderID, fallbackModel, found := s.findVisionCapableModel(); found {
			// Get the provider config for the fallback model
			provider, err := s.providerService.GetByID(fallbackProviderID)
			if err == nil && provider.Enabled {
				// Check if fallback is an alias
				if aliasProviderID, actualModel, isAlias := s.resolveModelAlias(fallbackModel); isAlias {
					aliasProvider, err := s.providerService.GetByID(aliasProviderID)
					if err == nil && aliasProvider.Enabled {
						config = &models.Config{
							BaseURL: aliasProvider.BaseURL,
							APIKey:  aliasProvider.APIKey,
							Model:   actualModel,
						}
						log.Printf("🖼️ [VISION] Silently switched to vision model: %s (alias for %s)", fallbackModel, actualModel)
					}
				} else {
					config = &models.Config{
						BaseURL: provider.BaseURL,
						APIKey:  provider.APIKey,
						Model:   fallbackModel,
					}
					log.Printf("🖼️ [VISION] Silently switched to vision model: %s", fallbackModel)
				}
			}
		} else {
			log.Printf("⚠️  [VISION] No vision-capable model available - proceeding with current model (may fail)")
		}
	}

	// 🔍 DIAGNOSTIC: Log messages retrieved from cache for streaming
	log.Printf("🔍 [STREAM] Retrieved %d messages from cache for conversation %s",
		len(messages), userConn.ConversationID)
	if len(messages) > 0 {
		// Count message types
		systemCount, userCount, assistantCount := 0, 0, 0
		for _, msg := range messages {
			if role, ok := msg["role"].(string); ok {
				switch role {
				case "system":
					systemCount++
				case "user":
					userCount++
				case "assistant":
					assistantCount++
				}
			}
		}
		log.Printf("🔍 [STREAM] Message breakdown BEFORE system prompt: system=%d, user=%d, assistant=%d",
			systemCount, userCount, assistantCount)
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// TOOL SELECTION - Must happen BEFORE system prompt to determine ask_user inclusion
	// ═══════════════════════════════════════════════════════════════════════════
	var tools []map[string]interface{}
	if userConn.DisableTools {
		log.Printf("🔒 [REQUEST] TOOLS DISABLED by client (agent builder mode)")
	} else if s.modelSupportsTools(config.Model) {
		// Get credential-filtered tools for user (only tools they have credentials for)
		credentialFilteredTools := []map[string]interface{}{}
		if s.toolService != nil {
			credentialFilteredTools = s.toolService.GetAvailableTools(context.Background(), userConn.UserID)
		} else {
			// Fallback: Get ALL user tools (built-in + MCP tools) without filtering
			credentialFilteredTools = s.toolRegistry.GetUserTools(userConn.UserID)
		}

		log.Printf("📦 [REQUEST] Credential-filtered tools: %d", len(credentialFilteredTools))

		// Use tool predictor to select subset of tools if available
		if s.toolPredictorService != nil && len(credentialFilteredTools) > 0 {
			// Extract user message from messages array (last user message)
			userMessage := extractLastUserMessage(messages)

			log.Printf("🤖 [TOOL-PREDICTOR] Starting tool prediction with conversation history (%d messages)...", len(messages))
			predictedTools, err := s.toolPredictorService.PredictTools(
				context.Background(),
				userConn.UserID,
				userMessage,
				credentialFilteredTools,
				messages, // Pass full conversation history for context-aware tool selection
			)

			if err != nil {
				log.Printf("⚠️ [TOOL-PREDICTOR] Prediction failed: %v, falling back to all tools", err)
				tools = credentialFilteredTools // Graceful fallback
			} else {
				log.Printf("✅ [TOOL-PREDICTOR] Using predicted tools: %d selected", len(predictedTools))
				tools = predictedTools
			}
		} else {
			if s.toolPredictorService == nil {
				log.Printf("📦 [REQUEST] Tool predictor not initialized, using all filtered tools")
			}
			tools = credentialFilteredTools
		}

		// Log MCP connection status
		if s.mcpBridge != nil && s.mcpBridge.IsUserConnected(userConn.UserID) {
			builtinCount := s.toolRegistry.Count()
			mcpCount := s.toolRegistry.CountUserTools(userConn.UserID) - builtinCount
			log.Printf("📦 [REQUEST] INCLUDING TOOLS for model: %s (built-in: %d, MCP: %d, selected: %d)",
				config.Model, builtinCount, mcpCount, len(tools))
		} else {
			log.Printf("📦 [REQUEST] INCLUDING TOOLS for model: %s (selected tools: %d)", config.Model, len(tools))
		}
	} else {
		log.Printf("🚫 [REQUEST] EXCLUDING TOOLS for model: %s (marked as incompatible)", config.Model)
	}

	// Get system prompt - include ask_user instructions only if tools are available
	// This prevents models like Gemini from failing with MALFORMED_FUNCTION_CALL
	includeAskUser := len(tools) > 0
	systemPrompt := s.GetSystemPrompt(userConn, includeAskUser)

	// Inject available images context if there are images in this conversation
	imageRegistry := GetImageRegistryService()
	if imageRegistry.HasImages(userConn.ConversationID) {
		imageContext := imageRegistry.BuildSystemContext(userConn.ConversationID)
		if imageContext != "" {
			systemPrompt = systemPrompt + "\n\n" + imageContext
			log.Printf("📸 [SYSTEM] Injected image context for conversation %s", userConn.ConversationID)
		}
	}

	messages = s.buildMessagesWithSystemPrompt(systemPrompt, messages)

	// Note: Context optimization now happens AFTER streaming ends (in processStream)
	// This prevents blocking the response while the user waits

	// Prepare chat request
	chatReq := models.ChatRequest{
		Model:       config.Model,
		Messages:    messages,
		Stream:      true,
		Temperature: 0.7,
	}

	// Only include tools if non-empty (some APIs reject empty tools array)
	if len(tools) > 0 {
		chatReq.Tools = tools
	}

	reqBody, err := json.Marshal(chatReq)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	// 🔍 DIAGNOSTIC: Log exactly what's being sent to LLM
	log.Printf("🔍 [LLM-REQUEST] Sending to LLM - Model: %s, Messages: %d, Tools: %d",
		chatReq.Model, len(chatReq.Messages), len(chatReq.Tools))
	log.Printf("🔍 [LLM-REQUEST] Request body size: %d bytes", len(reqBody))

	// 📋 Print the FULL JSON payload being sent to LLM
	prettyJSON, _ := json.MarshalIndent(chatReq, "", "  ")
	log.Printf("📋 [LLM-REQUEST] FULL JSON PAYLOAD:\n%s", string(prettyJSON))

	// Log all messages with FULL content for the user message
	if len(chatReq.Messages) > 0 {
		log.Printf("🔍 [LLM-REQUEST] === ALL MESSAGES BEING SENT TO LLM ===")
		for i, msg := range chatReq.Messages {
			role, _ := msg["role"].(string)
			contentStr := ""

			// Handle different content types
			if content, ok := msg["content"].(string); ok {
				contentStr = content
			} else if contentArr, ok := msg["content"].([]interface{}); ok {
				// Multi-part content (vision models)
				for j, part := range contentArr {
					if partMap, ok := part.(map[string]interface{}); ok {
						partType, _ := partMap["type"].(string)
						if partType == "text" {
							if text, ok := partMap["text"].(string); ok {
								contentStr += fmt.Sprintf("[Part %d - text]: %s\n", j, text)
							}
						} else if partType == "image_url" {
							contentStr += fmt.Sprintf("[Part %d - image_url]: <image data>\n", j)
						}
					}
				}
			}

			toolCallID, _ := msg["tool_call_id"].(string)
			toolName, _ := msg["name"].(string)

			log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
			if role == "tool" {
				log.Printf("📨 [MSG %d] role=%s, tool_call_id=%s, name=%s", i, role, toolCallID, toolName)
				// Truncate tool responses for readability
				if len(contentStr) > 500 {
					log.Printf("   content (truncated): %s...", contentStr[:500])
				} else {
					log.Printf("   content: %s", contentStr)
				}
			} else if role == "user" {
				// Show FULL user message content (includes injected CSV context)
				log.Printf("👤 [MSG %d] role=%s", i, role)
				log.Printf("   FULL CONTENT:\n%s", contentStr)
			} else if role == "system" {
				log.Printf("⚙️  [MSG %d] role=%s", i, role)
				if len(contentStr) > 200 {
					log.Printf("   content (truncated): %s...", contentStr[:200])
				} else {
					log.Printf("   content: %s", contentStr)
				}
			} else if role == "assistant" {
				log.Printf("🤖 [MSG %d] role=%s", i, role)
				if len(contentStr) > 300 {
					log.Printf("   content (truncated): %s...", contentStr[:300])
				} else {
					log.Printf("   content: %s", contentStr)
				}
				// Log tool calls if present
				if toolCalls, ok := msg["tool_calls"].([]interface{}); ok && len(toolCalls) > 0 {
					log.Printf("   tool_calls: %d calls", len(toolCalls))
					for _, tc := range toolCalls {
						if tcMap, ok := tc.(map[string]interface{}); ok {
							if fn, ok := tcMap["function"].(map[string]interface{}); ok {
								fnName, _ := fn["name"].(string)
								fnArgs, _ := fn["arguments"].(string)
								log.Printf("     - %s(%s)", fnName, fnArgs)
							}
						}
					}
				}
			} else {
				log.Printf("❓ [MSG %d] role=%s, content=%s", i, role, contentStr)
			}
		}
		log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Printf("🔍 [LLM-REQUEST] === END OF MESSAGES ===")
	}

	// Create HTTP request
	req, err := http.NewRequest("POST", config.BaseURL+"/chat/completions", bytes.NewBuffer(reqBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	// Send request
	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		errorMsg := string(body)

		log.Printf("⚠️  [API ERROR] API Error for %s: %s", userConn.ConnID, errorMsg)

		// Check if error is due to tool incompatibility
		if len(tools) > 0 && s.detectToolIncompatibility(errorMsg) {
			log.Printf("🔍 [ERROR DETECTION] Tool incompatibility detected for model: %s", config.Model)

			// Mark model as not supporting tools
			if err := s.markModelNoToolSupport(config.Model); err != nil {
				log.Printf("⚠️  [ERROR DETECTION] Failed to mark model: %v", err)
			}

			// Add assistant error message to maintain alternation
			messages := s.getConversationMessages(userConn.ConversationID)
			errorMsgText := "I encountered an error. This model doesn't support tool calling. Tools have been disabled for future requests."
			messages = append(messages, map[string]interface{}{
				"role":    "assistant",
				"content": errorMsgText,
			})
			s.setConversationMessages(userConn.ConversationID, messages)
			log.Printf("✅ [ERROR DETECTION] Added assistant error message to cache to maintain alternation")

			// Inform user about the error
			userConn.WriteChan <- models.ServerMessage{
				Type:         "error",
				ErrorCode:    "model_tool_incompatible",
				ErrorMessage: fmt.Sprintf("Model '%s' doesn't support tool calling. Tools will be automatically disabled for this model on the next message.", config.Model),
			}

			// Retry WITHOUT tools
			log.Printf("🔄 [ERROR DETECTION] Retrying request WITHOUT tools for model: %s", config.Model)
			return s.StreamChatCompletion(userConn)
		}

		return fmt.Errorf("API error (status %d): %s", resp.StatusCode, errorMsg)
	}

	// Process SSE stream
	return s.processStream(resp.Body, userConn)
}

// detectToolIncompatibility checks if an error message indicates tool incompatibility
func (s *ChatService) detectToolIncompatibility(errorMsg string) bool {
	errorLower := strings.ToLower(errorMsg)

	// Common error patterns for tool incompatibility
	patterns := []string{
		"roles must alternate",
		"tool",
		"not supported",
		"function calling",
		"unsupported",
	}

	// Check if error contains patterns related to tools
	hasToolKeyword := false
	hasErrorKeyword := false

	for _, pattern := range patterns {
		if strings.Contains(errorLower, pattern) {
			if pattern == "tool" || pattern == "function calling" {
				hasToolKeyword = true
			} else {
				hasErrorKeyword = true
			}
		}
	}

	// Must have both a tool-related keyword AND an error keyword
	result := hasToolKeyword && hasErrorKeyword

	if result {
		log.Printf("🔍 [ERROR DETECTION] Tool incompatibility pattern detected in error: %s", errorMsg)
	}

	return result || strings.Contains(errorLower, "roles must alternate")
}

// ToolCallAccumulator accumulates streaming tool call data
type ToolCallAccumulator struct {
	ID        string
	Type      string
	Name      string
	Arguments strings.Builder
}

// safeSendChunk sends a chunk to the client with graceful error handling
// This prevents panics if the channel is closed (client disconnected)
func (s *ChatService) safeSendChunk(userConn *models.UserConnection, content string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("⚠️ [STREAM] Recovered from WriteChan panic for %s: %v (chunk buffered)", userConn.ConnID, r)
			// Chunk is already buffered in streamBuffer, so no data loss
		}
	}()

	select {
	case userConn.WriteChan <- models.ServerMessage{
		Type:    "stream_chunk",
		Content: content,
	}:
		// Successfully sent
	case <-time.After(100 * time.Millisecond):
		// Channel backpressure detected - client rendering slower than generation
		bufferLen := len(userConn.WriteChan)
		log.Printf("⚠️ [STREAM] WriteChan backpressure for %s (buffer: %d/100), chunk buffered for resume",
			userConn.ConnID, bufferLen)

		// Chunk is already buffered in streamBuffer via AppendChunk before this call
		// If backpressure persists, client may need to reconnect and resume
	}
}

// processStream processes the SSE stream from the AI provider
func (s *ChatService) processStream(reader io.Reader, userConn *models.UserConnection) error {
	scanner := bufio.NewScanner(reader)

	// Increase buffer to 1MB for large SSE chunks (default is 64KB)
	// Prevents "bufio.Scanner: token too long" errors with large tool call arguments
	const maxCapacity = 1024 * 1024 // 1MB
	buf := make([]byte, maxCapacity)
	scanner.Buffer(buf, maxCapacity)

	var fullContent strings.Builder

	// Create stream buffer for this conversation (for resume capability)
	s.streamBuffer.CreateBuffer(userConn.ConversationID, userConn.UserID, userConn.ConnID)
	log.Printf("📦 [STREAM] Buffer created for conversation %s", userConn.ConversationID)

	// Track tool calls by index to accumulate streaming arguments
	toolCallsMap := make(map[int]*ToolCallAccumulator)
	var finishReason string

	for scanner.Scan() {
		select {
		case <-userConn.StopChan:
			log.Printf("⏹️  Generation stopped for %s", userConn.ConnID)
			// Clear buffer on stop - user explicitly cancelled
			s.streamBuffer.ClearBuffer(userConn.ConversationID)
			return nil
		default:
		}

		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk map[string]interface{}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		choices, ok := chunk["choices"].([]interface{})
		if !ok || len(choices) == 0 {
			continue
		}

		choice := choices[0].(map[string]interface{})
		delta, ok := choice["delta"].(map[string]interface{})
		if !ok {
			continue
		}

		// Check for finish reason
		if reason, ok := choice["finish_reason"].(string); ok && reason != "" {
			finishReason = reason
		}

		// Handle reasoning/thinking content (o1/o3 models)
		if reasoningContent, ok := delta["reasoning_content"].(string); ok {
			userConn.WriteChan <- models.ServerMessage{
				Type:    "reasoning_chunk",
				Content: reasoningContent,
			}
		}

		// Handle content chunks
		if content, ok := delta["content"].(string); ok {
			fullContent.WriteString(content)

			// Buffer chunk for potential resume (always buffer, even if send succeeds)
			s.streamBuffer.AppendChunk(userConn.ConversationID, content)

			// Send to client with graceful handling for closed channel
			s.safeSendChunk(userConn, content)
		}

		// Handle tool calls - ACCUMULATE, don't execute yet!
		if toolCallsData, ok := delta["tool_calls"].([]interface{}); ok {
			for _, tc := range toolCallsData {
				toolCallChunk := tc.(map[string]interface{})

				// Get tool call index
				var index int
				if idx, ok := toolCallChunk["index"].(float64); ok {
					index = int(idx)
				}

				// Initialize accumulator if needed
				if _, exists := toolCallsMap[index]; !exists {
					toolCallsMap[index] = &ToolCallAccumulator{}
				}

				acc := toolCallsMap[index]

				// Accumulate fields
				if id, ok := toolCallChunk["id"].(string); ok {
					acc.ID = truncateToolCallID(id) // Truncate to 40 chars (OpenAI constraint)
				}
				if typ, ok := toolCallChunk["type"].(string); ok {
					acc.Type = typ
				}
				if function, ok := toolCallChunk["function"].(map[string]interface{}); ok {
					if name, ok := function["name"].(string); ok {
						acc.Name = name
						log.Printf("🔧 [TOOL] Starting to accumulate tool call: %s (index %d)", name, index)
					}
					// ✅ ACCUMULATE arguments, don't parse yet!
					if args, ok := function["arguments"].(string); ok {
						acc.Arguments.WriteString(args)
					}
				}
			}
		}
	}

	// Execute tools ONLY after streaming completes with tool_calls finish reason
	if finishReason == "tool_calls" {
		log.Printf("🔧 [TOOL] Streaming complete, executing %d tool call(s)", len(toolCallsMap))

		// Get messages from cache
		messages := s.getConversationMessages(userConn.ConversationID)

		// Build tool call messages for conversation history
		var toolCallMessages []map[string]interface{}
		var toolResults []map[string]interface{}

		// Execute all tools and collect results
		for index, acc := range toolCallsMap {
			if acc.Name != "" && acc.Arguments.Len() > 0 {
				argsStr := acc.Arguments.String()
				log.Printf("🔧 [TOOL] Executing tool %s (index %d, args length: %d bytes)", acc.Name, index, len(argsStr))

				// Add to tool call messages
				toolCallMessages = append(toolCallMessages, map[string]interface{}{
					"id":   acc.ID,
					"type": acc.Type,
					"function": map[string]interface{}{
						"name":      acc.Name,
						"arguments": argsStr,
					},
				})

				// Execute tool and get result
				result := s.executeToolSyncWithResult(acc.ID, acc.Name, argsStr, userConn)
				toolResults = append(toolResults, map[string]interface{}{
					"role":         "tool",
					"tool_call_id": acc.ID,
					"name":         acc.Name,
					"content":      result,
				})
			}
		}

		// Only add assistant message if we have actual tool calls
		if len(toolCallMessages) > 0 {
			assistantMsg := map[string]interface{}{
				"role":       "assistant",
				"tool_calls": toolCallMessages,
			}
			// Only include content if it's not empty
			if fullContent.Len() > 0 {
				assistantMsg["content"] = fullContent.String()
			}
			messages = append(messages, assistantMsg)

			// Add all tool results
			for _, toolResult := range toolResults {
				messages = append(messages, toolResult)
			}

			// Save updated messages to cache
			s.setConversationMessages(userConn.ConversationID, messages)

			// Clear buffer for tool calls - a new stream will start
			s.streamBuffer.ClearBuffer(userConn.ConversationID)

			// After ALL tools complete, continue conversation ONCE
			log.Printf("🔄 [TOOL] All tools executed, continuing conversation with %d tool result(s)", len(toolCallMessages))
			go s.StreamChatCompletion(userConn)
		} else {
			// No valid tool calls - treat as error
			log.Printf("⚠️  [STREAM] Tool calls detected but none were valid")
			userConn.WriteChan <- models.ServerMessage{
				Type:         "error",
				ErrorCode:    "invalid_tool_calls",
				ErrorMessage: "The model attempted to call tools but the calls were invalid. Please try again.",
			}
		}
	} else {
		// Regular message without tool calls
		content := fullContent.String()

		// Only add assistant message if there's actual content
		if content != "" {
			// Get messages from cache and add assistant response
			messages := s.getConversationMessages(userConn.ConversationID)
			messages = append(messages, map[string]interface{}{
				"role":    "assistant",
				"content": content,
			})
			s.setConversationMessages(userConn.ConversationID, messages)

			// Mark stream buffer as complete before sending stream_end
			s.streamBuffer.MarkComplete(userConn.ConversationID, content)
			log.Printf("📦 [STREAM] Buffer marked complete for conversation %s", userConn.ConversationID)

			// Increment message counter
			userConn.Mutex.Lock()
			userConn.MessageCount++
			currentCount := userConn.MessageCount
			userConn.Mutex.Unlock()

			// Send completion message
			userConn.WriteChan <- models.ServerMessage{
				Type:           "stream_end",
				ConversationID: userConn.ConversationID,
			}

			// Generate title after first user-assistant exchange (2 messages: user + assistant)
			log.Printf("🔍 [TITLE] MessageCount=%d for conversation %s", currentCount, userConn.ConversationID)
			if currentCount == 1 {
				log.Printf("🎯 [TITLE] Triggering title generation for %s", userConn.ConversationID)
				go s.generateConversationTitle(userConn, content)
			} else {
				log.Printf("⏭️  [TITLE] Skipping title generation (MessageCount=%d, need 1)", currentCount)
			}

			// 🗜️ Context optimization - runs AFTER streaming ends (non-blocking)
			// This compacts conversation history for the NEXT message
			go s.optimizeContextAfterStream(userConn)

			// 🧠 Memory extraction - check if threshold reached (non-blocking)
			if s.memoryExtractionService != nil {
				go s.checkAndTriggerMemoryExtraction(userConn)
			}
		} else {
			// Empty response - log warning and send error to client
			log.Printf("⚠️  [STREAM] Received empty response from API for %s", userConn.ConnID)
			userConn.WriteChan <- models.ServerMessage{
				Type:         "error",
				ErrorCode:    "empty_response",
				ErrorMessage: "The model returned an empty response. Please try again.",
			}
		}
	}

	// Check for scanner errors (e.g., buffer overflow, I/O errors)
	if err := scanner.Err(); err != nil {
		log.Printf("❌ [STREAM] Scanner error for %s: %v", userConn.ConnID, err)
		userConn.WriteChan <- models.ServerMessage{
			Type:         "error",
			ErrorCode:    "stream_error",
			ErrorMessage: "An error occurred while processing the stream. Please try again.",
		}
		return fmt.Errorf("stream scanner error: %w", err)
	}

	return nil
}

// executeToolSyncWithResult executes a tool call synchronously and returns the result
func (s *ChatService) executeToolSyncWithResult(toolCallID, toolName, argsJSON string, userConn *models.UserConnection) string {
	// Get tool metadata from registry
	toolDisplayName := toolName
	toolIcon := ""
	toolDescription := ""
	if tool, exists := s.toolRegistry.Get(toolName); exists {
		toolDisplayName = tool.DisplayName
		toolIcon = tool.Icon
		toolDescription = tool.Description
	}

	// Parse complete JSON arguments
	var args map[string]interface{}
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		log.Printf("❌ Failed to parse tool arguments for %s: %v (length: %d bytes)", toolName, err, len(argsJSON))

		// Send error to client
		errorMsg := fmt.Sprintf("Failed to parse arguments: %v", err)
		userConn.WriteChan <- models.ServerMessage{
			Type:            "tool_result",
			ToolName:        toolName,
			ToolDisplayName: toolDisplayName,
			ToolIcon:        toolIcon,
			ToolDescription: toolDescription,
			Status:          "failed",
			Result:          errorMsg,
		}

		return fmt.Sprintf("Error: %v", err)
	}

	log.Printf("✅ [TOOL] Successfully parsed arguments for %s: %+v", toolName, args)

	// Inject user context into args (internal use only, not exposed to AI)
	// This allows tools to access authenticated user info without breaking the tool interface
	args["__user_id__"] = userConn.UserID
	args["__conversation_id__"] = userConn.ConversationID

	// Auto-inject credentials for tools that require them
	if s.toolService != nil {
		// Inject credential resolver for secure credential access
		resolver := s.toolService.CreateCredentialResolver(userConn.UserID)
		if resolver != nil {
			args[tools.CredentialResolverKey] = resolver
		}

		// Auto-inject credential_id for tools that need it
		credentialID := s.toolService.GetCredentialForTool(context.Background(), userConn.UserID, toolName)
		if credentialID != "" {
			args["credential_id"] = credentialID
			log.Printf("🔐 [CHAT] Auto-injected credential_id=%s for tool=%s", credentialID, toolName)
		}
	}

	// Inject user connection and waiter for ask_user tool (interactive prompts)
	if toolName == "ask_user" {
		args[tools.UserConnectionKey] = userConn
		args[tools.PromptWaiterKey] = userConn.PromptWaiter
		log.Printf("🔌 [CHAT] Injected user connection and prompt waiter for ask_user tool")
	}

	// Inject image provider config and registry for generate_image tool
	if toolName == "generate_image" {
		imageProviderService := GetImageProviderService()
		provider := imageProviderService.GetProvider()
		if provider != nil {
			args[tools.ImageProviderConfigKey] = &tools.ImageProviderConfig{
				Name:         provider.Name,
				BaseURL:      provider.BaseURL,
				APIKey:       provider.APIKey,
				DefaultModel: provider.DefaultModel,
			}
			log.Printf("🎨 [CHAT] Injected image provider config for generate_image tool (provider: %s)", provider.Name)
		}
		// Inject image registry for registering generated images
		imageRegistry := GetImageRegistryService()
		args[tools.ImageRegistryKey] = &ImageRegistryAdapter{registry: imageRegistry}

		// Inject usage limiter for tier-based image generation limits
		if s.usageLimiter != nil {
			args[tools.UsageLimiterKey] = s.usageLimiter
		}
	}

	// Inject image edit config and registry for edit_image tool
	if toolName == "edit_image" {
		// Inject image registry adapter for handle lookup (adapter implements tools.ImageRegistryInterface)
		imageRegistry := GetImageRegistryService()
		args[tools.ImageRegistryKey] = &ImageRegistryAdapter{registry: imageRegistry}

		// Inject image edit provider config from dedicated edit provider
		imageEditProviderService := GetImageEditProviderService()
		editProvider := imageEditProviderService.GetProvider()
		if editProvider != nil {
			args[tools.ImageEditConfigKey] = &tools.ImageEditConfig{
				BaseURL: editProvider.BaseURL,
				APIKey:  editProvider.APIKey,
			}
			log.Printf("🖌️ [CHAT] Injected image edit config for edit_image tool (provider: %s)", editProvider.Name)
		} else {
			log.Printf("⚠️ [CHAT] No image edit provider configured - edit_image tool will fail")
		}
	}

	// Inject image registry for describe_image tool (allows using image_id handles)
	if toolName == "describe_image" {
		imageRegistry := GetImageRegistryService()
		args[tools.ImageRegistryKey] = &ImageRegistryAdapter{registry: imageRegistry}
		log.Printf("🖼️ [CHAT] Injected image registry for describe_image tool")
	}

	// Notify client that tool is executing (send original args without internal params)
	displayArgs := make(map[string]interface{})
	for k, v := range args {
		// Filter out internal/sensitive params
		if k != "__user_id__" && k != "__conversation_id__" && k != tools.CredentialResolverKey && k != "credential_id" && k != tools.ImageProviderConfigKey && k != tools.ImageEditConfigKey && k != tools.ImageRegistryKey && k != tools.UsageLimiterKey && k != tools.UserConnectionKey && k != tools.PromptWaiterKey {
			displayArgs[k] = v
		}
	}

	// Use SafeSend to prevent panic if connection was closed
	if !userConn.SafeSend(models.ServerMessage{
		Type:            "tool_call",
		ToolName:        toolName,
		ToolDisplayName: toolDisplayName,
		ToolIcon:        toolIcon,
		ToolDescription: toolDescription,
		Status:          "executing",
		Arguments:       displayArgs,
	}) {
		log.Printf("⚠️ [TOOL] Connection closed before tool execution for %s", toolName)
		return ""
	}

	// Execute tool (with injected user context)
	// Check if this is a built-in tool or MCP tool
	tool, exists := s.toolRegistry.GetUserTool(userConn.UserID, toolName)
	var result string
	var err error

	if exists && tool.Source == tools.ToolSourceMCPLocal {
		// MCP tool - route to local client
		log.Printf("🔌 [MCP] Routing tool %s to local MCP client for user %s", toolName, userConn.UserID)

		if s.mcpBridge == nil || !s.mcpBridge.IsUserConnected(userConn.UserID) {
			errorMsg := "MCP client not connected. Please start your local MCP client."
			log.Printf("❌ [MCP] No client connected for user %s", userConn.UserID)
			userConn.SafeSend(models.ServerMessage{
				Type:            "tool_result",
				ToolName:        toolName,
				ToolDisplayName: toolDisplayName,
				ToolIcon:        toolIcon,
				ToolDescription: toolDescription,
				Status:          "failed",
				Result:          errorMsg,
			})
			return errorMsg
		}

		// Execute on MCP client with 30 second timeout
		startTime := time.Now()
		result, err = s.mcpBridge.ExecuteToolOnClient(userConn.UserID, toolName, args, 30*time.Second)
		executionTime := int(time.Since(startTime).Milliseconds())

		// Log execution for audit
		s.mcpBridge.LogToolExecution(userConn.UserID, toolName, userConn.ConversationID, executionTime, err == nil, "")

		if err != nil {
			log.Printf("❌ [MCP] Tool execution failed for %s: %v", toolName, err)
			errorMsg := fmt.Sprintf("Error: %v", err)
			userConn.SafeSend(models.ServerMessage{
				Type:            "tool_result",
				ToolName:        toolName,
				ToolDisplayName: toolDisplayName,
				ToolIcon:        toolIcon,
				ToolDescription: toolDescription,
				Status:          "failed",
				Result:          errorMsg,
			})
			return errorMsg
		}
	} else {
		// Built-in tool - execute locally
		result, err = s.toolRegistry.Execute(toolName, args)
		if err != nil {
			log.Printf("❌ Tool execution failed for %s: %v", toolName, err)
			errorMsg := fmt.Sprintf("Error: %v", err)
			userConn.SafeSend(models.ServerMessage{
				Type:            "tool_result",
				ToolName:        toolName,
				ToolDisplayName: toolDisplayName,
				ToolIcon:        toolIcon,
				ToolDescription: toolDescription,
				Status:          "failed",
				Result:          errorMsg,
			})

			return errorMsg
		}
	}

	log.Printf("✅ [TOOL] Tool %s executed successfully, result length: %d", toolName, len(result))

	// Try to parse result as JSON to extract plots and files (for E2B tools)
	// We strip base64 data from the LLM result to avoid sending huge payloads
	var resultData map[string]interface{}
	var plots []models.PlotData
	llmResult := result // Default: send full result to LLM
	needsLLMSummary := false

	if err := json.Unmarshal([]byte(result), &resultData); err == nil {
		// Check for plots - extract for frontend, strip from LLM
		if plotsRaw, hasPlots := resultData["plots"]; hasPlots {
			if plotsArray, ok := plotsRaw.([]interface{}); ok && len(plotsArray) > 0 {
				// Extract plots for frontend
				for _, p := range plotsArray {
					if plotMap, ok := p.(map[string]interface{}); ok {
						format, _ := plotMap["format"].(string)
						data, _ := plotMap["data"].(string)
						if format != "" && data != "" {
							plots = append(plots, models.PlotData{
								Format: format,
								Data:   data,
							})
						}
					}
				}
				needsLLMSummary = true
				log.Printf("📊 [TOOL] Extracted %d plot(s) from %s result", len(plots), toolName)
			}
		}

		// Check for files - strip base64 data from LLM result
		if filesRaw, hasFiles := resultData["files"]; hasFiles {
			if filesArray, ok := filesRaw.([]interface{}); ok && len(filesArray) > 0 {
				needsLLMSummary = true
				log.Printf("📁 [TOOL] Detected %d file(s) in %s result, stripping base64 from LLM", len(filesArray), toolName)
			}
		}

		// Create LLM-friendly summary (without base64 image/file data)
		if needsLLMSummary {
			llmSummary := map[string]interface{}{
				"success": resultData["success"],
				"stdout":  resultData["stdout"],
				"stderr":  resultData["stderr"],
			}

			// Add plot count if plots exist
			if len(plots) > 0 {
				llmSummary["plot_count"] = len(plots)
				llmSummary["plots_generated"] = fmt.Sprintf("%d visualization(s) generated and shown to user", len(plots))
			}

			// Add file info without base64 data
			if filesRaw, hasFiles := resultData["files"]; hasFiles {
				if filesArray, ok := filesRaw.([]interface{}); ok && len(filesArray) > 0 {
					var fileNames []string
					for _, f := range filesArray {
						if fileMap, ok := f.(map[string]interface{}); ok {
							if filename, ok := fileMap["filename"].(string); ok {
								fileNames = append(fileNames, filename)
							}
						}
					}
					llmSummary["file_count"] = len(filesArray)
					llmSummary["files_generated"] = fileNames
					llmSummary["files_message"] = fmt.Sprintf("%d file(s) generated and available for user download", len(filesArray))
				}
			}

			// Preserve other useful fields
			if analysis, ok := resultData["analysis"]; ok {
				llmSummary["analysis"] = analysis
			}
			if filename, ok := resultData["filename"]; ok {
				llmSummary["filename"] = filename
			}
			if execTime, ok := resultData["execution_time"]; ok {
				llmSummary["execution_time"] = execTime
			}
			if installOutput, ok := resultData["install_output"]; ok {
				llmSummary["install_output"] = installOutput
			}

			llmResultBytes, _ := json.Marshal(llmSummary)
			llmResult = string(llmResultBytes)
		}
	}

	// Send result to client (with plots for frontend visualization)
	// Use SafeSend to prevent panic if connection was closed during long tool execution
	toolResultMsg := models.ServerMessage{
		Type:            "tool_result",
		ToolName:        toolName,
		ToolDisplayName: toolDisplayName,
		ToolIcon:        toolIcon,
		ToolDescription: toolDescription,
		Status:          "completed",
		Result:          result, // Full result for frontend
		Plots:           plots,  // Extracted plots for rendering
	}

	// Try to send the tool result
	if !userConn.SafeSend(toolResultMsg) {
		log.Printf("⚠️ [TOOL] Connection closed, could not send tool result for %s", toolName)

		// Buffer tool results with artifacts (images, etc.) for reconnection recovery
		// Only buffer if send failed - this ensures users don't lose generated images
		if len(plots) > 0 && userConn.ConversationID != "" {
			s.streamBuffer.AppendMessage(userConn.ConversationID, BufferedMessage{
				Type:            "tool_result",
				ToolName:        toolName,
				ToolDisplayName: toolDisplayName,
				ToolIcon:        toolIcon,
				ToolDescription: toolDescription,
				Status:          "completed",
				Result:          result,
				Plots:           plots,
			})
			log.Printf("📦 [TOOL] Buffered tool result for %s for reconnection recovery", toolName)
		}
		return llmResult
	}

	log.Printf("✅ [TOOL] Tool result for %s ready (plots: %d)", toolName, len(plots))
	// Return LLM-friendly result (without heavy image data)
	return llmResult
}

// getMarkdownFormattingGuidelines returns formatting rules appended to all system prompts
// getAskUserInstructions returns intelligent guidance for ask_user tool usage
// Balanced approach: use when it adds value, skip when it interrupts natural flow
func getAskUserInstructions() string {
	return `

## 🎯 Interactive Tool - ask_user

You have an **ask_user** tool that creates interactive modal dialogs. Use it intelligently for gathering structured input.

**When to USE ask_user (high value scenarios):**

1. **Planning complex tasks** - Gathering requirements before implementation
   - Example: "Create a website" → ask: style, colors, features, pages
   - Example: "Build a game" → ask: language, library, controls, difficulty

2. **User explicitly requests questions**
   - User: "Ask me questions to understand what I need"
   - User: "Help me figure out what I want"
   - User: "Guide me through this"

3. **Important decisions with multiple valid options**
   - Technical choices: "Which framework? React/Vue/Angular"
   - Approach selection: "Approach A (fast) or B (thorough)?"
   - Confirmation for destructive actions: "Delete all files?"

4. **Missing critical information for task execution**
   - Need specific values: project name, API key, configuration
   - Need preferences that significantly impact output: code style, documentation level

**When NOT to use ask_user (let conversation flow naturally):**

1. **Casual conversation** - Just chat normally
2. **Emotional support** - Be empathetic in text, don't interrupt with modals
3. **Simple clarifications** - Ask in text: "Did you mean X or Y?"
4. **Follow-up questions in dialogue** - Natural back-and-forth
5. **Rhetorical questions** - Part of your explanation style

**Smart Usage Examples:**

✅ GOOD:
- User: "Create a landing page" → ask_user: Design style? Color scheme? Sections?
- User: "I need help planning my app" → ask_user: Features? Users? Platform?
- User: "Build me a calculator" → ask_user: Basic or scientific? UI style?

❌ NOT NEEDED:
- User: "I'm feeling lost" → Just respond with empathy, don't open modal
- User: "Tell me about React" → Just explain, don't ask questions
- Natural conversation → Keep it flowing, don't interrupt

**Guideline:** Use ask_user when it **helps you gather structured input for better results**. Skip it when it would **interrupt natural conversation flow**.
`
}

func getMarkdownFormattingGuidelines() string {
	return `

## Response Style (CRITICAL)
- **Answer first**: Lead with the direct answer or solution. Context and explanation come after.
- **No filler phrases**: Never start with "Great question!", "Certainly!", "Of course!", "I'd be happy to", "Absolutely!", or similar. Just answer.
- **Be concise**: Give complete answers without unnecessary padding. Every sentence should add value.
- **No excessive caveats**: Don't lead with disclaimers or hedging. If caveats are needed, put them at the end.
- **Use structure for complex answers**: Use headers and lists for multi-part responses, but avoid over-formatting simple answers.
- **Match response length to question complexity**: Simple questions get short answers. Complex questions get thorough answers.

## Markdown Formatting
- **Tables**: Use standard syntax with ` + "`|`" + ` separators and ` + "`---`" + ` header dividers
- **Lists**: Use ` + "`-`" + ` for unordered lists, ` + "`1.`" + ` for ordered lists (not ` + "`1)`" + `)
- **Headers**: Always include a space after ` + "`#`" + ` symbols (` + "`## Title`" + ` not ` + "`##Title`" + `)
- **Code blocks**: Always specify language after ` + "` + \"```\" + `" + ` (e.g., ` + "` + \"```python\" + `" + `, ` + "` + \"```json\" + `" + `)
- **Links**: Use ` + "`[text](url)`" + ` with no space between ` + "`]`" + ` and ` + "`(`" + `
- **Avoid**: Citation-style ` + "`[1]`" + ` references, decorative unicode lines, non-standard bullets, emojis (unless user requests them)`
}

// buildTemporalContext builds context string with current date/time and user name
// This provides the model with temporal awareness and personalization
func (s *ChatService) buildTemporalContext(userID string) string {
	now := time.Now()

	// Format date and time
	currentDate := now.Format("Monday, January 2, 2006")
	currentTime := now.Format("3:04 PM MST")

	// Try to get user's name from database (if MongoDB is available)
	userName := "User" // Default fallback

	// Check if we have MongoDB access to get user name
	// Note: ChatService doesn't have direct MongoDB access, but we can try via the database
	// For now, use a simple approach - just use UserID as identifier
	// TODO: Could enhance this with UserService integration if needed
	if userID != "" {
		userName = userID // Use user ID as fallback
	}

	// Build temporal context
	context := fmt.Sprintf(`# Current Context
- **User**: %s
- **Date**: %s
- **Time**: %s

`, userName, currentDate, currentTime)

	return context
}

// buildMemoryContext selects and formats relevant memories for injection
func (s *ChatService) buildMemoryContext(userConn *models.UserConnection) string {
	// Check if memory selection service is available
	if s.memorySelectionService == nil {
		return ""
	}

	// Get recent messages from cache for context
	messages := s.getConversationMessages(userConn.ConversationID)
	if len(messages) == 0 {
		return "" // No conversation history yet
	}

	// Limit to last 10 messages for context
	recentMessages := messages
	if len(messages) > 10 {
		recentMessages = messages[len(messages)-10:]
	}

	// TODO: Get max memories from user preferences (default: 5)
	maxMemories := 5

	// Select relevant memories
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	selectedMemories, err := s.memorySelectionService.SelectRelevantMemories(
		ctx,
		userConn.UserID,
		recentMessages,
		maxMemories,
	)

	if err != nil {
		log.Printf("⚠️ [MEMORY] Failed to select memories: %v", err)
		return ""
	}

	if len(selectedMemories) == 0 {
		return "" // No relevant memories
	}

	// Build memory context string
	var builder strings.Builder
	builder.WriteString("\n\n## Relevant Context from Previous Conversations\n\n")
	builder.WriteString("The following information was extracted from your past interactions with this user:\n\n")

	for i, mem := range selectedMemories {
		builder.WriteString(fmt.Sprintf("%d. %s\n", i+1, mem.DecryptedContent))
	}

	builder.WriteString("\nUse this context to personalize responses and avoid asking for information the user has already provided.\n")

	log.Printf("🧠 [MEMORY] Injected %d memories into system prompt for user %s", len(selectedMemories), userConn.UserID)

	return builder.String()
}

// GetSystemPrompt returns the appropriate system prompt based on priority hierarchy
// includeAskUser: whether to include ask_user tool instructions (should be true if tools are available)
func (s *ChatService) GetSystemPrompt(userConn *models.UserConnection, includeAskUser bool) string {
	formattingGuidelines := getMarkdownFormattingGuidelines()

	// Only include ask_user instructions if tools will be available in the request
	// Otherwise models like Gemini will fail with MALFORMED_FUNCTION_CALL when trying to use a tool that doesn't exist
	var appendix string
	if includeAskUser {
		appendix = getAskUserInstructions() + formattingGuidelines
	} else {
		appendix = formattingGuidelines
		log.Printf("📝 [SYSTEM] Skipping ask_user instructions (no tools selected)")
	}

	// Build temporal context (user name, date, time) - prepended to all prompts
	temporalContext := s.buildTemporalContext(userConn.UserID)

	// 🧠 Build memory context (injected memories from user's memory bank)
	memoryContext := s.buildMemoryContext(userConn)

	// Priority 1: User-provided system instructions (per-request override)
	if userConn.SystemInstructions != "" {
		log.Printf("🎯 [SYSTEM] Using user-provided system instructions for %s", userConn.ConnID)
		log.Printf("✅ [SYSTEM] Appending MANDATORY ask_user instructions")
		return temporalContext + userConn.SystemInstructions + memoryContext + appendix
	}

	// Priority 2: Model-specific system prompt (from database)
	if userConn.ModelID != "" {
		var modelSystemPrompt string
		err := s.db.QueryRow(`
			SELECT system_prompt FROM models WHERE id = ? AND system_prompt IS NOT NULL AND system_prompt != ''
		`, userConn.ModelID).Scan(&modelSystemPrompt)

		if err == nil && modelSystemPrompt != "" {
			log.Printf("📋 [SYSTEM] Using model-specific system prompt for %s (model: %s)", userConn.ConnID, userConn.ModelID)
			log.Printf("✅ [SYSTEM] Appending MANDATORY ask_user instructions to database prompt")
			return temporalContext + modelSystemPrompt + memoryContext + appendix
		}
	}

	// Priority 3: Provider default system prompt (from providers table)
	if userConn.ModelID != "" {
		var providerSystemPrompt string
		err := s.db.QueryRow(`
			SELECT p.system_prompt
			FROM providers p
			JOIN models m ON m.provider_id = p.id
			WHERE m.id = ? AND p.system_prompt IS NOT NULL AND p.system_prompt != ''
		`, userConn.ModelID).Scan(&providerSystemPrompt)

		if err == nil && providerSystemPrompt != "" {
			log.Printf("🏢 [SYSTEM] Using provider default system prompt for %s", userConn.ConnID)
			log.Printf("✅ [SYSTEM] Appending MANDATORY ask_user instructions to provider prompt")
			return temporalContext + providerSystemPrompt + memoryContext + appendix
		}
	}

	// Priority 4: Global fallback prompt (already has ask_user instructions built-in)
	log.Printf("🌐 [SYSTEM] Using global fallback system prompt for %s", userConn.ConnID)
	defaultPrompt := getDefaultSystemPrompt()

	// Verify ask_user instructions are present
	if strings.Contains(defaultPrompt, "ask_user") {
		log.Printf("✅ [SYSTEM] ask_user tool instructions included in system prompt")
	} else {
		log.Printf("⚠️ [SYSTEM] WARNING: ask_user instructions NOT found in system prompt!")
	}

	return temporalContext + defaultPrompt + memoryContext
}

// getDefaultSystemPrompt returns the Humphrey-specific system prompt
// Tailored to the platform's actual capabilities and tools
func getDefaultSystemPrompt() string {
	return `You are Humphrey, an intelligent and helpful assistant with access to powerful tools.

## Your Capabilities

### Interactive Prompts
- **ask_user** - Create interactive modal dialogs to gather structured input when planning tasks or making important decisions. Use this intelligently for complex workflows, not casual conversation

### Research & Information
- **search_web** - Search the internet for current information
- **search_images** - Find images on any topic
- **scrape_web** - Extract content from specific web pages
- **get_current_time** - Get current time in any timezone

### File Processing (when user uploads files)
- **describe_image** - Analyze and describe images in detail
- **read_document** - Extract text from PDF, DOCX, PPTX files
- **read_data_file** - Parse CSV, JSON, Excel files
- **transcribe_audio** - Convert speech to text (MP3, WAV, M4A, etc.)

### Data Analysis & Code
- **analyze_data** - Statistical analysis with automatic visualizations (charts, graphs)
- **run_python** - Execute Python code with package support
- **train_model** - Build ML models (classification, regression, clustering)

### Content Generation
- **generate_image** - Create AI-generated images from descriptions
- **create_presentation** - Build Reveal.js slideshows

### Integrations (when user has credentials configured)
- **GitHub** - Create issues, list repos, add comments
- **Notion** - Search, query databases, create/update pages
- **Discord/Slack/Telegram** - Send messages to channels
- **Custom webhooks** - Send data to any endpoint

## How to Use Tools (In Priority Order)

1. **ask_user FIRST - ALWAYS**
   - ANY question you want to ask → Use ask_user (no exceptions)
   - User says ANYTHING that could go multiple ways → Use ask_user to clarify
   - Examples:
     * User: "Create a website" → ask_user: "What style? Modern/Classic/Minimal?" + "What colors?" + "How many pages?"
     * User: "I'm not figuring out myself" → ask_user: "What did you enjoy as a kid?" + "What makes you lose track of time?"
     * User: "Help me code" → ask_user: "What language?" + "What are you building?"
     * User: "I'm sad" → ask_user: "What's going on?" + "How can I help?"

   **Key point**: It doesn't matter if it's technical, emotional, casual, or formal → If you're asking a question → Use ask_user

2. **Other tools SECOND**
   - search_web - For current events, prices, facts
   - analyze_data - When user uploads files
   - generate_image - For illustrations
   - etc.

## Response Guidelines

### Format Rules
- **Start with the answer** - No preambles like "Great question!"
- **Match complexity** - Simple question = brief answer, Complex = structured with headers
- **Use markdown** - Headers, lists, code blocks, tables where appropriate
- **Code inline** - Add comments in code, not paragraphs explaining it

### Markdown Formatting (IMPORTANT)
- **Tables**: Use standard syntax with ` + "`|`" + ` separators and ` + "`---`" + ` header dividers
- **Lists**: Use ` + "`-`" + ` for unordered lists, ` + "`1.`" + ` for ordered lists (not ` + "`1)`" + `)
- **Headers**: Always include a space after ` + "`#`" + ` symbols (` + "`## Title`" + ` not ` + "`##Title`" + `)
- **Code blocks**: Always specify language after ` + "` + \"```\" + `" + ` (e.g., ` + "` + \"```python\" + `" + `, ` + "` + \"```json\" + `" + `)
- **Links**: Use ` + "`[text](url)`" + ` with no space between ` + "`]`" + ` and ` + "`(`" + `
- **Avoid**: Citation-style ` + "`[1]`" + ` references, decorative unicode lines, non-standard bullets

### Source Citations (CRITICAL)
When using search_web or search_images, ALWAYS cite sources:

**Inline:** "The iPhone 16 starts at $799 ([Apple](https://apple.com/iphone))."

**End of response:**
---
**Sources:**
- [Source Title](url)

### Tool Usage Rules

**🚨 MANDATORY: ask_user**

Use ask_user for EVERY SINGLE QUESTION. No thinking. No judgment. Just do it.

- Typing "Would you..." → STOP → ask_user
- Typing "Should I..." → STOP → ask_user
- Typing "Do you want..." → STOP → ask_user
- Typing "What do you think about..." → STOP → ask_user
- Typing ANY sentence with a question mark → STOP → ask_user

**Examples that MUST use ask_user:**
- "What language do you prefer?" → ask_user
- "How are you feeling?" → ask_user
- "Want me to continue?" → ask_user
- "Which approach?" → ask_user
- "Tell me more?" → ask_user
- "What makes you happy?" → ask_user
- "Should I proceed?" → ask_user

**The ONLY time you don't use ask_user:**
- When you're making a statement (no question mark)
- When you're explaining a concept they asked about
- When you're showing results/code/answers

**Other Tools (use when appropriate):**
- search_web - Current events, prices, facts
- analyze_data - Uploaded files
- generate_image - Create images

## Artifacts

You can create interactive artifacts that render in the UI:

1. **HTML/CSS/JS** - Use html code blocks for interactive web content
2. **SVG** - Use svg code blocks for vector graphics
3. **Mermaid diagrams** - Use mermaid code blocks for flowcharts, sequence diagrams, etc.

Example Mermaid diagram:
` + "```" + `mermaid
graph LR
    A[Start] --> B[Process]
    B --> C[End]
` + "```" + `

## Tone & Style

- **Interactive and Conversational** - Your defining trait. Engage users in dialogue via ask_user
- Professional but approachable
- No emojis unless user uses them first
- Direct and efficient (but not at the expense of being thorough with ask_user)
- Technical when appropriate, simple when not

## Your Interactive Character

You are designed to be a **collaborative partner**, not just a command executor. Embrace dialogue:

✅ **DO THIS:**
- Ask questions before assuming
- Offer choices instead of making decisions for users
- Confirm understanding before executing
- Gather requirements through conversation
- Use ask_user early and often
- Treat every request as a conversation starter

❌ **AVOID THIS:**
- Guessing at user preferences
- Making assumptions about unstated requirements
- Jumping straight to implementation without clarifying
- Asking questions in your text response when ask_user exists
- Being passive - actively engage the user

**Remember:** Users chose ClaraVerse because they want an interactive AI that collaborates with them, not one that makes assumptions.

## Never Do

- Hallucinate URLs - only use URLs from actual search results
- Skip citations when using search tools
- Add unnecessary disclaimers
- Over-explain simple things
- Repeat the user's question back to them

**🚨 CRITICALLY IMPORTANT - NEVER DO THESE:**
- **NEVER ask questions in your text response** - Use ask_user instead
- **NEVER rationalize why a question "doesn't need ask_user"** - Just use it
- **NEVER think "this is too casual for a modal"** - Wrong thinking, use ask_user
- **NEVER think "this is emotional support so I shouldn't use tools"** - Wrong thinking, use ask_user
- **NEVER think "I'll just ask in text this time"** - Wrong, use ask_user
- **NEVER write "You're right to notice that. The ask_user tool I have is designed for..."** - This is you rationalizing. Stop. Use the tool.
- **NEVER explain why you're not using ask_user** - You should be using it`
}

// buildMessagesWithSystemPrompt ensures system prompt is the first message
func (s *ChatService) buildMessagesWithSystemPrompt(systemPrompt string, messages []map[string]interface{}) []map[string]interface{} {
	// Check if first message is already a system message
	if len(messages) > 0 {
		if role, ok := messages[0]["role"].(string); ok && role == "system" {
			// Update existing system message
			messages[0]["content"] = systemPrompt
			return messages
		}
	}

	// Prepend system message
	systemMessage := map[string]interface{}{
		"role":    "system",
		"content": systemPrompt,
	}

	return append([]map[string]interface{}{systemMessage}, messages...)
}

// generateConversationTitle generates a short title from the conversation
func (s *ChatService) generateConversationTitle(userConn *models.UserConnection, assistantResponse string) {
	// Recover from panics (e.g., send on closed channel if user disconnects)
	defer func() {
		if r := recover(); r != nil {
			log.Printf("⚠️  [TITLE] Recovered from panic (user likely disconnected): %v", r)
		}
	}()

	// Get the first user message from cache
	messages := s.getConversationMessages(userConn.ConversationID)
	var firstUserMessage string
	for _, msg := range messages {
		if role, ok := msg["role"].(string); ok && role == "user" {
			if content, ok := msg["content"].(string); ok {
				firstUserMessage = content
				break
			}
		}
	}

	if firstUserMessage == "" {
		log.Printf("⚠️  [TITLE] No user message found for title generation")
		return
	}

	config, err := s.GetEffectiveConfig(userConn, userConn.ModelID)
	if err != nil {
		log.Printf("❌ [TITLE] Failed to get config: %v", err)
		return
	}

	// Create a simple prompt for title generation
	titlePrompt := []map[string]interface{}{
		{
			"role":    "system",
			"content": "Generate a short, descriptive title (4-5 words maximum) for this conversation. Respond with only the title, no quotes or punctuation.",
		},
		{
			"role":    "user",
			"content": fmt.Sprintf("First message: %s\n\nAssistant response: %s", firstUserMessage, assistantResponse),
		},
	}

	// Make a non-streaming request for title
	chatReq := models.ChatRequest{
		Model:       config.Model,
		Messages:    titlePrompt,
		Stream:      false,
		Temperature: 0.7,
	}

	reqBody, err := json.Marshal(chatReq)
	if err != nil {
		log.Printf("❌ [TITLE] Failed to marshal request: %v", err)
		return
	}

	req, err := http.NewRequest("POST", config.BaseURL+"/chat/completions", bytes.NewBuffer(reqBody))
	if err != nil {
		log.Printf("❌ [TITLE] Failed to create request: %v", err)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ [TITLE] Request failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ [TITLE] API error (status %d): %s", resp.StatusCode, string(body))
		return
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("❌ [TITLE] Failed to decode response: %v", err)
		return
	}

	if len(result.Choices) == 0 {
		log.Printf("⚠️  [TITLE] No choices in response")
		return
	}

	title := strings.TrimSpace(result.Choices[0].Message.Content)
	title = strings.Trim(title, `"'`) // Remove quotes if present

	// Limit to 5 words
	words := strings.Fields(title)
	if len(words) > 5 {
		words = words[:5]
		title = strings.Join(words, " ")
	}

	log.Printf("📝 [TITLE] Generated title for %s (length: %d chars)", userConn.ConversationID, len(title))

	// Send title to client (safe send - channel may be closed if user disconnected)
	select {
	case userConn.WriteChan <- models.ServerMessage{
		Type:           "conversation_title",
		ConversationID: userConn.ConversationID,
		Title:          title,
	}:
		log.Printf("✅ [TITLE] Sent title to client for %s", userConn.ConversationID)
	default:
		log.Printf("⚠️  [TITLE] Channel closed or full, skipping title send for %s", userConn.ConversationID)
	}
}

// extractLastUserMessage extracts the last user message content from messages array
// Handles both string content and array content (for vision messages)
func extractLastUserMessage(messages []map[string]interface{}) string {
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		role, _ := msg["role"].(string)
		if role == "user" {
			// Handle string content
			if content, ok := msg["content"].(string); ok {
				return content
			}
			// Handle array content (vision messages)
			if contentArr, ok := msg["content"].([]interface{}); ok {
				for _, part := range contentArr {
					if partMap, ok := part.(map[string]interface{}); ok {
						if partType, _ := partMap["type"].(string); partType == "text" {
							if text, ok := partMap["text"].(string); ok {
								return text
							}
						}
					}
				}
			}
		}
	}
	return ""
}
