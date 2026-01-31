package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"
)

// maskSensitiveID masks a sensitive ID for safe logging (e.g., "acc_abc123xyz" -> "acc_...xyz")
func maskSensitiveID(id string) string {
	if len(id) <= 8 {
		return "***"
	}
	return id[:4] + "..." + id[len(id)-4:]
}

// composioRateLimiter implements per-user rate limiting for Composio API calls
type composioRateLimiter struct {
	requests map[string][]time.Time // userID -> timestamps
	mutex    sync.RWMutex
	maxCalls int           // max calls per window
	window   time.Duration // time window
}

var globalComposioRateLimiter = &composioRateLimiter{
	requests: make(map[string][]time.Time),
	maxCalls: 50,                 // 50 calls per minute per user
	window:   1 * time.Minute,
}

// checkRateLimit checks if user has exceeded rate limit
func (rl *composioRateLimiter) checkRateLimit(userID string) error {
	rl.mutex.Lock()
	defer rl.mutex.Unlock()

	now := time.Now()
	windowStart := now.Add(-rl.window)

	// Get user's request history
	timestamps := rl.requests[userID]

	// Remove timestamps outside window
	validTimestamps := []time.Time{}
	for _, ts := range timestamps {
		if ts.After(windowStart) {
			validTimestamps = append(validTimestamps, ts)
		}
	}

	// Check if limit exceeded
	if len(validTimestamps) >= rl.maxCalls {
		return fmt.Errorf("rate limit exceeded: max %d requests per minute", rl.maxCalls)
	}

	// Add current timestamp
	validTimestamps = append(validTimestamps, now)
	rl.requests[userID] = validTimestamps

	return nil
}

// checkComposioRateLimit checks rate limit using user ID from args
func checkComposioRateLimit(args map[string]interface{}) error {
	// Extract user ID from args (injected by chat service)
	userID, ok := args["__user_id__"].(string)
	if !ok || userID == "" {
		// If no user ID, allow but log warning
		log.Printf("⚠️ [COMPOSIO] No user ID for rate limiting")
		return nil
	}

	return globalComposioRateLimiter.checkRateLimit(userID)
}

// NewComposioGoogleSheetsReadTool creates a tool for reading Google Sheets via Composio
func NewComposioGoogleSheetsReadTool() *Tool {
	return &Tool{
		Name:        "googlesheets_read",
		DisplayName: "Google Sheets - Read Range",
		Description: `Read data from a Google Sheets range via Composio.

Features:
- Read any range from a spreadsheet (e.g., "Sheet1!A1:D10")
- Returns data as 2D array
- Supports named sheets and ranges
- OAuth authentication handled by Composio

Use this to fetch data from Google Sheets for processing, analysis, or automation workflows.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "read", "data", "excel", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
				"range": map[string]interface{}{
					"type":        "string",
					"description": "Range to read (e.g., 'Sheet1!A1:D10' or 'Sheet1!A:D')",
				},
			},
			"required": []string{"spreadsheet_id", "range"},
		},
		Execute: executeComposioGoogleSheetsRead,
	}
}

// NewComposioGoogleSheetsWriteTool creates a tool for writing to Google Sheets via Composio
func NewComposioGoogleSheetsWriteTool() *Tool {
	return &Tool{
		Name:        "googlesheets_write",
		DisplayName: "Google Sheets - Write Range",
		Description: `Write data to a Google Sheets range via Composio.

Features:
- Write data to specific sheet (overwrites existing data)
- Supports 2D arrays for multiple rows/columns
- Can write formulas and formatted strings (uses USER_ENTERED mode)
- OAuth authentication handled by Composio

Use this to update Google Sheets with calculated results, API responses, or processed data.

Note: The range parameter should include the sheet name (e.g., 'Sheet1!A1:D10'). The sheet name will be automatically extracted.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "write", "update", "data", "excel", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
				"range": map[string]interface{}{
					"type":        "string",
					"description": "Sheet name and range to write (e.g., 'Sheet1!A1:D10'). Sheet name is required.",
				},
				"values": map[string]interface{}{
					"type":        "array",
					"description": "2D array of values to write [[row1], [row2], ...] or JSON string",
					"items": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "string", // Google Sheets values are read as strings
						},
					},
				},
			},
			"required": []string{"spreadsheet_id", "range", "values"},
		},
		Execute: executeComposioGoogleSheetsWrite,
	}
}

// NewComposioGoogleSheetsAppendTool creates a tool for appending to Google Sheets via Composio
func NewComposioGoogleSheetsAppendTool() *Tool {
	return &Tool{
		Name:        "googlesheets_append",
		DisplayName: "Google Sheets - Append Rows",
		Description: `Append rows to a Google Sheets spreadsheet via Composio.

Features:
- Appends rows to the end of the specified range
- Automatically finds the next empty row
- Supports multiple rows in one operation
- Uses USER_ENTERED mode (formulas are evaluated)
- OAuth authentication handled by Composio

Use this to add new data without overwriting existing content (logs, form responses, etc.).`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "append", "add", "insert", "data", "excel", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
				"range": map[string]interface{}{
					"type":        "string",
					"description": "Sheet name and column range to append to (e.g., 'Sheet1!A:D' or 'Sheet1')",
				},
				"values": map[string]interface{}{
					"type":        "array",
					"description": "2D array of values to append [[row1], [row2], ...] or JSON string",
					"items": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "string", // Google Sheets values are read as strings
						},
					},
				},
			},
			"required": []string{"spreadsheet_id", "range", "values"},
		},
		Execute: executeComposioGoogleSheetsAppend,
	}
}

func executeComposioGoogleSheetsRead(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING - Check per-user rate limit
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	// Get Composio credentials
	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	// Extract parameters
	spreadsheetID, _ := args["spreadsheet_id"].(string)
	rangeSpec, _ := args["range"].(string)

	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}
	if rangeSpec == "" {
		return "", fmt.Errorf("'range' is required")
	}

	// Call Composio API
	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	// Use exact parameter names from Composio docs
	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input": map[string]interface{}{
			"spreadsheet_id": spreadsheetID,
			"ranges":         []string{rangeSpec},
		},
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_BATCH_GET", payload)
}

func executeComposioGoogleSheetsWrite(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	// Get Composio credentials
	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	// Extract parameters
	spreadsheetID, _ := args["spreadsheet_id"].(string)
	rangeSpec, _ := args["range"].(string)
	values := args["values"]

	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}
	if rangeSpec == "" {
		return "", fmt.Errorf("'range' is required")
	}
	if values == nil {
		return "", fmt.Errorf("'values' is required")
	}

	// Parse values if it's a JSON string
	var valuesArray [][]interface{}
	switch v := values.(type) {
	case string:
		if err := json.Unmarshal([]byte(v), &valuesArray); err != nil {
			return "", fmt.Errorf("failed to parse values JSON: %w", err)
		}
	case []interface{}:
		// Convert to 2D array
		for _, row := range v {
			if rowArr, ok := row.([]interface{}); ok {
				valuesArray = append(valuesArray, rowArr)
			} else {
				// Single value row
				valuesArray = append(valuesArray, []interface{}{row})
			}
		}
	default:
		return "", fmt.Errorf("values must be array or JSON string")
	}

	// Extract sheet name from range (e.g., "Sheet1!A1:D10" -> "Sheet1")
	sheetName := "Sheet1"
	for i := 0; i < len(rangeSpec); i++ {
		if rangeSpec[i] == '!' {
			sheetName = rangeSpec[:i]
			break
		}
	}

	// Call Composio API
	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	// Use exact parameter names from Composio docs for GOOGLESHEETS_BATCH_UPDATE
	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input": map[string]interface{}{
			"spreadsheet_id":   spreadsheetID,
			"sheet_name":       sheetName,
			"values":           valuesArray,
			"valueInputOption": "USER_ENTERED", // Default value from docs
		},
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_BATCH_UPDATE", payload)
}

func executeComposioGoogleSheetsAppend(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	// Get Composio credentials
	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	// Extract parameters
	spreadsheetID, _ := args["spreadsheet_id"].(string)
	rangeSpec, _ := args["range"].(string)
	values := args["values"]

	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}
	if rangeSpec == "" {
		return "", fmt.Errorf("'range' is required")
	}
	if values == nil {
		return "", fmt.Errorf("'values' is required")
	}

	// Parse values if it's a JSON string
	var valuesArray [][]interface{}
	switch v := values.(type) {
	case string:
		if err := json.Unmarshal([]byte(v), &valuesArray); err != nil {
			return "", fmt.Errorf("failed to parse values JSON: %w", err)
		}
	case []interface{}:
		// Convert to 2D array
		for _, row := range v {
			if rowArr, ok := row.([]interface{}); ok {
				valuesArray = append(valuesArray, rowArr)
			} else {
				// Single value row
				valuesArray = append(valuesArray, []interface{}{row})
			}
		}
	default:
		return "", fmt.Errorf("values must be array or JSON string")
	}

	// Call Composio API
	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	// Use exact parameter names from Composio docs for GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND
	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input": map[string]interface{}{
			"spreadsheetId":    spreadsheetID,
			"range":            rangeSpec,
			"valueInputOption": "USER_ENTERED", // Required by docs
			"values":           valuesArray,
		},
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND", payload)
}

// NewComposioGoogleSheetsCreateTool creates a tool for creating new Google Sheets via Composio
func NewComposioGoogleSheetsCreateTool() *Tool {
	return &Tool{
		Name:        "googlesheets_create",
		DisplayName: "Google Sheets - Create Spreadsheet",
		Description: `Create a new Google Sheets spreadsheet via Composio.

Features:
- Creates a new spreadsheet in Google Drive
- Can specify custom title or use default
- Returns spreadsheet ID and URL
- OAuth authentication handled by Composio

Use this to create new spreadsheets for data storage, reports, or automation workflows.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "create", "new", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"title": map[string]interface{}{
					"type":        "string",
					"description": "Title for the new spreadsheet (optional, defaults to 'Untitled spreadsheet')",
				},
			},
			"required": []string{},
		},
		Execute: executeComposioGoogleSheetsCreate,
	}
}

func executeComposioGoogleSheetsCreate(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	// Get Composio credentials
	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	// Extract optional title parameter
	title, _ := args["title"].(string)

	// Call Composio API
	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	// Build payload based on whether title is provided
	input := map[string]interface{}{}
	if title != "" {
		input["title"] = title
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input":    input,
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_CREATE_GOOGLE_SHEET1", payload)
}

// NewComposioGoogleSheetsInfoTool creates a tool for getting spreadsheet metadata via Composio
func NewComposioGoogleSheetsInfoTool() *Tool {
	return &Tool{
		Name:        "googlesheets_get_info",
		DisplayName: "Google Sheets - Get Spreadsheet Info",
		Description: `Get comprehensive metadata for a Google Sheets spreadsheet via Composio.

Features:
- Returns spreadsheet title, locale, timezone
- Lists all sheets/worksheets with their properties
- Gets sheet dimensions and tab colors
- OAuth authentication handled by Composio

Use this to discover sheet names, understand spreadsheet structure, or validate spreadsheet existence.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "info", "metadata", "sheets list", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
			},
			"required": []string{"spreadsheet_id"},
		},
		Execute: executeComposioGoogleSheetsInfo,
	}
}

func executeComposioGoogleSheetsInfo(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	spreadsheetID, _ := args["spreadsheet_id"].(string)
	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input": map[string]interface{}{
			"spreadsheet_id": spreadsheetID,
		},
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_GET_SPREADSHEET_INFO", payload)
}

// NewComposioGoogleSheetsListSheetsTool creates a tool for listing sheet names via Composio
func NewComposioGoogleSheetsListSheetsTool() *Tool {
	return &Tool{
		Name:        "googlesheets_list_sheets",
		DisplayName: "Google Sheets - List Sheet Names",
		Description: `List all worksheet names in a Google Spreadsheet via Composio.

Features:
- Returns array of all sheet/tab names in order
- Fast, lightweight operation (no cell data)
- Useful before reading/writing to specific sheets
- OAuth authentication handled by Composio

Use this to discover available sheets or validate sheet existence before operations.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "list", "tabs", "worksheets", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
			},
			"required": []string{"spreadsheet_id"},
		},
		Execute: executeComposioGoogleSheetsListSheets,
	}
}

func executeComposioGoogleSheetsListSheets(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	spreadsheetID, _ := args["spreadsheet_id"].(string)
	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input": map[string]interface{}{
			"spreadsheet_id": spreadsheetID,
		},
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_GET_SHEET_NAMES", payload)
}

// NewComposioGoogleSheetsSearchTool creates a tool for searching spreadsheets via Composio
func NewComposioGoogleSheetsSearchTool() *Tool {
	return &Tool{
		Name:        "googlesheets_search",
		DisplayName: "Google Sheets - Search Spreadsheets",
		Description: `Search for Google Spreadsheets using filters via Composio.

Features:
- Search by name, content, or metadata
- Filter by creation/modification date
- Find shared or starred spreadsheets
- Returns spreadsheet IDs and metadata
- OAuth authentication handled by Composio

Use this to find spreadsheets by name when you don't have the ID, or discover available sheets.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "search", "find", "discover", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"query": map[string]interface{}{
					"type":        "string",
					"description": "Search query (searches in name and content)",
				},
				"max_results": map[string]interface{}{
					"type":        "integer",
					"description": "Maximum number of results to return (default: 10)",
				},
			},
			"required": []string{},
		},
		Execute: executeComposioGoogleSheetsSearch,
	}
}

func executeComposioGoogleSheetsSearch(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	// Build input parameters
	input := map[string]interface{}{}

	if query, ok := args["query"].(string); ok && query != "" {
		input["query"] = query
	}

	if maxResults, ok := args["max_results"].(float64); ok {
		input["max_results"] = int(maxResults)
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input":    input,
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_SEARCH_SPREADSHEETS", payload)
}

// NewComposioGoogleSheetsClearTool creates a tool for clearing cell values via Composio
func NewComposioGoogleSheetsClearTool() *Tool {
	return &Tool{
		Name:        "googlesheets_clear",
		DisplayName: "Google Sheets - Clear Values",
		Description: `Clear cell content from a range in Google Sheets via Composio.

Features:
- Clears cell values but preserves formatting
- Preserves cell notes/comments
- Clears formulas and data
- Supports A1 notation ranges
- OAuth authentication handled by Composio

Use this to clear data from specific ranges while keeping cell formatting intact.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "clear", "delete", "erase", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
				"range": map[string]interface{}{
					"type":        "string",
					"description": "Range to clear (e.g., 'Sheet1!A1:D10' or 'Sheet1!A:D')",
				},
			},
			"required": []string{"spreadsheet_id", "range"},
		},
		Execute: executeComposioGoogleSheetsClear,
	}
}

func executeComposioGoogleSheetsClear(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	spreadsheetID, _ := args["spreadsheet_id"].(string)
	rangeSpec, _ := args["range"].(string)

	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}
	if rangeSpec == "" {
		return "", fmt.Errorf("'range' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input": map[string]interface{}{
			"spreadsheet_id": spreadsheetID,
			"range":          rangeSpec,
		},
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_CLEAR_VALUES", payload)
}

// NewComposioGoogleSheetsAddSheetTool creates a tool for adding new sheets via Composio
func NewComposioGoogleSheetsAddSheetTool() *Tool {
	return &Tool{
		Name:        "googlesheets_add_sheet",
		DisplayName: "Google Sheets - Add Sheet",
		Description: `Add a new worksheet/tab to an existing Google Spreadsheet via Composio.

Features:
- Creates new sheet within existing spreadsheet
- Can specify sheet title
- Can set initial row/column count
- Can set tab color
- OAuth authentication handled by Composio

Use this to add new tabs/worksheets to organize data in existing spreadsheets.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "add", "create", "tab", "worksheet", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
				"title": map[string]interface{}{
					"type":        "string",
					"description": "Title for the new sheet (default: 'Sheet{N}')",
				},
			},
			"required": []string{"spreadsheet_id"},
		},
		Execute: executeComposioGoogleSheetsAddSheet,
	}
}

func executeComposioGoogleSheetsAddSheet(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	spreadsheetID, _ := args["spreadsheet_id"].(string)
	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	// Build input with optional title
	input := map[string]interface{}{
		"spreadsheetId": spreadsheetID,
	}

	// Add optional properties
	properties := map[string]interface{}{}
	if title, ok := args["title"].(string); ok && title != "" {
		properties["title"] = title
	}

	if len(properties) > 0 {
		input["properties"] = properties
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input":    input,
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_ADD_SHEET", payload)
}

// NewComposioGoogleSheetsDeleteSheetTool creates a tool for deleting sheets via Composio
func NewComposioGoogleSheetsDeleteSheetTool() *Tool {
	return &Tool{
		Name:        "googlesheets_delete_sheet",
		DisplayName: "Google Sheets - Delete Sheet",
		Description: `Delete a worksheet/tab from a Google Spreadsheet via Composio.

Features:
- Permanently removes a sheet from spreadsheet
- Requires sheet ID (numeric ID, not name)
- Cannot delete the last remaining sheet
- OAuth authentication handled by Composio

Use this to remove unwanted worksheets. Get sheet ID from 'googlesheets_get_info' first.

WARNING: This action is permanent and cannot be undone!`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "delete", "remove", "tab", "worksheet", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
				"sheet_id": map[string]interface{}{
					"type":        "integer",
					"description": "Numeric ID of the sheet to delete (get from googlesheets_get_info)",
				},
			},
			"required": []string{"spreadsheet_id", "sheet_id"},
		},
		Execute: executeComposioGoogleSheetsDeleteSheet,
	}
}

func executeComposioGoogleSheetsDeleteSheet(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	spreadsheetID, _ := args["spreadsheet_id"].(string)
	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}

	// Handle both float64 and int types for sheet_id
	var sheetID int
	switch v := args["sheet_id"].(type) {
	case float64:
		sheetID = int(v)
	case int:
		sheetID = v
	default:
		return "", fmt.Errorf("'sheet_id' must be a number")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input": map[string]interface{}{
			"spreadsheetId": spreadsheetID,
			"sheet_id":      sheetID,
		},
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_DELETE_SHEET", payload)
}

// NewComposioGoogleSheetsFindReplaceTool creates a tool for find and replace via Composio
func NewComposioGoogleSheetsFindReplaceTool() *Tool {
	return &Tool{
		Name:        "googlesheets_find_replace",
		DisplayName: "Google Sheets - Find and Replace",
		Description: `Find and replace text in a Google Spreadsheet via Composio.

Features:
- Find and replace across entire spreadsheet or specific sheets
- Case-sensitive or case-insensitive matching
- Match entire cell or partial content
- Supports regex patterns
- OAuth authentication handled by Composio

Use this to bulk update values, fix errors, or update formulas across your spreadsheet.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "find", "replace", "search", "update", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
				"find": map[string]interface{}{
					"type":        "string",
					"description": "Text or pattern to find",
				},
				"replace": map[string]interface{}{
					"type":        "string",
					"description": "Text to replace with",
				},
				"sheet_id": map[string]interface{}{
					"type":        "integer",
					"description": "Optional: Numeric sheet ID to limit search (omit for all sheets)",
				},
				"match_case": map[string]interface{}{
					"type":        "boolean",
					"description": "Whether to match case (default: false)",
				},
			},
			"required": []string{"spreadsheet_id", "find", "replace"},
		},
		Execute: executeComposioGoogleSheetsFindReplace,
	}
}

func executeComposioGoogleSheetsFindReplace(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	spreadsheetID, _ := args["spreadsheet_id"].(string)
	find, _ := args["find"].(string)
	replace, _ := args["replace"].(string)

	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}
	if find == "" {
		return "", fmt.Errorf("'find' is required")
	}
	if replace == "" {
		return "", fmt.Errorf("'replace' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	// Build input
	input := map[string]interface{}{
		"spreadsheetId": spreadsheetID,
		"find":          find,
		"replace":       replace,
	}

	// Add optional parameters
	if sheetID, ok := args["sheet_id"].(float64); ok {
		input["sheetId"] = int(sheetID)
	}
	if matchCase, ok := args["match_case"].(bool); ok {
		input["matchCase"] = matchCase
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input":    input,
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_FIND_REPLACE", payload)
}

// NewComposioGoogleSheetsUpsertRowsTool creates a tool for upserting rows via Composio
func NewComposioGoogleSheetsUpsertRowsTool() *Tool {
	return &Tool{
		Name:        "googlesheets_upsert_rows",
		DisplayName: "Google Sheets - Upsert Rows",
		Description: `Smart update/insert rows by matching a key column via Composio.

Features:
- Updates existing rows by matching key column
- Appends new rows if key not found
- Auto-adds missing columns to sheet
- Supports partial column updates
- Column order doesn't matter (auto-maps by header)
- Prevents duplicates
- OAuth authentication handled by Composio

Use this for CRM syncs, inventory updates, or any scenario where you want to update existing records or create new ones based on a unique identifier.

Example: Update contacts by email, inventory by SKU, leads by Lead ID, etc.`,
		Icon:     "FileSpreadsheet",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"google", "sheets", "spreadsheet", "upsert", "update", "insert", "merge", "sync", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"spreadsheet_id": map[string]interface{}{
					"type":        "string",
					"description": "Google Sheets spreadsheet ID (from the URL)",
				},
				"sheet_name": map[string]interface{}{
					"type":        "string",
					"description": "Name of the sheet/tab to upsert into",
				},
				"key_column": map[string]interface{}{
					"type":        "string",
					"description": "Column name to match on (e.g., 'Email', 'SKU', 'Lead ID')",
				},
				"rows": map[string]interface{}{
					"type":        "array",
					"description": "Array of row data arrays [[row1], [row2], ...]",
					"items": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "string", // Google Sheets values are read as strings
						},
					},
				},
				"headers": map[string]interface{}{
					"type":        "array",
					"description": "Optional: Array of column headers (if not provided, uses first row of sheet)",
					"items": map[string]interface{}{
						"type": "string",
					},
				},
			},
			"required": []string{"spreadsheet_id", "sheet_name", "rows"},
		},
		Execute: executeComposioGoogleSheetsUpsertRows,
	}
}

func executeComposioGoogleSheetsUpsertRows(args map[string]interface{}) (string, error) {
	// ✅ RATE LIMITING
	if err := checkComposioRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_googlesheets")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	spreadsheetID, _ := args["spreadsheet_id"].(string)
	sheetName, _ := args["sheet_name"].(string)
	rows := args["rows"]

	if spreadsheetID == "" {
		return "", fmt.Errorf("'spreadsheet_id' is required")
	}
	if sheetName == "" {
		return "", fmt.Errorf("'sheet_name' is required")
	}
	if rows == nil {
		return "", fmt.Errorf("'rows' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	// Build input
	input := map[string]interface{}{
		"spreadsheetId": spreadsheetID,
		"sheetName":     sheetName,
		"rows":          rows,
	}

	// Add optional parameters
	if keyColumn, ok := args["key_column"].(string); ok && keyColumn != "" {
		input["keyColumn"] = keyColumn
	}
	if headers, ok := args["headers"].([]interface{}); ok && len(headers) > 0 {
		input["headers"] = headers
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "googlesheets",
		"input":    input,
	}

	return callComposioAPI(composioAPIKey, "GOOGLESHEETS_UPSERT_ROWS", payload)
}

// getConnectedAccountID retrieves the connected account ID from Composio v3 API
func getConnectedAccountID(apiKey string, userID string, appName string) (string, error) {
	// Query v3 API to get connected accounts for this user (URL-safe to prevent injection)
	baseURL := "https://backend.composio.dev/api/v3/connected_accounts"
	params := url.Values{}
	params.Add("user_ids", userID)
	fullURL := baseURL + "?" + params.Encode()

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("x-api-key", apiKey)

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("Composio API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	// Parse v3 response
	var response struct {
		Items []struct {
			ID      string `json:"id"`
			Toolkit struct {
				Slug string `json:"slug"`
			} `json:"toolkit"`
			Deprecated struct {
				UUID string `json:"uuid"`
			} `json:"deprecated"`
		} `json:"items"`
	}

	if err := json.Unmarshal(respBody, &response); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	// Find the connected account for this app
	for _, account := range response.Items {
		if account.Toolkit.Slug == appName {
			// v2 execution endpoint needs the old UUID, not the new nano ID
			// Check if deprecated.uuid exists (for v2 compatibility)
			if account.Deprecated.UUID != "" {
				return account.Deprecated.UUID, nil
			}
			// Fall back to nano ID if UUID not available
			return account.ID, nil
		}
	}

	return "", fmt.Errorf("no connected account found for app '%s' and user '%s'", appName, userID)
}

// callComposioAPI makes a request to Composio's v3 API
func callComposioAPI(apiKey string, action string, payload map[string]interface{}) (string, error) {
	// v2 execution endpoint still works with v3 connected accounts
	url := "https://backend.composio.dev/api/v2/actions/" + action + "/execute"

	// Get params from payload
	entityID, _ := payload["entityId"].(string)
	appName, _ := payload["appName"].(string)
	input, _ := payload["input"].(map[string]interface{})

	// For v3, we need to find the connected account ID
	connectedAccountID, err := getConnectedAccountID(apiKey, entityID, appName)
	if err != nil {
		return "", fmt.Errorf("failed to get connected account ID: %w", err)
	}

	// Build v2 payload (v2 execution endpoint uses connectedAccountId with camelCase)
	v2Payload := map[string]interface{}{
		"connectedAccountId": connectedAccountID,
		"input":              input,
	}

	jsonData, err := json.Marshal(v2Payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	// ✅ SECURE LOGGING - Only log non-sensitive metadata
	log.Printf("🔍 [COMPOSIO] Action: %s, ConnectedAccount: %s", action, maskSensitiveID(connectedAccountID))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	// ✅ SECURITY FIX: Parse and log rate limit headers
	parseRateLimitHeaders(resp.Header, action)

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		// ✅ SECURE ERROR HANDLING - Log full details server-side, sanitize for user
		log.Printf("❌ [COMPOSIO] API error (status %d) for action %s", resp.StatusCode, action)

		// Handle rate limiting with specific error
		if resp.StatusCode == 429 {
			retryAfter := resp.Header.Get("Retry-After")
			if retryAfter != "" {
				log.Printf("⚠️ [COMPOSIO] Rate limited, retry after: %s seconds", retryAfter)
				return "", fmt.Errorf("rate limit exceeded, retry after %s seconds", retryAfter)
			}
			return "", fmt.Errorf("rate limit exceeded, please try again later")
		}

		// Don't expose internal Composio error details to users
		if resp.StatusCode >= 500 {
			return "", fmt.Errorf("external service error (status %d)", resp.StatusCode)
		}
		// Client errors (4xx) can be slightly more specific
		return "", fmt.Errorf("invalid request (status %d): check spreadsheet ID and permissions", resp.StatusCode)
	}

	// Parse response
	var apiResponse map[string]interface{}
	if err := json.Unmarshal(respBody, &apiResponse); err != nil {
		return string(respBody), nil
	}

	// Return formatted response
	result, _ := json.MarshalIndent(apiResponse, "", "  ")
	return string(result), nil
}

// parseRateLimitHeaders parses and logs rate limit headers from Composio API responses
func parseRateLimitHeaders(headers http.Header, action string) {
	limit := headers.Get("X-RateLimit-Limit")
	remaining := headers.Get("X-RateLimit-Remaining")
	reset := headers.Get("X-RateLimit-Reset")

	if limit != "" || remaining != "" || reset != "" {
		log.Printf("📊 [COMPOSIO] Rate limits for %s - Limit: %s, Remaining: %s, Reset: %s",
			action, limit, remaining, reset)

		// Warning if approaching rate limit
		if remaining != "" && limit != "" {
		remainingInt := 0
			limitInt := 0
			fmt.Sscanf(remaining, "%d", &remainingInt)
			fmt.Sscanf(limit, "%d", &limitInt)

			if limitInt > 0 {
				percentRemaining := float64(remainingInt) / float64(limitInt) * 100
				if percentRemaining < 20 {
					log.Printf("⚠️ [COMPOSIO] Rate limit warning: only %.1f%% remaining (%d/%d)",
						percentRemaining, remainingInt, limitInt)
				}
			}
		}
	}
}
