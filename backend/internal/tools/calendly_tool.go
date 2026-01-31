package tools

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// NewCalendlyEventsTool creates a Calendly events listing tool
func NewCalendlyEventsTool() *Tool {
	return &Tool{
		Name:        "calendly_events",
		DisplayName: "Calendly Events",
		Description: `List scheduled events from Calendly.

Returns event details including start/end times, invitees, and status.
Authentication is handled automatically via configured Calendly API key.`,
		Icon:     "Calendar",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"calendly", "events", "meetings", "schedule", "calendar"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"status": map[string]interface{}{
					"type":        "string",
					"description": "Filter by status: active or canceled",
				},
				"min_start_time": map[string]interface{}{
					"type":        "string",
					"description": "Filter events starting after this time (ISO 8601 format)",
				},
				"max_start_time": map[string]interface{}{
					"type":        "string",
					"description": "Filter events starting before this time (ISO 8601 format)",
				},
				"count": map[string]interface{}{
					"type":        "number",
					"description": "Number of events to return (max 100)",
				},
			},
			"required": []string{},
		},
		Execute: executeCalendlyEvents,
	}
}

// NewCalendlyEventTypesTool creates a Calendly event types listing tool
func NewCalendlyEventTypesTool() *Tool {
	return &Tool{
		Name:        "calendly_event_types",
		DisplayName: "Calendly Event Types",
		Description: `List available event types from Calendly.

Returns scheduling links and configuration for each event type.
Authentication is handled automatically via configured Calendly API key.`,
		Icon:     "Calendar",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"calendly", "event", "types", "scheduling", "links"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"active": map[string]interface{}{
					"type":        "boolean",
					"description": "Filter by active status",
				},
				"count": map[string]interface{}{
					"type":        "number",
					"description": "Number of event types to return (max 100)",
				},
			},
			"required": []string{},
		},
		Execute: executeCalendlyEventTypes,
	}
}

// NewCalendlyInviteesTool creates a Calendly invitees listing tool
func NewCalendlyInviteesTool() *Tool {
	return &Tool{
		Name:        "calendly_invitees",
		DisplayName: "Calendly Invitees",
		Description: `List invitees for a specific Calendly event.

Returns invitee details including name, email, and responses.
Authentication is handled automatically via configured Calendly API key.`,
		Icon:     "Users",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"calendly", "invitees", "attendees", "participants"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"event_uri": map[string]interface{}{
					"type":        "string",
					"description": "The scheduled event URI to get invitees for",
				},
				"status": map[string]interface{}{
					"type":        "string",
					"description": "Filter by status: active or canceled",
				},
				"count": map[string]interface{}{
					"type":        "number",
					"description": "Number of invitees to return (max 100)",
				},
			},
			"required": []string{"event_uri"},
		},
		Execute: executeCalendlyInvitees,
	}
}

func getCalendlyCurrentUser(apiKey string) (string, error) {
	req, _ := http.NewRequest("GET", "https://api.calendly.com/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(body, &result)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("failed to get current user")
	}

	if resource, ok := result["resource"].(map[string]interface{}); ok {
		if uri, ok := resource["uri"].(string); ok {
			return uri, nil
		}
	}
	return "", fmt.Errorf("user URI not found")
}

func executeCalendlyEvents(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "calendly")
	if err != nil {
		return "", fmt.Errorf("failed to get Calendly credentials: %w", err)
	}

	apiKey, _ := credData["api_key"].(string)
	if apiKey == "" {
		return "", fmt.Errorf("Calendly API key not configured")
	}

	userURI, err := getCalendlyCurrentUser(apiKey)
	if err != nil {
		return "", fmt.Errorf("failed to get current user: %w", err)
	}

	queryParams := url.Values{}
	queryParams.Set("user", userURI)
	if status, ok := args["status"].(string); ok && status != "" {
		queryParams.Set("status", status)
	}
	if minStart, ok := args["min_start_time"].(string); ok && minStart != "" {
		queryParams.Set("min_start_time", minStart)
	}
	if maxStart, ok := args["max_start_time"].(string); ok && maxStart != "" {
		queryParams.Set("max_start_time", maxStart)
	}
	if count, ok := args["count"].(float64); ok && count > 0 {
		queryParams.Set("count", fmt.Sprintf("%d", int(count)))
	}

	apiURL := "https://api.calendly.com/scheduled_events?" + queryParams.Encode()
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(body, &result)

	if resp.StatusCode >= 400 {
		errMsg := "unknown error"
		if msg, ok := result["message"].(string); ok {
			errMsg = msg
		}
		return "", fmt.Errorf("Calendly API error: %s", errMsg)
	}

	jsonResult, _ := json.MarshalIndent(result, "", "  ")
	return string(jsonResult), nil
}

func executeCalendlyEventTypes(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "calendly")
	if err != nil {
		return "", fmt.Errorf("failed to get Calendly credentials: %w", err)
	}

	apiKey, _ := credData["api_key"].(string)
	if apiKey == "" {
		return "", fmt.Errorf("Calendly API key not configured")
	}

	userURI, err := getCalendlyCurrentUser(apiKey)
	if err != nil {
		return "", fmt.Errorf("failed to get current user: %w", err)
	}

	queryParams := url.Values{}
	queryParams.Set("user", userURI)
	if active, ok := args["active"].(bool); ok {
		queryParams.Set("active", fmt.Sprintf("%t", active))
	}
	if count, ok := args["count"].(float64); ok && count > 0 {
		queryParams.Set("count", fmt.Sprintf("%d", int(count)))
	}

	apiURL := "https://api.calendly.com/event_types?" + queryParams.Encode()
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(body, &result)

	if resp.StatusCode >= 400 {
		errMsg := "unknown error"
		if msg, ok := result["message"].(string); ok {
			errMsg = msg
		}
		return "", fmt.Errorf("Calendly API error: %s", errMsg)
	}

	jsonResult, _ := json.MarshalIndent(result, "", "  ")
	return string(jsonResult), nil
}

func executeCalendlyInvitees(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "calendly")
	if err != nil {
		return "", fmt.Errorf("failed to get Calendly credentials: %w", err)
	}

	apiKey, _ := credData["api_key"].(string)
	if apiKey == "" {
		return "", fmt.Errorf("Calendly API key not configured")
	}

	eventURI, _ := args["event_uri"].(string)
	if eventURI == "" {
		return "", fmt.Errorf("'event_uri' is required")
	}

	queryParams := url.Values{}
	if status, ok := args["status"].(string); ok && status != "" {
		queryParams.Set("status", status)
	}
	if count, ok := args["count"].(float64); ok && count > 0 {
		queryParams.Set("count", fmt.Sprintf("%d", int(count)))
	}

	apiURL := eventURI + "/invitees"
	if len(queryParams) > 0 {
		apiURL += "?" + queryParams.Encode()
	}

	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(body, &result)

	if resp.StatusCode >= 400 {
		errMsg := "unknown error"
		if msg, ok := result["message"].(string); ok {
			errMsg = msg
		}
		return "", fmt.Errorf("Calendly API error: %s", errMsg)
	}

	jsonResult, _ := json.MarshalIndent(result, "", "  ")
	return string(jsonResult), nil
}
