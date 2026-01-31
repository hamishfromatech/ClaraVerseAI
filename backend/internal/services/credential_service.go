package services

import (
	"claraverse/internal/crypto"
	"claraverse/internal/database"
	"claraverse/internal/models"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	// CollectionCredentials is the MongoDB collection name
	CollectionCredentials = "credentials"
)

// CredentialService manages encrypted credentials for integrations
type CredentialService struct {
	mongoDB    *database.MongoDB
	encryption *crypto.EncryptionService
}

// NewCredentialService creates a new credential service
func NewCredentialService(mongoDB *database.MongoDB, encryption *crypto.EncryptionService) *CredentialService {
	return &CredentialService{
		mongoDB:    mongoDB,
		encryption: encryption,
	}
}

// collection returns the credentials collection
func (s *CredentialService) collection() *mongo.Collection {
	return s.mongoDB.Database().Collection(CollectionCredentials)
}

// Create creates a new credential with encrypted data
func (s *CredentialService) Create(ctx context.Context, userID string, req *models.CreateCredentialRequest) (*models.CredentialListItem, error) {
	// Validate integration type exists
	integration, exists := models.GetIntegration(req.IntegrationType)
	if !exists {
		return nil, fmt.Errorf("unknown integration type: %s", req.IntegrationType)
	}

	// Validate required fields
	if err := models.ValidateCredentialData(req.IntegrationType, req.Data); err != nil {
		return nil, err
	}

	// Serialize data to JSON
	dataJSON, err := json.Marshal(req.Data)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize credential data: %w", err)
	}

	// Encrypt the data
	encryptedData, err := s.encryption.Encrypt(userID, dataJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt credential data: %w", err)
	}

	// Generate masked preview
	maskedPreview := models.GenerateMaskedPreview(req.IntegrationType, req.Data)

	now := time.Now()
	credential := &models.Credential{
		UserID:          userID,
		Name:            req.Name,
		IntegrationType: req.IntegrationType,
		EncryptedData:   encryptedData,
		Metadata: models.CredentialMetadata{
			MaskedPreview: maskedPreview,
			Icon:          integration.Icon,
			UsageCount:    0,
			TestStatus:    "pending",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	result, err := s.collection().InsertOne(ctx, credential)
	if err != nil {
		return nil, fmt.Errorf("failed to create credential: %w", err)
	}

	credential.ID = result.InsertedID.(primitive.ObjectID)

	log.Printf("🔐 [CREDENTIAL] Created credential %s (%s) for user %s",
		credential.ID.Hex(), req.IntegrationType, userID)

	return credential.ToListItem(), nil
}

// GetByID retrieves a credential by ID (metadata only, no decryption)
func (s *CredentialService) GetByID(ctx context.Context, credentialID primitive.ObjectID) (*models.Credential, error) {
	var credential models.Credential
	err := s.collection().FindOne(ctx, bson.M{"_id": credentialID}).Decode(&credential)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, fmt.Errorf("credential not found")
		}
		return nil, fmt.Errorf("failed to get credential: %w", err)
	}
	return &credential, nil
}

// GetByIDAndUser retrieves a credential ensuring user ownership
func (s *CredentialService) GetByIDAndUser(ctx context.Context, credentialID primitive.ObjectID, userID string) (*models.Credential, error) {
	var credential models.Credential
	err := s.collection().FindOne(ctx, bson.M{
		"_id":    credentialID,
		"userId": userID,
	}).Decode(&credential)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, fmt.Errorf("credential not found")
		}
		return nil, fmt.Errorf("failed to get credential: %w", err)
	}
	return &credential, nil
}

// GetDecrypted retrieves and decrypts a credential for tool use
// SECURITY: This should ONLY be called by tools, never exposed to API/LLM
func (s *CredentialService) GetDecrypted(ctx context.Context, userID string, credentialID primitive.ObjectID) (*models.DecryptedCredential, error) {
	// Get the credential with ownership verification
	credential, err := s.GetByIDAndUser(ctx, credentialID, userID)
	if err != nil {
		return nil, err
	}

	// Decrypt the data
	decryptedJSON, err := s.encryption.Decrypt(userID, credential.EncryptedData)
	if err != nil {
		log.Printf("⚠️ [CREDENTIAL] Decryption failed for credential %s: %v", credentialID.Hex(), err)
		return nil, fmt.Errorf("failed to decrypt credential")
	}

	// Parse JSON
	var data map[string]interface{}
	if err := json.Unmarshal(decryptedJSON, &data); err != nil {
		return nil, fmt.Errorf("failed to parse credential data: %w", err)
	}

	// Update usage stats asynchronously
	go s.updateUsageStats(context.Background(), credentialID)

	return &models.DecryptedCredential{
		ID:              credential.ID.Hex(),
		Name:            credential.Name,
		IntegrationType: credential.IntegrationType,
		Data:            data,
	}, nil
}

// GetDecryptedByName retrieves and decrypts a credential by name for tool use
// SECURITY: This should ONLY be called by tools, never exposed to API/LLM
func (s *CredentialService) GetDecryptedByName(ctx context.Context, userID string, integrationType string, name string) (*models.DecryptedCredential, error) {
	var credential models.Credential
	err := s.collection().FindOne(ctx, bson.M{
		"userId":          userID,
		"integrationType": integrationType,
		"name":            name,
	}).Decode(&credential)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, fmt.Errorf("credential not found")
		}
		return nil, fmt.Errorf("failed to get credential: %w", err)
	}

	// Decrypt the data
	decryptedJSON, err := s.encryption.Decrypt(userID, credential.EncryptedData)
	if err != nil {
		log.Printf("⚠️ [CREDENTIAL] Decryption failed for credential %s: %v", credential.ID.Hex(), err)
		return nil, fmt.Errorf("failed to decrypt credential")
	}

	// Parse JSON
	var data map[string]interface{}
	if err := json.Unmarshal(decryptedJSON, &data); err != nil {
		return nil, fmt.Errorf("failed to parse credential data: %w", err)
	}

	// Update usage stats asynchronously
	go s.updateUsageStats(context.Background(), credential.ID)

	return &models.DecryptedCredential{
		ID:              credential.ID.Hex(),
		Name:            credential.Name,
		IntegrationType: credential.IntegrationType,
		Data:            data,
	}, nil
}

// ListByUser returns all credentials for a user (metadata only)
func (s *CredentialService) ListByUser(ctx context.Context, userID string) ([]*models.CredentialListItem, error) {
	cursor, err := s.collection().Find(ctx, bson.M{
		"userId": userID,
	}, options.Find().SetSort(bson.D{
		{Key: "integrationType", Value: 1},
		{Key: "name", Value: 1},
	}))
	if err != nil {
		return nil, fmt.Errorf("failed to list credentials: %w", err)
	}
	defer cursor.Close(ctx)

	var credentials []*models.CredentialListItem
	for cursor.Next(ctx) {
		var cred models.Credential
		if err := cursor.Decode(&cred); err != nil {
			continue
		}
		credentials = append(credentials, cred.ToListItem())
	}

	if credentials == nil {
		credentials = []*models.CredentialListItem{}
	}

	return credentials, nil
}

// ListByUserAndType returns credentials for a specific integration type
func (s *CredentialService) ListByUserAndType(ctx context.Context, userID string, integrationType string) ([]*models.CredentialListItem, error) {
	cursor, err := s.collection().Find(ctx, bson.M{
		"userId":          userID,
		"integrationType": integrationType,
	}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("failed to list credentials: %w", err)
	}
	defer cursor.Close(ctx)

	var credentials []*models.CredentialListItem
	for cursor.Next(ctx) {
		var cred models.Credential
		if err := cursor.Decode(&cred); err != nil {
			continue
		}
		credentials = append(credentials, cred.ToListItem())
	}

	if credentials == nil {
		credentials = []*models.CredentialListItem{}
	}

	return credentials, nil
}

// Update updates a credential's name and/or data
func (s *CredentialService) Update(ctx context.Context, credentialID primitive.ObjectID, userID string, req *models.UpdateCredentialRequest) (*models.CredentialListItem, error) {
	// Get existing credential
	credential, err := s.GetByIDAndUser(ctx, credentialID, userID)
	if err != nil {
		return nil, err
	}

	updateFields := bson.M{
		"updatedAt": time.Now(),
	}

	// Update name if provided
	if req.Name != "" {
		updateFields["name"] = req.Name
	}

	// Update data if provided (requires re-encryption)
	if req.Data != nil {
		// Validate the new data
		if err := models.ValidateCredentialData(credential.IntegrationType, req.Data); err != nil {
			return nil, err
		}

		// Serialize and encrypt new data
		dataJSON, err := json.Marshal(req.Data)
		if err != nil {
			return nil, fmt.Errorf("failed to serialize credential data: %w", err)
		}

		encryptedData, err := s.encryption.Encrypt(userID, dataJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to encrypt credential data: %w", err)
		}

		updateFields["encryptedData"] = encryptedData
		updateFields["metadata.maskedPreview"] = models.GenerateMaskedPreview(credential.IntegrationType, req.Data)
		updateFields["metadata.testStatus"] = "pending" // Reset test status
	}

	_, err = s.collection().UpdateByID(ctx, credentialID, bson.M{"$set": updateFields})
	if err != nil {
		return nil, fmt.Errorf("failed to update credential: %w", err)
	}

	// Get updated credential
	updated, err := s.GetByIDAndUser(ctx, credentialID, userID)
	if err != nil {
		return nil, err
	}

	log.Printf("📝 [CREDENTIAL] Updated credential %s for user %s", credentialID.Hex(), userID)

	return updated.ToListItem(), nil
}

// Delete permanently deletes a credential
func (s *CredentialService) Delete(ctx context.Context, credentialID primitive.ObjectID, userID string) error {
	// CRITICAL: Get credential data BEFORE deletion to revoke Composio connections
	credential, err := s.GetByIDAndUser(ctx, credentialID, userID)
	if err != nil {
		return err
	}

	// Revoke Composio OAuth if this is a Composio integration
	if err := s.revokeComposioIfNeeded(ctx, credential); err != nil {
		log.Printf("⚠️ [CREDENTIAL] Failed to revoke Composio connection for %s: %v", credentialID.Hex(), err)
		// Continue with deletion even if revocation fails (connection might already be invalid)
	}

	result, err := s.collection().DeleteOne(ctx, bson.M{
		"_id":    credentialID,
		"userId": userID,
	})
	if err != nil {
		return fmt.Errorf("failed to delete credential: %w", err)
	}

	if result.DeletedCount == 0 {
		return fmt.Errorf("credential not found")
	}

	log.Printf("🗑️ [CREDENTIAL] Deleted credential %s for user %s", credentialID.Hex(), userID)
	return nil
}

// DeleteAllByUser deletes all credentials for a user (for account deletion)
func (s *CredentialService) DeleteAllByUser(ctx context.Context, userID string) (int64, error) {
	result, err := s.collection().DeleteMany(ctx, bson.M{
		"userId": userID,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to delete credentials: %w", err)
	}

	log.Printf("🗑️ [CREDENTIAL] Deleted %d credentials for user %s", result.DeletedCount, userID)
	return result.DeletedCount, nil
}

// UpdateTestStatus updates the test status of a credential
func (s *CredentialService) UpdateTestStatus(ctx context.Context, credentialID primitive.ObjectID, userID string, status string, err error) error {
	updateFields := bson.M{
		"metadata.testStatus": status,
		"metadata.lastTestAt": time.Now(),
		"updatedAt":           time.Now(),
	}

	_, updateErr := s.collection().UpdateOne(ctx, bson.M{
		"_id":    credentialID,
		"userId": userID,
	}, bson.M{"$set": updateFields})
	if updateErr != nil {
		return fmt.Errorf("failed to update test status: %w", updateErr)
	}

	return nil
}

// updateUsageStats updates the usage statistics for a credential
func (s *CredentialService) updateUsageStats(ctx context.Context, credentialID primitive.ObjectID) {
	_, err := s.collection().UpdateByID(ctx, credentialID, bson.M{
		"$set": bson.M{
			"metadata.lastUsedAt": time.Now(),
		},
		"$inc": bson.M{
			"metadata.usageCount": 1,
		},
	})
	if err != nil {
		log.Printf("⚠️ [CREDENTIAL] Failed to update usage stats: %v", err)
	}
}

// CountByUser counts credentials for a user
func (s *CredentialService) CountByUser(ctx context.Context, userID string) (int64, error) {
	count, err := s.collection().CountDocuments(ctx, bson.M{
		"userId": userID,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to count credentials: %w", err)
	}
	return count, nil
}

// CountByUserAndType counts credentials for a user by type
func (s *CredentialService) CountByUserAndType(ctx context.Context, userID string, integrationType string) (int64, error) {
	count, err := s.collection().CountDocuments(ctx, bson.M{
		"userId":          userID,
		"integrationType": integrationType,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to count credentials: %w", err)
	}
	return count, nil
}

// GetCredentialReferences returns credential references for use in LLM context
// This returns only names and IDs, safe to show to LLM
func (s *CredentialService) GetCredentialReferences(ctx context.Context, userID string, integrationTypes []string) ([]models.CredentialReference, error) {
	filter := bson.M{"userId": userID}
	if len(integrationTypes) > 0 {
		filter["integrationType"] = bson.M{"$in": integrationTypes}
	}

	cursor, err := s.collection().Find(ctx, filter, options.Find().
		SetProjection(bson.M{
			"_id":             1,
			"name":            1,
			"integrationType": 1,
		}).
		SetSort(bson.D{
			{Key: "integrationType", Value: 1},
			{Key: "name", Value: 1},
		}))
	if err != nil {
		return nil, fmt.Errorf("failed to get credential references: %w", err)
	}
	defer cursor.Close(ctx)

	var refs []models.CredentialReference
	for cursor.Next(ctx) {
		var cred struct {
			ID              primitive.ObjectID `bson:"_id"`
			Name            string             `bson:"name"`
			IntegrationType string             `bson:"integrationType"`
		}
		if err := cursor.Decode(&cred); err != nil {
			continue
		}
		refs = append(refs, models.CredentialReference{
			ID:              cred.ID.Hex(),
			Name:            cred.Name,
			IntegrationType: cred.IntegrationType,
		})
	}

	if refs == nil {
		refs = []models.CredentialReference{}
	}

	return refs, nil
}

// revokeComposioIfNeeded revokes Composio OAuth connection when deleting a Composio credential
func (s *CredentialService) revokeComposioIfNeeded(ctx context.Context, credential *models.Credential) error {
	// Only revoke if this is a Composio integration
	if len(credential.IntegrationType) < 9 || credential.IntegrationType[:9] != "composio_" {
		return nil // Not a Composio integration
	}

	composioAPIKey := os.Getenv("COMPOSIO_API_KEY")
	if composioAPIKey == "" {
		return fmt.Errorf("COMPOSIO_API_KEY not set")
	}

	// Decrypt credential data to get entity_id
	decryptedJSON, err := s.encryption.Decrypt(credential.UserID, credential.EncryptedData)
	if err != nil {
		return fmt.Errorf("failed to decrypt credential: %w", err)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(decryptedJSON, &data); err != nil {
		return fmt.Errorf("failed to parse credential data: %w", err)
	}

	entityID, ok := data["composio_entity_id"].(string)
	if !ok || entityID == "" {
		return fmt.Errorf("no composio_entity_id found")
	}

	// Extract app name from integration type (e.g., "composio_gmail" -> "gmail")
	appName := credential.IntegrationType[9:] // Remove "composio_" prefix

	// Get connected account ID from Composio v3 API
	connectedAccountID, err := s.getComposioConnectedAccountID(ctx, composioAPIKey, entityID, appName)
	if err != nil {
		return fmt.Errorf("failed to get connected account: %w", err)
	}

	// Delete the connected account (revokes OAuth)
	deleteURL := fmt.Sprintf("https://backend.composio.dev/api/v3/connected_accounts/%s", connectedAccountID)
	req, err := http.NewRequestWithContext(ctx, "DELETE", deleteURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create delete request: %w", err)
	}

	req.Header.Set("x-api-key", composioAPIKey)

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete connection: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 && resp.StatusCode != 404 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Composio API error (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	log.Printf("✅ [COMPOSIO] Revoked %s connection for entity %s", appName, entityID)
	return nil
}

// getComposioConnectedAccountID retrieves the connected account ID from Composio v3 API
func (s *CredentialService) getComposioConnectedAccountID(ctx context.Context, apiKey string, entityID string, appName string) (string, error) {
	url := fmt.Sprintf("https://backend.composio.dev/api/v3/connected_accounts?user_ids=%s", entityID)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("x-api-key", apiKey)

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to fetch connected accounts: %w", err)
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
		} `json:"items"`
	}
	if err := json.Unmarshal(respBody, &response); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	// Find the connected account for this app
	for _, account := range response.Items {
		if account.Toolkit.Slug == appName {
			return account.ID, nil
		}
	}

	return "", fmt.Errorf("no %s connection found for entity %s", appName, entityID)
}

// EnsureIndexes creates the necessary indexes for the credentials collection
func (s *CredentialService) EnsureIndexes(ctx context.Context) error {
	indexes := []mongo.IndexModel{
		// User ID for listing
		{
			Keys: bson.D{{Key: "userId", Value: 1}},
		},
		// User + integration type for filtering
		{
			Keys: bson.D{
				{Key: "userId", Value: 1},
				{Key: "integrationType", Value: 1},
			},
		},
		// User + name + type for uniqueness (optional, could enforce unique names per type)
		{
			Keys: bson.D{
				{Key: "userId", Value: 1},
				{Key: "integrationType", Value: 1},
				{Key: "name", Value: 1},
			},
		},
	}

	_, err := s.collection().Indexes().CreateMany(ctx, indexes)
	if err != nil {
		return fmt.Errorf("failed to create credential indexes: %w", err)
	}

	log.Println("✅ [CREDENTIAL] Ensured indexes for credentials collection")
	return nil
}

// CreateCredentialResolver creates a credential resolver function that can be
// injected into tool args for runtime credential access.
// This function is here to avoid import cycles (tools cannot import services).
func (s *CredentialService) CreateCredentialResolver(userID string) func(credentialID string) (*models.DecryptedCredential, error) {
	return func(credentialID string) (*models.DecryptedCredential, error) {
		objID, err := primitive.ObjectIDFromHex(credentialID)
		if err != nil {
			return nil, fmt.Errorf("invalid credential ID: %w", err)
		}

		cred, err := s.GetDecrypted(context.Background(), userID, objID)
		if err != nil {
			return nil, fmt.Errorf("failed to retrieve credential: %w", err)
		}

		return cred, nil
	}
}
