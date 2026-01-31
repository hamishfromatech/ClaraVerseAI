package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	githubAPIBase    = "https://api.github.com"
	githubAPIVersion = "2022-11-28"
)

// NewGitHubCreateIssueTool creates a tool for creating GitHub issues
func NewGitHubCreateIssueTool() *Tool {
	return &Tool{
		Name:        "github_create_issue",
		DisplayName: "Create GitHub Issue",
		Description: "Create a new issue in a GitHub repository. Use this to report bugs, request features, or create tasks. Authentication is handled automatically via configured credentials.",
		Icon:        "AlertCircle",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"github", "issue", "create", "bug", "feature", "task", "ticket"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"owner": map[string]interface{}{
					"type":        "string",
					"description": "Repository owner (username or organization)",
				},
				"repo": map[string]interface{}{
					"type":        "string",
					"description": "Repository name",
				},
				"title": map[string]interface{}{
					"type":        "string",
					"description": "Issue title",
				},
				"body": map[string]interface{}{
					"type":        "string",
					"description": "Issue body/description (supports Markdown)",
				},
				"labels": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": "string"},
					"description": "Labels to apply (e.g., ['bug', 'priority:high'])",
				},
				"assignees": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": "string"},
					"description": "GitHub usernames to assign",
				},
			},
			"required": []string{"owner", "repo", "title"},
		},
		Execute: executeGitHubCreateIssue,
	}
}

// NewGitHubListIssuesTool creates a tool for listing GitHub issues
func NewGitHubListIssuesTool() *Tool {
	return &Tool{
		Name:        "github_list_issues",
		DisplayName: "List GitHub Issues",
		Description: "List issues from a GitHub repository with optional filtering by state, labels, assignee, etc. Authentication is handled automatically.",
		Icon:        "List",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"github", "issues", "list", "search", "bugs", "tasks"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"owner": map[string]interface{}{
					"type":        "string",
					"description": "Repository owner (username or organization)",
				},
				"repo": map[string]interface{}{
					"type":        "string",
					"description": "Repository name",
				},
				"state": map[string]interface{}{
					"type":        "string",
					"enum":        []string{"open", "closed", "all"},
					"description": "Filter by state (default: open)",
				},
				"labels": map[string]interface{}{
					"type":        "string",
					"description": "Comma-separated list of labels to filter by",
				},
				"assignee": map[string]interface{}{
					"type":        "string",
					"description": "Filter by assignee username (use '*' for any, 'none' for unassigned)",
				},
				"sort": map[string]interface{}{
					"type":        "string",
					"enum":        []string{"created", "updated", "comments"},
					"description": "Sort by (default: created)",
				},
				"direction": map[string]interface{}{
					"type":        "string",
					"enum":        []string{"asc", "desc"},
					"description": "Sort direction (default: desc)",
				},
				"per_page": map[string]interface{}{
					"type":        "number",
					"description": "Results per page (max 100, default 10)",
				},
			},
			"required": []string{"owner", "repo"},
		},
		Execute: executeGitHubListIssues,
	}
}

// NewGitHubGetRepoTool creates a tool for getting repository info
func NewGitHubGetRepoTool() *Tool {
	return &Tool{
		Name:        "github_get_repo",
		DisplayName: "Get GitHub Repository",
		Description: "Get information about a GitHub repository including stats, description, and metadata. Authentication is handled automatically.",
		Icon:        "GitBranch",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"github", "repository", "repo", "info", "stats"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"owner": map[string]interface{}{
					"type":        "string",
					"description": "Repository owner (username or organization)",
				},
				"repo": map[string]interface{}{
					"type":        "string",
					"description": "Repository name",
				},
			},
			"required": []string{"owner", "repo"},
		},
		Execute: executeGitHubGetRepo,
	}
}

// NewGitHubAddCommentTool creates a tool for adding comments to issues/PRs
func NewGitHubAddCommentTool() *Tool {
	return &Tool{
		Name:        "github_add_comment",
		DisplayName: "Add GitHub Comment",
		Description: "Add a comment to a GitHub issue or pull request. Use this to provide feedback, updates, or responses. Authentication is handled automatically.",
		Icon:        "MessageSquare",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"github", "comment", "issue", "pr", "pull request", "reply"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"owner": map[string]interface{}{
					"type":        "string",
					"description": "Repository owner (username or organization)",
				},
				"repo": map[string]interface{}{
					"type":        "string",
					"description": "Repository name",
				},
				"issue_number": map[string]interface{}{
					"type":        "number",
					"description": "Issue or PR number to comment on",
				},
				"body": map[string]interface{}{
					"type":        "string",
					"description": "Comment body (supports Markdown)",
				},
			},
			"required": []string{"owner", "repo", "issue_number", "body"},
		},
		Execute: executeGitHubAddComment,
	}
}

// Helper function to make GitHub API requests
func githubRequest(method, endpoint, token string, body interface{}) (map[string]interface{}, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	req, err := http.NewRequest(method, githubAPIBase+endpoint, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", githubAPIVersion)
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

	// Handle empty response (like 204 No Content)
	if len(respBody) == 0 {
		return map[string]interface{}{"success": true}, nil
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		// Try parsing as array (for list endpoints)
		var arrayResult []interface{}
		if err2 := json.Unmarshal(respBody, &arrayResult); err2 == nil {
			return map[string]interface{}{"items": arrayResult}, nil
		}
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if resp.StatusCode >= 400 {
		errMsg := "GitHub API error"
		if msg, ok := result["message"].(string); ok {
			errMsg = msg
		}
		return nil, fmt.Errorf("%s (status %d)", errMsg, resp.StatusCode)
	}

	return result, nil
}

// Simplify GitHub issue for cleaner output
func simplifyGitHubIssue(issue map[string]interface{}) map[string]interface{} {
	simplified := map[string]interface{}{
		"number": issue["number"],
		"title":  issue["title"],
		"state":  issue["state"],
		"url":    issue["html_url"],
	}

	if body, ok := issue["body"].(string); ok {
		// Truncate long bodies
		if len(body) > 500 {
			body = body[:497] + "..."
		}
		simplified["body"] = body
	}

	// Extract user
	if user, ok := issue["user"].(map[string]interface{}); ok {
		simplified["author"] = user["login"]
	}

	// Extract labels
	if labels, ok := issue["labels"].([]interface{}); ok {
		labelNames := make([]string, 0, len(labels))
		for _, l := range labels {
			if label, ok := l.(map[string]interface{}); ok {
				if name, ok := label["name"].(string); ok {
					labelNames = append(labelNames, name)
				}
			}
		}
		if len(labelNames) > 0 {
			simplified["labels"] = labelNames
		}
	}

	// Extract assignees
	if assignees, ok := issue["assignees"].([]interface{}); ok {
		assigneeNames := make([]string, 0, len(assignees))
		for _, a := range assignees {
			if assignee, ok := a.(map[string]interface{}); ok {
				if login, ok := assignee["login"].(string); ok {
					assigneeNames = append(assigneeNames, login)
				}
			}
		}
		if len(assigneeNames) > 0 {
			simplified["assignees"] = assigneeNames
		}
	}

	// Timestamps
	if created, ok := issue["created_at"].(string); ok {
		simplified["created_at"] = created
	}
	if updated, ok := issue["updated_at"].(string); ok {
		simplified["updated_at"] = updated
	}

	// Comments count
	if comments, ok := issue["comments"].(float64); ok {
		simplified["comments_count"] = int(comments)
	}

	// Check if PR
	if _, ok := issue["pull_request"]; ok {
		simplified["is_pull_request"] = true
	}

	return simplified
}

func executeGitHubCreateIssue(args map[string]interface{}) (string, error) {
	// Resolve API token
	token, err := ResolveAPIKey(args, "github", "personal_access_token")
	if err != nil {
		return "", fmt.Errorf("failed to get GitHub token: %w", err)
	}

	owner, _ := args["owner"].(string)
	repo, _ := args["repo"].(string)
	title, _ := args["title"].(string)

	if owner == "" || repo == "" || title == "" {
		return "", fmt.Errorf("owner, repo, and title are required")
	}

	// Build request body
	body := map[string]interface{}{
		"title": title,
	}

	if issueBody, ok := args["body"].(string); ok && issueBody != "" {
		body["body"] = issueBody
	}

	if labels, ok := args["labels"].([]interface{}); ok && len(labels) > 0 {
		body["labels"] = labels
	}

	if assignees, ok := args["assignees"].([]interface{}); ok && len(assignees) > 0 {
		body["assignees"] = assignees
	}

	// Make API request
	endpoint := fmt.Sprintf("/repos/%s/%s/issues", owner, repo)
	result, err := githubRequest("POST", endpoint, token, body)
	if err != nil {
		return "", err
	}

	// Build response
	response := map[string]interface{}{
		"success":      true,
		"message":      "Issue created successfully",
		"issue_number": result["number"],
		"url":          result["html_url"],
		"title":        result["title"],
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeGitHubListIssues(args map[string]interface{}) (string, error) {
	// Resolve API token
	token, err := ResolveAPIKey(args, "github", "personal_access_token")
	if err != nil {
		return "", fmt.Errorf("failed to get GitHub token: %w", err)
	}

	owner, _ := args["owner"].(string)
	repo, _ := args["repo"].(string)

	if owner == "" || repo == "" {
		return "", fmt.Errorf("owner and repo are required")
	}

	// Build query parameters
	params := []string{}

	if state, ok := args["state"].(string); ok && state != "" {
		params = append(params, "state="+state)
	}
	if labels, ok := args["labels"].(string); ok && labels != "" {
		params = append(params, "labels="+labels)
	}
	if assignee, ok := args["assignee"].(string); ok && assignee != "" {
		params = append(params, "assignee="+assignee)
	}
	if sort, ok := args["sort"].(string); ok && sort != "" {
		params = append(params, "sort="+sort)
	}
	if direction, ok := args["direction"].(string); ok && direction != "" {
		params = append(params, "direction="+direction)
	}

	perPage := 10
	if pp, ok := args["per_page"].(float64); ok && pp > 0 {
		perPage = int(pp)
		if perPage > 100 {
			perPage = 100
		}
	}
	params = append(params, fmt.Sprintf("per_page=%d", perPage))

	// Build endpoint
	endpoint := fmt.Sprintf("/repos/%s/%s/issues", owner, repo)
	if len(params) > 0 {
		endpoint += "?" + strings.Join(params, "&")
	}

	// Make API request
	result, err := githubRequest("GET", endpoint, token, nil)
	if err != nil {
		return "", err
	}

	// Process results
	response := map[string]interface{}{
		"owner":       owner,
		"repo":        repo,
		"total_found": 0,
		"issues":      []interface{}{},
	}

	if items, ok := result["items"].([]interface{}); ok {
		response["total_found"] = len(items)
		simplifiedIssues := make([]interface{}, 0, len(items))
		for _, item := range items {
			if issue, ok := item.(map[string]interface{}); ok {
				simplifiedIssues = append(simplifiedIssues, simplifyGitHubIssue(issue))
			}
		}
		response["issues"] = simplifiedIssues
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeGitHubGetRepo(args map[string]interface{}) (string, error) {
	// Resolve API token
	token, err := ResolveAPIKey(args, "github", "personal_access_token")
	if err != nil {
		return "", fmt.Errorf("failed to get GitHub token: %w", err)
	}

	owner, _ := args["owner"].(string)
	repo, _ := args["repo"].(string)

	if owner == "" || repo == "" {
		return "", fmt.Errorf("owner and repo are required")
	}

	// Make API request
	endpoint := fmt.Sprintf("/repos/%s/%s", owner, repo)
	result, err := githubRequest("GET", endpoint, token, nil)
	if err != nil {
		return "", err
	}

	// Simplify response
	response := map[string]interface{}{
		"name":          result["name"],
		"full_name":     result["full_name"],
		"description":   result["description"],
		"url":           result["html_url"],
		"private":       result["private"],
		"default_branch": result["default_branch"],
		"language":      result["language"],
		"stars":         result["stargazers_count"],
		"forks":         result["forks_count"],
		"open_issues":   result["open_issues_count"],
		"watchers":      result["watchers_count"],
		"created_at":    result["created_at"],
		"updated_at":    result["updated_at"],
		"pushed_at":     result["pushed_at"],
	}

	// Owner info
	if ownerInfo, ok := result["owner"].(map[string]interface{}); ok {
		response["owner"] = map[string]interface{}{
			"login":      ownerInfo["login"],
			"type":       ownerInfo["type"],
			"avatar_url": ownerInfo["avatar_url"],
		}
	}

	// Topics
	if topics, ok := result["topics"].([]interface{}); ok && len(topics) > 0 {
		response["topics"] = topics
	}

	// License
	if license, ok := result["license"].(map[string]interface{}); ok {
		response["license"] = license["spdx_id"]
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeGitHubAddComment(args map[string]interface{}) (string, error) {
	// Resolve API token
	token, err := ResolveAPIKey(args, "github", "personal_access_token")
	if err != nil {
		return "", fmt.Errorf("failed to get GitHub token: %w", err)
	}

	owner, _ := args["owner"].(string)
	repo, _ := args["repo"].(string)
	issueNumber, _ := args["issue_number"].(float64)
	body, _ := args["body"].(string)

	if owner == "" || repo == "" || issueNumber == 0 || body == "" {
		return "", fmt.Errorf("owner, repo, issue_number, and body are required")
	}

	// Make API request
	endpoint := fmt.Sprintf("/repos/%s/%s/issues/%d/comments", owner, repo, int(issueNumber))
	result, err := githubRequest("POST", endpoint, token, map[string]interface{}{
		"body": body,
	})
	if err != nil {
		return "", err
	}

	// Build response
	response := map[string]interface{}{
		"success":      true,
		"message":      "Comment added successfully",
		"comment_id":   result["id"],
		"url":          result["html_url"],
		"issue_number": int(issueNumber),
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}
