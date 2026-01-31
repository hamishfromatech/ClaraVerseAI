package handlers

import (
	"bytes"
	"claraverse/internal/models"
	"claraverse/internal/services"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// isPlaceholderDescription checks if a description is empty or a placeholder
func isPlaceholderDescription(desc string) bool {
	if desc == "" {
		return true
	}
	// Normalize for comparison
	lower := strings.ToLower(strings.TrimSpace(desc))
	// Common placeholder patterns
	placeholders := []string{
		"describe what this agent does",
		"description",
		"add a description",
		"enter description",
		"agent description",
		"no description",
		"...",
		"-",
	}
	for _, p := range placeholders {
		if lower == p || strings.HasPrefix(lower, p) {
			return true
		}
	}
	return false
}

// AgentHandler handles agent-related HTTP requests
type AgentHandler struct {
	agentService               *services.AgentService
	workflowGeneratorService   *services.WorkflowGeneratorService
	workflowGeneratorV2Service *services.WorkflowGeneratorV2Service
	builderConvService         *services.BuilderConversationService
	providerService            *services.ProviderService
}

// NewAgentHandler creates a new agent handler
func NewAgentHandler(agentService *services.AgentService, workflowGenerator *services.WorkflowGeneratorService) *AgentHandler {
	return &AgentHandler{
		agentService:             agentService,
		workflowGeneratorService: workflowGenerator,
	}
}

// SetWorkflowGeneratorV2Service sets the v2 workflow generator service
func (h *AgentHandler) SetWorkflowGeneratorV2Service(svc *services.WorkflowGeneratorV2Service) {
	h.workflowGeneratorV2Service = svc
}

// SetBuilderConversationService sets the builder conversation service (for sync endpoint)
func (h *AgentHandler) SetBuilderConversationService(svc *services.BuilderConversationService) {
	h.builderConvService = svc
}

// SetProviderService sets the provider service (for Ask mode)
func (h *AgentHandler) SetProviderService(svc *services.ProviderService) {
	h.providerService = svc
}

// Create creates a new agent
// POST /api/agents
func (h *AgentHandler) Create(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	var req models.CreateAgentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Name is required",
		})
	}

	log.Printf("🤖 [AGENT] Creating agent '%s' for user %s", req.Name, userID)

	agent, err := h.agentService.CreateAgent(userID, req.Name, req.Description)
	if err != nil {
		log.Printf("❌ [AGENT] Failed to create agent: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create agent",
		})
	}

	log.Printf("✅ [AGENT] Created agent %s", agent.ID)
	return c.Status(fiber.StatusCreated).JSON(agent)
}

// List returns all agents for the authenticated user with pagination
// GET /api/agents?limit=20&offset=0
func (h *AgentHandler) List(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	limit := c.QueryInt("limit", 20)
	offset := c.QueryInt("offset", 0)

	log.Printf("📋 [AGENT] Listing agents for user %s (limit: %d, offset: %d)", userID, limit, offset)

	response, err := h.agentService.ListAgentsPaginated(userID, limit, offset)
	if err != nil {
		log.Printf("❌ [AGENT] Failed to list agents: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to list agents",
		})
	}

	// Ensure agents array is not null
	if response.Agents == nil {
		response.Agents = []models.AgentListItem{}
	}

	return c.JSON(response)
}

// ListRecent returns the 10 most recent agents for the landing page
// GET /api/agents/recent
func (h *AgentHandler) ListRecent(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	log.Printf("📋 [AGENT] Getting recent agents for user %s", userID)

	response, err := h.agentService.GetRecentAgents(userID)
	if err != nil {
		log.Printf("❌ [AGENT] Failed to get recent agents: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get recent agents",
		})
	}

	// Ensure agents array is not null
	if response.Agents == nil {
		response.Agents = []models.AgentListItem{}
	}

	return c.JSON(response)
}

// Get returns a single agent by ID
// GET /api/agents/:id
func (h *AgentHandler) Get(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	log.Printf("🔍 [AGENT] Getting agent %s for user %s", agentID, userID)

	agent, err := h.agentService.GetAgent(agentID, userID)
	if err != nil {
		if err.Error() == "agent not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Agent not found",
			})
		}
		log.Printf("❌ [AGENT] Failed to get agent: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get agent",
		})
	}

	return c.JSON(agent)
}

// Update updates an agent's metadata
// PUT /api/agents/:id
func (h *AgentHandler) Update(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	var req models.UpdateAgentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	log.Printf("✏️ [AGENT] Updating agent %s for user %s", agentID, userID)

	// Check if we're deploying and need to auto-generate a description
	if req.Status == "deployed" {
		// Get current agent to check if description is empty or placeholder
		currentAgent, err := h.agentService.GetAgent(agentID, userID)
		if err == nil && currentAgent != nil {
			// Auto-generate description if empty or a placeholder
			if isPlaceholderDescription(currentAgent.Description) {
				log.Printf("🔍 [AGENT] Agent %s has no/placeholder description, generating one on deploy", agentID)
				workflow, err := h.agentService.GetWorkflow(agentID)
				if err == nil && workflow != nil {
					description, err := h.workflowGeneratorService.GenerateDescriptionFromWorkflow(workflow, currentAgent.Name)
					if err != nil {
						log.Printf("⚠️ [AGENT] Failed to generate description (non-fatal): %v", err)
					} else if description != "" {
						req.Description = description
						log.Printf("📝 [AGENT] Auto-generated description for agent %s: %s", agentID, description)
					}
				}
			}
		}
	}

	agent, err := h.agentService.UpdateAgent(agentID, userID, &req)
	if err != nil {
		if err.Error() == "agent not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Agent not found",
			})
		}
		log.Printf("❌ [AGENT] Failed to update agent: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update agent",
		})
	}

	log.Printf("✅ [AGENT] Updated agent %s", agentID)
	return c.JSON(agent)
}

// Delete deletes an agent
// DELETE /api/agents/:id
func (h *AgentHandler) Delete(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	log.Printf("🗑️ [AGENT] Deleting agent %s for user %s", agentID, userID)

	err := h.agentService.DeleteAgent(agentID, userID)
	if err != nil {
		if err.Error() == "agent not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Agent not found",
			})
		}
		log.Printf("❌ [AGENT] Failed to delete agent: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to delete agent",
		})
	}

	log.Printf("✅ [AGENT] Deleted agent %s", agentID)
	return c.Status(fiber.StatusNoContent).Send(nil)
}

// SaveWorkflow saves or updates the workflow for an agent
// PUT /api/agents/:id/workflow
func (h *AgentHandler) SaveWorkflow(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	var req models.SaveWorkflowRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	log.Printf("💾 [AGENT] Saving workflow for agent %s (user: %s, blocks: %d)", agentID, userID, len(req.Blocks))

	workflow, err := h.agentService.SaveWorkflow(agentID, userID, &req)
	if err != nil {
		if err.Error() == "agent not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Agent not found",
			})
		}
		log.Printf("❌ [AGENT] Failed to save workflow: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save workflow",
		})
	}

	log.Printf("✅ [AGENT] Saved workflow for agent %s (version: %d)", agentID, workflow.Version)
	return c.JSON(workflow)
}

// GetWorkflow returns the workflow for an agent
// GET /api/agents/:id/workflow
func (h *AgentHandler) GetWorkflow(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	// Verify agent belongs to user
	_, err := h.agentService.GetAgent(agentID, userID)
	if err != nil {
		if err.Error() == "agent not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Agent not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to verify agent ownership",
		})
	}

	workflow, err := h.agentService.GetWorkflow(agentID)
	if err != nil {
		if err.Error() == "workflow not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Workflow not found",
			})
		}
		log.Printf("❌ [AGENT] Failed to get workflow: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get workflow",
		})
	}

	return c.JSON(workflow)
}

// GenerateWorkflow generates or modifies a workflow using AI
// POST /api/agents/:id/generate-workflow
func (h *AgentHandler) GenerateWorkflow(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	// Parse request body
	var req models.WorkflowGenerateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.UserMessage == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "User message is required",
		})
	}

	req.AgentID = agentID

	// Get or create the agent - auto-create if it doesn't exist yet
	// This supports the frontend workflow where agent IDs are generated client-side
	agent, err := h.agentService.GetAgent(agentID, userID)
	if err != nil {
		if err.Error() == "agent not found" {
			// Auto-create the agent with a default name (user can rename later)
			log.Printf("🆕 [WORKFLOW-GEN] Agent %s doesn't exist, creating it", agentID)
			agent, err = h.agentService.CreateAgentWithID(agentID, userID, "New Agent", "")
			if err != nil {
				log.Printf("❌ [WORKFLOW-GEN] Failed to auto-create agent: %v", err)
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to create agent",
				})
			}
			log.Printf("✅ [WORKFLOW-GEN] Auto-created agent %s", agentID)
		} else {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to verify agent ownership",
			})
		}
	}
	_ = agent // Agent verified or created

	log.Printf("🔧 [WORKFLOW-GEN] Generating workflow for agent %s (user: %s)", agentID, userID)

	// Generate the workflow
	response, err := h.workflowGeneratorService.GenerateWorkflow(&req, userID)
	if err != nil {
		log.Printf("❌ [WORKFLOW-GEN] Failed to generate workflow: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate workflow",
		})
	}

	if !response.Success {
		log.Printf("⚠️ [WORKFLOW-GEN] Workflow generation failed: %s", response.Error)
		return c.Status(fiber.StatusUnprocessableEntity).JSON(response)
	}

	// Generate suggested name and description for new workflows
	// Check if agent still has default name - if so, generate a better one
	shouldGenerateMetadata := response.Action == "create" || (agent != nil && agent.Name == "New Agent")
	log.Printf("🔍 [WORKFLOW-GEN] Checking metadata generation: action=%s, agentName=%s, shouldGenerate=%v", response.Action, agent.Name, shouldGenerateMetadata)
	if shouldGenerateMetadata {
		metadata, err := h.workflowGeneratorService.GenerateAgentMetadata(req.UserMessage)
		if err != nil {
			log.Printf("⚠️ [WORKFLOW-GEN] Failed to generate agent metadata (non-fatal): %v", err)
		} else {
			response.SuggestedName = metadata.Name
			response.SuggestedDescription = metadata.Description
			log.Printf("📝 [WORKFLOW-GEN] Suggested agent: name=%s, desc=%s", metadata.Name, metadata.Description)

			// Immediately persist the generated name to the database
			// This ensures the name is saved even if frontend fails to update
			if metadata.Name != "" {
				updateReq := &models.UpdateAgentRequest{
					Name:        metadata.Name,
					Description: metadata.Description,
				}
				_, updateErr := h.agentService.UpdateAgent(agentID, userID, updateReq)
				if updateErr != nil {
					log.Printf("⚠️ [WORKFLOW-GEN] Failed to persist agent metadata (non-fatal): %v", updateErr)
				} else {
					log.Printf("💾 [WORKFLOW-GEN] Persisted agent metadata to database: name=%s", metadata.Name)
				}
			}
		}
	}

	log.Printf("✅ [WORKFLOW-GEN] Generated workflow for agent %s: %d blocks", agentID, len(response.Workflow.Blocks))
	return c.JSON(response)
}

// ============================================================================
// Workflow Version Handlers
// ============================================================================

// ListWorkflowVersions returns all versions for an agent's workflow
// GET /api/agents/:id/workflow/versions
func (h *AgentHandler) ListWorkflowVersions(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	log.Printf("📜 [WORKFLOW] Listing versions for agent %s (user: %s)", agentID, userID)

	versions, err := h.agentService.ListWorkflowVersions(agentID, userID)
	if err != nil {
		if err.Error() == "agent not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Agent not found",
			})
		}
		log.Printf("❌ [WORKFLOW] Failed to list versions: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to list workflow versions",
		})
	}

	return c.JSON(fiber.Map{
		"versions": versions,
		"count":    len(versions),
	})
}

// GetWorkflowVersion returns a specific workflow version
// GET /api/agents/:id/workflow/versions/:version
func (h *AgentHandler) GetWorkflowVersion(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	version, err := c.ParamsInt("version")
	if err != nil || version <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Valid version number is required",
		})
	}

	log.Printf("🔍 [WORKFLOW] Getting version %d for agent %s (user: %s)", version, agentID, userID)

	workflow, err := h.agentService.GetWorkflowVersion(agentID, userID, version)
	if err != nil {
		if err.Error() == "agent not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Agent not found",
			})
		}
		if err.Error() == "workflow version not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Workflow version not found",
			})
		}
		log.Printf("❌ [WORKFLOW] Failed to get version: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get workflow version",
		})
	}

	return c.JSON(workflow)
}

// RestoreWorkflowVersion restores a workflow to a previous version
// POST /api/agents/:id/workflow/restore/:version
func (h *AgentHandler) RestoreWorkflowVersion(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	version, err := c.ParamsInt("version")
	if err != nil || version <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Valid version number is required",
		})
	}

	log.Printf("⏪ [WORKFLOW] Restoring version %d for agent %s (user: %s)", version, agentID, userID)

	workflow, err := h.agentService.RestoreWorkflowVersion(agentID, userID, version)
	if err != nil {
		if err.Error() == "agent not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Agent not found",
			})
		}
		if err.Error() == "workflow version not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Workflow version not found",
			})
		}
		log.Printf("❌ [WORKFLOW] Failed to restore version: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to restore workflow version",
		})
	}

	log.Printf("✅ [WORKFLOW] Restored version %d for agent %s (new version: %d)", version, agentID, workflow.Version)
	return c.JSON(workflow)
}

// SyncAgent syncs a local agent to the backend on first message
// This creates/updates the agent, workflow, and conversation in one call
// POST /api/agents/:id/sync
func (h *AgentHandler) SyncAgent(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	var req models.SyncAgentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent name is required",
		})
	}

	log.Printf("🔄 [AGENT] Syncing agent %s for user %s", agentID, userID)

	// Sync agent and workflow
	agent, workflow, err := h.agentService.SyncAgent(agentID, userID, &req)
	if err != nil {
		log.Printf("❌ [AGENT] Failed to sync agent: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to sync agent",
		})
	}

	// Create conversation if builder conversation service is available
	var conversationID string
	if h.builderConvService != nil {
		conv, err := h.builderConvService.CreateConversation(c.Context(), agentID, userID, req.ModelID)
		if err != nil {
			log.Printf("⚠️ [AGENT] Failed to create conversation (non-fatal): %v", err)
			// Continue without conversation - not fatal
		} else {
			conversationID = conv.ID
			log.Printf("✅ [AGENT] Created conversation %s for agent %s", conversationID, agentID)
		}
	}

	log.Printf("✅ [AGENT] Synced agent %s (workflow v%d, conv: %s)", agentID, workflow.Version, conversationID)

	return c.JSON(&models.SyncAgentResponse{
		Agent:          agent,
		Workflow:       workflow,
		ConversationID: conversationID,
	})
}

// GenerateWorkflowV2 generates a workflow using multi-step process with tool selection
// POST /api/agents/:id/generate-workflow-v2
func (h *AgentHandler) GenerateWorkflowV2(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.workflowGeneratorV2Service == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Workflow generator v2 service not available",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	// Parse request body
	var req services.MultiStepGenerateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.UserMessage == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "User message is required",
		})
	}

	req.AgentID = agentID

	// Get or create the agent - auto-create if it doesn't exist yet
	agent, err := h.agentService.GetAgent(agentID, userID)
	if err != nil {
		if err.Error() == "agent not found" {
			log.Printf("🆕 [WORKFLOW-GEN-V2] Agent %s doesn't exist, creating it", agentID)
			agent, err = h.agentService.CreateAgentWithID(agentID, userID, "New Agent", "")
			if err != nil {
				log.Printf("❌ [WORKFLOW-GEN-V2] Failed to auto-create agent: %v", err)
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to create agent",
				})
			}
			log.Printf("✅ [WORKFLOW-GEN-V2] Auto-created agent %s", agentID)
		} else {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to verify agent ownership",
			})
		}
	}

	log.Printf("🔧 [WORKFLOW-GEN-V2] Starting multi-step generation for agent %s (user: %s)", agentID, userID)

	// Generate the workflow using multi-step process
	response, err := h.workflowGeneratorV2Service.GenerateWorkflowMultiStep(&req, userID, nil)
	if err != nil {
		log.Printf("❌ [WORKFLOW-GEN-V2] Failed to generate workflow: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate workflow",
		})
	}

	if !response.Success {
		log.Printf("⚠️ [WORKFLOW-GEN-V2] Workflow generation failed: %s", response.Error)
		return c.Status(fiber.StatusUnprocessableEntity).JSON(response)
	}

	// Generate suggested name and description for new workflows
	shouldGenerateMetadata := agent != nil && agent.Name == "New Agent"
	if shouldGenerateMetadata && h.workflowGeneratorService != nil {
		metadata, err := h.workflowGeneratorService.GenerateAgentMetadata(req.UserMessage)
		if err != nil {
			log.Printf("⚠️ [WORKFLOW-GEN-V2] Failed to generate agent metadata (non-fatal): %v", err)
		} else if metadata.Name != "" {
			// Persist the generated name
			updateReq := &models.UpdateAgentRequest{
				Name:        metadata.Name,
				Description: metadata.Description,
			}
			_, updateErr := h.agentService.UpdateAgent(agentID, userID, updateReq)
			if updateErr != nil {
				log.Printf("⚠️ [WORKFLOW-GEN-V2] Failed to persist agent metadata (non-fatal): %v", updateErr)
			} else {
				log.Printf("💾 [WORKFLOW-GEN-V2] Persisted agent metadata: name=%s", metadata.Name)
			}
		}
	}

	log.Printf("✅ [WORKFLOW-GEN-V2] Generated workflow for agent %s: %d blocks, %d tools selected",
		agentID, len(response.Workflow.Blocks), len(response.SelectedTools))
	return c.JSON(response)
}

// GetToolRegistry returns all available tools and categories for the frontend
// GET /api/tools/registry
func (h *AgentHandler) GetToolRegistry(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"tools":      services.ToolRegistry,
		"categories": services.ToolCategoryRegistry,
	})
}

// SelectTools performs just the tool selection step (Step 1 only)
// POST /api/agents/:id/select-tools
func (h *AgentHandler) SelectTools(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.workflowGeneratorV2Service == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Workflow generator v2 service not available",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	// Parse request body
	var req services.MultiStepGenerateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.UserMessage == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "User message is required",
		})
	}

	req.AgentID = agentID

	log.Printf("🔧 [TOOL-SELECT] Selecting tools for agent %s (user: %s)", agentID, userID)

	// Perform tool selection only
	result, err := h.workflowGeneratorV2Service.Step1SelectTools(&req, userID)
	if err != nil {
		log.Printf("❌ [TOOL-SELECT] Failed to select tools: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to select tools",
		})
	}

	log.Printf("✅ [TOOL-SELECT] Selected %d tools for agent %s", len(result.SelectedTools), agentID)
	return c.JSON(result)
}

// GenerateWithToolsRequest is the request for generating a workflow with pre-selected tools
type GenerateWithToolsRequest struct {
	UserMessage     string                   `json:"user_message"`
	ModelID         string                   `json:"model_id,omitempty"`
	SelectedTools   []services.SelectedTool  `json:"selected_tools"`
	CurrentWorkflow *models.Workflow         `json:"current_workflow,omitempty"`
}

// GenerateWithTools performs workflow generation with pre-selected tools (Step 2 only)
// POST /api/agents/:id/generate-with-tools
func (h *AgentHandler) GenerateWithTools(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	if h.workflowGeneratorV2Service == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Workflow generator v2 service not available",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	// Parse request body
	var req GenerateWithToolsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.UserMessage == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "User message is required",
		})
	}

	if len(req.SelectedTools) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Selected tools are required",
		})
	}

	log.Printf("🔧 [GENERATE-WITH-TOOLS] Generating workflow for agent %s with %d pre-selected tools (user: %s)",
		agentID, len(req.SelectedTools), userID)

	// Build the multi-step request
	multiStepReq := &services.MultiStepGenerateRequest{
		AgentID:         agentID,
		UserMessage:     req.UserMessage,
		ModelID:         req.ModelID,
		CurrentWorkflow: req.CurrentWorkflow,
	}

	// Perform workflow generation with pre-selected tools
	result, err := h.workflowGeneratorV2Service.Step2GenerateWorkflow(multiStepReq, req.SelectedTools, userID)
	if err != nil {
		log.Printf("❌ [GENERATE-WITH-TOOLS] Failed to generate workflow: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to generate workflow",
			"details": err.Error(),
		})
	}

	if !result.Success {
		log.Printf("⚠️ [GENERATE-WITH-TOOLS] Workflow generation failed: %s", result.Error)
		return c.Status(fiber.StatusUnprocessableEntity).JSON(result)
	}

	// Generate suggested name and description for new workflows
	agent, _ := h.agentService.GetAgent(agentID, userID)
	shouldGenerateMetadata := agent != nil && agent.Name == "New Agent"
	if shouldGenerateMetadata && h.workflowGeneratorService != nil {
		metadata, err := h.workflowGeneratorService.GenerateAgentMetadata(req.UserMessage)
		if err != nil {
			log.Printf("⚠️ [GENERATE-WITH-TOOLS] Failed to generate agent metadata (non-fatal): %v", err)
		} else if metadata.Name != "" {
			result.SuggestedName = metadata.Name
			result.SuggestedDescription = metadata.Description

			// Persist the generated name
			updateReq := &models.UpdateAgentRequest{
				Name:        metadata.Name,
				Description: metadata.Description,
			}
			_, updateErr := h.agentService.UpdateAgent(agentID, userID, updateReq)
			if updateErr != nil {
				log.Printf("⚠️ [GENERATE-WITH-TOOLS] Failed to persist agent metadata (non-fatal): %v", updateErr)
			} else {
				log.Printf("💾 [GENERATE-WITH-TOOLS] Persisted agent metadata: name=%s", metadata.Name)
			}
		}
	}

	log.Printf("✅ [GENERATE-WITH-TOOLS] Generated workflow for agent %s: %d blocks",
		agentID, len(result.Workflow.Blocks))
	return c.JSON(result)
}

// GenerateSampleInput uses AI to generate sample JSON input for a workflow
// POST /api/agents/:id/generate-sample-input
func (h *AgentHandler) GenerateSampleInput(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	agentID := c.Params("id")
	if agentID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Agent ID is required",
		})
	}

	// Parse request body
	var req struct {
		ModelID string `json:"model_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.ModelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Model ID is required",
		})
	}

	// Get the agent and workflow
	agent, err := h.agentService.GetAgent(agentID, userID)
	if err != nil {
		log.Printf("❌ [SAMPLE-INPUT] Failed to get agent: %v", err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Agent not found",
		})
	}

	if agent.Workflow == nil || len(agent.Workflow.Blocks) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Workflow has no blocks",
		})
	}

	// Generate sample input using the workflow generator service
	sampleInput, err := h.workflowGeneratorService.GenerateSampleInput(agent.Workflow, req.ModelID, userID)
	if err != nil {
		log.Printf("❌ [SAMPLE-INPUT] Failed to generate sample input: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to generate sample input",
			"details": err.Error(),
		})
	}

	log.Printf("✅ [SAMPLE-INPUT] Generated sample input for agent %s", agentID)
	return c.JSON(fiber.Map{
		"success":      true,
		"sample_input": sampleInput,
	})
}

// Ask handles Ask mode requests - helps users understand their workflow
// POST /api/agents/ask
func (h *AgentHandler) Ask(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Authentication required",
		})
	}

	var req struct {
		AgentID string `json:"agent_id"`
		Message string `json:"message"`
		ModelID string `json:"model_id"`
		Context struct {
			Workflow          *models.Workflow       `json:"workflow"`
			AvailableTools    []map[string]string    `json:"available_tools"`
			DeploymentExample string                 `json:"deployment_example"`
		} `json:"context"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.AgentID == "" || req.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "agent_id and message are required",
		})
	}

	if h.providerService == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Provider service not available",
		})
	}

	// Get the agent to verify ownership
	agent, err := h.agentService.GetAgent(req.AgentID, userID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Agent not found",
		})
	}

	log.Printf("💬 [ASK] User %s asking about agent %s: %s", userID, agent.Name, req.Message)

	// Build context from workflow
	var workflowContext string
	if req.Context.Workflow != nil && len(req.Context.Workflow.Blocks) > 0 {
		workflowContext = "\n\n## Current Workflow Structure\n"
		for i, block := range req.Context.Workflow.Blocks {
			desc := block.Description
			if desc == "" {
				desc = "No description"
			}
			workflowContext += fmt.Sprintf("%d. **%s** (%s): %s\n", i+1, block.Name, block.Type, desc)
		}
	}

	// Build tools context
	var toolsContext string
	if len(req.Context.AvailableTools) > 0 {
		toolsContext = "\n\n## Available Tools\n"
		for _, tool := range req.Context.AvailableTools {
			toolsContext += fmt.Sprintf("- **%s**: %s (Category: %s)\n",
				tool["name"], tool["description"], tool["category"])
		}
	}

	// Build deployment context
	var deploymentContext string
	if req.Context.DeploymentExample != "" {
		deploymentContext = "\n\n## Deployment API Example\n```bash\n" + req.Context.DeploymentExample + "\n```"
	}

	// Build system prompt
	systemPrompt := fmt.Sprintf(`You are an AI assistant helping users understand their workflow agent in ClaraVerse.

**Agent Name**: %s
**Agent Description**: %s

Your role is to:
1. Answer questions about the workflow structure and how it works
2. Explain what tools are available and how to use them
3. Help with deployment and API integration questions
4. Provide clear, concise explanations

**IMPORTANT**: You are in "Ask" mode, which is for answering questions only. If the user asks you to modify the workflow (add, change, remove blocks), politely tell them to switch to "Builder" mode.

%s%s%s

Be helpful, clear, and concise. If you don't know something, say so.`,
		agent.Name,
		agent.Description,
		workflowContext,
		toolsContext,
		deploymentContext,
	)

	// Call LLM with simple chat endpoint
	modelID := req.ModelID
	if modelID == "" {
		modelID = "gpt-4.1" // Default model
	}

	// Get provider for model
	provider, err := h.providerService.GetByModelID(modelID)
	if err != nil {
		log.Printf("❌ [ASK] Failed to get provider for model %s: %v", modelID, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Model '%s' not found", modelID),
		})
	}

	// Build OpenAI-compatible request
	type Message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type OpenAIRequest struct {
		Model    string    `json:"model"`
		Messages []Message `json:"messages"`
	}

	reqBody, err := json.Marshal(OpenAIRequest{
		Model: modelID,
		Messages: []Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: req.Message},
		},
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to prepare request",
		})
	}

	// Make HTTP request
	httpReq, err := http.NewRequest("POST", provider.BaseURL+"/chat/completions", bytes.NewBuffer(reqBody))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create HTTP request",
		})
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+provider.APIKey)

	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("❌ [ASK] HTTP request failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get response from AI",
		})
	}
	defer resp.Body.Close()

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read response",
		})
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("⚠️ [ASK] API error: %s", string(body))
		return c.Status(resp.StatusCode).JSON(fiber.Map{
			"error": fmt.Sprintf("AI service error: %s", string(body)),
		})
	}

	// Parse response
	var apiResponse struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to parse AI response",
		})
	}

	if len(apiResponse.Choices) == 0 {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "No response from AI",
		})
	}

	responseText := apiResponse.Choices[0].Message.Content

	log.Printf("✅ [ASK] Response generated for agent %s", agent.Name)
	return c.JSON(fiber.Map{
		"response": responseText,
	})
}
