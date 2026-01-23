package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// User represents a user with local JWT authentication
type User struct {
	ID             primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	SupabaseUserID string             `bson:"supabaseUserId,omitempty" json:"supabase_user_id,omitempty"` // Legacy field (optional)
	Email          string             `bson:"email" json:"email"`
	CreatedAt      time.Time          `bson:"createdAt" json:"created_at"`
	LastLoginAt    time.Time          `bson:"lastLoginAt" json:"last_login_at"`

	// Local authentication fields (v2.0)
	PasswordHash         string `bson:"passwordHash,omitempty" json:"-"` // Argon2id hash (never expose in API)
	EmailVerified        bool   `bson:"emailVerified" json:"email_verified"`
	RefreshTokenVersion  int    `bson:"refreshTokenVersion" json:"-"` // For token revocation (never expose)
	Role                 string `bson:"role,omitempty" json:"role,omitempty"` // user, admin

	// Subscription fields
	SubscriptionTier      string     `bson:"subscriptionTier,omitempty" json:"subscription_tier,omitempty"`
	SubscriptionStatus    string     `bson:"subscriptionStatus,omitempty" json:"subscription_status,omitempty"`
	SubscriptionExpiresAt *time.Time `bson:"subscriptionExpiresAt,omitempty" json:"subscription_expires_at,omitempty"`

	// Migration audit trail
	MigratedToLegacyAt *time.Time `bson:"migratedToLegacyAt,omitempty" json:"migrated_to_legacy_at,omitempty"`

	// Manual tier override (set by superadmin)
	TierOverride *string `bson:"tierOverride,omitempty" json:"tier_override,omitempty"` // Override tier (if set)

	// Granular limit overrides (set by superadmin) - per-feature overrides
	LimitOverrides *TierLimits `bson:"limitOverrides,omitempty" json:"limit_overrides,omitempty"` // Custom limits per user

	// Audit trail for overrides
	OverrideSetBy  string     `bson:"overrideSetBy,omitempty" json:"override_set_by,omitempty"`     // Admin user ID
	OverrideSetAt  *time.Time `bson:"overrideSetAt,omitempty" json:"override_set_at,omitempty"`     // When override was set
	OverrideReason string     `bson:"overrideReason,omitempty" json:"override_reason,omitempty"`    // Why override was set

	// DodoPayments integration
	DodoCustomerID     string `bson:"dodoCustomerId,omitempty" json:"dodo_customer_id,omitempty"`
	DodoSubscriptionID string `bson:"dodoSubscriptionId,omitempty" json:"-"` // Don't expose in API

	// User preferences
	Preferences UserPreferences `bson:"preferences" json:"preferences"`

	// Onboarding state
	HasSeenWelcomePopup bool `bson:"hasSeenWelcomePopup" json:"has_seen_welcome_popup"`
}

// ChatPrivacyMode represents how chats are stored
type ChatPrivacyMode string

const (
	ChatPrivacyModeLocal ChatPrivacyMode = "local"
	ChatPrivacyModeCloud ChatPrivacyMode = "cloud"
)

// UserPreferences holds user-specific settings
type UserPreferences struct {
	StoreBuilderChatHistory bool            `bson:"storeBuilderChatHistory" json:"store_builder_chat_history"`
	DefaultModelID          string          `bson:"defaultModelId,omitempty" json:"default_model_id,omitempty"`
	ToolPredictorModelID    string          `bson:"toolPredictorModelId,omitempty" json:"tool_predictor_model_id,omitempty"`
	ChatPrivacyMode         ChatPrivacyMode `bson:"chatPrivacyMode,omitempty" json:"chat_privacy_mode,omitempty"`
	Theme                   string          `bson:"theme,omitempty" json:"theme,omitempty"`
	FontSize                string          `bson:"fontSize,omitempty" json:"font_size,omitempty"`

	// Memory system preferences
	MemoryEnabled             bool   `bson:"memoryEnabled" json:"memory_enabled"`                                       // Default: false (opt-in)
	MemoryExtractionThreshold int    `bson:"memoryExtractionThreshold,omitempty" json:"memory_extraction_threshold,omitempty"` // Default: 2 messages (for quick testing, range: 2-50)
	MemoryMaxInjection        int    `bson:"memoryMaxInjection,omitempty" json:"memory_max_injection,omitempty"`       // Default: 5 memories
	MemoryExtractorModelID    string `bson:"memoryExtractorModelId,omitempty" json:"memory_extractor_model_id,omitempty"`
	MemorySelectorModelID     string `bson:"memorySelectorModelId,omitempty" json:"memory_selector_model_id,omitempty"`

	// Transcription preferences
	TranscriptionProvider string `bson:"transcriptionProvider,omitempty" json:"transcription_provider,omitempty"`
	TranscriptionModel    string `bson:"transcriptionModel,omitempty" json:"transcription_model,omitempty"`
}

// UpdateUserPreferencesRequest is the request body for updating preferences
type UpdateUserPreferencesRequest struct {
	StoreBuilderChatHistory *bool            `json:"store_builder_chat_history,omitempty"`
	DefaultModelID          *string          `json:"default_model_id,omitempty"`
	ToolPredictorModelID    *string          `json:"tool_predictor_model_id,omitempty"`
	ChatPrivacyMode         *ChatPrivacyMode `json:"chat_privacy_mode,omitempty"`
	Theme                   *string          `json:"theme,omitempty"`
	FontSize                *string          `json:"font_size,omitempty"`

	// Memory system preferences
	MemoryEnabled             *bool   `json:"memory_enabled,omitempty"`
	MemoryExtractionThreshold *int    `json:"memory_extraction_threshold,omitempty"`
	MemoryMaxInjection        *int    `json:"memory_max_injection,omitempty"`
	MemoryExtractorModelID    *string `json:"memory_extractor_model_id,omitempty"`
	MemorySelectorModelID     *string `json:"memory_selector_model_id,omitempty"`

	// Transcription preferences
	TranscriptionProvider *string `json:"transcription_provider,omitempty"`
	TranscriptionModel    *string `json:"transcription_model,omitempty"`
}

// UserResponse is the API response for user data
type UserResponse struct {
	ID                    string          `json:"id"`
	Email                 string          `json:"email"`
	Role                  string          `json:"role"`
	CreatedAt             time.Time       `json:"created_at"`
	LastLoginAt           time.Time       `json:"last_login_at"`
	SubscriptionTier      string          `json:"subscription_tier,omitempty"`
	SubscriptionStatus    string          `json:"subscription_status,omitempty"`
	SubscriptionExpiresAt *time.Time      `json:"subscription_expires_at,omitempty"`
	Preferences           UserPreferences `json:"preferences"`
	HasSeenWelcomePopup   bool            `json:"has_seen_welcome_popup"`
}

// ToResponse converts User to UserResponse
func (u *User) ToResponse() UserResponse {
	return UserResponse{
		ID:                    u.ID.Hex(),
		Email:                 u.Email,
		Role:                  u.Role,
		CreatedAt:             u.CreatedAt,
		LastLoginAt:           u.LastLoginAt,
		SubscriptionTier:      u.SubscriptionTier,
		SubscriptionStatus:    u.SubscriptionStatus,
		SubscriptionExpiresAt: u.SubscriptionExpiresAt,
		Preferences:           u.Preferences,
		HasSeenWelcomePopup:   u.HasSeenWelcomePopup,
	}
}

// SetLimitOverridesRequest for admin to set granular limit overrides
type SetLimitOverridesRequest struct {
	// Option 1: Set entire tier (simple)
	Tier *string `json:"tier,omitempty"` // Set to a tier name

	// Option 2: Set custom limits (granular)
	Limits *TierLimits `json:"limits,omitempty"` // Custom limits

	// Metadata
	Reason string `json:"reason"` // Why override is being set
}

// AdminUserResponse includes override information
type AdminUserResponse struct {
	UserResponse                      // Embed normal user response
	EffectiveTier     string          `json:"effective_tier"`              // Tier being used
	EffectiveLimits   TierLimits      `json:"effective_limits"`            // Actual limits after overrides
	HasTierOverride   bool            `json:"has_tier_override"`           // Whether tier is overridden
	HasLimitOverrides bool            `json:"has_limit_overrides"`         // Whether limits are overridden
	TierOverride      *string         `json:"tier_override,omitempty"`     //
	LimitOverrides    *TierLimits     `json:"limit_overrides,omitempty"`   //
	OverrideSetBy     string          `json:"override_set_by,omitempty"`   //
	OverrideSetAt     *time.Time      `json:"override_set_at,omitempty"`   //
	OverrideReason    string          `json:"override_reason,omitempty"`   //
}
