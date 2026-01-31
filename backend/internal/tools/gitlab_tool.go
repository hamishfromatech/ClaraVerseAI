package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// NewGitLabProjectsTool creates a tool for listing GitLab projects
func NewGitLabProjectsTool() *Tool {
	return &Tool{
		Name:        "gitlab_projects",
		DisplayName: "List GitLab Projects",
		Description: "List projects accessible to the authenticated user. Authentication is handled automatically via configured credentials.",
		Icon:        "GitBranch",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"gitlab", "projects", "repositories", "list"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"owned": map[string]interface{}{
					"type":        "boolean",
					"description": "Only return projects owned by the user",
				},
				"membership": map[string]interface{}{
					"type":        "boolean",
					"description": "Only return projects the user is a member of",
				},
				"per_page": map[string]interface{}{
					"type":        "number",
					"description": "Results per page (max 100, default 20)",
				},
			},
			"required": []string{},
		},
		Execute: executeGitLabProjects,
	}
}

// NewGitLabIssuesTool creates a tool for listing GitLab issues
func NewGitLabIssuesTool() *Tool {
	return &Tool{
		Name:        "gitlab_issues",
		DisplayName: "List GitLab Issues",
		Description: "List issues from a GitLab project. Authentication is handled automatically.",
		Icon:        "AlertCircle",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"gitlab", "issues", "bugs", "tasks"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"project_id": map[string]interface{}{
					"type":        "string",
					"description": "Project ID or URL-encoded path",
				},
				"state": map[string]interface{}{
					"type":        "string",
					"enum":        []string{"opened", "closed", "all"},
					"description": "Filter by state (default: opened)",
				},
				"labels": map[string]interface{}{
					"type":        "string",
					"description": "Comma-separated list of labels to filter by",
				},
				"per_page": map[string]interface{}{
					"type":        "number",
					"description": "Results per page (max 100, default 20)",
				},
			},
			"required": []string{"project_id"},
		},
		Execute: executeGitLabIssues,
	}
}

// NewGitLabMRsTool creates a tool for listing GitLab merge requests
func NewGitLabMRsTool() *Tool {
	return &Tool{
		Name:        "gitlab_mrs",
		DisplayName: "List GitLab Merge Requests",
		Description: "List merge requests from a GitLab project. Authentication is handled automatically.",
		Icon:        "GitPullRequest",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"gitlab", "merge requests", "MR", "pull requests"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"project_id": map[string]interface{}{
					"type":        "string",
					"description": "Project ID or URL-encoded path",
				},
				"state": map[string]interface{}{
					"type":        "string",
					"enum":        []string{"opened", "closed", "merged", "all"},
					"description": "Filter by state (default: opened)",
				},
				"per_page": map[string]interface{}{
					"type":        "number",
					"description": "Results per page (max 100, default 20)",
				},
			},
			"required": []string{"project_id"},
		},
		Execute: executeGitLabMRs,
	}
}

func getGitLabConfig(args map[string]interface{}) (string, string, error) {
	credData, err := GetCredentialData(args, "gitlab")
	if err != nil {
		return "", "", fmt.Errorf("failed to get GitLab credentials: %w", err)
	}

	token, _ := credData["personal_access_token"].(string)
	if token == "" {
		return "", "", fmt.Errorf("personal_access_token is required")
	}

	baseURL := "https://gitlab.com"
	if url, ok := credData["base_url"].(string); ok && url != "" {
		baseURL = url
	}

	return baseURL, token, nil
}

func gitlabRequest(method, baseURL, endpoint, token string, body interface{}) (interface{}, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	req, err := http.NewRequest(method, baseURL+"/api/v4"+endpoint, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("PRIVATE-TOKEN", token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("GitLab API error: %s (status %d)", string(respBody), resp.StatusCode)
	}

	var result interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return result, nil
}

func executeGitLabProjects(args map[string]interface{}) (string, error) {
	baseURL, token, err := getGitLabConfig(args)
	if err != nil {
		return "", err
	}

	params := url.Values{}
	if owned, ok := args["owned"].(bool); ok && owned {
		params.Set("owned", "true")
	}
	if membership, ok := args["membership"].(bool); ok && membership {
		params.Set("membership", "true")
	}
	perPage := 20
	if pp, ok := args["per_page"].(float64); ok && pp > 0 {
		perPage = int(pp)
		if perPage > 100 {
			perPage = 100
		}
	}
	params.Set("per_page", fmt.Sprintf("%d", perPage))

	endpoint := "/projects"
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}

	result, err := gitlabRequest("GET", baseURL, endpoint, token, nil)
	if err != nil {
		return "", err
	}

	projects, ok := result.([]interface{})
	if !ok {
		return "", fmt.Errorf("unexpected response format")
	}

	simplifiedProjects := make([]map[string]interface{}, 0)
	for _, p := range projects {
		project, ok := p.(map[string]interface{})
		if !ok {
			continue
		}
		simplifiedProjects = append(simplifiedProjects, map[string]interface{}{
			"id":              project["id"],
			"name":            project["name"],
			"path_with_namespace": project["path_with_namespace"],
			"web_url":         project["web_url"],
			"description":     project["description"],
			"default_branch":  project["default_branch"],
			"visibility":      project["visibility"],
		})
	}

	response := map[string]interface{}{
		"success":  true,
		"count":    len(simplifiedProjects),
		"projects": simplifiedProjects,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeGitLabIssues(args map[string]interface{}) (string, error) {
	baseURL, token, err := getGitLabConfig(args)
	if err != nil {
		return "", err
	}

	projectID, _ := args["project_id"].(string)
	if projectID == "" {
		return "", fmt.Errorf("project_id is required")
	}

	params := url.Values{}
	if state, ok := args["state"].(string); ok && state != "" {
		params.Set("state", state)
	}
	if labels, ok := args["labels"].(string); ok && labels != "" {
		params.Set("labels", labels)
	}
	perPage := 20
	if pp, ok := args["per_page"].(float64); ok && pp > 0 {
		perPage = int(pp)
		if perPage > 100 {
			perPage = 100
		}
	}
	params.Set("per_page", fmt.Sprintf("%d", perPage))

	endpoint := fmt.Sprintf("/projects/%s/issues", url.PathEscape(projectID))
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}

	result, err := gitlabRequest("GET", baseURL, endpoint, token, nil)
	if err != nil {
		return "", err
	}

	issues, ok := result.([]interface{})
	if !ok {
		return "", fmt.Errorf("unexpected response format")
	}

	simplifiedIssues := make([]map[string]interface{}, 0)
	for _, i := range issues {
		issue, ok := i.(map[string]interface{})
		if !ok {
			continue
		}
		simplifiedIssues = append(simplifiedIssues, map[string]interface{}{
			"iid":        issue["iid"],
			"title":      issue["title"],
			"state":      issue["state"],
			"web_url":    issue["web_url"],
			"labels":     issue["labels"],
			"created_at": issue["created_at"],
			"updated_at": issue["updated_at"],
		})
	}

	response := map[string]interface{}{
		"success": true,
		"count":   len(simplifiedIssues),
		"issues":  simplifiedIssues,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeGitLabMRs(args map[string]interface{}) (string, error) {
	baseURL, token, err := getGitLabConfig(args)
	if err != nil {
		return "", err
	}

	projectID, _ := args["project_id"].(string)
	if projectID == "" {
		return "", fmt.Errorf("project_id is required")
	}

	params := url.Values{}
	if state, ok := args["state"].(string); ok && state != "" {
		params.Set("state", state)
	}
	perPage := 20
	if pp, ok := args["per_page"].(float64); ok && pp > 0 {
		perPage = int(pp)
		if perPage > 100 {
			perPage = 100
		}
	}
	params.Set("per_page", fmt.Sprintf("%d", perPage))

	endpoint := fmt.Sprintf("/projects/%s/merge_requests", url.PathEscape(projectID))
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}

	result, err := gitlabRequest("GET", baseURL, endpoint, token, nil)
	if err != nil {
		return "", err
	}

	mrs, ok := result.([]interface{})
	if !ok {
		return "", fmt.Errorf("unexpected response format")
	}

	simplifiedMRs := make([]map[string]interface{}, 0)
	for _, m := range mrs {
		mr, ok := m.(map[string]interface{})
		if !ok {
			continue
		}
		simplifiedMRs = append(simplifiedMRs, map[string]interface{}{
			"iid":           mr["iid"],
			"title":         mr["title"],
			"state":         mr["state"],
			"web_url":       mr["web_url"],
			"source_branch": mr["source_branch"],
			"target_branch": mr["target_branch"],
			"created_at":    mr["created_at"],
			"updated_at":    mr["updated_at"],
		})
	}

	response := map[string]interface{}{
		"success":        true,
		"count":          len(simplifiedMRs),
		"merge_requests": simplifiedMRs,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

