package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const linearAPIBase = "https://api.linear.app/graphql"

// NewLinearIssuesTool creates a tool for listing Linear issues
func NewLinearIssuesTool() *Tool {
	return &Tool{
		Name:        "linear_issues",
		DisplayName: "List Linear Issues",
		Description: "List issues from Linear. Authentication is handled automatically via configured credentials.",
		Icon:        "List",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"linear", "issues", "tasks", "bugs", "project"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"team_key": map[string]interface{}{
					"type":        "string",
					"description": "Team key to filter issues (e.g., 'ENG')",
				},
				"state": map[string]interface{}{
					"type":        "string",
					"description": "Filter by state name (e.g., 'In Progress', 'Done')",
				},
				"limit": map[string]interface{}{
					"type":        "number",
					"description": "Maximum number of issues to return (default 50)",
				},
			},
			"required": []string{},
		},
		Execute: executeLinearIssues,
	}
}

// NewLinearCreateIssueTool creates a tool for creating Linear issues
func NewLinearCreateIssueTool() *Tool {
	return &Tool{
		Name:        "linear_create_issue",
		DisplayName: "Create Linear Issue",
		Description: "Create a new issue in Linear. Authentication is handled automatically.",
		Icon:        "Plus",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"linear", "issue", "create", "task", "add"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"team_id": map[string]interface{}{
					"type":        "string",
					"description": "Team ID for the issue",
				},
				"title": map[string]interface{}{
					"type":        "string",
					"description": "Issue title",
				},
				"description": map[string]interface{}{
					"type":        "string",
					"description": "Issue description (supports Markdown)",
				},
				"priority": map[string]interface{}{
					"type":        "number",
					"description": "Priority (0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low)",
				},
			},
			"required": []string{"team_id", "title"},
		},
		Execute: executeLinearCreateIssue,
	}
}

// NewLinearUpdateIssueTool creates a tool for updating Linear issues
func NewLinearUpdateIssueTool() *Tool {
	return &Tool{
		Name:        "linear_update_issue",
		DisplayName: "Update Linear Issue",
		Description: "Update an existing issue in Linear. Authentication is handled automatically.",
		Icon:        "Edit",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"linear", "issue", "update", "edit", "modify"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"issue_id": map[string]interface{}{
					"type":        "string",
					"description": "Issue ID to update",
				},
				"title": map[string]interface{}{
					"type":        "string",
					"description": "New title",
				},
				"description": map[string]interface{}{
					"type":        "string",
					"description": "New description",
				},
				"state_id": map[string]interface{}{
					"type":        "string",
					"description": "New state ID",
				},
				"priority": map[string]interface{}{
					"type":        "number",
					"description": "New priority (0-4)",
				},
			},
			"required": []string{"issue_id"},
		},
		Execute: executeLinearUpdateIssue,
	}
}

func linearRequest(query string, variables map[string]interface{}, token string) (map[string]interface{}, error) {
	body := map[string]interface{}{
		"query":     query,
		"variables": variables,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", linearAPIBase, bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", "application/json")

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

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if errors, ok := result["errors"].([]interface{}); ok && len(errors) > 0 {
		if errObj, ok := errors[0].(map[string]interface{}); ok {
			if msg, ok := errObj["message"].(string); ok {
				return nil, fmt.Errorf("Linear API error: %s", msg)
			}
		}
		return nil, fmt.Errorf("Linear API error")
	}

	data, ok := result["data"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("unexpected response format")
	}

	return data, nil
}

func executeLinearIssues(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "linear", "api_key")
	if err != nil {
		return "", fmt.Errorf("failed to get Linear token: %w", err)
	}

	limit := 50
	if l, ok := args["limit"].(float64); ok && l > 0 {
		limit = int(l)
		if limit > 100 {
			limit = 100
		}
	}

	// Build filter
	filter := ""
	if teamKey, ok := args["team_key"].(string); ok && teamKey != "" {
		filter = fmt.Sprintf(`team: { key: { eq: "%s" } }`, teamKey)
	}
	if state, ok := args["state"].(string); ok && state != "" {
		if filter != "" {
			filter += ", "
		}
		filter += fmt.Sprintf(`state: { name: { eq: "%s" } }`, state)
	}

	filterClause := ""
	if filter != "" {
		filterClause = fmt.Sprintf(", filter: { %s }", filter)
	}

	query := fmt.Sprintf(`
		query {
			issues(first: %d%s) {
				nodes {
					id
					identifier
					title
					description
					priority
					state {
						name
					}
					team {
						key
						name
					}
					createdAt
					updatedAt
				}
			}
		}
	`, limit, filterClause)

	data, err := linearRequest(query, nil, token)
	if err != nil {
		return "", err
	}

	issues, ok := data["issues"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("unexpected response format")
	}

	nodes, ok := issues["nodes"].([]interface{})
	if !ok {
		nodes = []interface{}{}
	}

	simplifiedIssues := make([]map[string]interface{}, 0)
	for _, n := range nodes {
		issue, ok := n.(map[string]interface{})
		if !ok {
			continue
		}
		simplified := map[string]interface{}{
			"id":         issue["id"],
			"identifier": issue["identifier"],
			"title":      issue["title"],
			"priority":   issue["priority"],
			"created_at": issue["createdAt"],
			"updated_at": issue["updatedAt"],
		}
		if state, ok := issue["state"].(map[string]interface{}); ok {
			simplified["state"] = state["name"]
		}
		if team, ok := issue["team"].(map[string]interface{}); ok {
			simplified["team"] = team["key"]
		}
		simplifiedIssues = append(simplifiedIssues, simplified)
	}

	response := map[string]interface{}{
		"success": true,
		"count":   len(simplifiedIssues),
		"issues":  simplifiedIssues,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeLinearCreateIssue(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "linear", "api_key")
	if err != nil {
		return "", fmt.Errorf("failed to get Linear token: %w", err)
	}

	teamID, _ := args["team_id"].(string)
	title, _ := args["title"].(string)

	if teamID == "" || title == "" {
		return "", fmt.Errorf("team_id and title are required")
	}

	variables := map[string]interface{}{
		"teamId": teamID,
		"title":  title,
	}

	if desc, ok := args["description"].(string); ok && desc != "" {
		variables["description"] = desc
	}
	if priority, ok := args["priority"].(float64); ok {
		variables["priority"] = int(priority)
	}

	query := `
		mutation IssueCreate($teamId: String!, $title: String!, $description: String, $priority: Int) {
			issueCreate(input: { teamId: $teamId, title: $title, description: $description, priority: $priority }) {
				success
				issue {
					id
					identifier
					title
					url
				}
			}
		}
	`

	data, err := linearRequest(query, variables, token)
	if err != nil {
		return "", err
	}

	issueCreate, ok := data["issueCreate"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("unexpected response format")
	}

	issue, _ := issueCreate["issue"].(map[string]interface{})

	response := map[string]interface{}{
		"success":    issueCreate["success"],
		"message":    "Issue created successfully",
		"issue_id":   issue["id"],
		"identifier": issue["identifier"],
		"title":      issue["title"],
		"url":        issue["url"],
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeLinearUpdateIssue(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "linear", "api_key")
	if err != nil {
		return "", fmt.Errorf("failed to get Linear token: %w", err)
	}

	issueID, _ := args["issue_id"].(string)
	if issueID == "" {
		return "", fmt.Errorf("issue_id is required")
	}

	variables := map[string]interface{}{
		"issueId": issueID,
	}

	input := map[string]interface{}{}
	if title, ok := args["title"].(string); ok && title != "" {
		input["title"] = title
	}
	if desc, ok := args["description"].(string); ok && desc != "" {
		input["description"] = desc
	}
	if stateID, ok := args["state_id"].(string); ok && stateID != "" {
		input["stateId"] = stateID
	}
	if priority, ok := args["priority"].(float64); ok {
		input["priority"] = int(priority)
	}

	if len(input) == 0 {
		return "", fmt.Errorf("at least one field to update is required")
	}

	variables["input"] = input

	query := `
		mutation IssueUpdate($issueId: String!, $input: IssueUpdateInput!) {
			issueUpdate(id: $issueId, input: $input) {
				success
				issue {
					id
					identifier
					title
					url
				}
			}
		}
	`

	data, err := linearRequest(query, variables, token)
	if err != nil {
		return "", err
	}

	issueUpdate, ok := data["issueUpdate"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("unexpected response format")
	}

	issue, _ := issueUpdate["issue"].(map[string]interface{})

	response := map[string]interface{}{
		"success":    issueUpdate["success"],
		"message":    "Issue updated successfully",
		"issue_id":   issue["id"],
		"identifier": issue["identifier"],
		"title":      issue["title"],
		"url":        issue["url"],
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

