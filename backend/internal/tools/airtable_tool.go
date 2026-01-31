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

const airtableAPIBase = "https://api.airtable.com/v0"

// NewAirtableListTool creates a tool for listing Airtable records
func NewAirtableListTool() *Tool {
	return &Tool{
		Name:        "airtable_list",
		DisplayName: "List Airtable Records",
		Description: "List records from an Airtable table. Authentication is handled automatically via configured credentials.",
		Icon:        "Table",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"airtable", "database", "records", "list", "table"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"base_id": map[string]interface{}{
					"type":        "string",
					"description": "Airtable Base ID (e.g., appXXXXXXXXXXXXXX)",
				},
				"table_name": map[string]interface{}{
					"type":        "string",
					"description": "Table name or ID",
				},
				"view": map[string]interface{}{
					"type":        "string",
					"description": "Optional view name to filter records",
				},
				"max_records": map[string]interface{}{
					"type":        "number",
					"description": "Maximum number of records to return (default 100)",
				},
				"filter_formula": map[string]interface{}{
					"type":        "string",
					"description": "Airtable formula to filter records",
				},
			},
			"required": []string{"base_id", "table_name"},
		},
		Execute: executeAirtableList,
	}
}

// NewAirtableReadTool creates a tool for reading a single Airtable record
func NewAirtableReadTool() *Tool {
	return &Tool{
		Name:        "airtable_read",
		DisplayName: "Read Airtable Record",
		Description: "Read a single record from an Airtable table by ID. Authentication is handled automatically.",
		Icon:        "FileText",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"airtable", "database", "record", "read", "get"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"base_id": map[string]interface{}{
					"type":        "string",
					"description": "Airtable Base ID",
				},
				"table_name": map[string]interface{}{
					"type":        "string",
					"description": "Table name or ID",
				},
				"record_id": map[string]interface{}{
					"type":        "string",
					"description": "Record ID to retrieve",
				},
			},
			"required": []string{"base_id", "table_name", "record_id"},
		},
		Execute: executeAirtableRead,
	}
}

// NewAirtableCreateTool creates a tool for creating Airtable records
func NewAirtableCreateTool() *Tool {
	return &Tool{
		Name:        "airtable_create",
		DisplayName: "Create Airtable Record",
		Description: "Create a new record in an Airtable table. Authentication is handled automatically.",
		Icon:        "Plus",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"airtable", "database", "record", "create", "add"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"base_id": map[string]interface{}{
					"type":        "string",
					"description": "Airtable Base ID",
				},
				"table_name": map[string]interface{}{
					"type":        "string",
					"description": "Table name or ID",
				},
				"fields": map[string]interface{}{
					"type":        "object",
					"description": "Record fields as key-value pairs",
				},
			},
			"required": []string{"base_id", "table_name", "fields"},
		},
		Execute: executeAirtableCreate,
	}
}

// NewAirtableUpdateTool creates a tool for updating Airtable records
func NewAirtableUpdateTool() *Tool {
	return &Tool{
		Name:        "airtable_update",
		DisplayName: "Update Airtable Record",
		Description: "Update an existing record in an Airtable table. Authentication is handled automatically.",
		Icon:        "Edit",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"airtable", "database", "record", "update", "edit"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"base_id": map[string]interface{}{
					"type":        "string",
					"description": "Airtable Base ID",
				},
				"table_name": map[string]interface{}{
					"type":        "string",
					"description": "Table name or ID",
				},
				"record_id": map[string]interface{}{
					"type":        "string",
					"description": "Record ID to update",
				},
				"fields": map[string]interface{}{
					"type":        "object",
					"description": "Fields to update as key-value pairs",
				},
			},
			"required": []string{"base_id", "table_name", "record_id", "fields"},
		},
		Execute: executeAirtableUpdate,
	}
}

func airtableRequest(method, endpoint, token string, body interface{}) (map[string]interface{}, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	req, err := http.NewRequest(method, airtableAPIBase+endpoint, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
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

	if resp.StatusCode >= 400 {
		errMsg := "Airtable API error"
		if errInfo, ok := result["error"].(map[string]interface{}); ok {
			if msg, ok := errInfo["message"].(string); ok {
				errMsg = msg
			}
		}
		return nil, fmt.Errorf("%s (status %d)", errMsg, resp.StatusCode)
	}

	return result, nil
}

func executeAirtableList(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "airtable", "api_key")
	if err != nil {
		return "", fmt.Errorf("failed to get Airtable token: %w", err)
	}

	baseID, _ := args["base_id"].(string)
	tableName, _ := args["table_name"].(string)

	if baseID == "" || tableName == "" {
		return "", fmt.Errorf("base_id and table_name are required")
	}

	// Build query params
	params := url.Values{}
	if view, ok := args["view"].(string); ok && view != "" {
		params.Set("view", view)
	}
	if maxRecords, ok := args["max_records"].(float64); ok && maxRecords > 0 {
		params.Set("maxRecords", fmt.Sprintf("%d", int(maxRecords)))
	}
	if filter, ok := args["filter_formula"].(string); ok && filter != "" {
		params.Set("filterByFormula", filter)
	}

	endpoint := fmt.Sprintf("/%s/%s", baseID, url.PathEscape(tableName))
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}

	result, err := airtableRequest("GET", endpoint, token, nil)
	if err != nil {
		return "", err
	}

	response := map[string]interface{}{
		"success": true,
		"records": result["records"],
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeAirtableRead(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "airtable", "api_key")
	if err != nil {
		return "", fmt.Errorf("failed to get Airtable token: %w", err)
	}

	baseID, _ := args["base_id"].(string)
	tableName, _ := args["table_name"].(string)
	recordID, _ := args["record_id"].(string)

	if baseID == "" || tableName == "" || recordID == "" {
		return "", fmt.Errorf("base_id, table_name, and record_id are required")
	}

	endpoint := fmt.Sprintf("/%s/%s/%s", baseID, url.PathEscape(tableName), recordID)
	result, err := airtableRequest("GET", endpoint, token, nil)
	if err != nil {
		return "", err
	}

	response := map[string]interface{}{
		"success": true,
		"record":  result,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeAirtableCreate(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "airtable", "api_key")
	if err != nil {
		return "", fmt.Errorf("failed to get Airtable token: %w", err)
	}

	baseID, _ := args["base_id"].(string)
	tableName, _ := args["table_name"].(string)
	fields, _ := args["fields"].(map[string]interface{})

	if baseID == "" || tableName == "" || len(fields) == 0 {
		return "", fmt.Errorf("base_id, table_name, and fields are required")
	}

	endpoint := fmt.Sprintf("/%s/%s", baseID, url.PathEscape(tableName))
	body := map[string]interface{}{"fields": fields}

	result, err := airtableRequest("POST", endpoint, token, body)
	if err != nil {
		return "", err
	}

	response := map[string]interface{}{
		"success":   true,
		"message":   "Record created successfully",
		"record_id": result["id"],
		"record":    result,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeAirtableUpdate(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "airtable", "api_key")
	if err != nil {
		return "", fmt.Errorf("failed to get Airtable token: %w", err)
	}

	baseID, _ := args["base_id"].(string)
	tableName, _ := args["table_name"].(string)
	recordID, _ := args["record_id"].(string)
	fields, _ := args["fields"].(map[string]interface{})

	if baseID == "" || tableName == "" || recordID == "" || len(fields) == 0 {
		return "", fmt.Errorf("base_id, table_name, record_id, and fields are required")
	}

	endpoint := fmt.Sprintf("/%s/%s/%s", baseID, url.PathEscape(tableName), recordID)
	body := map[string]interface{}{"fields": fields}

	result, err := airtableRequest("PATCH", endpoint, token, body)
	if err != nil {
		return "", err
	}

	response := map[string]interface{}{
		"success":   true,
		"message":   "Record updated successfully",
		"record_id": result["id"],
		"record":    result,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

