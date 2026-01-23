package models

import "time"

// Model represents an LLM model from a provider
type Model struct {
	ID                string    `json:"id"`
	ProviderID        int       `json:"provider_id"`
	ProviderName      string    `json:"provider_name,omitempty"`
	ProviderFavicon   string    `json:"provider_favicon,omitempty"`
	Name              string    `json:"name"`
	DisplayName       string    `json:"display_name,omitempty"`
	Description       string    `json:"description,omitempty"`
	ContextLength     int       `json:"context_length,omitempty"`
	SupportsTools     bool      `json:"supports_tools"`
	SupportsStreaming bool      `json:"supports_streaming"`
	SupportsVision    bool      `json:"supports_vision"`
	SmartToolRouter   bool      `json:"smart_tool_router"`         // If true, model can be used as tool predictor
	AgentsEnabled     bool      `json:"agents_enabled"`            // If true, model is available in agent builder
	IsVisible         bool      `json:"isVisible"`
	SystemPrompt      string    `json:"system_prompt,omitempty"`
	FetchedAt         time.Time `json:"fetched_at"`
}

// ModelFilter represents a filter rule for showing/hiding models
type ModelFilter struct {
	ID           int    `json:"id"`
	ProviderID   int    `json:"provider_id"`
	ModelPattern string `json:"model_pattern"`
	Action       string `json:"action"` // "include" or "exclude"
	Priority     int    `json:"priority"`
}

// OpenAIModelsResponse represents the response from OpenAI-compatible /v1/models endpoint
type OpenAIModelsResponse struct {
	Object string `json:"object"`
	Data   []struct {
		ID      string `json:"id"`
		Object  string `json:"object"`
		Created int64  `json:"created"`
		OwnedBy string `json:"owned_by"`
	} `json:"data"`
}
