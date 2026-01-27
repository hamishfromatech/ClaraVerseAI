package execution

import (
	"claraverse/internal/models"
	"claraverse/internal/services"
	"context"
	"fmt"
	"log"
	"sync"
	"time"
)

// WorkflowEngine executes workflows as DAGs with parallel execution
type WorkflowEngine struct {
	registry     *ExecutorRegistry
	blockChecker *BlockChecker
}

// NewWorkflowEngine creates a new workflow engine
func NewWorkflowEngine(registry *ExecutorRegistry) *WorkflowEngine {
	return &WorkflowEngine{registry: registry}
}

// NewWorkflowEngineWithChecker creates a workflow engine with block completion checking
func NewWorkflowEngineWithChecker(registry *ExecutorRegistry, providerService *services.ProviderService) *WorkflowEngine {
	return &WorkflowEngine{
		registry:     registry,
		blockChecker: NewBlockChecker(providerService),
	}
}

// SetBlockChecker allows setting the block checker after creation
func (e *WorkflowEngine) SetBlockChecker(checker *BlockChecker) {
	e.blockChecker = checker
}

// ExecutionResult contains the final result of a workflow execution
type ExecutionResult struct {
	Status      string                        `json:"status"` // completed, failed, partial
	Output      map[string]any                `json:"output"`
	BlockStates map[string]*models.BlockState `json:"block_states"`
	Error       string                        `json:"error,omitempty"`
}

// ExecutionOptions contains optional settings for workflow execution
type ExecutionOptions struct {
	// WorkflowGoal is the high-level objective of the workflow (used for block checking)
	WorkflowGoal string
	// CheckerModelID is the model to use for block completion checking
	// If empty, block checking is disabled
	CheckerModelID string
	// EnableBlockChecker enables/disables block completion validation
	EnableBlockChecker bool
}

// Execute runs a workflow and streams updates via the statusChan
// This is the backwards-compatible version without block checking
func (e *WorkflowEngine) Execute(
	ctx context.Context,
	workflow *models.Workflow,
	input map[string]any,
	statusChan chan<- models.ExecutionUpdate,
) (*ExecutionResult, error) {
	return e.ExecuteWithOptions(ctx, workflow, input, statusChan, nil)
}

// ExecuteWithOptions runs a workflow with optional block completion checking
func (e *WorkflowEngine) ExecuteWithOptions(
	ctx context.Context,
	workflow *models.Workflow,
	input map[string]any,
	statusChan chan<- models.ExecutionUpdate,
	options *ExecutionOptions,
) (*ExecutionResult, error) {
	log.Printf("🚀 [ENGINE] Starting workflow execution with %d blocks", len(workflow.Blocks))

	// Build block index
	blockIndex := make(map[string]models.Block)
	for _, block := range workflow.Blocks {
		blockIndex[block.ID] = block
	}

	// Build dependency graph
	// dependencies[blockID] = list of block IDs that must complete before this block
	dependencies := make(map[string][]string)
	// dependents[blockID] = list of block IDs that depend on this block
	dependents := make(map[string][]string)

	for _, block := range workflow.Blocks {
		dependencies[block.ID] = []string{}
		dependents[block.ID] = []string{}
	}

	for _, conn := range workflow.Connections {
		// conn.SourceBlockID -> conn.TargetBlockID
		dependencies[conn.TargetBlockID] = append(dependencies[conn.TargetBlockID], conn.SourceBlockID)
		dependents[conn.SourceBlockID] = append(dependents[conn.SourceBlockID], conn.TargetBlockID)
	}

	// Find start blocks (no dependencies)
	var startBlocks []string
	for blockID, deps := range dependencies {
		if len(deps) == 0 {
			startBlocks = append(startBlocks, blockID)
		}
	}

	if len(startBlocks) == 0 && len(workflow.Blocks) > 0 {
		return nil, fmt.Errorf("workflow has no start blocks (circular dependency?)")
	}

	log.Printf("📊 [ENGINE] Found %d start blocks: %v", len(startBlocks), startBlocks)

	// Initialize block states and outputs
	blockStates := make(map[string]*models.BlockState)
	blockOutputs := make(map[string]map[string]any)
	var statesMu sync.RWMutex

	for _, block := range workflow.Blocks {
		blockStates[block.ID] = &models.BlockState{
			Status: "pending",
		}
	}

	// Initialize with workflow variables and input
	globalInputs := make(map[string]any)
	log.Printf("🔍 [ENGINE] Workflow input received: %+v", input)

	// First, set workflow variable defaults
	for _, variable := range workflow.Variables {
		if variable.DefaultValue != nil {
			globalInputs[variable.Name] = variable.DefaultValue
			log.Printf("🔍 [ENGINE] Added workflow variable default: %s = %v", variable.Name, variable.DefaultValue)
		}
	}

	// Then, override with execution input (takes precedence over defaults)
	for k, v := range input {
		globalInputs[k] = v
		log.Printf("🔍 [ENGINE] Added/overrode from execution input: %s = %v", k, v)
	}

	// Extract workflow-level model override from Start block
	for _, block := range workflow.Blocks {
		if block.Type == "variable" {
			if op, ok := block.Config["operation"].(string); ok && op == "read" {
				if varName, ok := block.Config["variableName"].(string); ok && varName == "input" {
					// This is the Start block - check for workflowModelId
					if modelID, ok := block.Config["workflowModelId"].(string); ok && modelID != "" {
						globalInputs["_workflowModelId"] = modelID
						log.Printf("🎯 [ENGINE] Using workflow model override: %s", modelID)
					}
				}
			}
		}
	}

	// Track completed blocks for dependency resolution
	completedBlocks := make(map[string]bool)
	failedBlocks := make(map[string]bool)
	var completedMu sync.Mutex

	// Error tracking
	var executionErrors []string
	var errorsMu sync.Mutex

	// WaitGroup for tracking all goroutines
	var wg sync.WaitGroup

	// Recursive function to execute a block and schedule dependents
	var executeBlock func(blockID string)
	executeBlock = func(blockID string) {
		block := blockIndex[blockID]

		// Update status to running
		statesMu.Lock()
		blockStates[blockID].Status = "running"
		blockStates[blockID].StartedAt = timePtr(time.Now())
		statesMu.Unlock()

		// Send status update (without inputs yet - will send after building them)
		statusChan <- models.ExecutionUpdate{
			Type:    "execution_update",
			BlockID: blockID,
			Status:  "running",
		}

		log.Printf("▶️ [ENGINE] Executing block '%s' (type: %s)", block.Name, block.Type)

		// Build inputs for this block from:
		// 1. Global inputs (workflow input + variables)
		// 2. Outputs from upstream blocks
		blockInputs := make(map[string]any)
		log.Printf("🔍 [ENGINE] Block '%s': globalInputs keys: %v", block.Name, getMapKeys(globalInputs))
		for k, v := range globalInputs {
			blockInputs[k] = v
		}
		log.Printf("🔍 [ENGINE] Block '%s': blockInputs after globalInputs: %v", block.Name, getMapKeys(blockInputs))

		// Make ALL completed block outputs available for template resolution
		// This allows blocks to reference any upstream block, not just directly connected ones
		// Example: Final block can use {{start.response}}, {{research-overview.response}}, etc.
		statesMu.RLock()

		essentialKeys := []string{
			"response", "data", "output", "value", "result",
			"artifacts", "toolResults", "tokens", "model",
			"iterations", "_parseError", "rawResponse",
			"generatedFiles", "toolCalls", "timedOut",
		}

		// Track which block is directly connected (for flattening priority)
		directlyConnectedBlockID := ""
		for _, conn := range workflow.Connections {
			if conn.TargetBlockID == blockID {
				directlyConnectedBlockID = conn.SourceBlockID
				break
			}
		}

		// Add ALL completed block outputs (for template access like {{block-name.response}})
		for completedBlockID, output := range blockOutputs {
			sourceBlock, exists := blockIndex[completedBlockID]
			if !exists {
				continue
			}

			// Create clean output (only essential keys)
			cleanOutput := make(map[string]any)
			for _, key := range essentialKeys {
				if val, exists := output[key]; exists {
					cleanOutput[key] = val
				}
			}

			// Store under normalizedId (e.g., "research-overview")
			if sourceBlock.NormalizedID != "" {
				blockInputs[sourceBlock.NormalizedID] = cleanOutput
			}

			// Also store under block ID if different
			if sourceBlock.ID != "" && sourceBlock.ID != sourceBlock.NormalizedID {
				blockInputs[sourceBlock.ID] = cleanOutput
			}
		}

		// Log available block references
		log.Printf("🔗 [ENGINE] Block '%s' can access %d upstream blocks", block.Name, len(blockOutputs))

		// Flatten essential keys from DIRECTLY CONNECTED block only (for {{response}} shorthand)
		if directlyConnectedBlockID != "" {
			if output, ok := blockOutputs[directlyConnectedBlockID]; ok {
				for _, key := range essentialKeys {
					if val, exists := output[key]; exists {
						blockInputs[key] = val
					}
				}
				log.Printf("🔗 [ENGINE] Flattened keys from directly connected block '%s'", blockIndex[directlyConnectedBlockID].Name)
			}
		}

		statesMu.RUnlock()

		// Store the available inputs in BlockState for debugging
		statesMu.Lock()
		blockStates[blockID].Inputs = blockInputs
		statesMu.Unlock()

		log.Printf("🔍 [ENGINE] Block '%s': stored %d input keys for debugging: %v", block.Name, len(blockInputs), getMapKeys(blockInputs))

		// Send updated status with inputs for debugging
		statusChan <- models.ExecutionUpdate{
			Type:    "execution_update",
			BlockID: blockID,
			Status:  "running",
			Inputs:  blockInputs,
		}

		// Get executor for this block type
		executor, execErr := e.registry.Get(block.Type)
		if execErr != nil {
			handleBlockError(blockID, block.Name, execErr, blockStates, &statesMu, statusChan, &executionErrors, &errorsMu)
			completedMu.Lock()
			failedBlocks[blockID] = true
			completedMu.Unlock()
			return
		}

		// Create timeout context
		// Default: 30s for most blocks, 600s for LLM blocks (agent mode needs more time for multiple tool calls)
		timeout := 30 * time.Second
		if block.Type == "llm_inference" {
			timeout = 600 * time.Second // LLM blocks get 10 minutes by default (increased for agent mode)
		}
		// User-specified timeout can override, but LLM blocks get at least 600s
		if block.Timeout > 0 {
			userTimeout := time.Duration(block.Timeout) * time.Second
			if block.Type == "llm_inference" && userTimeout < 600*time.Second {
				// LLM blocks need at least 600s for agent mode with multiple tool calls
				timeout = 600 * time.Second
			} else {
				timeout = userTimeout
			}
		}
		blockCtx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()

		// Execute the block
		output, execErr := executor.Execute(blockCtx, block, blockInputs)
		if execErr != nil {
			handleBlockError(blockID, block.Name, execErr, blockStates, &statesMu, statusChan, &executionErrors, &errorsMu)
			completedMu.Lock()
			failedBlocks[blockID] = true
			completedMu.Unlock()
			return
		}

		// Block Completion Check: Validate if block actually accomplished its job
		// This catches cases where a block "completed" but didn't actually succeed
		// (e.g., repeated tool errors, timeouts, empty responses)
		if options != nil && options.EnableBlockChecker && e.blockChecker != nil && ShouldCheckBlock(block) {
			log.Printf("🔍 [ENGINE] Running block completion check for '%s'", block.Name)

			checkerModelID := options.CheckerModelID
			if checkerModelID == "" {
				// Default to a fast model for checking
				checkerModelID = "gpt-4.1"
			}

			checkResult, checkErr := e.blockChecker.CheckBlockCompletion(
				ctx,
				options.WorkflowGoal,
				block,
				blockInputs,
				output,
				checkerModelID,
			)

			if checkErr != nil {
				log.Printf("⚠️ [ENGINE] Block checker error (continuing): %v", checkErr)
			} else if !checkResult.Passed {
				// Block failed the completion check - treat as failure
				log.Printf("❌ [ENGINE] Block '%s' failed completion check: %s\n   Actual Output: %s", block.Name, checkResult.Reason, checkResult.ActualOutput)

				// Add check failure info to output for visibility
				output["_blockCheckFailed"] = true
				output["_blockCheckReason"] = checkResult.Reason
				output["_blockActualOutput"] = checkResult.ActualOutput

				checkError := fmt.Errorf("block did not accomplish its job: %s\n\nActual Output: %s", checkResult.Reason, checkResult.ActualOutput)
				handleBlockError(blockID, block.Name, checkError, blockStates, &statesMu, statusChan, &executionErrors, &errorsMu)
				completedMu.Lock()
				failedBlocks[blockID] = true
				completedMu.Unlock()
				return
			} else {
				log.Printf("✓ [ENGINE] Block '%s' passed completion check: %s", block.Name, checkResult.Reason)
			}
		}

		// Store output and mark completed
		statesMu.Lock()
		blockOutputs[blockID] = output
		blockStates[blockID].Status = "completed"
		blockStates[blockID].CompletedAt = timePtr(time.Now())
		blockStates[blockID].Outputs = output
		statesMu.Unlock()

		// Send completion update with inputs for debugging
		statusChan <- models.ExecutionUpdate{
			Type:    "execution_update",
			BlockID: blockID,
			Status:  "completed",
			Inputs:  blockInputs,
			Output:  output,
		}

		log.Printf("✅ [ENGINE] Block '%s' completed", block.Name)

		// Mark as completed and check dependents
		completedMu.Lock()
		completedBlocks[blockID] = true

		// Check if any dependent blocks can now run
		for _, depBlockID := range dependents[blockID] {
			canRun := true
			for _, reqBlockID := range dependencies[depBlockID] {
				if !completedBlocks[reqBlockID] {
					// Check if the required block failed - if so, we can't run
					if failedBlocks[reqBlockID] {
						canRun = false
						break
					}
					// Required block hasn't completed yet
					canRun = false
					break
				}
			}
			if canRun {
				// Queue this block for execution
				wg.Add(1)
				go func(bid string) {
					defer wg.Done()
					executeBlock(bid)
				}(depBlockID)
			}
		}
		completedMu.Unlock()
	}

	// Start execution with start blocks
	for _, blockID := range startBlocks {
		wg.Add(1)
		go func(bid string) {
			defer wg.Done()
			executeBlock(bid)
		}(blockID)
	}

	// Wait for all blocks to complete
	wg.Wait()

	// Determine final status
	finalStatus := "completed"
	var failedBlockIDs []string
	var completedCount, failedCount int

	statesMu.RLock()
	for blockID, state := range blockStates {
		if state.Status == "completed" {
			completedCount++
		} else if state.Status == "failed" {
			failedCount++
			failedBlockIDs = append(failedBlockIDs, blockID)
		}
	}
	statesMu.RUnlock()

	if failedCount > 0 {
		if completedCount > 0 {
			finalStatus = "partial"
		} else {
			finalStatus = "failed"
		}
	}

	// Collect final output from terminal blocks (blocks with no dependents)
	finalOutput := make(map[string]any)
	statesMu.RLock()
	for blockID, deps := range dependents {
		if len(deps) == 0 {
			if output, ok := blockOutputs[blockID]; ok {
				block := blockIndex[blockID]
				finalOutput[block.Name] = output
			}
		}
	}
	statesMu.RUnlock()

	// Build error message if any
	var errorMsg string
	errorsMu.Lock()
	if len(executionErrors) > 0 {
		errorMsg = fmt.Sprintf("%d block(s) failed: %v", len(executionErrors), executionErrors)
	}
	errorsMu.Unlock()

	log.Printf("🏁 [ENGINE] Workflow execution %s: %d completed, %d failed",
		finalStatus, completedCount, failedCount)

	return &ExecutionResult{
		Status:      finalStatus,
		Output:      finalOutput,
		BlockStates: blockStates,
		Error:       errorMsg,
	}, nil
}

// handleBlockError handles block execution errors with classification for debugging
func handleBlockError(
	blockID, blockName string,
	err error,
	blockStates map[string]*models.BlockState,
	statesMu *sync.RWMutex,
	statusChan chan<- models.ExecutionUpdate,
	executionErrors *[]string,
	errorsMu *sync.Mutex,
) {
	// Try to extract error classification for better debugging
	var errorType string
	var retryable bool

	if execErr, ok := err.(*ExecutionError); ok {
		errorType = execErr.Category.String()
		retryable = execErr.Retryable
		log.Printf("❌ [ENGINE] Block '%s' failed: %v [type=%s, retryable=%v]", blockName, err, errorType, retryable)
	} else {
		errorType = "unknown"
		retryable = false
		log.Printf("❌ [ENGINE] Block '%s' failed: %v", blockName, err)
	}

	statesMu.Lock()
	blockStates[blockID].Status = "failed"
	blockStates[blockID].CompletedAt = timePtr(time.Now())
	blockStates[blockID].Error = err.Error()
	statesMu.Unlock()

	// Include error classification in status update for frontend visibility
	statusChan <- models.ExecutionUpdate{
		Type:    "execution_update",
		BlockID: blockID,
		Status:  "failed",
		Error:   err.Error(),
		Output: map[string]any{
			"errorType": errorType,
			"retryable": retryable,
		},
	}

	errorsMu.Lock()
	*executionErrors = append(*executionErrors, fmt.Sprintf("%s: %s", blockName, err.Error()))
	errorsMu.Unlock()
}

// timePtr returns a pointer to a time.Time
func timePtr(t time.Time) *time.Time {
	return &t
}

// getMapKeys returns the keys of a map as a slice
func getMapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// BuildAPIResponse converts an ExecutionResult into a clean, structured API response
// This provides a standardized output format for API consumers
func (e *WorkflowEngine) BuildAPIResponse(
	result *ExecutionResult,
	workflow *models.Workflow,
	executionID string,
	durationMs int64,
) *models.ExecutionAPIResponse {
	response := &models.ExecutionAPIResponse{
		Status:    result.Status,
		Artifacts: []models.APIArtifact{},
		Files:     []models.APIFile{},
		Blocks:    make(map[string]models.APIBlockOutput),
		Metadata: models.ExecutionMetadata{
			ExecutionID: executionID,
			DurationMs:  durationMs,
		},
		Error: result.Error,
	}

	// Build block index for lookups
	blockIndex := make(map[string]models.Block)
	for _, block := range workflow.Blocks {
		blockIndex[block.ID] = block
	}

	// Track totals
	var totalTokens int
	var blocksExecuted, blocksFailed int

	// Process block states
	for blockID, state := range result.BlockStates {
		block, exists := blockIndex[blockID]
		if !exists {
			continue
		}

		// Create clean block output
		blockOutput := models.APIBlockOutput{
			Name:   block.Name,
			Type:   block.Type,
			Status: state.Status,
		}

		if state.Status == "completed" {
			blocksExecuted++
		} else if state.Status == "failed" {
			blocksFailed++
			blockOutput.Error = state.Error
		}

		// Extract response text from outputs
		if state.Outputs != nil {
			// Primary response
			if resp, ok := state.Outputs["response"].(string); ok {
				blockOutput.Response = resp
			}

			// Extract tokens (for metadata, but don't expose)
			if tokens, ok := state.Outputs["tokens"].(map[string]any); ok {
				if total, ok := tokens["total"].(int); ok {
					totalTokens += total
				} else if total, ok := tokens["total"].(float64); ok {
					totalTokens += int(total)
				}
			}

			// Calculate duration from timestamps
			if state.StartedAt != nil && state.CompletedAt != nil {
				blockOutput.DurationMs = state.CompletedAt.Sub(*state.StartedAt).Milliseconds()
			}

			// Extract structured data - filter all outputs except response
			cleanData := make(map[string]any)
			for k, v := range state.Outputs {
				// Skip internal fields and the response (already extracted)
				if !isInternalField(k) && k != "response" {
					// Also check nested output object
					if k == "output" {
						if outputMap, ok := v.(map[string]any); ok {
							for ok, ov := range outputMap {
								if !isInternalField(ok) && ok != "response" {
									cleanData[ok] = ov
								}
							}
						}
					} else {
						cleanData[k] = v
					}
				}
			}
			if len(cleanData) > 0 {
				blockOutput.Data = cleanData
			}

			// Extract artifacts from this block
			artifacts := extractArtifactsFromBlockOutput(state.Outputs, block.Name)
			response.Artifacts = append(response.Artifacts, artifacts...)

			// Extract files from this block
			files := extractFilesFromBlockOutput(state.Outputs, block.Name)
			response.Files = append(response.Files, files...)
		}

		response.Blocks[block.ID] = blockOutput
	}

	// Set metadata
	response.Metadata.TotalTokens = totalTokens
	response.Metadata.BlocksExecuted = blocksExecuted
	response.Metadata.BlocksFailed = blocksFailed
	if workflow != nil {
		response.Metadata.WorkflowVersion = workflow.Version
	}

	// Extract the primary result and structured data from terminal blocks
	response.Result, response.Data = extractPrimaryResultAndData(result.Output, result.BlockStates)

	log.Printf("📦 [ENGINE] Built API response: status=%s, result_length=%d, has_data=%v, artifacts=%d, files=%d",
		response.Status, len(response.Result), response.Data != nil, len(response.Artifacts), len(response.Files))

	return response
}

// extractPrimaryResultAndData gets the main text result AND structured data from the workflow output
// For structured output blocks, the "data" field contains the parsed JSON which we return separately
func extractPrimaryResultAndData(output map[string]any, blockStates map[string]*models.BlockState) (string, any) {
	// First, try to get from the final output (terminal blocks)
	for blockName, blockOutput := range output {
		if blockData, ok := blockOutput.(map[string]any); ok {
			var resultStr string
			var structuredData any

			// Look for response field (the text/JSON string)
			if resp, ok := blockData["response"].(string); ok && resp != "" {
				resultStr = resp
				log.Printf("📝 [ENGINE] Extracted primary result from block '%s' (%d chars)", blockName, len(resp))
			} else if resp, ok := blockData["rawResponse"].(string); ok && resp != "" {
				// Fallback to rawResponse
				resultStr = resp
			}

			// Look for structured data field (parsed JSON from structured output blocks)
			// This is populated when outputFormat="json" and the response was successfully parsed
			if data, ok := blockData["data"]; ok && data != nil {
				structuredData = data
				log.Printf("📊 [ENGINE] Extracted structured data from block '%s'", blockName)
			}

			if resultStr != "" {
				return resultStr, structuredData
			}
		}
	}

	// Fallback: find the last completed block with a response
	var lastResponse string
	var lastData any
	for _, state := range blockStates {
		if state.Status == "completed" && state.Outputs != nil {
			if resp, ok := state.Outputs["response"].(string); ok && resp != "" {
				lastResponse = resp
			}
			if data, ok := state.Outputs["data"]; ok && data != nil {
				lastData = data
			}
		}
	}

	return lastResponse, lastData
}

// extractArtifactsFromBlockOutput extracts artifacts from a block's output
func extractArtifactsFromBlockOutput(outputs map[string]any, blockName string) []models.APIArtifact {
	var artifacts []models.APIArtifact

	// Check for artifacts array
	if rawArtifacts, ok := outputs["artifacts"]; ok {
		switch arts := rawArtifacts.(type) {
		case []any:
			for _, a := range arts {
				if artMap, ok := a.(map[string]any); ok {
					artifact := models.APIArtifact{
						SourceBlock: blockName,
					}
					if t, ok := artMap["type"].(string); ok {
						artifact.Type = t
					}
					if f, ok := artMap["format"].(string); ok {
						artifact.Format = f
					}
					if d, ok := artMap["data"].(string); ok {
						artifact.Data = d
					}
					if t, ok := artMap["title"].(string); ok {
						artifact.Title = t
					}
					if artifact.Data != "" && len(artifact.Data) > 100 {
						artifacts = append(artifacts, artifact)
					}
				}
			}
		}
	}

	return artifacts
}

// extractFilesFromBlockOutput extracts generated files from a block's output
func extractFilesFromBlockOutput(outputs map[string]any, blockName string) []models.APIFile {
	var files []models.APIFile

	// Check for generatedFiles array
	if rawFiles, ok := outputs["generatedFiles"]; ok {
		switch fs := rawFiles.(type) {
		case []any:
			for _, f := range fs {
				if fileMap, ok := f.(map[string]any); ok {
					file := models.APIFile{
						SourceBlock: blockName,
					}
					if id, ok := fileMap["file_id"].(string); ok {
						file.FileID = id
					}
					if fn, ok := fileMap["filename"].(string); ok {
						file.Filename = fn
					}
					if url, ok := fileMap["download_url"].(string); ok {
						file.DownloadURL = url
					}
					if mt, ok := fileMap["mime_type"].(string); ok {
						file.MimeType = mt
					}
					if sz, ok := fileMap["size"].(float64); ok {
						file.Size = int64(sz)
					}
					if file.FileID != "" || file.DownloadURL != "" {
						files = append(files, file)
					}
				}
			}
		}
	}

	// Also check for single file reference
	if fileURL, ok := outputs["file_url"].(string); ok && fileURL != "" {
		file := models.APIFile{
			DownloadURL: fileURL,
			SourceBlock: blockName,
		}
		if fn, ok := outputs["file_name"].(string); ok {
			file.Filename = fn
		}
		files = append(files, file)
	}

	return files
}

// isInternalField checks if a field name is internal and should be hidden from API response
func isInternalField(key string) bool {
	// Any field starting with _ or __ is internal
	if len(key) > 0 && key[0] == '_' {
		return true
	}
	
	internalFields := map[string]bool{
		// Response duplicates
		"rawResponse":  true,
		"output":       true, // Duplicate of response
		
		// Execution internals
		"tokens":       true,
		"toolCalls":    true,
		"iterations":   true,
		"model":        true, // Internal model ID - never expose
		
		// Already extracted separately
		"artifacts":      true,
		"generatedFiles": true,
		"file_url":       true,
		"file_name":      true,
		
		// Passthrough noise
		"start":        true,
		"input":        true, // Passthrough from workflow input
		"value":        true, // Duplicate of input
		"timedOut":     true,
	}
	return internalFields[key]
}