package tools

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// composioSharePointRateLimiter implements per-user rate limiting for Composio SharePoint API calls
type composioSharePointRateLimiter struct {
	requests map[string][]time.Time
	mutex    sync.RWMutex
	maxCalls int
	window   time.Duration
}

var globalSharePointRateLimiter = &composioSharePointRateLimiter{
	requests: make(map[string][]time.Time),
	maxCalls: 30,
	window:   1 * time.Minute,
}

// checkSharePointRateLimit checks rate limit using user ID from args
func checkSharePointRateLimit(args map[string]interface{}) error {
	userID, ok := args["__user_id__"].(string)
	if !ok || userID == "" {
		log.Printf("⚠️ [SHAREPOINT] No user ID for rate limiting")
		return nil
	}

	globalSharePointRateLimiter.mutex.Lock()
	defer globalSharePointRateLimiter.mutex.Unlock()

	now := time.Now()
	windowStart := now.Add(-globalSharePointRateLimiter.window)

	timestamps := globalSharePointRateLimiter.requests[userID]
	validTimestamps := []time.Time{}
	for _, ts := range timestamps {
		if ts.After(windowStart) {
			validTimestamps = append(validTimestamps, ts)
		}
	}

	if len(validTimestamps) >= globalSharePointRateLimiter.maxCalls {
		return fmt.Errorf("rate limit exceeded: max %d requests per minute", globalSharePointRateLimiter.maxCalls)
	}

	validTimestamps = append(validTimestamps, now)
	globalSharePointRateLimiter.requests[userID] = validTimestamps
	return nil
}

// NewComposioSharePointListSitesTool creates a tool for listing SharePoint sites
func NewComposioSharePointListSitesTool() *Tool {
	return &Tool{
		Name:        "sharepoint_list_sites",
		DisplayName: "SharePoint - List Sites",
		Description: `List all SharePoint sites accessible to the user.

Features:
- Returns all sites the user has access to
- Includes site ID, name, and URL
- OAuth authentication handled by Composio

Use this to discover available SharePoint sites.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "sites", "list", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
			},
			"required": []string{},
		},
		Execute: executeComposioSharePointListSites,
	}
}

func executeComposioSharePointListSites(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
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

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input":    map[string]interface{}{},
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_GET_SITE_COLLECTION_INFO", payload)
}

// NewComposioSharePointGetSiteTool creates a tool for getting a specific SharePoint site
func NewComposioSharePointGetSiteTool() *Tool {
	return &Tool{
		Name:        "sharepoint_get_site",
		DisplayName: "SharePoint - Get Site",
		Description: `Get detailed information about a specific SharePoint site.

Features:
- Retrieve site metadata and configuration
- Get site ID, URL, and root web URI
- OAuth authentication handled by Composio

Use this to get detailed information about a specific SharePoint site.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "site", "get", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"site_id": map[string]interface{}{
					"type":        "string",
					"description": "The SharePoint site ID (e.g., domain.sharepoint.com:some-guid)",
				},
			},
			"required": []string{"site_id"},
		},
		Execute: executeComposioSharePointGetSite,
	}
}

func executeComposioSharePointGetSite(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	siteID, ok := args["site_id"].(string)
	if siteID == "" {
		return "", fmt.Errorf("'site_id' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input": map[string]interface{}{
			"site": siteID,
		},
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_GET_SITE_COLLECTION_INFO", payload)
}

// NewComposioSharePointListListsTool creates a tool for listing lists in a site
func NewComposioSharePointListListsTool() *Tool {
	return &Tool{
		Name:        "sharepoint_list_lists",
		DisplayName: "SharePoint - List Lists",
		Description: `List all SharePoint lists in a site.

Features:
- Get all lists including document libraries
- Returns list names, IDs, and metadata
- OAuth authentication handled by Composio

Use this to discover available lists in a SharePoint site.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "lists", "list", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"site_id": map[string]interface{}{
					"type":        "string",
					"description": "The SharePoint site ID (optional, defaults to current site)",
				},
			},
			"required": []string{},
		},
		Execute: executeComposioSharePointListLists,
	}
}

func executeComposioSharePointListLists(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
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

	input := map[string]interface{}{}
	if siteID, ok := args["site_id"].(string); ok && siteID != "" {
		input["site"] = siteID
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input":    input,
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_LIST_ALL_LISTS", payload)
}

// NewComposioSharePointGetListItemsTool creates a tool for getting list items
func NewComposioSharePointGetListItemsTool() *Tool {
	return &Tool{
		Name:        "sharepoint_get_list_items",
		DisplayName: "SharePoint - Get List Items",
		Description: `Retrieve items from a SharePoint list.

Features:
- Get items from any SharePoint list
- Supports OData parameters for filtering and sorting
- Pagination support with top and skip
- OAuth authentication handled by Composio

Use this to retrieve list entries with optional filtering.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "list", "items", "get", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"list_title": map[string]interface{}{
					"type":        "string",
					"description": "The title/name of the SharePoint list",
				},
				"top": map[string]interface{}{
					"type":        "integer",
					"description": "Maximum number of items to return (default: 100)",
				},
				"filter": map[string]interface{}{
					"type":        "string",
					"description": "OData filter string (e.g., 'Title eq \"My Item\"')",
				},
				"orderby": map[string]interface{}{
					"type":        "string",
					"description": "OData orderby string (e.g., 'Created desc')",
				},
			},
			"required": []string{"list_title"},
		},
		Execute: executeComposioSharePointGetListItems,
	}
}

func executeComposioSharePointGetListItems(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	listTitle, ok := args["list_title"].(string)
	if listTitle == "" {
		return "", fmt.Errorf("'list_title' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	input := map[string]interface{}{
		"list_title": listTitle,
	}

	if top, ok := args["top"].(float64); ok {
		input["top"] = int(top)
	}
	if filter, ok := args["filter"].(string); ok && filter != "" {
		input["filter"] = filter
	}
	if orderby, ok := args["orderby"].(string); ok && orderby != "" {
		input["orderby"] = orderby
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input":    input,
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_GET_LIST_ITEMS", payload)
}

// NewComposioSharePointCreateListItemTool creates a tool for creating list items
func NewComposioSharePointCreateListItemTool() *Tool {
	return &Tool{
		Name:        "sharepoint_create_list_item",
		DisplayName: "SharePoint - Create List Item",
		Description: `Create a new item in a SharePoint list.

Features:
- Add items to any SharePoint list
- Specify field values as key-value pairs
- OAuth authentication handled by Composio

Use this to create new entries in SharePoint lists.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "list", "create", "item", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"list_name": map[string]interface{}{
					"type":        "string",
					"description": "The name/title of the SharePoint list",
				},
				"item_properties": map[string]interface{}{
					"type":        "object",
					"description": "Field values as key-value pairs (e.g., {\"Title\": \"My Item\", \"Status\": \"Active\"})",
				},
			},
			"required": []string{"list_name", "item_properties"},
		},
		Execute: executeComposioSharePointCreateListItem,
	}
}

func executeComposioSharePointCreateListItem(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	listName, ok := args["list_name"].(string)
	if listName == "" {
		return "", fmt.Errorf("'list_name' is required")
	}

	itemProperties, ok := args["item_properties"].(map[string]interface{})
	if !ok || len(itemProperties) == 0 {
		return "", fmt.Errorf("'item_properties' is required and must be an object")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input": map[string]interface{}{
			"list_name":        listName,
			"item_properties": itemProperties,
		},
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_SHAREPOINT_CREATE_LIST_ITEM", payload)
}

// NewComposioSharePointUpdateListItemTool creates a tool for updating list items
func NewComposioSharePointUpdateListItemTool() *Tool {
	return &Tool{
		Name:        "sharepoint_update_list_item",
		DisplayName: "SharePoint - Update List Item",
		Description: `Update an existing item in a SharePoint list.

Features:
- Modify field values on existing list items
- Uses ETag for concurrency control
- OAuth authentication handled by Composio

Use this to update existing SharePoint list entries.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "list", "update", "item", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"list_title": map[string]interface{}{
					"type":        "string",
					"description": "The title/name of the SharePoint list",
				},
				"item_id": map[string]interface{}{
					"type":        "integer",
					"description": "The ID of the item to update",
				},
				"fields": map[string]interface{}{
					"type":        "object",
					"description": "Field values to update as key-value pairs",
				},
			},
			"required": []string{"list_title", "item_id", "fields"},
		},
		Execute: executeComposioSharePointUpdateListItem,
	}
}

func executeComposioSharePointUpdateListItem(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	listTitle, ok := args["list_title"].(string)
	if listTitle == "" {
		return "", fmt.Errorf("'list_title' is required")
	}

	itemIDFloat, ok := args["item_id"].(float64)
	if !ok {
		return "", fmt.Errorf("'item_id' is required and must be an integer")
	}
	itemID := int(itemIDFloat)

	fields, ok := args["fields"].(map[string]interface{})
	if !ok || len(fields) == 0 {
		return "", fmt.Errorf("'fields' is required and must be an object")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input": map[string]interface{}{
			"list_title": listTitle,
			"item_id":    itemID,
			"fields":     fields,
		},
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_UPDATE_LIST_ITEM", payload)
}

// NewComposioSharePointDeleteListItemTool creates a tool for deleting list items
func NewComposioSharePointDeleteListItemTool() *Tool {
	return &Tool{
		Name:        "sharepoint_delete_list_item",
		DisplayName: "SharePoint - Delete List Item",
		Description: `Delete an item from a SharePoint list.

Features:
- Permanently remove list items
- Uses match ETag for concurrency control
- OAuth authentication handled by Composio

Use this to delete items from SharePoint lists.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "list", "delete", "item", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"list_title": map[string]interface{}{
					"type":        "string",
					"description": "The title/name of the SharePoint list",
				},
				"item_id": map[string]interface{}{
					"type":        "integer",
					"description": "The ID of the item to delete",
				},
			},
			"required": []string{"list_title", "item_id"},
		},
		Execute: executeComposioSharePointDeleteListItem,
	}
}

func executeComposioSharePointDeleteListItem(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	listTitle, ok := args["list_title"].(string)
	if listTitle == "" {
		return "", fmt.Errorf("'list_title' is required")
	}

	itemIDFloat, ok := args["item_id"].(float64)
	if !ok {
		return "", fmt.Errorf("'item_id' is required and must be an integer")
	}
	itemID := int(itemIDFloat)

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input": map[string]interface{}{
			"list_title": listTitle,
			"item_id":    itemID,
		},
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_DELETE_LIST_ITEM", payload)
}

// NewComposioSharePointUploadFileTool creates a tool for uploading files
func NewComposioSharePointUploadFileTool() *Tool {
	return &Tool{
		Name:        "sharepoint_upload_file",
		DisplayName: "SharePoint - Upload File",
		Description: `Upload a file to a SharePoint document library or folder.

Features:
- Upload files to SharePoint document libraries
- Support for any file type
- Specify target folder by relative URL
- OAuth authentication handled by Composio

Use this to upload files to SharePoint.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "upload", "file", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"folder_relative_url": map[string]interface{}{
					"type":        "string",
					"description": "Server-relative URL of the target folder (e.g., '/Shared Documents')",
				},
				"file_content": map[string]interface{}{
					"type":        "string",
					"description": "Base64 encoded file content",
				},
				"file_name": map[string]interface{}{
					"type":        "string",
					"description": "Name of the file to upload",
				},
				"overwrite": map[string]interface{}{
					"type":        "boolean",
					"description": "Whether to overwrite existing files (default: true)",
				},
			},
			"required": []string{"folder_relative_url", "file_content", "file_name"},
		},
		Execute: executeComposioSharePointUploadFile,
	}
}

func executeComposioSharePointUploadFile(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	folderRelativeURL, ok := args["folder_relative_url"].(string)
	if folderRelativeURL == "" {
		return "", fmt.Errorf("'folder_relative_url' is required")
	}

	fileContent, ok := args["file_content"].(string)
	if fileContent == "" {
		return "", fmt.Errorf("'file_content' is required")
	}

	// Decode base64 if needed
	if isBase64(fileContent) {
		decoded, err := base64.StdEncoding.DecodeString(fileContent)
		if err == nil {
			fileContent = string(decoded)
		}
	}

	fileName, ok := args["file_name"].(string)
	if fileName == "" {
		return "", fmt.Errorf("'file_name' is required")
	}

	overwrite := true
	if ov, ok := args["overwrite"].(bool); ok {
		overwrite = ov
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input": map[string]interface{}{
			"folder_relative_url": folderRelativeURL,
			"file_content":        fileContent,
			"file_name":           fileName,
			"overwrite":           overwrite,
		},
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_UPLOAD_FILE", payload)
}

// NewComposioSharePointDownloadFileTool creates a tool for downloading files
func NewComposioSharePointDownloadFileTool() *Tool {
	return &Tool{
		Name:        "sharepoint_download_file",
		DisplayName: "SharePoint - Download File",
		Description: `Download a file from SharePoint.

Features:
- Download files by server-relative URL
- Get raw file content
- OAuth authentication handled by Composio

Use this to download files from SharePoint document libraries.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "download", "file", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"server_relative_url": map[string]interface{}{
					"type":        "string",
					"description": "Server-relative URL of the file (e.g., '/Shared Documents/folder/file.txt')",
				},
			},
			"required": []string{"server_relative_url"},
		},
		Execute: executeComposioSharePointDownloadFile,
	}
}

func executeComposioSharePointDownloadFile(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	serverRelativeURL, ok := args["server_relative_url"].(string)
	if serverRelativeURL == "" {
		return "", fmt.Errorf("'server_relative_url' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input": map[string]interface{}{
			"server_relative_url": serverRelativeURL,
		},
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_DOWNLOAD_FILE_BY_SERVER_RELATIVE_URL", payload)
}

// NewComposioSharePointSearchTool creates a tool for searching SharePoint
func NewComposioSharePointSearchTool() *Tool {
	return &Tool{
		Name:        "sharepoint_search",
		DisplayName: "SharePoint - Search",
		Description: `Search SharePoint sites for content.

Features:
- Full-text search across SharePoint
- Search documents, lists, and items
- KQL (Keyword Query Language) support
- OAuth authentication handled by Composio

Use this to find content in SharePoint.`,
		Icon:     "Folder",
		Source:   ToolSourceComposio,
		Category: "integration",
		Keywords: []string{"sharepoint", "search", "find", "microsoft", "composio"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"querytext": map[string]interface{}{
					"type":        "string",
					"description": "Search query text (e.g., 'report', 'filetype:pdf', 'author:john')",
				},
				"rowlimit": map[string]interface{}{
					"type":        "integer",
					"description": "Maximum number of results to return (default: 10)",
				},
			},
			"required": []string{"querytext"},
		},
		Execute: executeComposioSharePointSearch,
	}
}

func executeComposioSharePointSearch(args map[string]interface{}) (string, error) {
	if err := checkSharePointRateLimit(args); err != nil {
		return "", err
	}

	credData, err := GetCredentialData(args, "composio_sharepoint")
	if err != nil {
		return "", fmt.Errorf("failed to get Composio credentials: %w", err)
	}

	entityID, ok := credData["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return "", fmt.Errorf("composio_entity_id not found in credentials")
	}

	queryText, ok := args["querytext"].(string)
	if queryText == "" {
		return "", fmt.Errorf("'querytext' is required")
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return "", fmt.Errorf("COMPOSIO_API_KEY environment variable not set")
	}

	input := map[string]interface{}{
		"querytext": queryText,
	}

	if rowLimit, ok := args["rowlimit"].(float64); ok {
		input["rowlimit"] = int(rowLimit)
	}

	payload := map[string]interface{}{
		"entityId": entityID,
		"appName":  "sharepoint",
		"input":    input,
	}

	return callComposioSharePointAPI(composioAPIKey, entityID, "SHARE_POINT_SEARCH_QUERY", payload)
}

// callComposioSharePointAPI makes a v2 API call to Composio for SharePoint actions
func callComposioSharePointAPI(apiKey string, entityID string, action string, payload map[string]interface{}) (string, error) {
	// Get connected account ID
	connectedAccountID, err := getSharePointConnectedAccountID(apiKey, entityID, "SHARE_POINT")
	if err != nil {
		return "", fmt.Errorf("failed to get connected account: %w", err)
	}

	url := "https://backend.composio.dev/api/v2/actions/" + action + "/execute"

	v2Payload := map[string]interface{}{
		"connectedAccountId": connectedAccountID,
		"input":              payload["input"],
	}

	jsonData, err := json.Marshal(v2Payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	log.Printf("🔍 [SHAREPOINT] Action: %s, ConnectedAccount: %s", action, maskSensitiveID(connectedAccountID))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		log.Printf("❌ [SHAREPOINT] API error (status %d) for action %s", resp.StatusCode, action)
		log.Printf("❌ [SHAREPOINT] Composio error response: %s", string(respBody))

		if resp.StatusCode == 429 {
			return "", fmt.Errorf("rate limit exceeded, please try again later")
		}

		if resp.StatusCode >= 500 {
			return "", fmt.Errorf("external service error (status %d)", resp.StatusCode)
		}
		return "", fmt.Errorf("invalid request (status %d): check parameters and permissions", resp.StatusCode)
	}

	var apiResponse map[string]interface{}
	if err := json.Unmarshal(respBody, &apiResponse); err != nil {
		return string(respBody), nil
	}

	result, _ := json.MarshalIndent(apiResponse, "", "  ")
	return string(result), nil
}

// getSharePointConnectedAccountID retrieves the connected account ID from Composio v3 API
func getSharePointConnectedAccountID(apiKey string, userID string, appName string) (string, error) {
	baseURL := "https://backend.composio.dev/api/v3/connected_accounts"
	params := url.Values{}
	params.Add("user_ids", userID)
	fullURL := baseURL + "?" + params.Encode()

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("x-api-key", apiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to fetch connected accounts: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("Composio API error (status %d): %s", resp.StatusCode, string(respBody))
	}

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

	for _, account := range response.Items {
		if account.Toolkit.Slug == appName {
			if account.Deprecated.UUID != "" {
				return account.Deprecated.UUID, nil
			}
			return account.ID, nil
		}
	}

	return "", fmt.Errorf("no SharePoint connection found for user. Please connect your SharePoint account first")
}

// isBase64 checks if a string is base64 encoded
func isBase64(s string) bool {
	if len(s) < 4 || len(s)%4 != 0 {
		return false
	}
	_, err := base64.StdEncoding.DecodeString(s)
	return err == nil && !strings.ContainsAny(s, " \n\r\t")
}