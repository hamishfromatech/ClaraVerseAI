package tools

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// NewJiraIssuesTool creates a tool for listing Jira issues
func NewJiraIssuesTool() *Tool {
	return &Tool{
		Name:        "jira_issues",
		DisplayName: "List Jira Issues",
		Description: "Search and list issues from Jira using JQL. Authentication is handled automatically via configured credentials.",
		Icon:        "List",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"jira", "issues", "bugs", "tasks", "tickets"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"jql": map[string]interface{}{
					"type":        "string",
					"description": "JQL query to filter issues (e.g., 'project = PROJ AND status = Open')",
				},
				"project": map[string]interface{}{
					"type":        "string",
					"description": "Project key to filter issues",
				},
				"max_results": map[string]interface{}{
					"type":        "number",
					"description": "Maximum number of results (default 50)",
				},
			},
			"required": []string{},
		},
		Execute: executeJiraIssues,
	}
}

// NewJiraCreateIssueTool creates a tool for creating Jira issues
func NewJiraCreateIssueTool() *Tool {
	return &Tool{
		Name:        "jira_create_issue",
		DisplayName: "Create Jira Issue",
		Description: "Create a new issue in Jira. Authentication is handled automatically.",
		Icon:        "Plus",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"jira", "issue", "create", "task", "ticket", "add"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"project_key": map[string]interface{}{
					"type":        "string",
					"description": "Project key (e.g., 'PROJ')",
				},
				"summary": map[string]interface{}{
					"type":        "string",
					"description": "Issue summary/title",
				},
				"description": map[string]interface{}{
					"type":        "string",
					"description": "Issue description",
				},
				"issue_type": map[string]interface{}{
					"type":        "string",
					"description": "Issue type (e.g., 'Bug', 'Task', 'Story')",
				},
				"priority": map[string]interface{}{
					"type":        "string",
					"description": "Priority name (e.g., 'High', 'Medium', 'Low')",
				},
			},
			"required": []string{"project_key", "summary", "issue_type"},
		},
		Execute: executeJiraCreateIssue,
	}
}

// NewJiraUpdateIssueTool creates a tool for updating Jira issues
func NewJiraUpdateIssueTool() *Tool {
	return &Tool{
		Name:        "jira_update_issue",
		DisplayName: "Update Jira Issue",
		Description: "Update an existing issue in Jira. Authentication is handled automatically.",
		Icon:        "Edit",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"jira", "issue", "update", "edit", "modify"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"issue_key": map[string]interface{}{
					"type":        "string",
					"description": "Issue key (e.g., 'PROJ-123')",
				},
				"summary": map[string]interface{}{
					"type":        "string",
					"description": "New summary",
				},
				"description": map[string]interface{}{
					"type":        "string",
					"description": "New description",
				},
				"transition": map[string]interface{}{
					"type":        "string",
					"description": "Transition name to move issue (e.g., 'Done', 'In Progress')",
				},
			},
			"required": []string{"issue_key"},
		},
		Execute: executeJiraUpdateIssue,
	}
}

func getJiraConfig(args map[string]interface{}) (string, string, error) {
	credData, err := GetCredentialData(args, "jira")
	if err != nil {
		return "", "", fmt.Errorf("failed to get Jira credentials: %w", err)
	}

	email, _ := credData["email"].(string)
	apiToken, _ := credData["api_token"].(string)
	domain, _ := credData["domain"].(string)

	if email == "" || apiToken == "" || domain == "" {
		return "", "", fmt.Errorf("email, api_token, and domain are required")
	}

	// Create basic auth header
	auth := base64.StdEncoding.EncodeToString([]byte(email + ":" + apiToken))
	baseURL := fmt.Sprintf("https://%s", domain)

	return baseURL, auth, nil
}

func jiraRequest(method, baseURL, endpoint, auth string, body interface{}) (map[string]interface{}, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	req, err := http.NewRequest(method, baseURL+"/rest/api/3"+endpoint, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Basic "+auth)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

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

	if len(respBody) == 0 {
		return map[string]interface{}{"success": true}, nil
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if resp.StatusCode >= 400 {
		errMsg := "Jira API error"
		if errors, ok := result["errorMessages"].([]interface{}); ok && len(errors) > 0 {
			if msg, ok := errors[0].(string); ok {
				errMsg = msg
			}
		}
		return nil, fmt.Errorf("%s (status %d)", errMsg, resp.StatusCode)
	}

	return result, nil
}

func executeJiraIssues(args map[string]interface{}) (string, error) {
	baseURL, auth, err := getJiraConfig(args)
	if err != nil {
		return "", err
	}

	// Build JQL
	jql, _ := args["jql"].(string)
	if jql == "" {
		if project, ok := args["project"].(string); ok && project != "" {
			jql = fmt.Sprintf("project = %s ORDER BY created DESC", project)
		} else {
			jql = "ORDER BY created DESC"
		}
	}

	maxResults := 50
	if mr, ok := args["max_results"].(float64); ok && mr > 0 {
		maxResults = int(mr)
		if maxResults > 100 {
			maxResults = 100
		}
	}

	params := url.Values{}
	params.Set("jql", jql)
	params.Set("maxResults", fmt.Sprintf("%d", maxResults))
	params.Set("fields", "summary,status,priority,assignee,reporter,created,updated,issuetype")

	endpoint := "/search?" + params.Encode()
	result, err := jiraRequest("GET", baseURL, endpoint, auth, nil)
	if err != nil {
		return "", err
	}

	issues, ok := result["issues"].([]interface{})
	if !ok {
		issues = []interface{}{}
	}

	simplifiedIssues := make([]map[string]interface{}, 0)
	for _, i := range issues {
		issue, ok := i.(map[string]interface{})
		if !ok {
			continue
		}
		fields, _ := issue["fields"].(map[string]interface{})
		simplified := map[string]interface{}{
			"key":        issue["key"],
			"summary":    fields["summary"],
			"created":    fields["created"],
			"updated":    fields["updated"],
		}
		if status, ok := fields["status"].(map[string]interface{}); ok {
			simplified["status"] = status["name"]
		}
		if priority, ok := fields["priority"].(map[string]interface{}); ok {
			simplified["priority"] = priority["name"]
		}
		if issueType, ok := fields["issuetype"].(map[string]interface{}); ok {
			simplified["type"] = issueType["name"]
		}
		if assignee, ok := fields["assignee"].(map[string]interface{}); ok {
			simplified["assignee"] = assignee["displayName"]
		}
		simplifiedIssues = append(simplifiedIssues, simplified)
	}

	response := map[string]interface{}{
		"success": true,
		"total":   result["total"],
		"count":   len(simplifiedIssues),
		"issues":  simplifiedIssues,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeJiraCreateIssue(args map[string]interface{}) (string, error) {
	baseURL, auth, err := getJiraConfig(args)
	if err != nil {
		return "", err
	}

	projectKey, _ := args["project_key"].(string)
	summary, _ := args["summary"].(string)
	issueType, _ := args["issue_type"].(string)

	if projectKey == "" || summary == "" || issueType == "" {
		return "", fmt.Errorf("project_key, summary, and issue_type are required")
	}

	fields := map[string]interface{}{
		"project": map[string]interface{}{
			"key": projectKey,
		},
		"summary": summary,
		"issuetype": map[string]interface{}{
			"name": issueType,
		},
	}

	if desc, ok := args["description"].(string); ok && desc != "" {
		fields["description"] = map[string]interface{}{
			"type":    "doc",
			"version": 1,
			"content": []map[string]interface{}{
				{
					"type": "paragraph",
					"content": []map[string]interface{}{
						{
							"type": "text",
							"text": desc,
						},
					},
				},
			},
		}
	}

	if priority, ok := args["priority"].(string); ok && priority != "" {
		fields["priority"] = map[string]interface{}{
			"name": priority,
		}
	}

	body := map[string]interface{}{"fields": fields}
	result, err := jiraRequest("POST", baseURL, "/issue", auth, body)
	if err != nil {
		return "", err
	}

	response := map[string]interface{}{
		"success":   true,
		"message":   "Issue created successfully",
		"issue_key": result["key"],
		"issue_id":  result["id"],
		"self":      result["self"],
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeJiraUpdateIssue(args map[string]interface{}) (string, error) {
	baseURL, auth, err := getJiraConfig(args)
	if err != nil {
		return "", err
	}

	issueKey, _ := args["issue_key"].(string)
	if issueKey == "" {
		return "", fmt.Errorf("issue_key is required")
	}

	fields := map[string]interface{}{}

	if summary, ok := args["summary"].(string); ok && summary != "" {
		fields["summary"] = summary
	}

	if desc, ok := args["description"].(string); ok && desc != "" {
		fields["description"] = map[string]interface{}{
			"type":    "doc",
			"version": 1,
			"content": []map[string]interface{}{
				{
					"type": "paragraph",
					"content": []map[string]interface{}{
						{
							"type": "text",
							"text": desc,
						},
					},
				},
			},
		}
	}

	if len(fields) > 0 {
		body := map[string]interface{}{"fields": fields}
		endpoint := fmt.Sprintf("/issue/%s", issueKey)
		_, err := jiraRequest("PUT", baseURL, endpoint, auth, body)
		if err != nil {
			return "", err
		}
	}

	// Handle transition if specified
	if transition, ok := args["transition"].(string); ok && transition != "" {
		// Get available transitions
		endpoint := fmt.Sprintf("/issue/%s/transitions", issueKey)
		transResult, err := jiraRequest("GET", baseURL, endpoint, auth, nil)
		if err != nil {
			return "", fmt.Errorf("failed to get transitions: %w", err)
		}

		transitions, _ := transResult["transitions"].([]interface{})
		var transitionID string
		for _, t := range transitions {
			trans, ok := t.(map[string]interface{})
			if !ok {
				continue
			}
			if name, ok := trans["name"].(string); ok && name == transition {
				transitionID, _ = trans["id"].(string)
				break
			}
		}

		if transitionID != "" {
			body := map[string]interface{}{
				"transition": map[string]interface{}{
					"id": transitionID,
				},
			}
			_, err = jiraRequest("POST", baseURL, endpoint, auth, body)
			if err != nil {
				return "", fmt.Errorf("failed to transition issue: %w", err)
			}
		}
	}

	response := map[string]interface{}{
		"success":   true,
		"message":   "Issue updated successfully",
		"issue_key": issueKey,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

