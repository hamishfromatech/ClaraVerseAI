package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// NewMixpanelTrackTool creates a Mixpanel event tracking tool
func NewMixpanelTrackTool() *Tool {
	return &Tool{
		Name:        "mixpanel_track",
		DisplayName: "Mixpanel Track Event",
		Description: `Track events in Mixpanel for product analytics.

Send user actions and behaviors to Mixpanel for analysis.
Authentication is handled automatically via configured Mixpanel credentials.`,
		Icon:     "BarChart2",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"mixpanel", "analytics", "track", "event", "metrics"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"event": map[string]interface{}{
					"type":        "string",
					"description": "The name of the event to track",
				},
				"distinct_id": map[string]interface{}{
					"type":        "string",
					"description": "The unique user identifier",
				},
				"properties": map[string]interface{}{
					"type":        "object",
					"description": "Additional properties to track with the event",
				},
			},
			"required": []string{"event", "distinct_id"},
		},
		Execute: executeMixpanelTrack,
	}
}

// NewMixpanelUserProfileTool creates a Mixpanel user profile tool
func NewMixpanelUserProfileTool() *Tool {
	return &Tool{
		Name:        "mixpanel_user_profile",
		DisplayName: "Mixpanel User Profile",
		Description: `Manage Mixpanel user profiles.

Set or update user properties for segmentation and analysis.
Operations: set, set_once, add, append, unset
Authentication is handled automatically via configured Mixpanel credentials.`,
		Icon:     "User",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"mixpanel", "user", "profile", "properties"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"distinct_id": map[string]interface{}{
					"type":        "string",
					"description": "The unique user identifier",
				},
				"operation": map[string]interface{}{
					"type":        "string",
					"enum":        []string{"set", "set_once", "add", "append", "unset"},
					"description": "The operation to perform: set, set_once, add, append, or unset",
				},
				"properties": map[string]interface{}{
					"type":        "object",
					"description": "Properties for the operation",
				},
			},
			"required": []string{"distinct_id", "operation"},
		},
		Execute: executeMixpanelUserProfile,
	}
}

func executeMixpanelTrack(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "mixpanel")
	if err != nil {
		return "", fmt.Errorf("failed to get Mixpanel credentials: %w", err)
	}

	projectToken, _ := credData["project_token"].(string)
	if projectToken == "" {
		return "", fmt.Errorf("Mixpanel project_token not configured")
	}

	event, _ := args["event"].(string)
	distinctID, _ := args["distinct_id"].(string)
	if event == "" || distinctID == "" {
		return "", fmt.Errorf("'event' and 'distinct_id' are required")
	}

	properties := map[string]interface{}{
		"token":       projectToken,
		"distinct_id": distinctID,
		"time":        time.Now().Unix(),
	}
	if props, ok := args["properties"].(map[string]interface{}); ok {
		for k, v := range props {
			properties[k] = v
		}
	}

	eventData := []map[string]interface{}{
		{"event": event, "properties": properties},
	}
	jsonBody, _ := json.Marshal(eventData)

	req, _ := http.NewRequest("POST", "https://api.mixpanel.com/track", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/plain")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if string(body) == "1" {
		output := map[string]interface{}{
			"success":     true,
			"event":       event,
			"distinct_id": distinctID,
		}
		jsonResult, _ := json.MarshalIndent(output, "", "  ")
		return string(jsonResult), nil
	}

	return "", fmt.Errorf("Mixpanel tracking failed: %s", string(body))
}

func executeMixpanelUserProfile(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "mixpanel")
	if err != nil {
		return "", fmt.Errorf("failed to get Mixpanel credentials: %w", err)
	}

	projectToken, _ := credData["project_token"].(string)
	if projectToken == "" {
		return "", fmt.Errorf("Mixpanel project_token not configured")
	}

	distinctID, _ := args["distinct_id"].(string)
	operation, _ := args["operation"].(string)
	if distinctID == "" || operation == "" {
		return "", fmt.Errorf("'distinct_id' and 'operation' are required")
	}

	opKeyMap := map[string]string{
		"set": "$set", "set_once": "$set_once", "add": "$add",
		"append": "$append", "unset": "$unset",
	}
	opKey, ok := opKeyMap[operation]
	if !ok {
		return "", fmt.Errorf("invalid operation: %s. Valid operations: set, set_once, add, append, unset", operation)
	}

	profileData := []map[string]interface{}{
		{"$token": projectToken, "$distinct_id": distinctID},
	}

	props, _ := args["properties"].(map[string]interface{})
	if operation == "unset" {
		keys := make([]string, 0, len(props))
		for k := range props {
			keys = append(keys, k)
		}
		profileData[0][opKey] = keys
	} else {
		profileData[0][opKey] = props
	}

	jsonBody, _ := json.Marshal(profileData)
	req, _ := http.NewRequest("POST", "https://api.mixpanel.com/engage", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/plain")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if string(body) == "1" {
		output := map[string]interface{}{
			"success":     true,
			"operation":   operation,
			"distinct_id": distinctID,
		}
		jsonResult, _ := json.MarshalIndent(output, "", "  ")
		return string(jsonResult), nil
	}

	return "", fmt.Errorf("Mixpanel profile update failed: %s", string(body))
}
