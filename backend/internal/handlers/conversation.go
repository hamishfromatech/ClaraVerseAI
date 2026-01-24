package handlers

import (
	"claraverse/internal/models"
	"claraverse/internal/services"
	"log"
	"strconv"

	"github.com/gofiber/fiber/v2"
)

// ConversationHandler handles conversation-related HTTP requests
type ConversationHandler struct {
	chatService    *services.ChatService
	chatSyncService *services.ChatSyncService
	builderService *services.BuilderConversationService
}

// NewConversationHandler creates a new conversation handler
func NewConversationHandler(chatService *services.ChatService, builderService *services.BuilderConversationService) *ConversationHandler {
	return &ConversationHandler{
		chatService:    chatService,
		builderService: builderService,
	}
}

// SetChatSyncService sets the chat sync service (optional, for cloud sync features)
func (h *ConversationHandler) SetChatSyncService(chatSyncService *services.ChatSyncService) {
	h.chatSyncService = chatSyncService
}

// GetStatus returns the status of a conversation (exists, has files, time until expiration)
// GET /api/conversations/:id/status
func (h *ConversationHandler) GetStatus(c *fiber.Ctx) error {
	conversationID := c.Params("id")

	if conversationID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Conversation ID is required",
		})
	}

	// Get user ID from context (set by auth middleware)
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	log.Printf("📊 [CONVERSATION] Status check for conversation %s (user: %s)", conversationID, userID)

	// Verify conversation ownership
	if !h.chatService.IsConversationOwner(conversationID, userID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "Access denied to this conversation",
		})
	}

	status := h.chatService.GetConversationStatus(conversationID)

	return c.JSON(status)
}

// ListBuilderConversations returns all builder conversations for an agent
// GET /api/agents/:id/conversations
func (h *ConversationHandler) ListBuilderConversations(c *fiber.Ctx) error {
	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.builderService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Builder conversation service not available",
		})
	}

	conversations, err := h.builderService.GetConversationsByAgent(c.Context(), agentID, userID)
	if err != nil {
		log.Printf("❌ Failed to list builder conversations: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to list conversations",
		})
	}

	return c.JSON(conversations)
}

// GetBuilderConversation returns a specific builder conversation
// GET /api/agents/:id/conversations/:convId
func (h *ConversationHandler) GetBuilderConversation(c *fiber.Ctx) error {
	conversationID := c.Params("convId")
	if conversationID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Conversation ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.builderService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Builder conversation service not available",
		})
	}

	conversation, err := h.builderService.GetConversation(c.Context(), conversationID, userID)
	if err != nil {
		log.Printf("❌ Failed to get builder conversation: %v", err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Conversation not found",
		})
	}

	return c.JSON(conversation)
}

// CreateBuilderConversation creates a new builder conversation for an agent
// POST /api/agents/:id/conversations
func (h *ConversationHandler) CreateBuilderConversation(c *fiber.Ctx) error {
	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.builderService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Builder conversation service not available",
		})
	}

	var req struct {
		ModelID string `json:"model_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	conversation, err := h.builderService.CreateConversation(c.Context(), agentID, userID, req.ModelID)
	if err != nil {
		log.Printf("❌ Failed to create builder conversation: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create conversation",
		})
	}

	log.Printf("✅ Created builder conversation %s for agent %s", conversation.ID, agentID)
	return c.Status(fiber.StatusCreated).JSON(conversation)
}

// AddBuilderMessage adds a message to a builder conversation
// POST /api/agents/:id/conversations/:convId/messages
func (h *ConversationHandler) AddBuilderMessage(c *fiber.Ctx) error {
	conversationID := c.Params("convId")
	if conversationID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Conversation ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.builderService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Builder conversation service not available",
		})
	}

	var req models.AddMessageRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.Role == "" || req.Content == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Role and content are required",
		})
	}

	message, err := h.builderService.AddMessage(c.Context(), conversationID, userID, &req)
	if err != nil {
		log.Printf("❌ Failed to add message to conversation: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to add message",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(message)
}

// DeleteBuilderConversation deletes a builder conversation
// DELETE /api/agents/:id/conversations/:convId
func (h *ConversationHandler) DeleteBuilderConversation(c *fiber.Ctx) error {
	conversationID := c.Params("convId")
	if conversationID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Conversation ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.builderService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Builder conversation service not available",
		})
	}

	if err := h.builderService.DeleteConversation(c.Context(), conversationID, userID); err != nil {
		log.Printf("❌ Failed to delete builder conversation: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to delete conversation",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Conversation deleted successfully",
	})
}

// GetOrCreateBuilderConversation gets the most recent conversation or creates a new one
// GET /api/agents/:id/conversations/current
func (h *ConversationHandler) GetOrCreateBuilderConversation(c *fiber.Ctx) error {
	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.builderService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Builder conversation service not available",
		})
	}

	modelID := c.Query("model_id", "")

	conversation, err := h.builderService.GetOrCreateConversation(c.Context(), agentID, userID, modelID)
	if err != nil {
		log.Printf("❌ Failed to get/create builder conversation: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get conversation",
		})
	}

	return c.JSON(conversation)
}

// === Folder Endpoints ===

// ListFolders returns all folders for a user with chat counts
// GET /api/conversations/folders
func (h *ConversationHandler) ListFolders(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.chatSyncService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Folder service not available",
		})
	}

	folders, err := h.chatSyncService.GetFolders(c.Context(), userID)
	if err != nil {
		log.Printf("❌ Failed to list folders: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to list folders",
		})
	}

	// Get chat counts for each folder
	folderCounts, err := h.chatSyncService.GetFolderCounts(c.Context(), userID)
	if err != nil {
		log.Printf("⚠️ Failed to get folder counts: %v", err)
		// Continue without counts
	}

	return c.JSON(&models.FolderListResponse{
		Folders:      folders,
		FolderCounts: folderCounts,
	})
}

// CreateFolder creates a new folder
// POST /api/conversations/folders
func (h *ConversationHandler) CreateFolder(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.chatSyncService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Folder service not available",
		})
	}

	var req models.CreateFolderRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Folder name is required",
		})
	}

	folder, err := h.chatSyncService.CreateFolder(c.Context(), userID, &req)
	if err != nil {
		log.Printf("❌ Failed to create folder: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create folder",
		})
	}

	log.Printf("✅ Created folder %s for user %s", folder.ID, userID)
	return c.Status(fiber.StatusCreated).JSON(folder)
}

// GetFolder returns a specific folder
// GET /api/conversations/folders/:id
func (h *ConversationHandler) GetFolder(c *fiber.Ctx) error {
	folderID := c.Params("id")
	if folderID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Folder ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.chatSyncService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Folder service not available",
		})
	}

	folder, err := h.chatSyncService.GetFolder(c.Context(), userID, folderID)
	if err != nil {
		log.Printf("❌ Failed to get folder: %v", err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Folder not found",
		})
	}

	return c.JSON(folder)
}

// UpdateFolder updates a folder
// PUT /api/conversations/folders/:id
func (h *ConversationHandler) UpdateFolder(c *fiber.Ctx) error {
	folderID := c.Params("id")
	if folderID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Folder ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.chatSyncService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Folder service not available",
		})
	}

	var req models.UpdateFolderRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	folder, err := h.chatSyncService.UpdateFolder(c.Context(), userID, folderID, &req)
	if err != nil {
		log.Printf("❌ Failed to update folder: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update folder",
		})
	}

	log.Printf("✅ Updated folder %s", folderID)
	return c.JSON(folder)
}

// DeleteFolder deletes a folder and all chats in it
// DELETE /api/conversations/folders/:id
func (h *ConversationHandler) DeleteFolder(c *fiber.Ctx) error {
	folderID := c.Params("id")
	if folderID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Folder ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.chatSyncService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Folder service not available",
		})
	}

	deletedCount, err := h.chatSyncService.DeleteFolder(c.Context(), userID, folderID)
	if err != nil {
		log.Printf("❌ Failed to delete folder: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to delete folder",
		})
	}

	log.Printf("✅ Deleted folder %s and %d chats", folderID, deletedCount)
	return c.JSON(fiber.Map{
		"message":    "Folder and all its chats deleted successfully",
		"chat_count": deletedCount,
	})
}

// MoveChatToFolder moves a chat to a folder (or out of folder)
// PUT /api/conversations/:id/folder
func (h *ConversationHandler) MoveChatToFolder(c *fiber.Ctx) error {
	chatID := c.Params("id")
	if chatID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Chat ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.chatSyncService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Folder service not available",
		})
	}

	var req models.MoveChatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	err := h.chatSyncService.MoveChatToFolder(c.Context(), userID, chatID, req.FolderID)
	if err != nil {
		log.Printf("❌ Failed to move chat to folder: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to move chat",
		})
	}

	log.Printf("✅ Moved chat %s to folder %v", chatID, req.FolderID)
	return c.JSON(fiber.Map{
		"message": "Chat moved successfully",
	})
}

// GetFolderChats returns chats in a specific folder
// GET /api/conversations/folders/:id/chats
func (h *ConversationHandler) GetFolderChats(c *fiber.Ctx) error {
	folderID := c.Params("id")
	if folderID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Folder ID is required",
		})
	}

	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.chatSyncService == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Folder service not available",
		})
	}

	page := 1
	pageSize := 20

	if pageStr := c.Query("page"); pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil {
			page = p
		}
	}
	if pageSizeStr := c.Query("page_size"); pageSizeStr != "" {
		if ps, err := strconv.Atoi(pageSizeStr); err == nil {
			pageSize = ps
		}
	}

	chats, err := h.chatSyncService.GetChatsByFolder(c.Context(), userID, folderID, page, pageSize)
	if err != nil {
		log.Printf("❌ Failed to get folder chats: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get folder chats",
		})
	}

	return c.JSON(chats)
}
