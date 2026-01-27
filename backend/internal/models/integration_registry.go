package models

// IntegrationRegistry contains all supported integrations
// This is the source of truth for what integrations are available
var IntegrationRegistry = map[string]Integration{
	// ============================================
	// COMMUNICATION
	// ============================================
	"discord": {
		ID:          "discord",
		Name:        "Discord",
		Description: "Send messages to Discord channels via webhooks",
		Icon:        "discord",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "webhook_url",
				Label:       "Webhook URL",
				Type:        "webhook_url",
				Required:    true,
				Placeholder: "https://discord.com/api/webhooks/...",
				HelpText:    "Create a webhook in Discord: Server Settings → Integrations → Webhooks",
				Sensitive:   true,
			},
		},
		Tools:   []string{"send_discord_message"},
		DocsURL: "https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
	},

	"slack": {
		ID:          "slack",
		Name:        "Slack",
		Description: "Send messages to Slack channels via webhooks",
		Icon:        "slack",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "webhook_url",
				Label:       "Webhook URL",
				Type:        "webhook_url",
				Required:    true,
				Placeholder: "https://hooks.slack.com/services/...",
				HelpText:    "Create an Incoming Webhook in your Slack App settings",
				Sensitive:   true,
			},
		},
		Tools:   []string{"send_slack_message"},
		DocsURL: "https://api.slack.com/messaging/webhooks",
	},

	"telegram": {
		ID:          "telegram",
		Name:        "Telegram",
		Description: "Send messages via Telegram Bot API",
		Icon:        "telegram",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "bot_token",
				Label:       "Bot Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
				HelpText:    "Get your bot token from @BotFather on Telegram",
				Sensitive:   true,
			},
			{
				Key:         "chat_id",
				Label:       "Chat ID",
				Type:        "text",
				Required:    true,
				Placeholder: "-1001234567890",
				HelpText:    "The chat ID where messages will be sent (use @userinfobot to find it)",
				Sensitive:   false,
			},
		},
		Tools:   []string{"send_telegram_message"},
		DocsURL: "https://core.telegram.org/bots/api",
	},

	"teams": {
		ID:          "teams",
		Name:        "Microsoft Teams",
		Description: "Send messages to Microsoft Teams channels",
		Icon:        "microsoft",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "webhook_url",
				Label:       "Webhook URL",
				Type:        "webhook_url",
				Required:    true,
				Placeholder: "https://outlook.office.com/webhook/...",
				HelpText:    "Create an Incoming Webhook connector in your Teams channel",
				Sensitive:   true,
			},
		},
		Tools:   []string{"send_teams_message"},
		DocsURL: "https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook",
	},

	"google_chat": {
		ID:          "google_chat",
		Name:        "Google Chat",
		Description: "Send messages to Google Chat spaces via webhooks",
		Icon:        "google",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "webhook_url",
				Label:       "Webhook URL",
				Type:        "webhook_url",
				Required:    true,
				Placeholder: "https://chat.googleapis.com/v1/spaces/.../messages?key=...",
				HelpText:    "Create a webhook in Google Chat: Space settings → Integrations → Webhooks",
				Sensitive:   true,
			},
		},
		Tools:   []string{"send_google_chat_message"},
		DocsURL: "https://developers.google.com/chat/how-tos/webhooks",
	},

	"zoom": {
		ID:          "zoom",
		Name:        "Zoom",
		Description: "Create and manage Zoom meetings, handle registrations, and schedule video conferences",
		Icon:        "zoom",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "account_id",
				Label:       "Account ID",
				Type:        "text",
				Required:    true,
				Placeholder: "Your Zoom Account ID",
				HelpText:    "Find in Zoom Marketplace: Your app → App Credentials → Account ID",
				Sensitive:   false,
			},
			{
				Key:         "client_id",
				Label:       "Client ID",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your Zoom Client ID",
				HelpText:    "Find in Zoom Marketplace: Your app → App Credentials → Client ID",
				Sensitive:   true,
			},
			{
				Key:         "client_secret",
				Label:       "Client Secret",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your Zoom Client Secret",
				HelpText:    "Find in Zoom Marketplace: Your app → App Credentials → Client Secret",
				Sensitive:   true,
			},
		},
		Tools:   []string{"zoom_meeting"},
		DocsURL: "https://developers.zoom.us/docs/internal-apps/s2s-oauth/",
	},

	"twilio": {
		ID:          "twilio",
		Name:        "Twilio",
		Description: "Send SMS, MMS, and WhatsApp messages via Twilio API",
		Icon:        "twilio",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "account_sid",
				Label:       "Account SID",
				Type:        "text",
				Required:    true,
				Placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
				HelpText:    "Find in Twilio Console: Account → Account SID",
				Sensitive:   false,
			},
			{
				Key:         "auth_token",
				Label:       "Auth Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your Twilio Auth Token",
				HelpText:    "Find in Twilio Console: Account → Auth Token",
				Sensitive:   true,
			},
			{
				Key:         "from_number",
				Label:       "Default From Number",
				Type:        "text",
				Required:    false,
				Placeholder: "+1234567890",
				HelpText:    "Default phone number to send messages from (must be a Twilio number)",
				Sensitive:   false,
			},
		},
		Tools:   []string{"twilio_send_sms", "twilio_send_whatsapp"},
		DocsURL: "https://www.twilio.com/docs/sms/api",
	},

	"referralmonk": {
		ID:          "referralmonk",
		Name:        "ReferralMonk",
		Description: "Send WhatsApp messages via ReferralMonk with template support for campaigns and nurture flows",
		Icon:        "message-square",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "api_token",
				Label:       "API Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your ReferralMonk API Token",
				HelpText:    "Get your API credentials from ReferralMonk dashboard (AhaGuru instance)",
				Sensitive:   true,
			},
			{
				Key:         "api_secret",
				Label:       "API Secret",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your ReferralMonk API Secret",
				HelpText:    "Your API secret key from ReferralMonk dashboard",
				Sensitive:   true,
			},
		},
		Tools:   []string{"referralmonk_whatsapp"},
		DocsURL: "https://ahaguru.referralmonk.com/",
	},

	// ============================================
	// PRODUCTIVITY
	// ============================================
	"notion": {
		ID:          "notion",
		Name:        "Notion",
		Description: "Read and write to Notion databases and pages",
		Icon:        "notion",
		Category:    "productivity",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "Integration Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "secret_...",
				HelpText:    "Create an integration at notion.so/my-integrations and share pages with it",
				Sensitive:   true,
			},
		},
		Tools:   []string{"notion_search", "notion_query_database", "notion_create_page", "notion_update_page"},
		DocsURL: "https://developers.notion.com/docs/getting-started",
	},

	"airtable": {
		ID:          "airtable",
		Name:        "Airtable",
		Description: "Read and write to Airtable bases",
		Icon:        "airtable",
		Category:    "productivity",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "Personal Access Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "pat...",
				HelpText:    "Create a Personal Access Token in your Airtable account settings",
				Sensitive:   true,
			},
			{
				Key:         "base_id",
				Label:       "Base ID",
				Type:        "text",
				Required:    false,
				Placeholder: "appXXXXXXXXXXXXXX",
				HelpText:    "Optional: Default base ID (can be overridden per request)",
				Sensitive:   false,
			},
		},
		Tools:   []string{"airtable_list", "airtable_read", "airtable_create", "airtable_update"},
		DocsURL: "https://airtable.com/developers/web/api/introduction",
	},

	"trello": {
		ID:          "trello",
		Name:        "Trello",
		Description: "Manage Trello boards, lists, and cards",
		Icon:        "trello",
		Category:    "productivity",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "API Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your Trello API key",
				HelpText:    "Get your API key from trello.com/app-key",
				Sensitive:   true,
			},
			{
				Key:         "token",
				Label:       "Token",
				Type:        "token",
				Required:    true,
				Placeholder: "Your Trello token",
				HelpText:    "Generate a token using your API key",
				Sensitive:   true,
			},
		},
		Tools:   []string{"trello_boards", "trello_lists", "trello_cards", "trello_create_card"},
		DocsURL: "https://developer.atlassian.com/cloud/trello/rest/",
	},

	"clickup": {
		ID:          "clickup",
		Name:        "ClickUp",
		Description: "Manage ClickUp tasks, lists, and spaces",
		Icon:        "clickup",
		Category:    "productivity",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "API Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "pk_...",
				HelpText:    "Get your API key from ClickUp: Settings → Apps → API Token",
				Sensitive:   true,
			},
		},
		Tools:   []string{"clickup_tasks", "clickup_create_task", "clickup_update_task"},
		DocsURL: "https://clickup.com/api",
	},

	"calendly": {
		ID:          "calendly",
		Name:        "Calendly",
		Description: "Manage Calendly events, scheduling links, and invitees",
		Icon:        "calendly",
		Category:    "productivity",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "Personal Access Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "eyJraW...",
				HelpText:    "Get your token from Calendly: Integrations → API & Webhooks → Personal Access Tokens",
				Sensitive:   true,
			},
		},
		Tools:   []string{"calendly_events", "calendly_event_types", "calendly_invitees"},
		DocsURL: "https://developer.calendly.com/api-docs",
	},

	"composio_googlesheets": {
		ID:          "composio_googlesheets",
		Name:        "Google Sheets",
		Description: "Complete Google Sheets integration via Composio OAuth - no GCP setup required. Create, read, write, search, and manage spreadsheets.",
		Icon:        "file-spreadsheet",
		Category:    "productivity",
		Fields: []IntegrationField{
			{
				Key:         "composio_entity_id",
				Label:       "Entity ID",
				Type:        "text",
				Required:    true,
				Placeholder: "Automatically filled after OAuth",
				HelpText:    "Connect your Google account via Composio OAuth (managed by ClaraVerse)",
				Sensitive:   false,
			},
		},
		Tools: []string{
			"googlesheets_read",
			"googlesheets_write",
			"googlesheets_append",
			"googlesheets_create",
			"googlesheets_get_info",
			"googlesheets_list_sheets",
			"googlesheets_search",
			"googlesheets_clear",
			"googlesheets_add_sheet",
			"googlesheets_delete_sheet",
			"googlesheets_find_replace",
			"googlesheets_upsert_rows",
		},
		DocsURL: "https://docs.composio.dev/toolkits/googlesheets",
	},

	"composio_gmail": {
		ID:          "composio_gmail",
		Name:        "Gmail",
		Description: "Complete Gmail integration via Composio OAuth - no GCP setup required. Send, fetch, reply, manage drafts, and organize emails.",
		Icon:        "mail",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "composio_entity_id",
				Label:       "Entity ID",
				Type:        "text",
				Required:    true,
				Placeholder: "Automatically filled after OAuth",
				HelpText:    "Connect your Gmail account via Composio OAuth (managed by ClaraVerse)",
				Sensitive:   false,
			},
		},
		Tools: []string{
			"gmail_send_email",
			"gmail_fetch_emails",
			"gmail_get_message",
			"gmail_reply_to_thread",
			"gmail_create_draft",
			"gmail_send_draft",
			"gmail_list_drafts",
			"gmail_add_label",
			"gmail_list_labels",
			"gmail_move_to_trash",
		},
		DocsURL: "https://docs.composio.dev/toolkits/gmail",
	},

	"composio_sharepoint": {
		ID:          "composio_sharepoint",
		Name:        "Microsoft SharePoint",
		Description: "Complete SharePoint integration via Composio OAuth - no Azure app registration required. Access sites, lists, libraries, items, and manage content.",
		Icon:        "folder",
		Category:    "productivity",
		Fields: []IntegrationField{
			{
				Key:         "composio_entity_id",
				Label:       "Entity ID",
				Type:        "text",
				Required:    true,
				Placeholder: "Automatically filled after OAuth",
				HelpText:    "Connect your SharePoint account via Composio OAuth (managed by ClaraVerse)",
				Sensitive:   false,
			},
		},
		Tools: []string{
			"sharepoint_list_sites",
			"sharepoint_get_site",
			"sharepoint_list_lists",
			"sharepoint_get_list_items",
			"sharepoint_get_list_item",
			"sharepoint_create_list_item",
			"sharepoint_update_list_item",
			"sharepoint_delete_list_item",
			"sharepoint_list_drives",
			"sharepoint_list_drive_items",
			"sharepoint_get_drive_item",
			"sharepoint_download_file",
			"sharepoint_upload_file",
			"sharepoint_search",
		},
		DocsURL: "https://docs.composio.dev/toolkits/microsoftsharepoint",
	},

	"composio_onedrive": {
		ID:          "composio_onedrive",
		Name:        "Microsoft OneDrive",
		Description: "Complete OneDrive integration via Composio OAuth - no Azure app registration required. Access files, folders, upload, download, and manage your cloud storage.",
		Icon:        "hard-drive",
		Category:    "storage",
		Fields: []IntegrationField{
			{
				Key:         "composio_entity_id",
				Label:       "Entity ID",
				Type:        "text",
				Required:    true,
				Placeholder: "Automatically filled after OAuth",
				HelpText:    "Connect your OneDrive account via Composio OAuth (managed by ClaraVerse)",
				Sensitive:   false,
			},
		},
		Tools: []string{
			"onedrive_list_items",
			"onedrive_get_item",
			"onedrive_get_item_content",
			"onedrive_upload_file",
			"onedrive_create_folder",
			"onedrive_delete_item",
			"onedrive_move_item",
			"onedrive_copy_item",
			"onedrive_search_items",
			"onedrive_get_recent_items",
			"onedrive_share_item",
		},
		DocsURL: "https://docs.composio.dev/toolkits/microsoftonedrive",
	},

	"composio_outlook": {
		ID:          "composio_outlook",
		Name:        "Microsoft Outlook",
		Description: "Complete Outlook integration via Composio OAuth - no Azure app registration required. Send, fetch, reply, manage drafts, and organize emails.",
		Icon:        "mail",
		Category:    "communication",
		Fields: []IntegrationField{
			{
				Key:         "composio_entity_id",
				Label:       "Entity ID",
				Type:        "text",
				Required:    true,
				Placeholder: "Automatically filled after OAuth",
				HelpText:    "Connect your Outlook account via Composio OAuth (managed by ClaraVerse)",
				Sensitive:   false,
			},
		},
		Tools: []string{
			"outlook_send_email",
			"outlook_fetch_emails",
			"outlook_get_message",
			"outlook_reply_to_thread",
			"outlook_create_draft",
			"outlook_send_draft",
			"outlook_list_drafts",
			"outlook_move_to_deleted_items",
			"outlook_get_folders",
		},
		DocsURL: "https://docs.composio.dev/toolkits/microsoftoutlook",
	},

	// ============================================
	// DEVELOPMENT
	// ============================================
	"github": {
		ID:          "github",
		Name:        "GitHub",
		Description: "Access GitHub repositories, issues, and pull requests",
		Icon:        "github",
		Category:    "development",
		Fields: []IntegrationField{
			{
				Key:         "personal_access_token",
				Label:       "Personal Access Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "ghp_...",
				HelpText:    "Create a PAT at github.com/settings/tokens with required scopes",
				Sensitive:   true,
			},
		},
		Tools:   []string{"github_create_issue", "github_list_issues", "github_get_repo", "github_add_comment"},
		DocsURL: "https://docs.github.com/en/rest",
	},

	"gitlab": {
		ID:          "gitlab",
		Name:        "GitLab",
		Description: "Access GitLab projects, issues, and merge requests",
		Icon:        "gitlab",
		Category:    "development",
		Fields: []IntegrationField{
			{
				Key:         "personal_access_token",
				Label:       "Personal Access Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "glpat-...",
				HelpText:    "Create a PAT in GitLab: Settings → Access Tokens",
				Sensitive:   true,
			},
			{
				Key:         "base_url",
				Label:       "GitLab URL",
				Type:        "text",
				Required:    false,
				Placeholder: "https://gitlab.com",
				HelpText:    "Leave empty for gitlab.com, or enter your self-hosted URL",
				Default:     "https://gitlab.com",
				Sensitive:   false,
			},
		},
		Tools:   []string{"gitlab_projects", "gitlab_issues", "gitlab_mrs"},
		DocsURL: "https://docs.gitlab.com/ee/api/",
	},

	"linear": {
		ID:          "linear",
		Name:        "Linear",
		Description: "Manage Linear issues and projects",
		Icon:        "linear",
		Category:    "development",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "API Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "lin_api_...",
				HelpText:    "Create an API key in Linear: Settings → API → Personal API keys",
				Sensitive:   true,
			},
		},
		Tools:   []string{"linear_issues", "linear_create_issue", "linear_update_issue"},
		DocsURL: "https://developers.linear.app/docs/graphql/working-with-the-graphql-api",
	},

	"jira": {
		ID:          "jira",
		Name:        "Jira",
		Description: "Manage Jira issues and projects",
		Icon:        "jira",
		Category:    "development",
		Fields: []IntegrationField{
			{
				Key:         "email",
				Label:       "Email",
				Type:        "text",
				Required:    true,
				Placeholder: "your@email.com",
				HelpText:    "Your Atlassian account email",
				Sensitive:   false,
			},
			{
				Key:         "api_token",
				Label:       "API Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your Jira API token",
				HelpText:    "Create an API token at id.atlassian.com/manage-profile/security/api-tokens",
				Sensitive:   true,
			},
			{
				Key:         "domain",
				Label:       "Jira Domain",
				Type:        "text",
				Required:    true,
				Placeholder: "your-company.atlassian.net",
				HelpText:    "Your Jira Cloud domain (without https://)",
				Sensitive:   false,
			},
		},
		Tools:   []string{"jira_issues", "jira_create_issue", "jira_update_issue"},
		DocsURL: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/",
	},

	// ============================================
	// CRM / SALES
	// ============================================
	"hubspot": {
		ID:          "hubspot",
		Name:        "HubSpot",
		Description: "Access HubSpot CRM contacts, deals, and companies",
		Icon:        "hubspot",
		Category:    "crm",
		Fields: []IntegrationField{
			{
				Key:         "access_token",
				Label:       "Private App Access Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "pat-...",
				HelpText:    "Create a Private App in HubSpot: Settings → Integrations → Private Apps",
				Sensitive:   true,
			},
		},
		Tools:   []string{"hubspot_contacts", "hubspot_deals", "hubspot_companies"},
		DocsURL: "https://developers.hubspot.com/docs/api/overview",
	},

	"leadsquared": {
		ID:          "leadsquared",
		Name:        "LeadSquared",
		Description: "Access LeadSquared CRM leads and activities",
		Icon:        "leadsquared",
		Category:    "crm",
		Fields: []IntegrationField{
			{
				Key:         "access_key",
				Label:       "Access Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your LeadSquared Access Key",
				HelpText:    "Find in LeadSquared: Settings → API & Webhooks → Access Keys",
				Sensitive:   true,
			},
			{
				Key:         "secret_key",
				Label:       "Secret Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your LeadSquared Secret Key",
				HelpText:    "Find alongside your Access Key",
				Sensitive:   true,
			},
			{
				Key:         "host",
				Label:       "API Host",
				Type:        "text",
				Required:    true,
				Placeholder: "api.leadsquared.com",
				HelpText:    "Your LeadSquared API host (varies by region)",
				Default:     "api.leadsquared.com",
				Sensitive:   false,
			},
		},
		Tools:   []string{"leadsquared_leads", "leadsquared_create_lead", "leadsquared_activities"},
		DocsURL: "https://apidocs.leadsquared.com/",
	},

	// ============================================
	// MARKETING / EMAIL
	// ============================================
	"sendgrid": {
		ID:          "sendgrid",
		Name:        "SendGrid",
		Description: "Send emails via SendGrid API. Supports HTML/text emails, multiple recipients, CC/BCC, and attachments.",
		Icon:        "sendgrid",
		Category:    "marketing",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "API Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "SG...",
				HelpText:    "Create an API key in SendGrid: Settings → API Keys",
				Sensitive:   true,
			},
			{
				Key:         "from_email",
				Label:       "Default From Email",
				Type:        "text",
				Required:    false,
				Placeholder: "noreply@yourdomain.com",
				HelpText:    "Default sender email (must be verified in SendGrid)",
				Sensitive:   false,
			},
		},
		Tools:   []string{"send_email"},
		DocsURL: "https://docs.sendgrid.com/api-reference/mail-send/mail-send",
	},

	"brevo": {
		ID:          "brevo",
		Name:        "Brevo",
		Description: "Send transactional and marketing emails via Brevo (formerly SendInBlue). Supports templates, tracking, and automation.",
		Icon:        "brevo",
		Category:    "marketing",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "API Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "xkeysib-...",
				HelpText:    "Create an API key in Brevo: Settings → SMTP & API → API Keys",
				Sensitive:   true,
			},
			{
				Key:         "from_email",
				Label:       "Default From Email",
				Type:        "text",
				Required:    false,
				Placeholder: "noreply@yourdomain.com",
				HelpText:    "Default sender email (must be verified in Brevo)",
				Sensitive:   false,
			},
			{
				Key:         "from_name",
				Label:       "Default From Name",
				Type:        "text",
				Required:    false,
				Placeholder: "My Company",
				HelpText:    "Default sender display name",
				Sensitive:   false,
			},
		},
		Tools:   []string{"send_brevo_email"},
		DocsURL: "https://developers.brevo.com/docs/send-a-transactional-email",
	},

	"mailchimp": {
		ID:          "mailchimp",
		Name:        "Mailchimp",
		Description: "Manage Mailchimp audiences and campaigns",
		Icon:        "mailchimp",
		Category:    "marketing",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "API Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-usX",
				HelpText:    "Create an API key in Mailchimp: Account → Extras → API keys",
				Sensitive:   true,
			},
		},
		Tools:   []string{"mailchimp_lists", "mailchimp_add_subscriber"},
		DocsURL: "https://mailchimp.com/developer/marketing/api/",
	},

	// ============================================
	// ANALYTICS
	// ============================================
	"mixpanel": {
		ID:          "mixpanel",
		Name:        "Mixpanel",
		Description: "Track events and analyze user behavior with Mixpanel",
		Icon:        "mixpanel",
		Category:    "analytics",
		Fields: []IntegrationField{
			{
				Key:         "project_token",
				Label:       "Project Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your Mixpanel Project Token",
				HelpText:    "Find in Mixpanel: Settings → Project Settings → Project Token",
				Sensitive:   true,
			},
			{
				Key:         "api_secret",
				Label:       "API Secret",
				Type:        "api_key",
				Required:    false,
				Placeholder: "Your Mixpanel API Secret",
				HelpText:    "Required for data export. Find in Project Settings → API Secret",
				Sensitive:   true,
			},
		},
		Tools:   []string{"mixpanel_track", "mixpanel_user_profile"},
		DocsURL: "https://developer.mixpanel.com/reference/overview",
	},

	"posthog": {
		ID:          "posthog",
		Name:        "PostHog",
		Description: "Track events and analyze product usage with PostHog",
		Icon:        "posthog",
		Category:    "analytics",
		Fields: []IntegrationField{
			{
				Key:         "api_key",
				Label:       "Project API Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "phc_...",
				HelpText:    "Find in PostHog: Settings → Project → Project API Key",
				Sensitive:   true,
			},
			{
				Key:         "host",
				Label:       "PostHog Host",
				Type:        "text",
				Required:    false,
				Placeholder: "https://app.posthog.com",
				HelpText:    "Leave empty for PostHog Cloud, or enter your self-hosted URL",
				Default:     "https://app.posthog.com",
				Sensitive:   false,
			},
			{
				Key:         "personal_api_key",
				Label:       "Personal API Key",
				Type:        "api_key",
				Required:    false,
				Placeholder: "phx_...",
				HelpText:    "Required for querying data. Create at Settings → Personal API Keys",
				Sensitive:   true,
			},
		},
		Tools:   []string{"posthog_capture", "posthog_identify", "posthog_query"},
		DocsURL: "https://posthog.com/docs/api",
	},

	// ============================================
	// E-COMMERCE
	// ============================================
	"shopify": {
		ID:          "shopify",
		Name:        "Shopify",
		Description: "Manage Shopify products, orders, and customers",
		Icon:        "shopify",
		Category:    "ecommerce",
		Fields: []IntegrationField{
			{
				Key:         "store_url",
				Label:       "Store URL",
				Type:        "text",
				Required:    true,
				Placeholder: "your-store.myshopify.com",
				HelpText:    "Your Shopify store URL (without https://)",
				Sensitive:   false,
			},
			{
				Key:         "access_token",
				Label:       "Admin API Access Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "shpat_...",
				HelpText:    "Create in Shopify Admin: Settings → Apps → Develop apps → Create an app",
				Sensitive:   true,
			},
		},
		Tools:   []string{"shopify_products", "shopify_orders", "shopify_customers"},
		DocsURL: "https://shopify.dev/docs/api/admin-rest",
	},

	// ============================================
	// DEPLOYMENT
	// ============================================
	"netlify": {
		ID:          "netlify",
		Name:        "Netlify",
		Description: "Manage Netlify sites, deploys, and DNS settings",
		Icon:        "netlify",
		Category:    "deployment",
		Fields: []IntegrationField{
			{
				Key:         "access_token",
				Label:       "Personal Access Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your Netlify Personal Access Token",
				HelpText:    "Create at app.netlify.com/user/applications#personal-access-tokens",
				Sensitive:   true,
			},
		},
		Tools:   []string{"netlify_sites", "netlify_deploys", "netlify_trigger_build"},
		DocsURL: "https://docs.netlify.com/api/get-started/",
	},

	// ============================================
	// STORAGE
	// ============================================
	"aws_s3": {
		ID:          "aws_s3",
		Name:        "AWS S3",
		Description: "Access AWS S3 buckets for file storage",
		Icon:        "aws",
		Category:    "storage",
		Fields: []IntegrationField{
			{
				Key:         "access_key_id",
				Label:       "Access Key ID",
				Type:        "api_key",
				Required:    true,
				Placeholder: "AKIA...",
				HelpText:    "Your AWS Access Key ID",
				Sensitive:   true,
			},
			{
				Key:         "secret_access_key",
				Label:       "Secret Access Key",
				Type:        "api_key",
				Required:    true,
				Placeholder: "Your AWS Secret Access Key",
				HelpText:    "Your AWS Secret Access Key",
				Sensitive:   true,
			},
			{
				Key:         "region",
				Label:       "Region",
				Type:        "text",
				Required:    true,
				Placeholder: "us-east-1",
				HelpText:    "AWS region for your S3 bucket",
				Default:     "us-east-1",
				Sensitive:   false,
			},
			{
				Key:         "bucket",
				Label:       "Default Bucket",
				Type:        "text",
				Required:    false,
				Placeholder: "my-bucket",
				HelpText:    "Optional: Default S3 bucket name",
				Sensitive:   false,
			},
		},
		Tools:   []string{"s3_list", "s3_upload", "s3_download", "s3_delete"},
		DocsURL: "https://docs.aws.amazon.com/s3/",
	},

	// ============================================
	// SOCIAL MEDIA
	// ============================================
	"x_twitter": {
		ID:          "x_twitter",
		Name:        "X (Twitter)",
		Description: "Access X (Twitter) API v2 to post tweets, search posts, manage users, and interact with the platform programmatically.",
		Icon:        "twitter",
		Category:    "social",
		Fields: []IntegrationField{
			{
				Key:         "bearer_token",
				Label:       "Bearer Token",
				Type:        "api_key",
				Required:    true,
				Placeholder: "AAAAAAAAAAAAAAAAAAAAAA...",
				HelpText:    "Get your Bearer Token from developer.x.com portal",
				Sensitive:   true,
			},
			{
				Key:         "api_key",
				Label:       "API Key (Consumer Key)",
				Type:        "api_key",
				Required:    false,
				Placeholder: "Your API Key",
				HelpText:    "Required for posting tweets (OAuth 1.0a)",
				Sensitive:   true,
			},
			{
				Key:         "api_secret",
				Label:       "API Secret (Consumer Secret)",
				Type:        "api_key",
				Required:    false,
				Placeholder: "Your API Secret",
				HelpText:    "Required for posting tweets (OAuth 1.0a)",
				Sensitive:   true,
			},
			{
				Key:         "access_token",
				Label:       "Access Token",
				Type:        "api_key",
				Required:    false,
				Placeholder: "Your Access Token",
				HelpText:    "Required for posting tweets on behalf of a user",
				Sensitive:   true,
			},
			{
				Key:         "access_token_secret",
				Label:       "Access Token Secret",
				Type:        "api_key",
				Required:    false,
				Placeholder: "Your Access Token Secret",
				HelpText:    "Required for posting tweets on behalf of a user",
				Sensitive:   true,
			},
		},
		Tools:   []string{"x_search_posts", "x_post_tweet", "x_get_user", "x_get_user_posts"},
		DocsURL: "https://docs.x.com/x-api/getting-started/about-x-api",
	},

	// ============================================
	// CUSTOM
	// ============================================
	"custom_webhook": {
		ID:          "custom_webhook",
		Name:        "Custom Webhook",
		Description: "Send data to any HTTP endpoint",
		Icon:        "webhook",
		Category:    "custom",
		Fields: []IntegrationField{
			{
				Key:         "url",
				Label:       "Webhook URL",
				Type:        "webhook_url",
				Required:    true,
				Placeholder: "https://your-endpoint.com/webhook",
				HelpText:    "The URL to send webhook requests to",
				Sensitive:   true,
			},
			{
				Key:       "method",
				Label:     "HTTP Method",
				Type:      "select",
				Required:  true,
				Options:   []string{"POST", "PUT", "PATCH"},
				Default:   "POST",
				HelpText:  "HTTP method for the webhook request",
				Sensitive: false,
			},
			{
				Key:       "auth_type",
				Label:     "Authentication Type",
				Type:      "select",
				Required:  false,
				Options:   []string{"none", "bearer", "basic", "api_key"},
				Default:   "none",
				HelpText:  "Type of authentication to use",
				Sensitive: false,
			},
			{
				Key:         "auth_value",
				Label:       "Auth Token/Key",
				Type:        "api_key",
				Required:    false,
				Placeholder: "Your authentication token or key",
				HelpText:    "The authentication value (token, API key, or user:pass for basic)",
				Sensitive:   true,
			},
			{
				Key:         "headers",
				Label:       "Custom Headers (JSON)",
				Type:        "json",
				Required:    false,
				Placeholder: `{"X-Custom-Header": "value"}`,
				HelpText:    "Additional headers as JSON object",
				Sensitive:   false,
			},
		},
		Tools:   []string{"send_webhook"},
		DocsURL: "",
	},

	"rest_api": {
		ID:          "rest_api",
		Name:        "REST API",
		Description: "Connect to any REST API endpoint",
		Icon:        "api",
		Category:    "custom",
		Fields: []IntegrationField{
			{
				Key:         "base_url",
				Label:       "Base URL",
				Type:        "text",
				Required:    true,
				Placeholder: "https://api.example.com/v1",
				HelpText:    "Base URL for the API (endpoints will be appended)",
				Sensitive:   false,
			},
			{
				Key:       "auth_type",
				Label:     "Authentication Type",
				Type:      "select",
				Required:  false,
				Options:   []string{"none", "bearer", "basic", "api_key_header", "api_key_query"},
				Default:   "none",
				HelpText:  "Type of authentication to use",
				Sensitive: false,
			},
			{
				Key:         "auth_value",
				Label:       "Auth Token/Key",
				Type:        "api_key",
				Required:    false,
				Placeholder: "Your authentication token or key",
				HelpText:    "The authentication value",
				Sensitive:   true,
			},
			{
				Key:         "auth_header_name",
				Label:       "API Key Header Name",
				Type:        "text",
				Required:    false,
				Placeholder: "X-API-Key",
				HelpText:    "Header name for API key authentication",
				Default:     "X-API-Key",
				Sensitive:   false,
			},
			{
				Key:         "headers",
				Label:       "Default Headers (JSON)",
				Type:        "json",
				Required:    false,
				Placeholder: `{"Accept": "application/json"}`,
				HelpText:    "Default headers to include in all requests",
				Sensitive:   false,
			},
		},
		Tools:   []string{"api_request"},
		DocsURL: "",
	},

	// ============================================
	// DATABASE
	// ============================================
	"mongodb": {
		ID:          "mongodb",
		Name:        "MongoDB",
		Description: "Query and write to MongoDB databases. Supports find, insert, update operations (no delete for safety).",
		Icon:        "database",
		Category:    "database",
		Fields: []IntegrationField{
			{
				Key:         "connection_string",
				Label:       "Connection String",
				Type:        "api_key",
				Required:    true,
				Placeholder: "mongodb+srv://user:password@cluster.mongodb.net",
				HelpText:    "MongoDB connection URI (SRV or standard format)",
				Sensitive:   true,
			},
			{
				Key:         "database",
				Label:       "Database Name",
				Type:        "text",
				Required:    true,
				Placeholder: "myDatabase",
				HelpText:    "The database to connect to",
				Sensitive:   false,
			},
		},
		Tools:   []string{"mongodb_query", "mongodb_write"},
		DocsURL: "https://www.mongodb.com/docs/drivers/go/current/",
	},

	"redis": {
		ID:          "redis",
		Name:        "Redis",
		Description: "Read and write to Redis key-value store. Supports strings, hashes, lists, sets, and sorted sets (no delete for safety).",
		Icon:        "database",
		Category:    "database",
		Fields: []IntegrationField{
			{
				Key:         "host",
				Label:       "Host",
				Type:        "text",
				Required:    true,
				Placeholder: "localhost",
				HelpText:    "Redis server hostname or IP",
				Default:     "localhost",
				Sensitive:   false,
			},
			{
				Key:         "port",
				Label:       "Port",
				Type:        "text",
				Required:    false,
				Placeholder: "6379",
				HelpText:    "Redis server port (default: 6379)",
				Default:     "6379",
				Sensitive:   false,
			},
			{
				Key:         "password",
				Label:       "Password",
				Type:        "api_key",
				Required:    false,
				Placeholder: "Your Redis password",
				HelpText:    "Redis authentication password (leave empty if not required)",
				Sensitive:   true,
			},
			{
				Key:         "database",
				Label:       "Database Number",
				Type:        "text",
				Required:    false,
				Placeholder: "0",
				HelpText:    "Redis database number (default: 0)",
				Default:     "0",
				Sensitive:   false,
			},
		},
		Tools:   []string{"redis_read", "redis_write"},
		DocsURL: "https://redis.io/docs/",
	},
}

// IntegrationCategories defines the categories and their order
var IntegrationCategories = []IntegrationCategory{
	{
		ID:   "communication",
		Name: "Communication",
		Icon: "message-square",
	},
	{
		ID:   "productivity",
		Name: "Productivity",
		Icon: "layout-grid",
	},
	{
		ID:   "development",
		Name: "Development",
		Icon: "code",
	},
	{
		ID:   "crm",
		Name: "CRM / Sales",
		Icon: "users",
	},
	{
		ID:   "marketing",
		Name: "Marketing / Email",
		Icon: "mail",
	},
	{
		ID:   "analytics",
		Name: "Analytics",
		Icon: "bar-chart-2",
	},
	{
		ID:   "ecommerce",
		Name: "E-Commerce",
		Icon: "shopping-cart",
	},
	{
		ID:   "deployment",
		Name: "Deployment",
		Icon: "rocket",
	},
	{
		ID:   "storage",
		Name: "Storage",
		Icon: "hard-drive",
	},
	{
		ID:   "database",
		Name: "Database",
		Icon: "database",
	},
	{
		ID:   "social",
		Name: "Social Media",
		Icon: "share-2",
	},
	{
		ID:   "custom",
		Name: "Custom",
		Icon: "settings",
	},
}

// GetIntegration returns an integration by ID
func GetIntegration(id string) (Integration, bool) {
	integration, exists := IntegrationRegistry[id]
	return integration, exists
}

// GetIntegrationsByCategory returns all integrations grouped by category
func GetIntegrationsByCategory() []IntegrationCategory {
	result := make([]IntegrationCategory, len(IntegrationCategories))

	for i, category := range IntegrationCategories {
		result[i] = IntegrationCategory{
			ID:           category.ID,
			Name:         category.Name,
			Icon:         category.Icon,
			Integrations: []Integration{},
		}

		for _, integration := range IntegrationRegistry {
			if integration.Category == category.ID {
				result[i].Integrations = append(result[i].Integrations, integration)
			}
		}
	}

	return result
}

// ValidateCredentialData validates that the provided data matches the integration schema
func ValidateCredentialData(integrationType string, data map[string]interface{}) error {
	integration, exists := IntegrationRegistry[integrationType]
	if !exists {
		return &CredentialValidationError{Field: "integrationType", Message: "unknown integration type"}
	}

	for _, field := range integration.Fields {
		value, hasValue := data[field.Key]
		if field.Required && (!hasValue || value == nil || value == "") {
			return &CredentialValidationError{Field: field.Key, Message: "required field is missing"}
		}
	}

	return nil
}

// CredentialValidationError represents a credential validation error
type CredentialValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e *CredentialValidationError) Error() string {
	return e.Field + ": " + e.Message
}

// MaskCredentialValue masks a sensitive value for display
// e.g., "sk-1234567890abcdef" -> "sk-...cdef"
func MaskCredentialValue(value string, fieldType string) string {
	if value == "" {
		return ""
	}

	switch fieldType {
	case "webhook_url":
		// For URLs, show domain and mask the rest
		if len(value) > 30 {
			return value[:20] + "..." + value[len(value)-8:]
		}
		return value

	case "api_key", "token":
		// For API keys, show prefix and last few chars
		if len(value) > 12 {
			return value[:6] + "..." + value[len(value)-4:]
		}
		if len(value) > 6 {
			return value[:3] + "..." + value[len(value)-2:]
		}
		return "***"

	case "json":
		return "[JSON data]"

	default:
		// For other sensitive data, basic masking
		if len(value) > 8 {
			return value[:4] + "..." + value[len(value)-4:]
		}
		return "***"
	}
}

// GenerateMaskedPreview generates a masked preview for a credential
func GenerateMaskedPreview(integrationType string, data map[string]interface{}) string {
	integration, exists := IntegrationRegistry[integrationType]
	if !exists {
		return ""
	}

	// Find the primary field (first required sensitive field)
	for _, field := range integration.Fields {
		if field.Required && field.Sensitive {
			if value, ok := data[field.Key].(string); ok {
				return MaskCredentialValue(value, field.Type)
			}
		}
	}

	// Fallback: mask first field
	for _, field := range integration.Fields {
		if value, ok := data[field.Key].(string); ok && value != "" {
			return MaskCredentialValue(value, field.Type)
		}
	}

	return ""
}
