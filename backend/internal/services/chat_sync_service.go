package services

import (
	"bytes"
	"claraverse/internal/crypto"
	"claraverse/internal/database"
	"claraverse/internal/models"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ChatSyncService handles cloud sync operations for chats with encryption
type ChatSyncService struct {
	db                *database.MongoDB
	collection        *mongo.Collection
	folderCollection  *mongo.Collection
	encryptionService *crypto.EncryptionService
}

// NewChatSyncService creates a new chat sync service
func NewChatSyncService(db *database.MongoDB, encryptionService *crypto.EncryptionService) *ChatSyncService {
	return &ChatSyncService{
		db:                db,
		collection:        db.Collection(database.CollectionChats),
		folderCollection:  db.Collection(database.CollectionFolders),
		encryptionService: encryptionService,
	}
}

// CreateOrUpdateChat creates a new chat or updates an existing one
// Uses atomic upsert to prevent race conditions when multiple syncs arrive simultaneously
func (s *ChatSyncService) CreateOrUpdateChat(ctx context.Context, userID string, req *models.CreateChatRequest) (*models.ChatResponse, error) {
	if userID == "" {
		return nil, fmt.Errorf("user ID is required")
	}
	if req.ID == "" {
		return nil, fmt.Errorf("chat ID is required")
	}

	// Encrypt messages
	messagesJSON, err := json.Marshal(req.Messages)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize messages: %w", err)
	}

	encryptedMessages, err := s.encryptionService.Encrypt(userID, messagesJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt messages: %w", err)
	}

	// Compress encrypted messages to reduce storage size (helps avoid MongoDB 16MB limit)
	compressedMessages, err := s.compressData(encryptedMessages)
	if err != nil {
		return nil, fmt.Errorf("failed to compress messages: %w", err)
	}

	now := time.Now()

	filter := bson.M{
		"userId": userID,
		"chatId": req.ID,
	}

	// Use atomic upsert to handle race conditions
	// $setOnInsert only applies when creating a new document
	// $set applies to both insert and update
	// Note: Cannot use $setOnInsert and $inc on the same field (version),
	// so we set version to 1 on insert via $setOnInsert, and increment for updates via $inc
	update := bson.M{
		"$set": bson.M{
			"title":             req.Title,
			"encryptedMessages": compressedMessages,
			"isStarred":         req.IsStarred,
			"model":             req.Model,
			"updatedAt":         now,
		},
		"$setOnInsert": bson.M{
			"userId":    userID,
			"chatId":    req.ID,
			"createdAt": now,
		},
		"$inc": bson.M{
			"version": 1,
		},
	}

	opts := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	var resultChat models.EncryptedChat
	err = s.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&resultChat)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert chat: %w", err)
	}

	return &models.ChatResponse{
		ID:        req.ID,
		Title:     resultChat.Title,
		Messages:  req.Messages,
		IsStarred: resultChat.IsStarred,
		Model:     resultChat.Model,
		Version:   resultChat.Version,
		FolderID:  resultChat.FolderID,
		CreatedAt: resultChat.CreatedAt,
		UpdatedAt: resultChat.UpdatedAt,
	}, nil
}

// GetChat retrieves and decrypts a single chat
func (s *ChatSyncService) GetChat(ctx context.Context, userID, chatID string) (*models.ChatResponse, error) {
	if userID == "" || chatID == "" {
		return nil, fmt.Errorf("user ID and chat ID are required")
	}

	filter := bson.M{
		"userId": userID,
		"chatId": chatID,
	}

	var chat models.EncryptedChat
	err := s.collection.FindOne(ctx, filter).Decode(&chat)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("chat not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get chat: %w", err)
	}

	// Decrypt messages
	messages, err := s.decryptMessages(userID, chat.EncryptedMessages)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt messages: %w", err)
	}

	return &models.ChatResponse{
		ID:        chat.ChatID,
		Title:     chat.Title,
		Messages:  messages,
		IsStarred: chat.IsStarred,
		Model:     chat.Model,
		Version:   chat.Version,
		FolderID:  chat.FolderID,
		CreatedAt: chat.CreatedAt,
		UpdatedAt: chat.UpdatedAt,
	}, nil
}

// ListChats returns a paginated list of chats (metadata only, no messages)
func (s *ChatSyncService) ListChats(ctx context.Context, userID string, page, pageSize int, starredOnly bool) (*models.ChatListResponse, error) {
	if userID == "" {
		return nil, fmt.Errorf("user ID is required")
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	filter := bson.M{"userId": userID}
	if starredOnly {
		filter["isStarred"] = true
	}

	// Get total count
	totalCount, err := s.collection.CountDocuments(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("failed to count chats: %w", err)
	}

	// Find chats with pagination
	skip := int64((page - 1) * pageSize)
	opts := options.Find().
		SetSort(bson.D{{Key: "updatedAt", Value: -1}}).
		SetSkip(skip).
		SetLimit(int64(pageSize)).
		SetProjection(bson.M{
			"_id":               1,
			"chatId":            1,
			"title":             1,
			"isStarred":         1,
			"model":             1,
			"version":           1,
			"folderId":          1,
			"createdAt":         1,
			"updatedAt":         1,
			"encryptedMessages": 1, // Need this to count messages
		})

	cursor, err := s.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to list chats: %w", err)
	}
	defer cursor.Close(ctx)

	var chats []models.ChatListItem
	for cursor.Next(ctx) {
		var encChat models.EncryptedChat
		if err := cursor.Decode(&encChat); err != nil {
			log.Printf("⚠️ Failed to decode chat: %v", err)
			continue
		}

		// Count messages (decrypt to get count)
		messageCount := 0
		if encChat.EncryptedMessages != "" {
			messages, err := s.decryptMessages(userID, encChat.EncryptedMessages)
			if err == nil {
				messageCount = len(messages)
			}
		}

		chats = append(chats, models.ChatListItem{
			ID:           encChat.ChatID,
			Title:        encChat.Title,
			IsStarred:    encChat.IsStarred,
			Model:        encChat.Model,
			MessageCount: messageCount,
			Version:      encChat.Version,
			FolderID:     encChat.FolderID,
			CreatedAt:    encChat.CreatedAt,
			UpdatedAt:    encChat.UpdatedAt,
		})
	}

	return &models.ChatListResponse{
		Chats:      chats,
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		HasMore:    int64(page*pageSize) < totalCount,
	}, nil
}

// UpdateChat performs a partial update on a chat
func (s *ChatSyncService) UpdateChat(ctx context.Context, userID, chatID string, req *models.UpdateChatRequest) (*models.ChatListItem, error) {
	if userID == "" || chatID == "" {
		return nil, fmt.Errorf("user ID and chat ID are required")
	}

	filter := bson.M{
		"userId":  userID,
		"chatId":  chatID,
		"version": req.Version, // Optimistic locking
	}

	updateFields := bson.M{
		"updatedAt": time.Now(),
	}

	if req.Title != nil {
		updateFields["title"] = *req.Title
	}
	if req.IsStarred != nil {
		updateFields["isStarred"] = *req.IsStarred
	}
	if req.Model != nil {
		updateFields["model"] = *req.Model
	}

	update := bson.M{
		"$set": updateFields,
		"$inc": bson.M{"version": 1},
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var updatedChat models.EncryptedChat
	err := s.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&updatedChat)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("chat not found or version conflict")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update chat: %w", err)
	}

	// Count messages
	messageCount := 0
	if updatedChat.EncryptedMessages != "" {
		messages, err := s.decryptMessages(userID, updatedChat.EncryptedMessages)
		if err == nil {
			messageCount = len(messages)
		}
	}

	return &models.ChatListItem{
		ID:           updatedChat.ChatID,
		Title:        updatedChat.Title,
		IsStarred:    updatedChat.IsStarred,
		Model:        updatedChat.Model,
		MessageCount: messageCount,
		Version:      updatedChat.Version,
		FolderID:     updatedChat.FolderID,
		CreatedAt:    updatedChat.CreatedAt,
		UpdatedAt:    updatedChat.UpdatedAt,
	}, nil
}

// DeleteChat removes a chat
func (s *ChatSyncService) DeleteChat(ctx context.Context, userID, chatID string) error {
	if userID == "" || chatID == "" {
		return fmt.Errorf("user ID and chat ID are required")
	}

	filter := bson.M{
		"userId": userID,
		"chatId": chatID,
	}

	result, err := s.collection.DeleteOne(ctx, filter)
	if err != nil {
		return fmt.Errorf("failed to delete chat: %w", err)
	}

	if result.DeletedCount == 0 {
		return fmt.Errorf("chat not found")
	}

	return nil
}

// BulkSync uploads multiple chats at once
func (s *ChatSyncService) BulkSync(ctx context.Context, userID string, req *models.BulkSyncRequest) (*models.BulkSyncResponse, error) {
	if userID == "" {
		return nil, fmt.Errorf("user ID is required")
	}

	response := &models.BulkSyncResponse{
		ChatIDs: make([]string, 0),
	}

	for _, chatReq := range req.Chats {
		_, err := s.CreateOrUpdateChat(ctx, userID, &chatReq)
		if err != nil {
			response.Failed++
			response.Errors = append(response.Errors, fmt.Sprintf("chat %s: %v", chatReq.ID, err))
			log.Printf("⚠️ Failed to sync chat %s: %v", chatReq.ID, err)
		} else {
			response.Synced++
			response.ChatIDs = append(response.ChatIDs, chatReq.ID)
		}
	}

	return response, nil
}

// GetAllChats returns all chats for initial sync (with decrypted messages)
func (s *ChatSyncService) GetAllChats(ctx context.Context, userID string) (*models.SyncAllResponse, error) {
	if userID == "" {
		return nil, fmt.Errorf("user ID is required")
	}

	filter := bson.M{"userId": userID}
	opts := options.Find().SetSort(bson.D{{Key: "updatedAt", Value: -1}})

	cursor, err := s.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to get chats: %w", err)
	}
	defer cursor.Close(ctx)

	chats := make([]models.ChatResponse, 0) // Initialize empty slice to avoid null in JSON
	for cursor.Next(ctx) {
		var encChat models.EncryptedChat
		if err := cursor.Decode(&encChat); err != nil {
			log.Printf("⚠️ Failed to decode chat: %v", err)
			continue
		}

		// Decrypt messages
		messages, err := s.decryptMessages(userID, encChat.EncryptedMessages)
		if err != nil {
			log.Printf("⚠️ Failed to decrypt messages for chat %s: %v", encChat.ChatID, err)
			continue
		}

		chats = append(chats, models.ChatResponse{
			ID:        encChat.ChatID,
			Title:     encChat.Title,
			Messages:  messages,
			IsStarred: encChat.IsStarred,
			Model:     encChat.Model,
			Version:   encChat.Version,
			FolderID:  encChat.FolderID,
			CreatedAt: encChat.CreatedAt,
			UpdatedAt: encChat.UpdatedAt,
		})
	}

	return &models.SyncAllResponse{
		Chats:      chats,
		TotalCount: len(chats),
		SyncedAt:   time.Now(),
	}, nil
}

// AddMessage adds a single message to a chat with optimistic locking
func (s *ChatSyncService) AddMessage(ctx context.Context, userID, chatID string, req *models.ChatAddMessageRequest) (*models.ChatResponse, error) {
	if userID == "" || chatID == "" {
		return nil, fmt.Errorf("user ID and chat ID are required")
	}

	// Get current chat
	filter := bson.M{
		"userId":  userID,
		"chatId":  chatID,
		"version": req.Version, // Optimistic locking
	}

	var chat models.EncryptedChat
	err := s.collection.FindOne(ctx, filter).Decode(&chat)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("chat not found or version conflict")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get chat: %w", err)
	}

	// Decrypt existing messages
	messages, err := s.decryptMessages(userID, chat.EncryptedMessages)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt messages: %w", err)
	}

	// Add new message
	messages = append(messages, req.Message)

	// Re-encrypt messages
	messagesJSON, err := json.Marshal(messages)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize messages: %w", err)
	}

	encryptedMessages, err := s.encryptionService.Encrypt(userID, messagesJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt messages: %w", err)
	}

	// Compress encrypted messages to reduce storage size
	compressedMessages, err := s.compressData(encryptedMessages)
	if err != nil {
		return nil, fmt.Errorf("failed to compress messages: %w", err)
	}

	// Update chat
	now := time.Now()
	update := bson.M{
		"$set": bson.M{
			"encryptedMessages": compressedMessages,
			"updatedAt":         now,
		},
		"$inc": bson.M{"version": 1},
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var updatedChat models.EncryptedChat
	err = s.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&updatedChat)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("version conflict during update")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update chat: %w", err)
	}

	return &models.ChatResponse{
		ID:        chatID,
		Title:     updatedChat.Title,
		Messages:  messages,
		IsStarred: updatedChat.IsStarred,
		Model:     updatedChat.Model,
		Version:   updatedChat.Version,
		FolderID:  updatedChat.FolderID,
		CreatedAt: updatedChat.CreatedAt,
		UpdatedAt: updatedChat.UpdatedAt,
	}, nil
}

// DeleteAllUserChats removes all chats for a user (GDPR compliance)
func (s *ChatSyncService) DeleteAllUserChats(ctx context.Context, userID string) (int64, error) {
	if userID == "" {
		return 0, fmt.Errorf("user ID is required")
	}

	filter := bson.M{"userId": userID}
	result, err := s.collection.DeleteMany(ctx, filter)
	if err != nil {
		return 0, fmt.Errorf("failed to delete user chats: %w", err)
	}

	return result.DeletedCount, nil
}

// decryptMessages decrypts and decompresses the encrypted messages JSON
func (s *ChatSyncService) decryptMessages(userID, encryptedMessages string) ([]models.ChatMessage, error) {
	if encryptedMessages == "" {
		return []models.ChatMessage{}, nil
	}

	// Decompress if compressed (backward compatible - old data won't have gzip: prefix)
	dataToDecrypt := encryptedMessages
	if strings.HasPrefix(encryptedMessages, "gzip:") {
		compressed := strings.TrimPrefix(encryptedMessages, "gzip:")
		decompressed, err := s.decompressData(compressed)
		if err != nil {
			return nil, fmt.Errorf("failed to decompress messages: %w", err)
		}
		dataToDecrypt = decompressed
	}

	decrypted, err := s.encryptionService.Decrypt(userID, dataToDecrypt)
	if err != nil {
		return nil, err
	}

	var messages []models.ChatMessage
	if err := json.Unmarshal(decrypted, &messages); err != nil {
		return nil, fmt.Errorf("failed to parse messages: %w", err)
	}

	return messages, nil
}

// compressData compresses a string using gzip and returns it with a prefix marker
func (s *ChatSyncService) compressData(data string) (string, error) {
	var buf bytes.Buffer
	writer := gzip.NewWriter(&buf)

	if _, err := writer.Write([]byte(data)); err != nil {
		return "", err
	}

	if err := writer.Close(); err != nil {
		return "", err
	}

	// Encode to base64 and add prefix to identify compressed data
	compressed := base64.StdEncoding.EncodeToString(buf.Bytes())
	return "gzip:" + compressed, nil
}

// decompressData decompresses a base64-encoded gzip string
func (s *ChatSyncService) decompressData(compressed string) (string, error) {
	// Decode base64
	data, err := base64.StdEncoding.DecodeString(compressed)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %w", err)
	}

	// Decompress gzip
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer reader.Close()

	decompressed, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("failed to read decompressed data: %w", err)
	}

	return string(decompressed), nil
}

// EnsureIndexes creates necessary indexes for the chats collection
func (s *ChatSyncService) EnsureIndexes(ctx context.Context) error {
	indexes := []mongo.IndexModel{
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "updatedAt", Value: -1}}},
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "chatId", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "isStarred", Value: 1}}},
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "folderId", Value: 1}}},
	}

	_, err := s.collection.Indexes().CreateMany(ctx, indexes)
	if err != nil {
		return fmt.Errorf("failed to create chat indexes: %w", err)
	}

	// Create indexes for folders collection
	folderIndexes := []mongo.IndexModel{
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "order", Value: 1}}},
		{Keys: bson.D{{Key: "userId", Value: 1}, {Key: "name", Value: 1}}},
	}

	_, err = s.folderCollection.Indexes().CreateMany(ctx, folderIndexes)
	if err != nil {
		return fmt.Errorf("failed to create folder indexes: %w", err)
	}

	return nil
}

// CreateFolder creates a new folder for a user
func (s *ChatSyncService) CreateFolder(ctx context.Context, userID string, req *models.CreateFolderRequest) (*models.ChatFolder, error) {
	if userID == "" {
		return nil, fmt.Errorf("user ID is required")
	}
	if req.Name == "" {
		return nil, fmt.Errorf("folder name is required")
	}

	now := time.Now()
	folder := &models.ChatFolder{
		ID:        primitive.NewObjectID().Hex(),
		UserID:    userID,
		Name:      req.Name,
		Color:     req.Color,
		Icon:      req.Icon,
		Order:     req.Order,
		CreatedAt: now,
		UpdatedAt: now,
	}

	_, err := s.folderCollection.InsertOne(ctx, folder)
	if err != nil {
		return nil, fmt.Errorf("failed to create folder: %w", err)
	}

	return folder, nil
}

// GetFolders retrieves all folders for a user
func (s *ChatSyncService) GetFolders(ctx context.Context, userID string) ([]models.ChatFolder, error) {
	if userID == "" {
		return nil, fmt.Errorf("user ID is required")
	}

	filter := bson.M{"userId": userID}
	opts := options.Find().SetSort(bson.D{{Key: "order", Value: 1}})

	cursor, err := s.folderCollection.Find(ctx, filter, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to get folders: %w", err)
	}
	defer cursor.Close(ctx)

	var folders []models.ChatFolder
	for cursor.Next(ctx) {
		var folder models.ChatFolder
		if err := cursor.Decode(&folder); err != nil {
			log.Printf("⚠️ Failed to decode folder: %v", err)
			continue
		}
		folders = append(folders, folder)
	}

	return folders, nil
}

// GetFolder retrieves a specific folder by ID
func (s *ChatSyncService) GetFolder(ctx context.Context, userID, folderID string) (*models.ChatFolder, error) {
	if userID == "" || folderID == "" {
		return nil, fmt.Errorf("user ID and folder ID are required")
	}

	filter := bson.M{"userId": userID, "_id": folderID}

	var folder models.ChatFolder
	err := s.folderCollection.FindOne(ctx, filter).Decode(&folder)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("folder not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get folder: %w", err)
	}

	return &folder, nil
}

// UpdateFolder updates a folder
func (s *ChatSyncService) UpdateFolder(ctx context.Context, userID, folderID string, req *models.UpdateFolderRequest) (*models.ChatFolder, error) {
	if userID == "" || folderID == "" {
		return nil, fmt.Errorf("user ID and folder ID are required")
	}

	filter := bson.M{"userId": userID, "_id": folderID}

	update := bson.M{"updatedAt": time.Now()}
	if req.Name != nil {
		update["name"] = *req.Name
	}
	if req.Color != nil {
		update["color"] = *req.Color
	}
	if req.Icon != nil {
		update["icon"] = *req.Icon
	}
	if req.Order != nil {
		update["order"] = *req.Order
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var folder models.ChatFolder
	err := s.folderCollection.FindOneAndUpdate(ctx, filter, bson.M{"$set": update}, opts).Decode(&folder)
	if err == mongo.ErrNoDocuments {
		return nil, fmt.Errorf("folder not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update folder: %w", err)
	}

	return &folder, nil
}

// DeleteFolder deletes a folder and ALL chats in it
func (s *ChatSyncService) DeleteFolder(ctx context.Context, userID, folderID string) (int64, error) {
	if userID == "" || folderID == "" {
		return 0, fmt.Errorf("user ID and folder ID are required")
	}

	// First, delete all chats in the folder
	chatFilter := bson.M{"userId": userID, "folderId": folderID}
	chatResult, err := s.collection.DeleteMany(ctx, chatFilter)
	if err != nil {
		return 0, fmt.Errorf("failed to delete chats in folder: %w", err)
	}

	// Then delete the folder
	folderFilter := bson.M{"userId": userID, "_id": folderID}
	folderResult, err := s.folderCollection.DeleteOne(ctx, folderFilter)
	if err != nil {
		return 0, fmt.Errorf("failed to delete folder: %w", err)
	}

	if folderResult.DeletedCount == 0 {
		return 0, fmt.Errorf("folder not found")
	}

	return chatResult.DeletedCount, nil
}

// MoveChatToFolder moves a chat to a folder (or out of folder if folderID is nil)
func (s *ChatSyncService) MoveChatToFolder(ctx context.Context, userID, chatID string, folderID *string) error {
	if userID == "" || chatID == "" {
		return fmt.Errorf("user ID and chat ID are required")
	}

	filter := bson.M{"userId": userID, "chatId": chatID}

	update := bson.M{
		"$set": bson.M{
			"folderId":  folderID,
			"updatedAt": time.Now(),
		},
		"$inc": bson.M{"version": 1},
	}

	result, err := s.collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("failed to move chat to folder: %w", err)
	}

	if result.MatchedCount == 0 {
		return fmt.Errorf("chat not found")
	}

	return nil
}

// GetChatsByFolder retrieves chats in a specific folder
func (s *ChatSyncService) GetChatsByFolder(ctx context.Context, userID, folderID string, page, pageSize int) (*models.ChatListResponse, error) {
	if userID == "" || folderID == "" {
		return nil, fmt.Errorf("user ID and folder ID are required")
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	filter := bson.M{
		"userId":   userID,
		"folderId": folderID,
	}

	// Get total count
	totalCount, err := s.collection.CountDocuments(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("failed to count chats: %w", err)
	}

	// Find chats with pagination
	skip := int64((page - 1) * pageSize)
	opts := options.Find().
		SetSort(bson.D{{Key: "updatedAt", Value: -1}}).
		SetSkip(skip).
		SetLimit(int64(pageSize)).
		SetProjection(bson.M{
			"_id":               1,
			"chatId":            1,
			"title":             1,
			"isStarred":         1,
			"model":             1,
			"version":           1,
			"folderId":          1,
			"createdAt":         1,
			"updatedAt":         1,
			"encryptedMessages": 1, // Need this to count messages
		})

	cursor, err := s.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to list chats: %w", err)
	}
	defer cursor.Close(ctx)

	var chats []models.ChatListItem
	for cursor.Next(ctx) {
		var encChat models.EncryptedChat
		if err := cursor.Decode(&encChat); err != nil {
			log.Printf("⚠️ Failed to decode chat: %v", err)
			continue
		}

		// Count messages (decrypt to get count)
		messageCount := 0
		if encChat.EncryptedMessages != "" {
			messages, err := s.decryptMessages(userID, encChat.EncryptedMessages)
			if err == nil {
				messageCount = len(messages)
			}
		}

		chats = append(chats, models.ChatListItem{
			ID:           encChat.ChatID,
			Title:        encChat.Title,
			IsStarred:    encChat.IsStarred,
			Model:        encChat.Model,
			MessageCount: messageCount,
			Version:      encChat.Version,
			FolderID:     encChat.FolderID,
			CreatedAt:    encChat.CreatedAt,
			UpdatedAt:    encChat.UpdatedAt,
		})
	}

	return &models.ChatListResponse{
		Chats:      chats,
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		HasMore:    int64(page*pageSize) < totalCount,
	}, nil
}

// GetFolderCounts returns a map of folder ID to chat count for a user
func (s *ChatSyncService) GetFolderCounts(ctx context.Context, userID string) (map[string]int, error) {
	if userID == "" {
		return nil, fmt.Errorf("user ID is required")
	}

	// Get all folders first
	folders, err := s.GetFolders(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get folders: %w", err)
	}

	// Initialize map with 0 counts
	folderCounts := make(map[string]int)
	for _, folder := range folders {
		folderCounts[folder.ID] = 0
	}

	// Count chats per folder using aggregation
	pipeline := []bson.M{
		{"$match": bson.M{"userId": userID}},
		{"$group": bson.M{"_id": "$folderId", "count": bson.M{"$sum": 1}}},
	}

	cursor, err := s.collection.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("failed to count chats per folder: %w", err)
	}
	defer cursor.Close(ctx)

	var results []struct {
		ID    *string `bson:"_id"`
		Count int     `bson:"count"`
	}

	for cursor.Next(ctx) {
		var result struct {
			ID    *string `bson:"_id"`
			Count int     `bson:"count"`
		}
		if err := cursor.Decode(&result); err != nil {
			log.Printf("⚠️ Failed to decode folder count: %v", err)
			continue
		}
		results = append(results, result)
	}

	// Update the folder counts map
	for _, result := range results {
		if result.ID != nil {
			folderCounts[*result.ID] = result.Count
		}
	}

	return folderCounts, nil
}

// GetUngroupedChats returns chats not in any folder
func (s *ChatSyncService) GetUngroupedChats(ctx context.Context, userID string, page, pageSize int) (*models.ChatListResponse, error) {
	if userID == "" {
		return nil, fmt.Errorf("user ID is required")
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	// Chats not in any folder have folderId as null or missing
	filter := bson.M{
		"userId":   userID,
		"folderId": bson.M{"$exists": false},
	}

	// Get total count
	totalCount, err := s.collection.CountDocuments(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("failed to count ungrouped chats: %w", err)
	}

	// Find chats with pagination
	skip := int64((page - 1) * pageSize)
	opts := options.Find().
		SetSort(bson.D{{Key: "updatedAt", Value: -1}}).
		SetSkip(skip).
		SetLimit(int64(pageSize)).
		SetProjection(bson.M{
			"_id":               1,
			"chatId":            1,
			"title":             1,
			"isStarred":         1,
			"model":             1,
			"version":           1,
			"folderId":          1,
			"createdAt":         1,
			"updatedAt":         1,
			"encryptedMessages": 1, // Need this to count messages
		})

	cursor, err := s.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to list ungrouped chats: %w", err)
	}
	defer cursor.Close(ctx)

	var chats []models.ChatListItem
	for cursor.Next(ctx) {
		var encChat models.EncryptedChat
		if err := cursor.Decode(&encChat); err != nil {
			log.Printf("⚠️ Failed to decode chat: %v", err)
			continue
		}

		// Count messages (decrypt to get count)
		messageCount := 0
		if encChat.EncryptedMessages != "" {
			messages, err := s.decryptMessages(userID, encChat.EncryptedMessages)
			if err == nil {
				messageCount = len(messages)
			}
		}

		chats = append(chats, models.ChatListItem{
			ID:           encChat.ChatID,
			Title:        encChat.Title,
			IsStarred:    encChat.IsStarred,
			Model:        encChat.Model,
			MessageCount: messageCount,
			Version:      encChat.Version,
			FolderID:     encChat.FolderID,
			CreatedAt:    encChat.CreatedAt,
			UpdatedAt:    encChat.UpdatedAt,
		})
	}

	return &models.ChatListResponse{
		Chats:      chats,
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		HasMore:    int64(page*pageSize) < totalCount,
	}, nil
}
