package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// NewClickUpTasksTool creates a ClickUp tasks listing tool
func NewClickUpTasksTool() *Tool {
	return &Tool{
		Name:        "clickup_tasks",
		DisplayName: "ClickUp Tasks",
		Description: `List tasks from a ClickUp list.

Returns task details including name, status, assignees, and due dates.
Authentication is handled automatically via configured ClickUp API key.`,
		Icon:     "CheckSquare",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"clickup", "tasks", "list", "project", "management"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"list_id": map[string]interface{}{
					"type":        "string",
					"description": "The ClickUp list ID to get tasks from",
				},
				"archived": map[string]interface{}{
					"type":        "boolean",
					"description": "Include archived tasks",
				},
				"subtasks": map[string]interface{}{
					"type":        "boolean",
					"description": "Include subtasks",
				},
			},
			"required": []string{"list_id"},
		},
		Execute: executeClickUpTasks,
	}
}

// NewClickUpCreateTaskTool creates a ClickUp task creation tool
func NewClickUpCreateTaskTool() *Tool {
	return &Tool{
		Name:        "clickup_create_task",
		DisplayName: "Create ClickUp Task",
		Description: `Create a new task in a ClickUp list.

Supports setting name, description, status, priority, due date, assignees, and tags.
Authentication is handled automatically via configured ClickUp API key.`,
		Icon:     "Plus",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"clickup", "task", "create", "new", "project"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"list_id": map[string]interface{}{
					"type":        "string",
					"description": "The ClickUp list ID to create task in",
				},
				"name": map[string]interface{}{
					"type":        "string",
					"description": "The task name",
				},
				"description": map[string]interface{}{
					"type":        "string",
					"description": "The task description (supports markdown)",
				},
				"status": map[string]interface{}{
					"type":        "string",
					"description": "The task status",
				},
				"priority": map[string]interface{}{
					"type":        "number",
					"description": "Priority: 1 (Urgent), 2 (High), 3 (Normal), 4 (Low)",
				},
				"due_date": map[string]interface{}{
					"type":        "number",
					"description": "Due date as Unix timestamp in milliseconds",
				},
			},
			"required": []string{"list_id", "name"},
		},
		Execute: executeClickUpCreateTask,
	}
}

// NewClickUpUpdateTaskTool creates a ClickUp task update tool
func NewClickUpUpdateTaskTool() *Tool {
	return &Tool{
		Name:        "clickup_update_task",
		DisplayName: "Update ClickUp Task",
		Description: `Update an existing ClickUp task.

Can modify name, description, status, priority, due date, or archive status.
Authentication is handled automatically via configured ClickUp API key.`,
		Icon:     "Edit",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"clickup", "task", "update", "edit", "modify"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"task_id": map[string]interface{}{
					"type":        "string",
					"description": "The ClickUp task ID to update",
				},
				"name": map[string]interface{}{
					"type":        "string",
					"description": "The new task name",
				},
				"description": map[string]interface{}{
					"type":        "string",
					"description": "The new task description",
				},
				"status": map[string]interface{}{
					"type":        "string",
					"description": "The new task status",
				},
				"priority": map[string]interface{}{
					"type":        "number",
					"description": "Priority: 1 (Urgent), 2 (High), 3 (Normal), 4 (Low)",
				},
			},
			"required": []string{"task_id"},
		},
		Execute: executeClickUpUpdateTask,
	}
}

func executeClickUpTasks(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "clickup")
	if err != nil {
		return "", fmt.Errorf("failed to get ClickUp credentials: %w", err)
	}

	apiKey, _ := credData["api_key"].(string)
	if apiKey == "" {
		return "", fmt.Errorf("ClickUp API key not configured")
	}

	listID, _ := args["list_id"].(string)
	if listID == "" {
		return "", fmt.Errorf("'list_id' is required")
	}

	apiURL := fmt.Sprintf("https://api.clickup.com/api/v2/list/%s/task", listID)
	if archived, ok := args["archived"].(bool); ok && archived {
		apiURL += "?archived=true"
	}

	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Authorization", apiKey)
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
		if msg, ok := result["err"].(string); ok {
			errMsg = msg
		}
		return "", fmt.Errorf("ClickUp API error: %s", errMsg)
	}

	jsonResult, _ := json.MarshalIndent(result, "", "  ")
	return string(jsonResult), nil
}

func executeClickUpCreateTask(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "clickup")
	if err != nil {
		return "", fmt.Errorf("failed to get ClickUp credentials: %w", err)
	}

	apiKey, _ := credData["api_key"].(string)
	if apiKey == "" {
		return "", fmt.Errorf("ClickUp API key not configured")
	}

	listID, _ := args["list_id"].(string)
	name, _ := args["name"].(string)
	if listID == "" || name == "" {
		return "", fmt.Errorf("'list_id' and 'name' are required")
	}

	payload := map[string]interface{}{"name": name}
	if desc, ok := args["description"].(string); ok && desc != "" {
		payload["description"] = desc
	}
	if status, ok := args["status"].(string); ok && status != "" {
		payload["status"] = status
	}
	if priority, ok := args["priority"].(float64); ok && priority > 0 {
		payload["priority"] = int(priority)
	}
	if dueDate, ok := args["due_date"].(float64); ok && dueDate > 0 {
		payload["due_date"] = int64(dueDate)
	}

	jsonBody, _ := json.Marshal(payload)
	apiURL := fmt.Sprintf("https://api.clickup.com/api/v2/list/%s/task", listID)
	req, _ := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", apiKey)
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
		if msg, ok := result["err"].(string); ok {
			errMsg = msg
		}
		return "", fmt.Errorf("ClickUp API error: %s", errMsg)
	}

	output := map[string]interface{}{
		"success": true,
		"task":    result,
	}
	jsonResult, _ := json.MarshalIndent(output, "", "  ")
	return string(jsonResult), nil
}

func executeClickUpUpdateTask(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "clickup")
	if err != nil {
		return "", fmt.Errorf("failed to get ClickUp credentials: %w", err)
	}

	apiKey, _ := credData["api_key"].(string)
	if apiKey == "" {
		return "", fmt.Errorf("ClickUp API key not configured")
	}

	taskID, _ := args["task_id"].(string)
	if taskID == "" {
		return "", fmt.Errorf("'task_id' is required")
	}

	payload := make(map[string]interface{})
	if name, ok := args["name"].(string); ok && name != "" {
		payload["name"] = name
	}
	if desc, ok := args["description"].(string); ok && desc != "" {
		payload["description"] = desc
	}
	if status, ok := args["status"].(string); ok && status != "" {
		payload["status"] = status
	}
	if priority, ok := args["priority"].(float64); ok && priority > 0 {
		payload["priority"] = int(priority)
	}

	jsonBody, _ := json.Marshal(payload)
	apiURL := fmt.Sprintf("https://api.clickup.com/api/v2/task/%s", taskID)
	req, _ := http.NewRequest("PUT", apiURL, bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", apiKey)
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
		if msg, ok := result["err"].(string); ok {
			errMsg = msg
		}
		return "", fmt.Errorf("ClickUp API error: %s", errMsg)
	}

	output := map[string]interface{}{
		"success": true,
		"task":    result,
	}
	jsonResult, _ := json.MarshalIndent(output, "", "  ")
	return string(jsonResult), nil
}
