package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// NewLeadSquaredLeadsTool creates a LeadSquared leads listing tool
func NewLeadSquaredLeadsTool() *Tool {
	return &Tool{
		Name:        "leadsquared_leads",
		DisplayName: "LeadSquared Leads",
		Description: `List and search leads from LeadSquared CRM.

Returns lead details including contact info, status, and owner.
Authentication is handled automatically via configured LeadSquared credentials.`,
		Icon:     "Users",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"leadsquared", "leads", "crm", "sales", "contacts"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"search_text": map[string]interface{}{
					"type":        "string",
					"description": "Search text to filter leads",
				},
				"lead_owner": map[string]interface{}{
					"type":        "string",
					"description": "Filter by lead owner email",
				},
				"limit": map[string]interface{}{
					"type":        "number",
					"description": "Number of leads to return (default 100)",
				},
			},
			"required": []string{},
		},
		Execute: executeLeadSquaredLeads,
	}
}

// NewLeadSquaredCreateLeadTool creates a LeadSquared lead creation tool
func NewLeadSquaredCreateLeadTool() *Tool {
	return &Tool{
		Name:        "leadsquared_create_lead",
		DisplayName: "Create LeadSquared Lead",
		Description: `Create a new lead in LeadSquared CRM.

Supports standard fields and custom fields.
Authentication is handled automatically via configured LeadSquared credentials.`,
		Icon:     "UserPlus",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"leadsquared", "lead", "create", "crm", "new"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"first_name": map[string]interface{}{
					"type":        "string",
					"description": "Lead's first name",
				},
				"last_name": map[string]interface{}{
					"type":        "string",
					"description": "Lead's last name",
				},
				"email": map[string]interface{}{
					"type":        "string",
					"description": "Lead's email address",
				},
				"phone": map[string]interface{}{
					"type":        "string",
					"description": "Lead's phone number",
				},
				"company": map[string]interface{}{
					"type":        "string",
					"description": "Lead's company name",
				},
				"source": map[string]interface{}{
					"type":        "string",
					"description": "Lead source (e.g., Website, Referral)",
				},
			},
			"required": []string{"first_name"},
		},
		Execute: executeLeadSquaredCreateLead,
	}
}

// NewLeadSquaredActivitiesTool creates a LeadSquared activities tool
func NewLeadSquaredActivitiesTool() *Tool {
	return &Tool{
		Name:        "leadsquared_activities",
		DisplayName: "LeadSquared Activities",
		Description: `Get activities for a LeadSquared lead.

Returns call logs, emails, notes, and other interactions.
Authentication is handled automatically via configured LeadSquared credentials.`,
		Icon:     "Activity",
		Source:   ToolSourceBuiltin,
		Category: "integration",
		Keywords: []string{"leadsquared", "activities", "history", "interactions"},
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"credential_id": map[string]interface{}{
					"type":        "string",
					"description": "INTERNAL: Auto-injected by system.",
				},
				"lead_id": map[string]interface{}{
					"type":        "string",
					"description": "The LeadSquared lead ID",
				},
			},
			"required": []string{"lead_id"},
		},
		Execute: executeLeadSquaredActivities,
	}
}

func buildLeadSquaredURL(host, endpoint, accessKey, secretKey string) string {
	return fmt.Sprintf("https://%s/v2/%s?accessKey=%s&secretKey=%s", host, endpoint, accessKey, secretKey)
}

func executeLeadSquaredLeads(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "leadsquared")
	if err != nil {
		return "", fmt.Errorf("failed to get LeadSquared credentials: %w", err)
	}

	accessKey, _ := credData["access_key"].(string)
	secretKey, _ := credData["secret_key"].(string)
	host, _ := credData["host"].(string)

	if accessKey == "" || secretKey == "" {
		return "", fmt.Errorf("LeadSquared credentials incomplete: access_key and secret_key are required")
	}
	if host == "" {
		host = "api.leadsquared.com"
	}

	limit := 100
	if l, ok := args["limit"].(float64); ok && l > 0 {
		limit = int(l)
	}

	payload := map[string]interface{}{
		"Paging": map[string]interface{}{
			"Offset":   0,
			"RowCount": limit,
		},
	}

	filters := []map[string]interface{}{}
	if search, ok := args["search_text"].(string); ok && search != "" {
		filters = append(filters, map[string]interface{}{
			"FieldName": "SearchContent",
			"Value":     search,
			"Condition": "Contains",
		})
	}
	if owner, ok := args["lead_owner"].(string); ok && owner != "" {
		filters = append(filters, map[string]interface{}{
			"FieldName": "LeadOwner",
			"Value":     owner,
			"Condition": "eq",
		})
	}
	if len(filters) > 0 {
		payload["Filters"] = filters
	}

	jsonBody, _ := json.Marshal(payload)
	apiURL := buildLeadSquaredURL(host, "LeadManagement.svc/Leads.Get", accessKey, secretKey)

	req, _ := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("LeadSquared API error: %s", string(body))
	}

	var result interface{}
	json.Unmarshal(body, &result)

	jsonResult, _ := json.MarshalIndent(result, "", "  ")
	return string(jsonResult), nil
}

func executeLeadSquaredCreateLead(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "leadsquared")
	if err != nil {
		return "", fmt.Errorf("failed to get LeadSquared credentials: %w", err)
	}

	accessKey, _ := credData["access_key"].(string)
	secretKey, _ := credData["secret_key"].(string)
	host, _ := credData["host"].(string)

	if accessKey == "" || secretKey == "" {
		return "", fmt.Errorf("LeadSquared credentials incomplete: access_key and secret_key are required")
	}
	if host == "" {
		host = "api.leadsquared.com"
	}

	firstName, _ := args["first_name"].(string)
	if firstName == "" {
		return "", fmt.Errorf("'first_name' is required")
	}

	leadData := []map[string]interface{}{
		{"Attribute": "FirstName", "Value": firstName},
	}

	if v, ok := args["last_name"].(string); ok && v != "" {
		leadData = append(leadData, map[string]interface{}{"Attribute": "LastName", "Value": v})
	}
	if v, ok := args["email"].(string); ok && v != "" {
		leadData = append(leadData, map[string]interface{}{"Attribute": "EmailAddress", "Value": v})
	}
	if v, ok := args["phone"].(string); ok && v != "" {
		leadData = append(leadData, map[string]interface{}{"Attribute": "Phone", "Value": v})
	}
	if v, ok := args["company"].(string); ok && v != "" {
		leadData = append(leadData, map[string]interface{}{"Attribute": "Company", "Value": v})
	}
	if v, ok := args["source"].(string); ok && v != "" {
		leadData = append(leadData, map[string]interface{}{"Attribute": "Source", "Value": v})
	}

	jsonBody, _ := json.Marshal(leadData)
	apiURL := buildLeadSquaredURL(host, "LeadManagement.svc/Lead.Create", accessKey, secretKey)

	req, _ := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("LeadSquared API error: %s", string(body))
	}

	var result map[string]interface{}
	json.Unmarshal(body, &result)

	output := map[string]interface{}{
		"success": true,
		"result":  result,
	}
	jsonResult, _ := json.MarshalIndent(output, "", "  ")
	return string(jsonResult), nil
}

func executeLeadSquaredActivities(args map[string]interface{}) (string, error) {
	credData, err := GetCredentialData(args, "leadsquared")
	if err != nil {
		return "", fmt.Errorf("failed to get LeadSquared credentials: %w", err)
	}

	accessKey, _ := credData["access_key"].(string)
	secretKey, _ := credData["secret_key"].(string)
	host, _ := credData["host"].(string)

	if accessKey == "" || secretKey == "" {
		return "", fmt.Errorf("LeadSquared credentials incomplete: access_key and secret_key are required")
	}
	if host == "" {
		host = "api.leadsquared.com"
	}

	leadID, _ := args["lead_id"].(string)
	if leadID == "" {
		return "", fmt.Errorf("'lead_id' is required")
	}

	apiURL := buildLeadSquaredURL(host, fmt.Sprintf("ProspectActivity.svc/Retrieve?leadId=%s", leadID), accessKey, secretKey)

	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("LeadSquared API error: %s", string(body))
	}

	var result interface{}
	json.Unmarshal(body, &result)

	output := map[string]interface{}{
		"lead_id":    leadID,
		"activities": result,
	}
	jsonResult, _ := json.MarshalIndent(output, "", "  ")
	return string(jsonResult), nil
}
