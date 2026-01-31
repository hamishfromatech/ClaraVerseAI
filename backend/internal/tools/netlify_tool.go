package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// NewNetlifySitesTool creates a Netlify sites listing tool
func NewNetlifySitesTool() *Tool {
	return &Tool{
		Name:        "netlify_sites",
		DisplayName: "Netlify Sites",
		Description: `List sites from your Netlify account.

Returns site details including name, URL, deploy status, and repository info.
Authentication is handled automatically via configured Netlify credentials.`,
		Icon:     "Globe",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"netlify", "sites", "deploy", "hosting", "web"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"filter": map[string]interface{}{
					"type":        "string",
					"description": "Filter sites by name (partial match)",
				},
			},
			"required": []string{},
		},
		Execute: executeNetlifySites,
	}
}

// NewNetlifyDeploysTool creates a Netlify deploys listing tool
func NewNetlifyDeploysTool() *Tool {
	return &Tool{
		Name:        "netlify_deploys",
		DisplayName: "Netlify Deploys",
		Description: `List deploys for a Netlify site.

Returns deploy history with status, timing, and error information.
Authentication is handled automatically via configured Netlify credentials.`,
		Icon:     "Rocket",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"netlify", "deploys", "history", "builds"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"site_id": map[string]interface{}{
					"type":        "string",
					"description": "The Netlify site ID",
				},
				"per_page": map[string]interface{}{
					"type":        "number",
					"description": "Number of deploys to return (max 100, default 20)",
				},
			},
			"required": []string{"site_id"},
		},
		Execute: executeNetlifyDeploys,
	}
}

// NewNetlifyTriggerBuildTool creates a Netlify build trigger tool
func NewNetlifyTriggerBuildTool() *Tool {
	return &Tool{
		Name:        "netlify_trigger_build",
		DisplayName: "Trigger Netlify Build",
		Description: `Trigger a new build and deploy for a Netlify site.

Optionally clear cache or add a title.
Authentication is handled automatically via configured Netlify credentials.`,
		Icon:     "Play",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"netlify", "build", "deploy", "trigger"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"site_id": map[string]interface{}{
					"type":        "string",
					"description": "The Netlify site ID",
				},
				"clear_cache": map[string]interface{}{
					"type":        "boolean",
					"description": "Clear the build cache before building",
				},
				"title": map[string]interface{}{
					"type":        "string",
					"description": "Title for the deploy (shown in Netlify UI)",
				},
			},
			"required": []string{"site_id"},
		},
		Execute: executeNetlifyTriggerBuild,
	}
}

func executeNetlifySites(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "netlify")
	if err != nil {
		return "", fmt.Errorf("failed to get Netlify credentials: %w", err)
	}

	accessToken, _ := credData["access_token"].(string)
	if accessToken == "" {
		return "", fmt.Errorf("Netlify access_token not configured")
	}

	apiURL := "https://api.netlify.com/api/v1/sites"
	if filter, ok := args["filter"].(string); ok && filter != "" {
		apiURL += "?filter=" + filter
	}

	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("Netlify API error: %s", string(body))
	}

	var result []map[string]interface{}
	json.Unmarshal(body, &result)

	output := map[string]interface{}{
		"sites": result,
		"count": len(result),
	}
	jsonResult, _ := json.MarshalIndent(output, "", "  ")
	return string(jsonResult), nil
}

func executeNetlifyDeploys(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "netlify")
	if err != nil {
		return "", fmt.Errorf("failed to get Netlify credentials: %w", err)
	}

	accessToken, _ := credData["access_token"].(string)
	if accessToken == "" {
		return "", fmt.Errorf("Netlify access_token not configured")
	}

	siteID, _ := args["site_id"].(string)
	if siteID == "" {
		return "", fmt.Errorf("'site_id' is required")
	}

	perPage := 20
	if pp, ok := args["per_page"].(float64); ok && pp > 0 {
		perPage = int(pp)
		if perPage > 100 {
			perPage = 100
		}
	}

	apiURL := fmt.Sprintf("https://api.netlify.com/api/v1/sites/%s/deploys?per_page=%d", siteID, perPage)
	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("Netlify API error: %s", string(body))
	}

	var result []map[string]interface{}
	json.Unmarshal(body, &result)

	output := map[string]interface{}{
		"deploys": result,
		"count":   len(result),
	}
	jsonResult, _ := json.MarshalIndent(output, "", "  ")
	return string(jsonResult), nil
}

func executeNetlifyTriggerBuild(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "netlify")
	if err != nil {
		return "", fmt.Errorf("failed to get Netlify credentials: %w", err)
	}

	accessToken, _ := credData["access_token"].(string)
	if accessToken == "" {
		return "", fmt.Errorf("Netlify access_token not configured")
	}

	siteID, _ := args["site_id"].(string)
	if siteID == "" {
		return "", fmt.Errorf("'site_id' is required")
	}

	payload := make(map[string]interface{})
	if cc, ok := args["clear_cache"].(bool); ok && cc {
		payload["clear_cache"] = true
	}
	if title, ok := args["title"].(string); ok && title != "" {
		payload["title"] = title
	}

	var reqBody io.Reader
	if len(payload) > 0 {
		jsonBody, _ := json.Marshal(payload)
		reqBody = bytes.NewBuffer(jsonBody)
	}

	apiURL := fmt.Sprintf("https://api.netlify.com/api/v1/sites/%s/builds", siteID)
	req, _ := http.NewRequest("POST", apiURL, reqBody)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("Netlify API error: %s", string(body))
	}

	var result map[string]interface{}
	json.Unmarshal(body, &result)

	output := map[string]interface{}{
		"success": true,
		"build":   result,
	}
	jsonResult, _ := json.MarshalIndent(output, "", "  ")
	return string(jsonResult), nil
}
