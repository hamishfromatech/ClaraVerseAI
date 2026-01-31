package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const hubspotAPIBase = "https://api.hubapi.com"

// NewHubSpotContactsTool creates a tool for listing HubSpot contacts
func NewHubSpotContactsTool() *Tool {
	return &Tool{
		Name:        "hubspot_contacts",
		DisplayName: "List HubSpot Contacts",
		Description: "List contacts from HubSpot CRM. Authentication is handled automatically via configured credentials.",
		Icon:        "Users",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"hubspot", "contacts", "crm", "leads", "customers"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"limit": map[string]interface{}{
					"type":        "number",
					"description": "Maximum number of contacts to return (default 50)",
				},
				"properties": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": "string"},
					"description": "Properties to include (e.g., ['email', 'firstname', 'lastname'])",
				},
			},
			"required": []string{},
		},
		Execute: executeHubSpotContacts,
	}
}

// NewHubSpotDealsTool creates a tool for listing HubSpot deals
func NewHubSpotDealsTool() *Tool {
	return &Tool{
		Name:        "hubspot_deals",
		DisplayName: "List HubSpot Deals",
		Description: "List deals from HubSpot CRM. Authentication is handled automatically.",
		Icon:        "DollarSign",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"hubspot", "deals", "crm", "sales", "pipeline"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"limit": map[string]interface{}{
					"type":        "number",
					"description": "Maximum number of deals to return (default 50)",
				},
				"properties": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": "string"},
					"description": "Properties to include (e.g., ['dealname', 'amount', 'dealstage'])",
				},
			},
			"required": []string{},
		},
		Execute: executeHubSpotDeals,
	}
}

// NewHubSpotCompaniesTool creates a tool for listing HubSpot companies
func NewHubSpotCompaniesTool() *Tool {
	return &Tool{
		Name:        "hubspot_companies",
		DisplayName: "List HubSpot Companies",
		Description: "List companies from HubSpot CRM. Authentication is handled automatically.",
		Icon:        "Building",
		Source:      ToolSourceBuiltin,
		Category:    "integration",
		Keywords:    []string{"hubspot", "companies", "crm", "organizations", "accounts"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system. Do not set manually.",
				},
				"limit": map[string]interface{}{
					"type":        "number",
					"description": "Maximum number of companies to return (default 50)",
				},
				"properties": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": "string"},
					"description": "Properties to include (e.g., ['name', 'domain', 'industry'])",
				},
			},
			"required": []string{},
		},
		Execute: executeHubSpotCompanies,
	}
}

func hubspotRequest(method, endpoint, token string, body interface{}) (map[string]interface{}, error) {
	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonBody)
	}

	req, err := http.NewRequest(method, hubspotAPIBase+endpoint, reqBody)
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
		errMsg := "HubSpot API error"
		if msg, ok := result["message"].(string); ok {
			errMsg = msg
		}
		return nil, fmt.Errorf("%s (status %d)", errMsg, resp.StatusCode)
	}

	return result, nil
}

func executeHubSpotContacts(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "hubspot", "access_token")
	if err != nil {
		return "", fmt.Errorf("failed to get HubSpot token: %w", err)
	}

	limit := 50
	if l, ok := args["limit"].(float64); ok && l > 0 {
		limit = int(l)
		if limit > 100 {
			limit = 100
		}
	}

	properties := []string{"email", "firstname", "lastname", "phone", "company"}
	if props, ok := args["properties"].([]interface{}); ok && len(props) > 0 {
		properties = make([]string, 0)
		for _, p := range props {
			if prop, ok := p.(string); ok {
				properties = append(properties, prop)
			}
		}
	}

	endpoint := fmt.Sprintf("/crm/v3/objects/contacts?limit=%d", limit)
	for _, prop := range properties {
		endpoint += "&properties=" + prop
	}

	result, err := hubspotRequest("GET", endpoint, token, nil)
	if err != nil {
		return "", err
	}

	results, _ := result["results"].([]interface{})
	contacts := make([]map[string]interface{}, 0)
	for _, r := range results {
		contact, ok := r.(map[string]interface{})
		if !ok {
			continue
		}
		simplified := map[string]interface{}{
			"id":         contact["id"],
			"properties": contact["properties"],
			"created_at": contact["createdAt"],
			"updated_at": contact["updatedAt"],
		}
		contacts = append(contacts, simplified)
	}

	response := map[string]interface{}{
		"success":  true,
		"count":    len(contacts),
		"contacts": contacts,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeHubSpotDeals(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "hubspot", "access_token")
	if err != nil {
		return "", fmt.Errorf("failed to get HubSpot token: %w", err)
	}

	limit := 50
	if l, ok := args["limit"].(float64); ok && l > 0 {
		limit = int(l)
		if limit > 100 {
			limit = 100
		}
	}

	properties := []string{"dealname", "amount", "dealstage", "closedate", "pipeline"}
	if props, ok := args["properties"].([]interface{}); ok && len(props) > 0 {
		properties = make([]string, 0)
		for _, p := range props {
			if prop, ok := p.(string); ok {
				properties = append(properties, prop)
			}
		}
	}

	endpoint := fmt.Sprintf("/crm/v3/objects/deals?limit=%d", limit)
	for _, prop := range properties {
		endpoint += "&properties=" + prop
	}

	result, err := hubspotRequest("GET", endpoint, token, nil)
	if err != nil {
		return "", err
	}

	results, _ := result["results"].([]interface{})
	deals := make([]map[string]interface{}, 0)
	for _, r := range results {
		deal, ok := r.(map[string]interface{})
		if !ok {
			continue
		}
		simplified := map[string]interface{}{
			"id":         deal["id"],
			"properties": deal["properties"],
			"created_at": deal["createdAt"],
			"updated_at": deal["updatedAt"],
		}
		deals = append(deals, simplified)
	}

	response := map[string]interface{}{
		"success": true,
		"count":   len(deals),
		"deals":   deals,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

func executeHubSpotCompanies(args map[string]interface{}) (string, error) {
	token, err := ResolveAPIKey(args, "hubspot", "access_token")
	if err != nil {
		return "", fmt.Errorf("failed to get HubSpot token: %w", err)
	}

	limit := 50
	if l, ok := args["limit"].(float64); ok && l > 0 {
		limit = int(l)
		if limit > 100 {
			limit = 100
		}
	}

	properties := []string{"name", "domain", "industry", "phone", "city", "country"}
	if props, ok := args["properties"].([]interface{}); ok && len(props) > 0 {
		properties = make([]string, 0)
		for _, p := range props {
			if prop, ok := p.(string); ok {
				properties = append(properties, prop)
			}
		}
	}

	endpoint := fmt.Sprintf("/crm/v3/objects/companies?limit=%d", limit)
	for _, prop := range properties {
		endpoint += "&properties=" + prop
	}

	result, err := hubspotRequest("GET", endpoint, token, nil)
	if err != nil {
		return "", err
	}

	results, _ := result["results"].([]interface{})
	companies := make([]map[string]interface{}, 0)
	for _, r := range results {
		company, ok := r.(map[string]interface{})
		if !ok {
			continue
		}
		simplified := map[string]interface{}{
			"id":         company["id"],
			"properties": company["properties"],
			"created_at": company["createdAt"],
			"updated_at": company["updatedAt"],
		}
		companies = append(companies, simplified)
	}

	response := map[string]interface{}{
		"success":   true,
		"count":     len(companies),
		"companies": companies,
	}

	jsonResult, _ := json.MarshalIndent(response, "", "  ")
	return string(jsonResult), nil
}

