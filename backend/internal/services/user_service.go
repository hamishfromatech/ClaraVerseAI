package services

import (
	"claraverse/internal/config"
	"claraverse/internal/database"
	"claraverse/internal/models"
	"context"
	"fmt"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// UserService handles user operations with MongoDB
type UserService struct {
	db           *database.MongoDB
	collection   *mongo.Collection
	config       *config.Config
	usageLimiter *UsageLimiterService
}

// NewUserService creates a new user service
// usageLimiter can be nil and set later via SetUsageLimiter
func NewUserService(db *database.MongoDB, cfg *config.Config, usageLimiter *UsageLimiterService) *UserService {
	return &UserService{
		db:           db,
		collection:   db.Collection(database.CollectionUsers),
		config:       cfg,
		usageLimiter: usageLimiter,
	}
}

// SetUsageLimiter sets the usage limiter (for deferred initialization)
func (s *UserService) SetUsageLimiter(limiter *UsageLimiterService) {
	s.usageLimiter = limiter
}

// SyncUserFromSupabase creates or updates a user from Supabase authentication
// This should be called on every authenticated request to keep user data in sync
func (s *UserService) SyncUserFromSupabase(ctx context.Context, supabaseUserID, email string) (*models.User, error) {
	if supabaseUserID == "" {
		return nil, fmt.Errorf("supabase user ID is required")
	}

	now := time.Now()

	// Determine subscription tier based on promo eligibility
	subscriptionTier := models.TierFree
	var subscriptionExpiresAt *time.Time

	if s.isPromoEligible(now) {
		subscriptionTier = models.TierPro
		expiresAt := now.Add(time.Duration(s.config.PromoDuration) * 24 * time.Hour)
		subscriptionExpiresAt = &expiresAt
	}

	// Use upsert to create or update user
	filter := bson.M{"supabaseUserId": supabaseUserID}
	setOnInsertFields := bson.M{
		"supabaseUserId":     supabaseUserID,
		"createdAt":          now,
		"subscriptionTier":   subscriptionTier,
		"subscriptionStatus": models.SubStatusActive,
		"preferences": models.UserPreferences{
			StoreBuilderChatHistory: true, // Default to storing chat history
		},
	}

	if subscriptionExpiresAt != nil {
		setOnInsertFields["subscriptionExpiresAt"] = subscriptionExpiresAt
	}

	update := bson.M{
		"$set": bson.M{
			"email":       email,
			"lastLoginAt": now,
		},
		"$setOnInsert": setOnInsertFields,
	}

	opts := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	var user models.User
	err := s.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&user)
	if err != nil {
		return nil, fmt.Errorf("failed to sync user: %w", err)
	}

	// Reset usage counters for NEW promo users to ensure clean slate
	// A new user is detected by checking if createdAt is very close to now (within 2 seconds)
	if user.SubscriptionTier == models.TierPro && user.CreatedAt.After(now.Add(-2*time.Second)) {
		if s.usageLimiter != nil {
			if err := s.usageLimiter.ResetAllCounters(ctx, supabaseUserID); err != nil {
				log.Printf("⚠️  Failed to reset usage counters for new promo user %s: %v", supabaseUserID, err)
			} else {
				log.Printf("✅ Reset usage counters for new promo user %s", supabaseUserID)
			}
		}
	}

	return &user, nil
}

// GetUserBySupabaseID retrieves a user by their Supabase user ID
func (s *UserService) GetUserBySupabaseID(ctx context.Context, supabaseUserID string) (*models.User, error) {
	var user models.User
	err := s.collection.FindOne(ctx, bson.M{"supabaseUserId": supabaseUserID}).Decode(&user)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return &user, nil
}

// GetUserByID retrieves a user by their MongoDB ID
func (s *UserService) GetUserByID(ctx context.Context, userID primitive.ObjectID) (*models.User, error) {
	var user models.User
	err := s.collection.FindOne(ctx, bson.M{"_id": userID}).Decode(&user)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return &user, nil
}

// GetUserByEmail retrieves a user by their email address
func (s *UserService) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := s.collection.FindOne(ctx, bson.M{"email": email}).Decode(&user)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return &user, nil
}

// CreateUser creates a new user (for local auth registration)
func (s *UserService) CreateUser(ctx context.Context, user *models.User) error {
	result, err := s.collection.InsertOne(ctx, user)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	// Update user ID with the inserted ID
	if oid, ok := result.InsertedID.(primitive.ObjectID); ok {
		user.ID = oid
	}

	return nil
}

// UpdateUser updates an existing user
func (s *UserService) UpdateUser(ctx context.Context, user *models.User) error {
	filter := bson.M{"_id": user.ID}
	update := bson.M{"$set": user}

	result, err := s.collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}
	if result.MatchedCount == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

// Collection returns the MongoDB collection (for direct access when needed)
func (s *UserService) Collection() *mongo.Collection {
	return s.collection
}

// UpdatePreferences updates a user's preferences
func (s *UserService) UpdatePreferences(ctx context.Context, supabaseUserID string, req *models.UpdateUserPreferencesRequest) (*models.UserPreferences, error) {
	// Build update document
	updateFields := bson.M{}
	if req.StoreBuilderChatHistory != nil {
		updateFields["preferences.storeBuilderChatHistory"] = *req.StoreBuilderChatHistory
	}
	if req.DefaultModelID != nil {
		updateFields["preferences.defaultModelId"] = *req.DefaultModelID
	}
	if req.ToolPredictorModelID != nil {
		updateFields["preferences.toolPredictorModelId"] = *req.ToolPredictorModelID
	}
	if req.ChatPrivacyMode != nil {
		updateFields["preferences.chatPrivacyMode"] = *req.ChatPrivacyMode
	}
	if req.Theme != nil {
		updateFields["preferences.theme"] = *req.Theme
	}
	if req.FontSize != nil {
		updateFields["preferences.fontSize"] = *req.FontSize
	}

	// Memory system preferences
	if req.MemoryEnabled != nil {
		updateFields["preferences.memoryEnabled"] = *req.MemoryEnabled
	}
	if req.MemoryExtractionThreshold != nil {
		updateFields["preferences.memoryExtractionThreshold"] = *req.MemoryExtractionThreshold
	}
	if req.MemoryMaxInjection != nil {
		updateFields["preferences.memoryMaxInjection"] = *req.MemoryMaxInjection
	}
	if req.MemoryExtractorModelID != nil {
		updateFields["preferences.memoryExtractorModelId"] = *req.MemoryExtractorModelID
	}
	if req.MemorySelectorModelID != nil {
		updateFields["preferences.memorySelectorModelId"] = *req.MemorySelectorModelID
	}
	if req.TranscriptionProvider != nil {
		updateFields["preferences.transcriptionProvider"] = *req.TranscriptionProvider
	}
	if req.TranscriptionModel != nil {
		updateFields["preferences.transcriptionModel"] = *req.TranscriptionModel
	}

	if len(updateFields) == 0 {
		// No changes, just return current preferences
		user, err := s.GetUserBySupabaseID(ctx, supabaseUserID)
		if err != nil {
			return nil, err
		}
		return &user.Preferences, nil
	}

	filter := bson.M{"supabaseUserId": supabaseUserID}
	update := bson.M{"$set": updateFields}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)

	var user models.User
	err := s.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&user)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update preferences: %w", err)
	}

	return &user.Preferences, nil
}

// GetPreferences retrieves a user's preferences
func (s *UserService) GetPreferences(ctx context.Context, supabaseUserID string) (*models.UserPreferences, error) {
	user, err := s.GetUserBySupabaseID(ctx, supabaseUserID)
	if err != nil {
		return nil, err
	}
	return &user.Preferences, nil
}

// MarkWelcomePopupSeen marks the welcome popup as seen for a user
func (s *UserService) MarkWelcomePopupSeen(ctx context.Context, supabaseUserID string) error {
	filter := bson.M{"supabaseUserId": supabaseUserID}
	update := bson.M{
		"$set": bson.M{
			"hasSeenWelcomePopup": true,
		},
	}

	result, err := s.collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("failed to mark welcome popup as seen: %w", err)
	}
	if result.MatchedCount == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

// GetUserCount returns the total number of users (for admin analytics)
func (s *UserService) GetUserCount(ctx context.Context) (int64, error) {
	count, err := s.collection.CountDocuments(ctx, bson.M{})
	if err != nil {
		return 0, fmt.Errorf("failed to count users: %w", err)
	}
	return count, nil
}

// ListUsers returns a paginated list of users (for admin)
func (s *UserService) ListUsers(ctx context.Context, skip, limit int64) ([]*models.User, error) {
	opts := options.Find().
		SetSkip(skip).
		SetLimit(limit).
		SetSort(bson.M{"createdAt": -1})

	cursor, err := s.collection.Find(ctx, bson.M{}, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	defer cursor.Close(ctx)

	var users []*models.User
	if err := cursor.All(ctx, &users); err != nil {
		return nil, fmt.Errorf("failed to decode users: %w", err)
	}

	return users, nil
}

// UpdateSubscription updates a user's subscription (for payment integration)
func (s *UserService) UpdateSubscription(ctx context.Context, supabaseUserID, tier string, expiresAt *time.Time) error {
	return s.UpdateSubscriptionWithStatus(ctx, supabaseUserID, tier, "", expiresAt)
}

// UpdateSubscriptionWithStatus updates a user's subscription with status
func (s *UserService) UpdateSubscriptionWithStatus(ctx context.Context, supabaseUserID, tier, status string, expiresAt *time.Time) error {
	filter := bson.M{"supabaseUserId": supabaseUserID}
	updateFields := bson.M{
		"subscriptionTier": tier,
	}
	if status != "" {
		updateFields["subscriptionStatus"] = status
	}
	if expiresAt != nil {
		updateFields["subscriptionExpiresAt"] = expiresAt
	}

	update := bson.M{
		"$set": updateFields,
	}

	result, err := s.collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("failed to update subscription: %w", err)
	}
	if result.MatchedCount == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

// UpdateDodoCustomer updates a user's DodoPayments customer ID
func (s *UserService) UpdateDodoCustomer(ctx context.Context, supabaseUserID, customerID string) error {
	filter := bson.M{"supabaseUserId": supabaseUserID}
	update := bson.M{
		"$set": bson.M{
			"dodoCustomerId": customerID,
		},
	}

	result, err := s.collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("failed to update DodoPayments customer ID: %w", err)
	}
	if result.MatchedCount == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

// DeleteUser deletes a user and all their data (GDPR compliance)
func (s *UserService) DeleteUser(ctx context.Context, supabaseUserID string) error {
	// Get user first to get their MongoDB ID
	user, err := s.GetUserBySupabaseID(ctx, supabaseUserID)
	if err != nil {
		return err
	}

	// Delete user document
	result, err := s.collection.DeleteOne(ctx, bson.M{"_id": user.ID})
	if err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}
	if result.DeletedCount == 0 {
		return fmt.Errorf("user not found")
	}

	// Note: Related data (agents, conversations, etc.) should be deleted
	// in a transaction or by the caller. This could be enhanced with
	// cascade delete logic.

	return nil
}

// isPromoEligible checks if a signup time is within the promotional window
func (s *UserService) isPromoEligible(signupTime time.Time) bool {
	if s.config == nil || !s.config.PromoEnabled {
		return false
	}

	// Check if signup time is within promo window (UTC)
	// Use After for start (exclusive) and Before for end (exclusive)
	return !signupTime.Before(s.config.PromoStartDate) &&
		signupTime.Before(s.config.PromoEndDate)
}

// SetLimitOverrides sets tier OR granular limit overrides for a user (admin only)
func (s *UserService) SetLimitOverrides(ctx context.Context, supabaseUserID, adminUserID, reason string, tier *string, limits *models.TierLimits) error {
	if supabaseUserID == "" {
		return fmt.Errorf("user ID is required")
	}
	if tier == nil && limits == nil {
		return fmt.Errorf("either tier or limits must be provided")
	}

	now := time.Now()
	updateFields := bson.M{
		"overrideSetBy":  adminUserID,
		"overrideSetAt":  now,
		"overrideReason": reason,
	}

	// Set tier override if provided
	if tier != nil {
		updateFields["tierOverride"] = *tier
		// Clear limit overrides when setting tier
		updateFields["limitOverrides"] = nil
	}

	// Set granular limit overrides if provided
	if limits != nil {
		updateFields["limitOverrides"] = limits
		// Clear tier override when setting limits
		updateFields["tierOverride"] = nil
	}

	filter := bson.M{"supabaseUserId": supabaseUserID}
	update := bson.M{"$set": updateFields}

	result, err := s.collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("failed to set overrides: %w", err)
	}
	if result.MatchedCount == 0 {
		return fmt.Errorf("user not found")
	}

	if tier != nil {
		log.Printf("🔐 Admin %s set tier override for user %s: %s (reason: %s)", adminUserID, supabaseUserID, *tier, reason)
	} else {
		log.Printf("🔐 Admin %s set granular limit overrides for user %s (reason: %s)", adminUserID, supabaseUserID, reason)
	}
	return nil
}

// RemoveAllOverrides removes all overrides (tier and limits) for a user (admin only)
func (s *UserService) RemoveAllOverrides(ctx context.Context, supabaseUserID, adminUserID string) error {
	if supabaseUserID == "" {
		return fmt.Errorf("user ID is required")
	}

	update := bson.M{
		"$unset": bson.M{
			"tierOverride":    "",
			"limitOverrides":  "",
			"overrideSetBy":   "",
			"overrideSetAt":   "",
			"overrideReason":  "",
		},
	}

	filter := bson.M{"supabaseUserId": supabaseUserID}
	result, err := s.collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("failed to remove overrides: %w", err)
	}
	if result.MatchedCount == 0 {
		return fmt.Errorf("user not found")
	}

	log.Printf("🔐 Admin %s removed all overrides for user %s", adminUserID, supabaseUserID)
	return nil
}

// GetAdminUserDetails returns detailed user info for admin (includes override info)
func (s *UserService) GetAdminUserDetails(ctx context.Context, supabaseUserID string, tierService *TierService) (*models.AdminUserResponse, error) {
	user, err := s.GetUserBySupabaseID(ctx, supabaseUserID)
	if err != nil {
		return nil, err
	}

	// Get effective tier
	effectiveTier := tierService.GetUserTier(ctx, supabaseUserID)

	// Get effective limits (with overrides applied)
	effectiveLimits := tierService.GetLimits(ctx, supabaseUserID)

	return &models.AdminUserResponse{
		UserResponse:      user.ToResponse(),
		EffectiveTier:     effectiveTier,
		EffectiveLimits:   effectiveLimits,
		HasTierOverride:   user.TierOverride != nil,
		HasLimitOverrides: user.LimitOverrides != nil,
		TierOverride:      user.TierOverride,
		LimitOverrides:    user.LimitOverrides,
		OverrideSetBy:     user.OverrideSetBy,
		OverrideSetAt:     user.OverrideSetAt,
		OverrideReason:    user.OverrideReason,
	}, nil
}
