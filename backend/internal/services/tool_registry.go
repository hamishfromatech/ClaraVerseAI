package services

import "strings"

// ToolDefinition represents a single tool in the registry
type ToolDefinition struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Category         string   `json:"category"`
	Icon             string   `json:"icon"` // Icon name for frontend (lucide-react icon name)
	Keywords         []string `json:"keywords"`
	UseCases         []string `json:"use_cases"`
	Parameters       string   `json:"parameters,omitempty"`        // Brief parameter description
	CodeBlockExample string   `json:"code_block_example,omitempty"` // Example argumentMapping for code_block usage
}

// ToolCategory represents a category of tools
type ToolCategory struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
}

// ToolRegistry holds all available tools - easily extensible
var ToolRegistry = []ToolDefinition{
	// ═══════════════════════════════════════════════════════════════
	// 📊 DATA & ANALYSIS
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "analyze_data",
		Name:        "Analyze Data",
		Description: "Python data analysis with charts and visualizations",
		Category:    "data_analysis",
		Icon:        "BarChart2",
		Keywords:    []string{"analyze", "analysis", "data", "chart", "graph", "statistics", "visualize", "visualization", "metrics", "plot", "pandas", "numpy"},
		UseCases:    []string{"Analyze CSV/Excel data", "Generate charts", "Calculate statistics", "Create visualizations"},
		Parameters:  "code: Python code to execute",
	},
	{
		ID:          "calculate_math",
		Name:        "Calculate Math",
		Description: "Mathematical calculations and expressions",
		Category:    "data_analysis",
		Icon:        "Calculator",
		Keywords:    []string{"calculate", "math", "formula", "equation", "compute", "arithmetic", "algebra"},
		UseCases:    []string{"Solve equations", "Calculate formulas", "Mathematical operations"},
		Parameters:  "expression: Math expression to evaluate",
		CodeBlockExample: `{"expression": "{{start.input}}"}`,
	},
	{
		ID:          "read_spreadsheet",
		Name:        "Read Spreadsheet",
		Description: "Read Excel/CSV files (xlsx, xls, csv, tsv)",
		Category:    "data_analysis",
		Icon:        "FileSpreadsheet",
		Keywords:    []string{"spreadsheet", "excel", "csv", "xlsx", "xls", "tsv", "read", "import", "table"},
		UseCases:    []string{"Read Excel files", "Import CSV data", "Parse spreadsheet data"},
		Parameters:  "file_id: ID of uploaded file",
	},
	{
		ID:          "read_data_file",
		Name:        "Read Data File",
		Description: "Read and parse data files (CSV, JSON, text)",
		Category:    "data_analysis",
		Icon:        "FileJson",
		Keywords:    []string{"read", "parse", "data", "file", "json", "csv", "text", "import"},
		UseCases:    []string{"Read JSON files", "Parse text data", "Import data files"},
		Parameters:  "file_id: ID of uploaded file",
	},
	{
		ID:          "read_document",
		Name:        "Read Document",
		Description: "Extract text from documents (PDF, DOCX, PPTX)",
		Category:    "data_analysis",
		Icon:        "FileText",
		Keywords:    []string{"document", "pdf", "docx", "pptx", "word", "powerpoint", "extract", "read", "text"},
		UseCases:    []string{"Extract PDF text", "Read Word documents", "Parse presentations"},
		Parameters:  "file_id: ID of uploaded file",
	},

	// ═══════════════════════════════════════════════════════════════
	// 🔍 SEARCH & WEB
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "search_web",
		Name:        "Search Web",
		Description: "Search the internet for information, news, articles",
		Category:    "search_web",
		Icon:        "Search",
		Keywords:    []string{"search", "google", "web", "internet", "find", "lookup", "query", "news", "articles", "information"},
		UseCases:    []string{"Search for information", "Find news articles", "Research topics"},
		Parameters:  "query: Search query string",
		CodeBlockExample: `{"query": "{{start.input}}"}`,
	},
	{
		ID:          "search_images",
		Name:        "Search Images",
		Description: "Search for images on the web",
		Category:    "search_web",
		Icon:        "Image",
		Keywords:    []string{"image", "images", "photo", "picture", "search", "find", "visual"},
		UseCases:    []string{"Find images", "Search for photos", "Visual content search"},
		Parameters:  "query: Image search query",
	},
	{
		ID:          "scrape_web",
		Name:        "Scrape Web",
		Description: "Scrape content from a specific URL",
		Category:    "search_web",
		Icon:        "Globe",
		Keywords:    []string{"scrape", "crawl", "url", "website", "extract", "web", "page", "content"},
		UseCases:    []string{"Extract webpage content", "Scrape URLs", "Get page data"},
		Parameters:  "url: URL to scrape",
		CodeBlockExample: `{"url": "{{start.input}}"}`,
	},
	{
		ID:          "download_file",
		Name:        "Download File",
		Description: "Download a file from a URL",
		Category:    "search_web",
		Icon:        "Download",
		Keywords:    []string{"download", "file", "url", "fetch", "get", "retrieve"},
		UseCases:    []string{"Download files", "Fetch remote content", "Get assets"},
		Parameters:  "url: URL of file to download",
	},

	// ═══════════════════════════════════════════════════════════════
	// 📝 CONTENT CREATION
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "create_document",
		Name:        "Create Document",
		Description: "Create DOCX or PDF documents",
		Category:    "content_creation",
		Icon:        "FileText",
		Keywords:    []string{"create", "document", "docx", "pdf", "word", "write", "generate", "report"},
		UseCases:    []string{"Create Word documents", "Generate PDFs", "Write reports"},
		Parameters:  "content: Document content, format: docx|pdf",
	},
	{
		ID:          "create_text_file",
		Name:        "Create Text File",
		Description: "Create plain text files",
		Category:    "content_creation",
		Icon:        "FilePlus",
		Keywords:    []string{"create", "text", "file", "write", "plain", "txt"},
		UseCases:    []string{"Create text files", "Write plain text", "Save content"},
		Parameters:  "content: Text content, filename: Output filename",
	},
	{
		ID:          "create_presentation",
		Name:        "Create Presentation",
		Description: "Create PowerPoint presentations with slides",
		Category:    "content_creation",
		Icon:        "Presentation",
		Keywords:    []string{"presentation", "powerpoint", "pptx", "slides", "create", "deck"},
		UseCases:    []string{"Create presentations", "Generate slide decks", "Make PowerPoints"},
		Parameters:  "slides: Array of slide content",
	},
	{
		ID:          "generate_image",
		Name:        "Generate Image",
		Description: "Generate images using AI (DALL-E)",
		Category:    "content_creation",
		Icon:        "Wand2",
		Keywords:    []string{"generate", "image", "create", "ai", "dall-e", "picture", "art", "visual"},
		UseCases:    []string{"Generate AI images", "Create artwork", "Visual content generation"},
		Parameters:  "prompt: Image description",
	},
	{
		ID:          "edit_image",
		Name:        "Edit Image",
		Description: "Edit/transform images (resize, crop, filters)",
		Category:    "content_creation",
		Icon:        "ImagePlus",
		Keywords:    []string{"edit", "image", "resize", "crop", "filter", "transform", "modify"},
		UseCases:    []string{"Resize images", "Crop photos", "Apply filters"},
		Parameters:  "file_id: Image file ID, operation: resize|crop|filter",
	},
	{
		ID:          "html_to_pdf",
		Name:        "HTML to PDF",
		Description: "Convert HTML content to PDF",
		Category:    "content_creation",
		Icon:        "FileOutput",
		Keywords:    []string{"html", "pdf", "convert", "render", "export"},
		UseCases:    []string{"Convert HTML to PDF", "Export web content", "Generate PDF reports"},
		Parameters:  "html: HTML content to convert",
	},

	// ═══════════════════════════════════════════════════════════════
	// 🎤 MEDIA PROCESSING
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "transcribe_audio",
		Name:        "Transcribe Audio",
		Description: "Transcribe speech from audio (MP3, WAV, M4A, OGG, FLAC, WebM)",
		Category:    "media_processing",
		Icon:        "Mic",
		Keywords:    []string{"transcribe", "audio", "speech", "voice", "mp3", "wav", "recording", "speech-to-text"},
		UseCases:    []string{"Transcribe audio files", "Convert speech to text", "Process recordings"},
		Parameters:  "file_id: Audio file ID",
	},
	{
		ID:          "describe_image",
		Name:        "Describe Image",
		Description: "Analyze/describe images using AI vision",
		Category:    "media_processing",
		Icon:        "Eye",
		Keywords:    []string{"describe", "image", "vision", "analyze", "see", "look", "visual", "ai"},
		UseCases:    []string{"Describe image content", "Analyze visuals", "Image understanding"},
		Parameters:  "file_id: Image file ID",
	},

	// ═══════════════════════════════════════════════════════════════
	// ⏰ UTILITIES
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "get_current_time",
		Name:        "Get Current Time",
		Description: "Get current date/time (REQUIRED for time-sensitive queries)",
		Category:    "utilities",
		Icon:        "Clock",
		Keywords:    []string{"time", "date", "now", "today", "current", "datetime", "timestamp"},
		UseCases:    []string{"Get current time", "Date operations", "Time-sensitive queries"},
		Parameters:  "timezone: Optional timezone",
		CodeBlockExample: `{}`,
	},
	{
		ID:          "ask_user",
		Name:        "Ask User Questions",
		Description: "Ask the user clarifying questions via modal dialog. Waits for response (blocking).",
		Category:    "utilities",
		Icon:        "MessageCircleQuestion",
		Keywords:    []string{"ask", "question", "prompt", "user", "input", "clarify", "modal", "dialog", "form", "interactive", "wait", "blocking"},
		UseCases:    []string{"Ask clarifying questions", "Gather user input", "Get user preferences", "Confirm actions", "Multi-choice questions"},
		Parameters:  "title: Prompt title, questions: Array of questions (text/number/checkbox/select/multi-select), allow_skip: Optional",
	},
	{
		ID:          "run_python",
		Name:        "Run Python",
		Description: "Execute Python code for custom logic",
		Category:    "utilities",
		Icon:        "Code",
		Keywords:    []string{"python", "code", "script", "execute", "run", "program", "custom"},
		UseCases:    []string{"Run custom code", "Execute scripts", "Custom processing"},
		Parameters:  "code: Python code to execute",
	},
	{
		ID:          "api_request",
		Name:        "API Request",
		Description: "Make HTTP API requests (GET, POST, PUT, DELETE)",
		Category:    "utilities",
		Icon:        "Globe",
		Keywords:    []string{"api", "http", "request", "rest", "get", "post", "put", "delete", "endpoint"},
		UseCases:    []string{"Call external APIs", "HTTP requests", "API integrations"},
		Parameters:  "url: API URL, method: GET|POST|PUT|DELETE, body: Request body",
	},
	{
		ID:          "send_webhook",
		Name:        "Send Webhook",
		Description: "Send data to any webhook URL",
		Category:    "utilities",
		Icon:        "Webhook",
		Keywords:    []string{"webhook", "send", "post", "notify", "trigger", "callback"},
		UseCases:    []string{"Trigger webhooks", "Send notifications", "External integrations"},
		Parameters:  "url: Webhook URL, data: JSON payload",
		CodeBlockExample: `{"webhook_url": "https://example.com/hook", "data": {"message": "{{previous-block.response}}"}}`,
	},

	// ═══════════════════════════════════════════════════════════════
	// 💬 MESSAGING & COMMUNICATION
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "send_discord_message",
		Name:        "Send Discord Message",
		Description: "Send message to Discord channel",
		Category:    "messaging",
		Icon:        "MessageCircle",
		Keywords:    []string{"discord", "message", "send", "chat", "channel", "notify", "bot"},
		UseCases:    []string{"Send Discord messages", "Discord notifications", "Bot messaging"},
		Parameters:  "content: Message text, embed_title: Optional embed title",
		CodeBlockExample: `{"content": "{{previous-block.response}}"}`,
	},
	{
		ID:          "send_slack_message",
		Name:        "Send Slack Message",
		Description: "Send message to Slack channel",
		Category:    "messaging",
		Icon:        "Hash",
		Keywords:    []string{"slack", "message", "send", "channel", "notify", "workspace"},
		UseCases:    []string{"Send Slack messages", "Slack notifications", "Team messaging"},
		Parameters:  "channel: Channel name, text: Message text",
		CodeBlockExample: `{"channel": "#general", "text": "{{previous-block.response}}"}`,
	},
	{
		ID:          "send_telegram_message",
		Name:        "Send Telegram Message",
		Description: "Send message to Telegram chat",
		Category:    "messaging",
		Icon:        "Send",
		Keywords:    []string{"telegram", "message", "send", "chat", "notify", "bot"},
		UseCases:    []string{"Send Telegram messages", "Telegram notifications", "Bot messaging"},
		Parameters:  "chat_id: Chat ID, text: Message text",
	},
	{
		ID:          "send_google_chat_message",
		Name:        "Send Google Chat Message",
		Description: "Send message to Google Chat",
		Category:    "messaging",
		Icon:        "MessageSquare",
		Keywords:    []string{"google chat", "message", "send", "hangouts", "workspace"},
		UseCases:    []string{"Google Chat messages", "Workspace notifications"},
		Parameters:  "space: Space ID, text: Message text",
	},
	{
		ID:          "send_teams_message",
		Name:        "Send Teams Message",
		Description: "Send message to Microsoft Teams",
		Category:    "messaging",
		Icon:        "Users",
		Keywords:    []string{"teams", "microsoft", "message", "send", "channel", "notify"},
		UseCases:    []string{"Teams messages", "Microsoft Teams notifications"},
		Parameters:  "channel: Channel, text: Message text",
	},
	{
		ID:          "send_email",
		Name:        "Send Email",
		Description: "Send email via SendGrid",
		Category:    "messaging",
		Icon:        "Mail",
		Keywords:    []string{"email", "send", "mail", "sendgrid", "notify"},
		UseCases:    []string{"Send emails", "Email notifications"},
		Parameters:  "to: Recipient, subject: Subject, body: Email body",
	},
	{
		ID:          "send_brevo_email",
		Name:        "Send Brevo Email",
		Description: "Send email via Brevo",
		Category:    "messaging",
		Icon:        "Mail",
		Keywords:    []string{"email", "brevo", "sendinblue", "send", "mail"},
		UseCases:    []string{"Send emails via Brevo", "Marketing emails"},
		Parameters:  "to: Recipient, subject: Subject, body: Email body",
	},
	{
		ID:          "twilio_send_sms",
		Name:        "Send SMS",
		Description: "Send SMS via Twilio",
		Category:    "messaging",
		Icon:        "Smartphone",
		Keywords:    []string{"sms", "text", "twilio", "send", "phone", "mobile"},
		UseCases:    []string{"Send SMS messages", "Text notifications"},
		Parameters:  "to: Phone number, body: Message text",
	},
	{
		ID:          "twilio_send_whatsapp",
		Name:        "Send WhatsApp",
		Description: "Send WhatsApp message via Twilio",
		Category:    "messaging",
		Icon:        "MessageCircle",
		Keywords:    []string{"whatsapp", "message", "twilio", "send", "chat"},
		UseCases:    []string{"Send WhatsApp messages", "WhatsApp notifications"},
		Parameters:  "to: Phone number, body: Message text",
	},
	{
		ID:          "referralmonk_whatsapp",
		Name:        "ReferralMonk WhatsApp",
		Description: "Send WhatsApp message via ReferralMonk with template support",
		Category:    "messaging",
		Icon:        "MessageSquare",
		Keywords:    []string{"whatsapp", "referralmonk", "template", "campaign", "message", "send", "ahaguru"},
		UseCases:    []string{"Send templated WhatsApp messages", "WhatsApp campaigns", "Marketing via WhatsApp"},
		Parameters:  "mobile: Phone with country code, template_name: Template ID, language: Language code (default: en), param_1/2/3: Template parameters",
		CodeBlockExample: `{"mobile": "917550002919", "template_name": "demo_session_01", "language": "en", "param_1": "{{user.name}}", "param_2": "{{lesson.link}}", "param_3": "Team Name"}`,
	},

	// ═══════════════════════════════════════════════════════════════
	// 📹 VIDEO CONFERENCING
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "zoom_meeting",
		Name:        "Zoom Meeting",
		Description: "Zoom meetings & webinars - create, list, register attendees",
		Category:    "video_conferencing",
		Icon:        "Video",
		Keywords:    []string{"zoom", "meeting", "webinar", "video", "conference", "call", "register", "attendee", "schedule"},
		UseCases:    []string{"Create Zoom meetings", "Register for webinars", "List meetings", "Manage attendees"},
		Parameters:  "action: create|list|get|register|create_webinar|register_webinar, meeting_id/webinar_id, email, first_name, last_name",
	},
	{
		ID:          "calendly_events",
		Name:        "Calendly Events",
		Description: "List and manage Calendly events",
		Category:    "video_conferencing",
		Icon:        "Calendar",
		Keywords:    []string{"calendly", "calendar", "schedule", "event", "booking", "appointment"},
		UseCases:    []string{"List Calendly events", "View scheduled meetings"},
		Parameters:  "user: User URI",
	},
	{
		ID:          "calendly_event_types",
		Name:        "Calendly Event Types",
		Description: "List Calendly event types",
		Category:    "video_conferencing",
		Icon:        "CalendarDays",
		Keywords:    []string{"calendly", "event type", "booking type", "schedule"},
		UseCases:    []string{"List event types", "Get booking options"},
		Parameters:  "user: User URI",
	},
	{
		ID:          "calendly_invitees",
		Name:        "Calendly Invitees",
		Description: "Get event invitees/attendees",
		Category:    "video_conferencing",
		Icon:        "Users",
		Keywords:    []string{"calendly", "invitee", "attendee", "participant"},
		UseCases:    []string{"List event invitees", "Get attendee info"},
		Parameters:  "event_uuid: Event UUID",
	},

	// ═══════════════════════════════════════════════════════════════
	// 📋 PROJECT MANAGEMENT
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "jira_issues",
		Name:        "Jira Issues",
		Description: "List/search Jira issues",
		Category:    "project_management",
		Icon:        "CheckSquare",
		Keywords:    []string{"jira", "issue", "ticket", "bug", "task", "search", "list"},
		UseCases:    []string{"Search Jira issues", "List tickets", "Find tasks"},
		Parameters:  "jql: JQL query string",
	},
	{
		ID:          "jira_create_issue",
		Name:        "Create Jira Issue",
		Description: "Create a new Jira issue",
		Category:    "project_management",
		Icon:        "PlusSquare",
		Keywords:    []string{"jira", "create", "issue", "ticket", "bug", "task", "new"},
		UseCases:    []string{"Create Jira tickets", "Report bugs", "Add tasks"},
		Parameters:  "project: Project key, summary: Title, description: Description",
	},
	{
		ID:          "jira_update_issue",
		Name:        "Update Jira Issue",
		Description: "Update an existing Jira issue",
		Category:    "project_management",
		Icon:        "Edit",
		Keywords:    []string{"jira", "update", "edit", "issue", "ticket", "modify"},
		UseCases:    []string{"Update tickets", "Modify issues", "Edit tasks"},
		Parameters:  "issue_key: Issue key, fields: Fields to update",
	},
	{
		ID:          "linear_issues",
		Name:        "Linear Issues",
		Description: "List Linear issues",
		Category:    "project_management",
		Icon:        "CheckSquare",
		Keywords:    []string{"linear", "issue", "ticket", "task", "list"},
		UseCases:    []string{"List Linear issues", "View tasks"},
		Parameters:  "team_id: Team ID",
	},
	{
		ID:          "linear_create_issue",
		Name:        "Create Linear Issue",
		Description: "Create a new Linear issue",
		Category:    "project_management",
		Icon:        "PlusSquare",
		Keywords:    []string{"linear", "create", "issue", "ticket", "task", "new"},
		UseCases:    []string{"Create Linear issues", "Add tasks"},
		Parameters:  "team_id: Team ID, title: Title, description: Description",
	},
	{
		ID:          "linear_update_issue",
		Name:        "Update Linear Issue",
		Description: "Update a Linear issue",
		Category:    "project_management",
		Icon:        "Edit",
		Keywords:    []string{"linear", "update", "edit", "issue", "modify"},
		UseCases:    []string{"Update Linear issues", "Modify tasks"},
		Parameters:  "issue_id: Issue ID, fields: Fields to update",
	},
	{
		ID:          "clickup_tasks",
		Name:        "ClickUp Tasks",
		Description: "List ClickUp tasks",
		Category:    "project_management",
		Icon:        "CheckCircle",
		Keywords:    []string{"clickup", "task", "list", "todo"},
		UseCases:    []string{"List ClickUp tasks", "View todos"},
		Parameters:  "list_id: List ID",
	},
	{
		ID:          "clickup_create_task",
		Name:        "Create ClickUp Task",
		Description: "Create a new ClickUp task",
		Category:    "project_management",
		Icon:        "PlusCircle",
		Keywords:    []string{"clickup", "create", "task", "new", "todo"},
		UseCases:    []string{"Create ClickUp tasks", "Add todos"},
		Parameters:  "list_id: List ID, name: Task name, description: Description",
	},
	{
		ID:          "clickup_update_task",
		Name:        "Update ClickUp Task",
		Description: "Update a ClickUp task",
		Category:    "project_management",
		Icon:        "Edit",
		Keywords:    []string{"clickup", "update", "edit", "task", "modify"},
		UseCases:    []string{"Update ClickUp tasks", "Modify todos"},
		Parameters:  "task_id: Task ID, fields: Fields to update",
	},
	{
		ID:          "trello_boards",
		Name:        "Trello Boards",
		Description: "List Trello boards",
		Category:    "project_management",
		Icon:        "Layout",
		Keywords:    []string{"trello", "board", "list", "kanban"},
		UseCases:    []string{"List Trello boards", "View kanban boards"},
		Parameters:  "None required",
	},
	{
		ID:          "trello_lists",
		Name:        "Trello Lists",
		Description: "List Trello lists in a board",
		Category:    "project_management",
		Icon:        "List",
		Keywords:    []string{"trello", "list", "column", "board"},
		UseCases:    []string{"List Trello lists", "View board columns"},
		Parameters:  "board_id: Board ID",
	},
	{
		ID:          "trello_cards",
		Name:        "Trello Cards",
		Description: "List Trello cards",
		Category:    "project_management",
		Icon:        "Square",
		Keywords:    []string{"trello", "card", "task", "list"},
		UseCases:    []string{"List Trello cards", "View tasks"},
		Parameters:  "list_id: List ID",
	},
	{
		ID:          "trello_create_card",
		Name:        "Create Trello Card",
		Description: "Create a new Trello card",
		Category:    "project_management",
		Icon:        "Plus",
		Keywords:    []string{"trello", "create", "card", "new", "task"},
		UseCases:    []string{"Create Trello cards", "Add tasks"},
		Parameters:  "list_id: List ID, name: Card name, description: Description",
	},
	{
		ID:          "asana_tasks",
		Name:        "Asana Tasks",
		Description: "List Asana tasks",
		Category:    "project_management",
		Icon:        "CheckSquare",
		Keywords:    []string{"asana", "task", "list", "project"},
		UseCases:    []string{"List Asana tasks", "View project tasks"},
		Parameters:  "project_id: Project ID",
	},

	// ═══════════════════════════════════════════════════════════════
	// 💼 CRM & SALES
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "hubspot_contacts",
		Name:        "HubSpot Contacts",
		Description: "List/search HubSpot contacts",
		Category:    "crm_sales",
		Icon:        "Users",
		Keywords:    []string{"hubspot", "contact", "crm", "customer", "lead", "list", "search"},
		UseCases:    []string{"List HubSpot contacts", "Search customers", "Find leads"},
		Parameters:  "query: Optional search query",
	},
	{
		ID:          "hubspot_deals",
		Name:        "HubSpot Deals",
		Description: "List HubSpot deals",
		Category:    "crm_sales",
		Icon:        "DollarSign",
		Keywords:    []string{"hubspot", "deal", "sales", "pipeline", "opportunity"},
		UseCases:    []string{"List deals", "View sales pipeline"},
		Parameters:  "None required",
	},
	{
		ID:          "hubspot_companies",
		Name:        "HubSpot Companies",
		Description: "List HubSpot companies",
		Category:    "crm_sales",
		Icon:        "Building",
		Keywords:    []string{"hubspot", "company", "organization", "account"},
		UseCases:    []string{"List companies", "View accounts"},
		Parameters:  "None required",
	},
	{
		ID:          "leadsquared_leads",
		Name:        "LeadSquared Leads",
		Description: "List LeadSquared leads",
		Category:    "crm_sales",
		Icon:        "UserPlus",
		Keywords:    []string{"leadsquared", "lead", "crm", "prospect"},
		UseCases:    []string{"List leads", "View prospects"},
		Parameters:  "query: Optional search query",
	},
	{
		ID:          "leadsquared_create_lead",
		Name:        "Create LeadSquared Lead",
		Description: "Create a new LeadSquared lead",
		Category:    "crm_sales",
		Icon:        "UserPlus",
		Keywords:    []string{"leadsquared", "create", "lead", "new", "prospect"},
		UseCases:    []string{"Create leads", "Add prospects"},
		Parameters:  "email: Email, firstName: First name, lastName: Last name",
	},
	{
		ID:          "leadsquared_activities",
		Name:        "LeadSquared Activities",
		Description: "List LeadSquared activities",
		Category:    "crm_sales",
		Icon:        "Activity",
		Keywords:    []string{"leadsquared", "activity", "history", "timeline"},
		UseCases:    []string{"List activities", "View lead history"},
		Parameters:  "lead_id: Lead ID",
	},
	{
		ID:          "mailchimp_lists",
		Name:        "Mailchimp Lists",
		Description: "List Mailchimp audiences",
		Category:    "crm_sales",
		Icon:        "Users",
		Keywords:    []string{"mailchimp", "list", "audience", "subscribers", "email"},
		UseCases:    []string{"List audiences", "View subscriber lists"},
		Parameters:  "None required",
	},
	{
		ID:          "mailchimp_add_subscriber",
		Name:        "Mailchimp Add Subscriber",
		Description: "Add subscriber to Mailchimp list",
		Category:    "crm_sales",
		Icon:        "UserPlus",
		Keywords:    []string{"mailchimp", "subscriber", "add", "email", "list"},
		UseCases:    []string{"Add subscribers", "Email list signup"},
		Parameters:  "list_id: List ID, email: Email address",
	},

	// ═══════════════════════════════════════════════════════════════
	// 📊 ANALYTICS
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "posthog_capture",
		Name:        "PostHog Capture",
		Description: "Track PostHog events",
		Category:    "analytics",
		Icon:        "BarChart",
		Keywords:    []string{"posthog", "track", "event", "analytics", "capture"},
		UseCases:    []string{"Track events", "Capture user actions"},
		Parameters:  "event: Event name, properties: Event properties",
	},
	{
		ID:          "posthog_identify",
		Name:        "PostHog Identify",
		Description: "Identify PostHog user",
		Category:    "analytics",
		Icon:        "User",
		Keywords:    []string{"posthog", "identify", "user", "profile"},
		UseCases:    []string{"Identify users", "Set user properties"},
		Parameters:  "distinct_id: User ID, properties: User properties",
	},
	{
		ID:          "posthog_query",
		Name:        "PostHog Query",
		Description: "Query PostHog analytics",
		Category:    "analytics",
		Icon:        "Database",
		Keywords:    []string{"posthog", "query", "analytics", "insights", "data"},
		UseCases:    []string{"Query analytics", "Get insights"},
		Parameters:  "query: HogQL query",
	},
	{
		ID:          "mixpanel_track",
		Name:        "Mixpanel Track",
		Description: "Track Mixpanel events",
		Category:    "analytics",
		Icon:        "BarChart",
		Keywords:    []string{"mixpanel", "track", "event", "analytics"},
		UseCases:    []string{"Track Mixpanel events", "Log user actions"},
		Parameters:  "event: Event name, properties: Event properties",
	},
	{
		ID:          "mixpanel_user_profile",
		Name:        "Mixpanel User Profile",
		Description: "Update Mixpanel user profile",
		Category:    "analytics",
		Icon:        "User",
		Keywords:    []string{"mixpanel", "user", "profile", "update"},
		UseCases:    []string{"Update user profiles", "Set user properties"},
		Parameters:  "distinct_id: User ID, properties: Profile properties",
	},

	// ═══════════════════════════════════════════════════════════════
	// 🐙 CODE & DEVOPS
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "github_create_issue",
		Name:        "GitHub Create Issue",
		Description: "Create a GitHub issue",
		Category:    "code_devops",
		Icon:        "CircleDot",
		Keywords:    []string{"github", "issue", "create", "bug", "feature", "repo"},
		UseCases:    []string{"Create GitHub issues", "Report bugs"},
		Parameters:  "owner: Repo owner, repo: Repo name, title: Title, body: Description",
	},
	{
		ID:          "github_list_issues",
		Name:        "GitHub List Issues",
		Description: "List GitHub issues",
		Category:    "code_devops",
		Icon:        "List",
		Keywords:    []string{"github", "issue", "list", "bug", "repo"},
		UseCases:    []string{"List GitHub issues", "View repo issues"},
		Parameters:  "owner: Repo owner, repo: Repo name",
	},
	{
		ID:          "github_get_repo",
		Name:        "GitHub Get Repo",
		Description: "Get GitHub repository info",
		Category:    "code_devops",
		Icon:        "GitBranch",
		Keywords:    []string{"github", "repo", "repository", "info", "details"},
		UseCases:    []string{"Get repo info", "View repository details"},
		Parameters:  "owner: Repo owner, repo: Repo name",
	},
	{
		ID:          "github_add_comment",
		Name:        "GitHub Add Comment",
		Description: "Add comment to GitHub issue/PR",
		Category:    "code_devops",
		Icon:        "MessageSquare",
		Keywords:    []string{"github", "comment", "issue", "pr", "pull request"},
		UseCases:    []string{"Comment on issues", "Reply to PRs"},
		Parameters:  "owner: Repo owner, repo: Repo name, issue_number: Issue number, body: Comment",
	},
	{
		ID:          "gitlab_projects",
		Name:        "GitLab Projects",
		Description: "List GitLab projects",
		Category:    "code_devops",
		Icon:        "Folder",
		Keywords:    []string{"gitlab", "project", "list", "repo"},
		UseCases:    []string{"List GitLab projects", "View repositories"},
		Parameters:  "None required",
	},
	{
		ID:          "gitlab_issues",
		Name:        "GitLab Issues",
		Description: "List GitLab issues",
		Category:    "code_devops",
		Icon:        "List",
		Keywords:    []string{"gitlab", "issue", "list", "bug"},
		UseCases:    []string{"List GitLab issues", "View project issues"},
		Parameters:  "project_id: Project ID",
	},
	{
		ID:          "gitlab_mrs",
		Name:        "GitLab Merge Requests",
		Description: "List GitLab merge requests",
		Category:    "code_devops",
		Icon:        "GitMerge",
		Keywords:    []string{"gitlab", "merge request", "mr", "pull request", "pr"},
		UseCases:    []string{"List merge requests", "View MRs"},
		Parameters:  "project_id: Project ID",
	},
	{
		ID:          "netlify_sites",
		Name:        "Netlify Sites",
		Description: "List Netlify sites",
		Category:    "code_devops",
		Icon:        "Globe",
		Keywords:    []string{"netlify", "site", "list", "deploy", "hosting"},
		UseCases:    []string{"List Netlify sites", "View deployed sites"},
		Parameters:  "None required",
	},
	{
		ID:          "netlify_deploys",
		Name:        "Netlify Deploys",
		Description: "List Netlify deploys",
		Category:    "code_devops",
		Icon:        "Rocket",
		Keywords:    []string{"netlify", "deploy", "list", "build", "release"},
		UseCases:    []string{"List deploys", "View build history"},
		Parameters:  "site_id: Site ID",
	},
	{
		ID:          "netlify_trigger_build",
		Name:        "Netlify Trigger Build",
		Description: "Trigger a Netlify build",
		Category:    "code_devops",
		Icon:        "Play",
		Keywords:    []string{"netlify", "build", "trigger", "deploy", "release"},
		UseCases:    []string{"Trigger builds", "Deploy sites"},
		Parameters:  "site_id: Site ID",
	},

	// ═══════════════════════════════════════════════════════════════
	// 📓 PRODUCTIVITY
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "notion_search",
		Name:        "Notion Search",
		Description: "Search Notion pages/databases",
		Category:    "productivity",
		Icon:        "Search",
		Keywords:    []string{"notion", "search", "page", "database", "find"},
		UseCases:    []string{"Search Notion", "Find pages"},
		Parameters:  "query: Search query",
	},
	{
		ID:          "notion_query_database",
		Name:        "Notion Query Database",
		Description: "Query a Notion database",
		Category:    "productivity",
		Icon:        "Database",
		Keywords:    []string{"notion", "database", "query", "filter", "table"},
		UseCases:    []string{"Query databases", "Filter records"},
		Parameters:  "database_id: Database ID, filter: Optional filter",
	},
	{
		ID:          "notion_create_page",
		Name:        "Notion Create Page",
		Description: "Create a Notion page",
		Category:    "productivity",
		Icon:        "FilePlus",
		Keywords:    []string{"notion", "create", "page", "new", "doc"},
		UseCases:    []string{"Create pages", "Add documents"},
		Parameters:  "parent_id: Parent page/database ID, properties: Page properties",
	},
	{
		ID:          "notion_update_page",
		Name:        "Notion Update Page",
		Description: "Update a Notion page",
		Category:    "productivity",
		Icon:        "Edit",
		Keywords:    []string{"notion", "update", "edit", "page", "modify"},
		UseCases:    []string{"Update pages", "Edit documents"},
		Parameters:  "page_id: Page ID, properties: Properties to update",
	},
	{
		ID:          "airtable_list",
		Name:        "Airtable List Records",
		Description: "List Airtable records",
		Category:    "productivity",
		Icon:        "Table",
		Keywords:    []string{"airtable", "list", "records", "table", "database"},
		UseCases:    []string{"List records", "View table data"},
		Parameters:  "base_id: Base ID, table_name: Table name",
	},
	{
		ID:          "airtable_read",
		Name:        "Airtable Read Record",
		Description: "Read a single Airtable record",
		Category:    "productivity",
		Icon:        "Eye",
		Keywords:    []string{"airtable", "read", "record", "get", "single"},
		UseCases:    []string{"Read records", "Get single record"},
		Parameters:  "base_id: Base ID, table_name: Table name, record_id: Record ID",
	},
	{
		ID:          "airtable_create",
		Name:        "Airtable Create Record",
		Description: "Create an Airtable record",
		Category:    "productivity",
		Icon:        "Plus",
		Keywords:    []string{"airtable", "create", "record", "new", "add"},
		UseCases:    []string{"Create records", "Add data"},
		Parameters:  "base_id: Base ID, table_name: Table name, fields: Record fields",
	},
	{
		ID:          "airtable_update",
		Name:        "Airtable Update Record",
		Description: "Update an Airtable record",
		Category:    "productivity",
		Icon:        "Edit",
		Keywords:    []string{"airtable", "update", "record", "edit", "modify"},
		UseCases:    []string{"Update records", "Modify data"},
		Parameters:  "base_id: Base ID, table_name: Table name, record_id: Record ID, fields: Fields to update",
	},
	{
		ID:          "sharepoint_list_sites",
		Name:        "SharePoint - List Sites",
		Description: "List all SharePoint sites accessible to the user",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "sites", "list", "microsoft", "composio"},
		UseCases:    []string{"List SharePoint sites", "Discover available sites"},
		Parameters:  "None required",
	},
	{
		ID:          "sharepoint_get_site",
		Name:        "SharePoint - Get Site",
		Description: "Get detailed information about a specific SharePoint site",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "site", "get", "microsoft", "composio"},
		UseCases:    []string{"Get site details", "View site information"},
		Parameters:  "site_id: SharePoint site ID",
	},
	{
		ID:          "sharepoint_list_lists",
		Name:        "SharePoint - List Lists",
		Description: "List all SharePoint lists in a site",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "lists", "list", "microsoft", "composio"},
		UseCases:    []string{"List SharePoint lists", "Discover available lists"},
		Parameters:  "site_id: Optional SharePoint site ID",
	},
	{
		ID:          "sharepoint_get_list_items",
		Name:        "SharePoint - Get List Items",
		Description: "Retrieve items from a SharePoint list with optional filtering and sorting",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "list", "items", "get", "microsoft", "composio"},
		UseCases:    []string{"Get list items", "Retrieve list entries", "Filter list data"},
		Parameters:  "list_title: List title, top: Max items, filter: OData filter, orderby: Sort order",
	},
	{
		ID:          "sharepoint_create_list_item",
		Name:        "SharePoint - Create List Item",
		Description: "Create a new item in a SharePoint list",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "list", "create", "item", "microsoft", "composio"},
		UseCases:    []string{"Create list items", "Add entries", "New list data"},
		Parameters:  "list_name: List name, item_properties: Field values as key-value pairs",
	},
	{
		ID:          "sharepoint_update_list_item",
		Name:        "SharePoint - Update List Item",
		Description: "Update an existing item in a SharePoint list",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "list", "update", "item", "microsoft", "composio"},
		UseCases:    []string{"Update list items", "Modify entries", "Edit list data"},
		Parameters:  "list_title: List title, item_id: Item ID, fields: Fields to update",
	},
	{
		ID:          "sharepoint_delete_list_item",
		Name:        "SharePoint - Delete List Item",
		Description: "Delete an item from a SharePoint list",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "list", "delete", "item", "microsoft", "composio"},
		UseCases:    []string{"Delete list items", "Remove entries"},
		Parameters:  "list_title: List title, item_id: Item ID",
	},
	{
		ID:          "sharepoint_upload_file",
		Name:        "SharePoint - Upload File",
		Description: "Upload a file to a SharePoint document library or folder",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "upload", "file", "microsoft", "composio"},
		UseCases:    []string{"Upload files", "Add documents", "File storage"},
		Parameters:  "folder_relative_url: Target folder URL, file_content: Base64 content, file_name: File name",
	},
	{
		ID:          "sharepoint_download_file",
		Name:        "SharePoint - Download File",
		Description: "Download a file from SharePoint",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "download", "file", "microsoft", "composio"},
		UseCases:    []string{"Download files", "Get documents", "Retrieve files"},
		Parameters:  "server_relative_url: File URL in SharePoint",
	},
	{
		ID:          "sharepoint_search",
		Name:        "SharePoint - Search",
		Description: "Search SharePoint sites for content with KQL support",
		Category:    "productivity",
		Icon:        "Folder",
		Keywords:    []string{"sharepoint", "search", "find", "microsoft", "composio"},
		UseCases:    []string{"Search SharePoint", "Find content", "Document search"},
		Parameters:  "querytext: Search query, rowlimit: Max results",
	},

	// ═══════════════════════════════════════════════════════════════
	// 🛒 E-COMMERCE
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "shopify_products",
		Name:        "Shopify Products",
		Description: "List Shopify products",
		Category:    "ecommerce",
		Icon:        "ShoppingBag",
		Keywords:    []string{"shopify", "product", "list", "inventory", "catalog"},
		UseCases:    []string{"List products", "View inventory"},
		Parameters:  "None required",
	},
	{
		ID:          "shopify_orders",
		Name:        "Shopify Orders",
		Description: "List Shopify orders",
		Category:    "ecommerce",
		Icon:        "ShoppingCart",
		Keywords:    []string{"shopify", "order", "list", "sales", "purchase"},
		UseCases:    []string{"List orders", "View sales"},
		Parameters:  "status: Optional status filter",
	},
	{
		ID:          "shopify_customers",
		Name:        "Shopify Customers",
		Description: "List Shopify customers",
		Category:    "ecommerce",
		Icon:        "Users",
		Keywords:    []string{"shopify", "customer", "list", "buyer"},
		UseCases:    []string{"List customers", "View buyers"},
		Parameters:  "None required",
	},

	// ═══════════════════════════════════════════════════════════════
	// 🗄️ DATABASE
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "mongodb_query",
		Name:        "MongoDB Query",
		Description: "Query MongoDB collections - find, aggregate, count documents",
		Category:    "database",
		Icon:        "Database",
		Keywords:    []string{"mongodb", "mongo", "database", "query", "find", "aggregate", "nosql", "document", "collection"},
		UseCases:    []string{"Query MongoDB collections", "Find documents", "Aggregate data", "Count records"},
		Parameters:  "action: find|aggregate|count, collection: Collection name, filter: Query filter, pipeline: Aggregation pipeline",
	},
	{
		ID:          "mongodb_write",
		Name:        "MongoDB Write",
		Description: "Write to MongoDB - insert or update documents (delete not permitted)",
		Category:    "database",
		Icon:        "DatabaseBackup",
		Keywords:    []string{"mongodb", "mongo", "database", "insert", "update", "write", "create", "modify", "insertOne", "insertMany", "updateOne", "updateMany"},
		UseCases:    []string{"Insert single document", "Insert multiple documents", "Update single record", "Update multiple records"},
		Parameters:  "action: insertOne|insertMany|updateOne|updateMany, collection: Collection name, document: Document to insert, documents: Array for insertMany, filter: Update filter, update: Update operations",
		CodeBlockExample: `{"action": "insertOne", "collection": "users", "document": {"name": "John", "email": "john@example.com"}}`,
	},
	{
		ID:          "redis_read",
		Name:        "Redis Read",
		Description: "Read from Redis - get keys, scan, list operations",
		Category:    "database",
		Icon:        "Database",
		Keywords:    []string{"redis", "cache", "key-value", "read", "get", "scan", "list", "hash", "set"},
		UseCases:    []string{"Get cached values", "Read keys", "Scan patterns", "List operations"},
		Parameters:  "action: get|mget|scan|hgetall|lrange|smembers, key: Redis key, pattern: Scan pattern",
		CodeBlockExample: `{"action": "get", "key": "{{start.input}}"}`,
	},
	{
		ID:          "redis_write",
		Name:        "Redis Write",
		Description: "Write to Redis - set keys, lists, hashes, with TTL support",
		Category:    "database",
		Icon:        "DatabaseBackup",
		Keywords:    []string{"redis", "cache", "key-value", "write", "set", "expire", "list", "hash", "push"},
		UseCases:    []string{"Set cache values", "Store data", "Queue operations", "Set expiry"},
		Parameters:  "action: set|mset|hset|lpush|rpush|sadd|del, key: Redis key, value: Value to set, ttl: Optional TTL in seconds",
		CodeBlockExample: `{"action": "set", "key": "{{start.input}}", "value": "{{previous-block.response}}"}`,
	},

	// ═══════════════════════════════════════════════════════════════
	// 🐦 SOCIAL MEDIA
	// ═══════════════════════════════════════════════════════════════
	{
		ID:          "x_search_posts",
		Name:        "X Search Posts",
		Description: "Search X/Twitter posts",
		Category:    "social_media",
		Icon:        "Twitter",
		Keywords:    []string{"twitter", "x", "search", "tweet", "post", "social"},
		UseCases:    []string{"Search tweets", "Find posts"},
		Parameters:  "query: Search query",
	},
	{
		ID:          "x_post_tweet",
		Name:        "X Post Tweet",
		Description: "Post to X/Twitter",
		Category:    "social_media",
		Icon:        "Send",
		Keywords:    []string{"twitter", "x", "post", "tweet", "publish"},
		UseCases:    []string{"Post tweets", "Share content"},
		Parameters:  "text: Tweet text",
	},
	{
		ID:          "x_get_user",
		Name:        "X Get User",
		Description: "Get X/Twitter user info",
		Category:    "social_media",
		Icon:        "User",
		Keywords:    []string{"twitter", "x", "user", "profile", "account"},
		UseCases:    []string{"Get user info", "View profiles"},
		Parameters:  "username: Twitter username",
	},
	{
		ID:          "x_get_user_posts",
		Name:        "X Get User Posts",
		Description: "Get user's X/Twitter posts",
		Category:    "social_media",
		Icon:        "List",
		Keywords:    []string{"twitter", "x", "user", "posts", "tweets", "timeline"},
		UseCases:    []string{"Get user tweets", "View timeline"},
		Parameters:  "user_id: User ID",
	},
}

// ToolCategoryRegistry defines all tool categories
var ToolCategoryRegistry = []ToolCategory{
	{ID: "data_analysis", Name: "Data & Analysis", Icon: "BarChart2", Description: "Analyze data, create charts, and work with spreadsheets"},
	{ID: "search_web", Name: "Search & Web", Icon: "Search", Description: "Search the web, scrape URLs, and download files"},
	{ID: "content_creation", Name: "Content Creation", Icon: "FileText", Description: "Create documents, presentations, and images"},
	{ID: "media_processing", Name: "Media Processing", Icon: "Mic", Description: "Transcribe audio and analyze images"},
	{ID: "utilities", Name: "Utilities", Icon: "Clock", Description: "Time, code execution, and API requests"},
	{ID: "messaging", Name: "Messaging", Icon: "MessageCircle", Description: "Send messages via Discord, Slack, email, SMS, etc."},
	{ID: "video_conferencing", Name: "Video Conferencing", Icon: "Video", Description: "Zoom meetings, webinars, and Calendly"},
	{ID: "project_management", Name: "Project Management", Icon: "CheckSquare", Description: "Jira, Linear, ClickUp, Trello, Asana"},
	{ID: "crm_sales", Name: "CRM & Sales", Icon: "Users", Description: "HubSpot, LeadSquared, Mailchimp"},
	{ID: "analytics", Name: "Analytics", Icon: "BarChart", Description: "PostHog and Mixpanel tracking"},
	{ID: "code_devops", Name: "Code & DevOps", Icon: "GitBranch", Description: "GitHub, GitLab, and Netlify"},
	{ID: "productivity", Name: "Productivity", Icon: "Layout", Description: "Notion and Airtable"},
	{ID: "ecommerce", Name: "E-Commerce", Icon: "ShoppingBag", Description: "Shopify products, orders, and customers"},
	{ID: "social_media", Name: "Social Media", Icon: "Twitter", Description: "X/Twitter posts and interactions"},
	{ID: "database", Name: "Database", Icon: "Database", Description: "MongoDB and Redis database operations"},
}

// GetToolsByCategory returns all tools in a given category
func GetToolsByCategory(categoryID string) []ToolDefinition {
	var tools []ToolDefinition
	for _, tool := range ToolRegistry {
		if tool.Category == categoryID {
			tools = append(tools, tool)
		}
	}
	return tools
}

// GetToolByID returns a tool by its ID
func GetToolByID(toolID string) *ToolDefinition {
	for _, tool := range ToolRegistry {
		if tool.ID == toolID {
			return &tool
		}
	}
	return nil
}

// GetAllToolIDs returns all tool IDs
func GetAllToolIDs() []string {
	ids := make([]string, len(ToolRegistry))
	for i, tool := range ToolRegistry {
		ids[i] = tool.ID
	}
	return ids
}

// BuildToolPromptSection builds a prompt section for specific tools
func BuildToolPromptSection(toolIDs []string) string {
	if len(toolIDs) == 0 {
		return ""
	}

	// Group tools by category for better organization
	categoryTools := make(map[string][]ToolDefinition)
	for _, toolID := range toolIDs {
		if tool := GetToolByID(toolID); tool != nil {
			categoryTools[tool.Category] = append(categoryTools[tool.Category], *tool)
		}
	}

	var builder strings.Builder
	builder.WriteString("=== AVAILABLE TOOLS (Selected for this workflow) ===\n\n")

	// Get category info for display
	categoryInfo := make(map[string]ToolCategory)
	for _, cat := range ToolCategoryRegistry {
		categoryInfo[cat.ID] = cat
	}

	for catID, tools := range categoryTools {
		if cat, ok := categoryInfo[catID]; ok {
			builder.WriteString(cat.Name + ":\n")
		}
		for _, tool := range tools {
			builder.WriteString("- " + tool.ID + ": " + tool.Description + "\n")
			if tool.Parameters != "" {
				builder.WriteString("  Parameters: " + tool.Parameters + "\n")
			}
			// Include code_block example if available - shows how to configure argumentMapping
			if tool.CodeBlockExample != "" {
				builder.WriteString("  code_block argumentMapping: " + tool.CodeBlockExample + "\n")
			}
		}
		builder.WriteString("\n")
	}

	return builder.String()
}
