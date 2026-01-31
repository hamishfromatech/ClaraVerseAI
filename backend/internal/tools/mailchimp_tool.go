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

// NewMailchimpListsTool creates a tool for listing Mailchimp audiences
func NewMailchimpListsTool() *Tool {
	return &Tool{
		Name:        "mailchimp_lists",
		DisplayName: "List Mailchimp Audiences",
		Description: "List all audiences (lists) in your Mailchimp account. Authentication is handled automatically via configured credentials.",
		Icon:        "Users",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"mailchimp", "lists", "audiences", "email", "marketing"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"count": map[string]interface{}{
					"type":        "number",
					"description": "Number of lists to return (default 10)",
				},
			},
			"required": []string{},
		},
		Execute: executeMailchimpLists,
	}
}

// NewMailchimpAddSubscriberTool creates a tool for adding subscribers
func NewMailchimpAddSubscriberTool() *Tool {
	return &Tool{
		Name:        "mailchimp_add_subscriber",
		DisplayName: "Add Mailchimp Subscriber",
		Description: "Add a new subscriber to a Mailchimp audience. Authentication is handled automatically.",
		Icon:        "UserPlus",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"mailchimp", "subscriber", "add", "email", "signup"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"list_id": map[string]interface{}{
					"type":        "string",
					"description": "Audience/List ID to add subscriber to",
				},
				"email": map[string]interface{}{
					"type":        "string",
					"description": "Subscriber email address",
				},
				"first_name": map[string]interface{}{
					"type":        "string",
					"description": "Subscriber first name",
				},
				"last_name": map[string]interface{}{
					"type":        "string",
					"description": "Subscriber last name",
				},
				"status": map[string]interface{}{
					"type":        "string",
					"enum":        []string{"subscribed", "pending", "unsubscribed"},
					"description": "Subscription status (default: subscribed)",
				},
				"tags": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": "string"},
					"description": "Tags to apply to subscriber",
				},
			},
			"required": []string{"list_id", "email"},
		},
		Execute: executeMailchimpAddSubscriber,
	}
}

func getMailchimpConfig(args map[string]interface{}) (string, string, error) {
	apiKey, err := ResolveAPIKey(args, "mailchimp", "api_key")
	if err != nil {
		return "", "", fmt.Errorf("failed to get Mailchimp API key: %w", err)
	}

	// Extract datacenter from API key (format: xxxxx-dc)
	parts := strings.Split(apiKey, "-")
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid Mailchimp API key format")
	}
	dc := parts[1]

	baseURL := fmt.Sprintf("https://%s.api.mailchimp.com/3.0", dc)
	return baseURL, apiKey, nil
}

func mailchimpRequest(method, baseURL, endpoint, apiKey string, body interface{}) (map[string]interface{}, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	req, err := http.NewRequest(method, baseURL+endpoint, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth("anystring", apiKey)
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
		errMsg := "Mailchimp API error"
		if title, ok := result["title"].(string); ok {
			errMsg = title
		}
		if detail, ok := result["detail"].(string); ok {
			errMsg += ": " + detail
		}
		return nil, fmt.Errorf("%s (status %d)", errMsg, resp.StatusCode)
	}

	return result, nil
}

func executeMailchimpLists(args map[string]interface{}) (string, error) {
	baseURL, apiKey, err := getMailchimpConfig(args)
	if err != nil {
		return "", err
	}

	count := 10
	if c, ok := args["count"].(float64); ok && c > 0 {
		count = int(c)
		if count > 100 {
			count = 100
		}
	}

	endpoint := fmt.Sprintf("/lists?count=%d", count)
	result, err := mailchimpRequest("GET", baseURL, endpoint, apiKey, nil)
	if err != nil {
		return "", err
	}

	lists, _ := result["lists"].([]interface{})
	simplifiedLists := make([]map[string]interface{}, 0)
	for _, l := range lists {
		list, ok := l.(map[string]interface{})
		if !ok {
			continue
		}
		stats, _ := list["stats"].(map[string]interface{})
		simplifiedLists = append(simplifiedLists, map[string]interface{}{
			"id":            list["id"],
			"name":          list["name"],
			"member_count":  stats["member_count"],
			"unsubscribe_count": stats["unsubscribe_count"],
			"open_rate":     stats["open_rate"],
			"click_rate":    stats["click_rate"],
			"date_created":  list["date_created"],
		})
	}

	response := map[string]interface{}{
		"success":    true,
		"total":      result["total_items"],
		"count":      len(simplifiedLists),
		"audiences":  simplifiedLists,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeMailchimpAddSubscriber(args map[string]interface{}) (string, error) {
	baseURL, apiKey, err := getMailchimpConfig(args)
	if err != nil {
		return "", err
	}

	listID, _ := args["list_id"].(string)
	email, _ := args["email"].(string)

	if listID == "" || email == "" {
		return "", fmt.Errorf("list_id and email are required")
	}

	status := "subscribed"
	if s, ok := args["status"].(string); ok && s != "" {
		status = s
	}

	body := map[string]interface{}{
		"email_address": email,
		"status":        status,
	}

	mergeFields := map[string]interface{}{}
	if firstName, ok := args["first_name"].(string); ok && firstName != "" {
		mergeFields["FNAME"] = firstName
	}
	if lastName, ok := args["last_name"].(string); ok && lastName != "" {
		mergeFields["LNAME"] = lastName
	}
	if len(mergeFields) > 0 {
		body["merge_fields"] = mergeFields
	}

	if tags, ok := args["tags"].([]interface{}); ok && len(tags) > 0 {
		tagNames := make([]map[string]interface{}, 0)
		for _, t := range tags {
			if tag, ok := t.(string); ok {
				tagNames = append(tagNames, map[string]interface{}{
					"name":   tag,
					"status": "active",
				})
			}
		}
		body["tags"] = tagNames
	}

	endpoint := fmt.Sprintf("/lists/%s/members", listID)
	result, err := mailchimpRequest("POST", baseURL, endpoint, apiKey, body)
	if err != nil {
		return "", err
	}

	response := map[string]interface{}{
		"success":       true,
		"message":       "Subscriber added successfully",
		"subscriber_id": result["id"],
		"email":         result["email_address"],
		"status":        result["status"],
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

