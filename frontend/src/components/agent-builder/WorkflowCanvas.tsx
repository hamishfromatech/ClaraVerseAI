import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  // MiniMap, // Temporarily disabled due to z-index issues
  BackgroundVariant,
  Panel,
  applyNodeChanges,
} from '@xyflow/react';
import type {
  Connection,
  ReactFlowInstance,
  NodeChange,
  EdgeChange,
  Node,
  Edge,
} from '@xyflow/react';
import {
  Play,
  Save,
  Rocket,
  Undo,
  Redo,
  Square,
  FileOutput,
  LayoutGrid,
  History,
  ChevronDown,
  KeyRound,
  AlertTriangle,
  ExternalLink,
  Bug,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAgentBuilderStore } from '@/store/useAgentBuilderStore';
import { useCredentialsStore } from '@/store/useCredentialsStore';
import { toast } from '@/store/useToastStore';
import { BlockNode } from './BlockNode';
import { ExecutionOutputPanel } from './ExecutionOutputPanel';
import { OnboardingGuidance } from './OnboardingGuidance';
import { SetupRequiredPanel } from './SetupRequiredPanel';
import { DeployPanel } from './DeployPanel';
import { workflowExecutionService } from '@/services/workflowExecutionService';
import { validateWorkflow, type WorkflowValidationResult } from '@/utils/blockValidation';

// Tools that require credentials - maps to integration types (legacy, kept for backward compat)
const TOOLS_REQUIRING_CREDENTIALS: Record<string, string> = {
  // Messaging tools
  send_discord_message: 'discord',
  send_slack_message: 'slack',
  send_telegram_message: 'telegram',
  send_google_chat_message: 'google_chat',
  send_webhook: 'webhook',
  // Notion tools
  notion_search: 'notion',
  notion_query_database: 'notion',
  notion_create_page: 'notion',
  notion_update_page: 'notion',
  // GitHub tools
  github_create_issue: 'github',
  github_list_issues: 'github',
  github_create_pr: 'github',
};

interface WorkflowCanvasProps {
  className?: string;
}

// Custom node types - MUST be outside component to prevent re-renders
const nodeTypes = {
  blockNode: BlockNode,
};

export function WorkflowCanvas({ className }: WorkflowCanvasProps) {
  const navigate = useNavigate();
  const {
    currentAgent,
    workflow,
    nodes: storeNodes,
    edges: storeEdges,
    executionStatus,
    blockStates,
    workflowHistory,
    workflowFuture,
    workflowVersions,
    highlightedEdgeIds,
    debugMode,
    onNodesChange: storeOnNodesChange,
    onConnect: storeOnConnect,
    saveCurrentAgent,
    clearExecution,
    autoLayoutWorkflow,
    setActiveView,
    undo,
    redo,
    restoreWorkflowVersion,
    showOnboardingGuidance,
    selectBlock,
    toggleDebugMode,
  } = useAgentBuilderStore();

  // State for execution errors
  const [, setExecutionError] = useState<string | null>(null);

  // State for output panel visibility
  const [showOutputPanel, setShowOutputPanel] = useState(false);

  // State for version dropdown
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);

  // State for saving indicator
  const [isSaving, setIsSaving] = useState(false);

  // State for credentials dropdown
  const [showCredentialsDropdown, setShowCredentialsDropdown] = useState(false);

  // State for setup required panel
  const [showSetupPanel, setShowSetupPanel] = useState(false);

  // State for deploy panel
  const [showDeployPanel, setShowDeployPanel] = useState(false);

  // Credentials store
  const { credentialReferences, fetchCredentialReferences } = useCredentialsStore();

  // Fetch credentials on mount
  useEffect(() => {
    fetchCredentialReferences();
  }, [fetchCredentialReferences]);

  // Get all tools used in the workflow that require credentials
  const workflowCredentialInfo = useMemo(() => {
    if (!workflow || workflow.blocks.length === 0) {
      return { toolsNeedingCredentials: [], unconfiguredTools: [], configuredTools: [] };
    }

    // Collect all tools from llm_inference blocks
    const allToolsInWorkflow: string[] = [];
    const blockCredentials: Record<string, string[]> = {};

    workflow.blocks.forEach(block => {
      // Check block.type instead of config.type (AI-generated blocks might not set config.type)
      if (block.type === 'llm_inference') {
        // Check both 'tools' and 'enabledTools' keys (config uses both depending on source)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const config = block.config as any;
        const enabledTools: string[] = config.tools || config.enabledTools || [];
        const credentials: string[] = config.credentials || [];

        enabledTools.forEach((tool: string) => {
          if (!allToolsInWorkflow.includes(tool)) {
            allToolsInWorkflow.push(tool);
          }
        });

        // Track credentials per block
        blockCredentials[block.id] = credentials;
      }
    });

    // Filter to only tools that require credentials
    const toolsNeedingCredentials = allToolsInWorkflow.filter(
      tool => tool in TOOLS_REQUIRING_CREDENTIALS
    );

    // Check which integration types are needed
    const neededIntegrationTypes = new Set<string>();
    toolsNeedingCredentials.forEach(tool => {
      const integrationType = TOOLS_REQUIRING_CREDENTIALS[tool];
      if (integrationType) {
        neededIntegrationTypes.add(integrationType);
      }
    });

    // Check which integration types have credentials available
    const availableIntegrationTypes = new Set<string>();
    credentialReferences.forEach(cred => {
      availableIntegrationTypes.add(cred.integrationType);
    });

    // Determine configured vs unconfigured
    const unconfiguredTools: Array<{ tool: string; integrationType: string; displayName: string }> =
      [];
    const configuredTools: Array<{ tool: string; integrationType: string; displayName: string }> =
      [];

    toolsNeedingCredentials.forEach(tool => {
      const integrationType = TOOLS_REQUIRING_CREDENTIALS[tool];
      const displayName = tool
        .replace(/_/g, ' ')
        .replace(/^send /, '')
        .replace(/\b\w/g, l => l.toUpperCase());

      if (availableIntegrationTypes.has(integrationType)) {
        configuredTools.push({ tool, integrationType, displayName });
      } else {
        unconfiguredTools.push({ tool, integrationType, displayName });
      }
    });

    return { toolsNeedingCredentials, unconfiguredTools, configuredTools };
  }, [workflow, credentialReferences]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')
      ) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Auto-show output panel when execution completes
  useEffect(() => {
    if (executionStatus === 'failed' || executionStatus === 'partial_failure') {
      setShowOutputPanel(true);
    }
  }, [executionStatus]);

  // Check if workflow is valid and ready to run (same validation as "Save & Run" button)
  // Returns { isValid, missingItems } to help show specific error messages
  const workflowValidation = useMemo(() => {
    const result = { isValid: false, missingItems: [] as string[] };

    if (!workflow || workflow.blocks.length === 0) {
      result.missingItems.push('workflow blocks');
      return result;
    }

    // Find the Start block (variable block with operation='read' and variableName='input')
    const startBlock = workflow.blocks.find(
      block =>
        block.type === 'variable' &&
        block.config.type === 'variable' &&
        block.config.operation === 'read' &&
        block.config.variableName === 'input'
    );

    if (!startBlock) {
      result.missingItems.push('start block');
      return result;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = startBlock.config as any;

    // Check if workflowModelId is set
    if (!config.workflowModelId) {
      result.missingItems.push('model selection');
      return result;
    }

    // Check if input is required (default: true)
    const requiresInput = config.requiresInput !== false;

    // If input is required, validate input exists
    if (requiresInput) {
      const inputType = config.inputType || 'text';

      if (inputType === 'text') {
        // For text input, check defaultValue is non-empty
        const hasTextInput =
          typeof config.defaultValue === 'string' && config.defaultValue.trim().length > 0;
        if (!hasTextInput) {
          result.missingItems.push('test input');
          return result;
        }
      } else if (inputType === 'file') {
        // For file input, check fileValue has fileId
        const hasFileInput = config.fileValue?.fileId;
        if (!hasFileInput) {
          result.missingItems.push('file upload');
          return result;
        }
      } else if (inputType === 'json') {
        // For JSON input, check jsonValue exists
        const hasJsonInput = config.jsonValue !== null && config.jsonValue !== undefined;
        if (!hasJsonInput) {
          result.missingItems.push('JSON input');
          return result;
        }
      }
    }

    result.isValid = true;
    return result;
  }, [workflow]);

  const isWorkflowValid = workflowValidation.isValid;

  // Comprehensive workflow validation including credentials
  const comprehensiveValidation: WorkflowValidationResult = useMemo(() => {
    if (!workflow || workflow.blocks.length === 0) {
      return {
        isValid: false,
        issues: [],
        missingCredentials: new Map(),
        blocksNeedingAttention: [],
      };
    }

    // Get integration types that have credentials configured
    const configuredIntegrationTypes = credentialReferences.map(cred => cred.integrationType);

    return validateWorkflow(workflow, configuredIntegrationTypes);
  }, [workflow, credentialReferences]);

  // Handle running the workflow
  const handleRunWorkflow = useCallback(async () => {
    if (!currentAgent?.id || !workflow || workflow.blocks.length === 0) return;

    setExecutionError(null);

    try {
      // Auto-save before running to ensure agent exists on backend
      console.log('💾 [WORKFLOW] Auto-saving agent before execution...');
      await saveCurrentAgent();

      // Get the updated agent ID (may have changed after save)
      const updatedAgent = useAgentBuilderStore.getState().currentAgent;
      if (!updatedAgent?.id) {
        throw new Error('Failed to save agent');
      }

      // Extract test input value from Start block (variable block with operation='read' and variableName='input')
      const startBlock = workflow.blocks.find(
        block =>
          block.type === 'variable' &&
          block.config.type === 'variable' &&
          block.config.operation === 'read' &&
          block.config.variableName === 'input'
      );

      const workflowInput: Record<string, unknown> = {};
      if (startBlock && startBlock.config.type === 'variable') {
        const config = startBlock.config;
        const inputType = config.inputType || 'text';

        if (inputType === 'file' && config.fileValue) {
          // Pass file reference as input
          workflowInput.input = {
            file_id: config.fileValue.fileId,
            filename: config.fileValue.filename,
            mime_type: config.fileValue.mimeType,
            size: config.fileValue.size,
            type: config.fileValue.type,
          };
          console.log('📁 [WORKFLOW] Using file input:', config.fileValue.filename);
        } else if (inputType === 'json' && config.jsonValue) {
          // Pass JSON object as input
          workflowInput.input = config.jsonValue;
          console.log('📋 [WORKFLOW] Using JSON input:', config.jsonValue);
        } else if (config.defaultValue) {
          // Pass text as input
          workflowInput.input = config.defaultValue;
          console.log('📝 [WORKFLOW] Using text input:', workflowInput.input);
        }
      }

      console.log('▶️ [WORKFLOW] Running workflow for agent:', updatedAgent.id);
      await workflowExecutionService.executeWorkflow(updatedAgent.id, workflowInput);
    } catch (error) {
      console.error('Failed to execute workflow:', error);
      setExecutionError(error instanceof Error ? error.message : 'Execution failed');
    }
  }, [currentAgent?.id, workflow, saveCurrentAgent]);

  // Handle showing validation error message when user clicks Play
  const handleRunButtonClick = useCallback(() => {
    // Don't do anything if workflow is already running
    if (executionStatus === 'running') {
      return;
    }

    if (!isWorkflowValid) {
      // Show specific error message based on what's missing
      const missing = workflowValidation.missingItems[0];
      let message = 'Please complete the Start block configuration.';

      if (missing === 'model selection') {
        message = 'Please select a model in the Start block.';
      } else if (missing === 'test input') {
        message = 'Please enter test input in the Start block.';
      } else if (missing === 'file upload') {
        message = 'Please upload a file in the Start block.';
      } else if (missing === 'JSON input') {
        message = 'Please enter valid JSON in the Start block.';
      }

      toast.warning(message, 'Cannot Run Workflow');
      return;
    }

    // Check for credential issues - show setup panel if any
    if (!comprehensiveValidation.isValid && comprehensiveValidation.issues.length > 0) {
      setShowSetupPanel(true);
      return;
    }

    handleRunWorkflow();
  }, [
    executionStatus,
    isWorkflowValid,
    workflowValidation.missingItems,
    comprehensiveValidation,
    handleRunWorkflow,
  ]);

  // Handle stopping the execution
  const handleStopExecution = useCallback(() => {
    workflowExecutionService.disconnect();
    clearExecution();
  }, [clearExecution]);

  // Handle auto-layout with fitView
  const handleAutoLayout = useCallback(() => {
    autoLayoutWorkflow();
    // Fit view after layout to center the workflow
    setTimeout(() => {
      reactFlowInstance.current?.fitView({ padding: 0.2 });
    }, 150);
  }, [autoLayoutWorkflow]);

  // Handle deploying the agent - opens deploy panel
  const handleDeploy = useCallback(async () => {
    if (!currentAgent) return;

    // Save workflow first if there are unsaved changes
    try {
      await saveCurrentAgent();
    } catch (error) {
      console.error('Failed to save before deploying:', error);
      toast.error('Failed to save workflow');
      return;
    }

    // Open deploy panel
    setShowDeployPanel(true);
  }, [currentAgent, saveCurrentAgent]);

  // Handle save (no version tracking - versions only created by AI)
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveCurrentAgent();
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  }, [saveCurrentAgent]);

  // Local state for smooth dragging - synced from store
  const [localNodes, setLocalNodes] = useState<Node[]>([]);

  // Track if we're currently dragging to prevent store sync during drag
  const isDraggingRef = useRef(false);

  // Sync store nodes to local state (when store changes externally)
  useEffect(() => {
    // Don't sync if we're in the middle of dragging
    if (isDraggingRef.current) return;

    // Add execution state to nodes from store
    const nodesWithState = storeNodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        executionState: blockStates[node.id],
      },
    }));
    setLocalNodes(nodesWithState);
  }, [storeNodes, blockStates]);

  // React Flow instance for programmatic control
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  // Store ReactFlow instance on init and fit view
  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstance.current = instance;
    // Fit view after a short delay to ensure nodes are rendered
    setTimeout(() => {
      instance.fitView({ padding: 0.2 });
    }, 100);
  }, []);

  // Handle node changes - apply to local state for smooth dragging
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      // Check if any change is a drag start/in-progress
      const isDragging = changes.some(
        change => change.type === 'position' && change.dragging === true
      );

      // Check if drag just ended
      const dragEnded = changes.some(
        change => change.type === 'position' && change.dragging === false
      );

      if (isDragging) {
        isDraggingRef.current = true;
      }

      // Apply ALL position changes to local state for smooth visual movement
      setLocalNodes(nodes => applyNodeChanges(changes, nodes));

      // When drag ends, persist final position to store
      if (dragEnded) {
        isDraggingRef.current = false;
        const positionChanges = changes.filter(
          change => change.type === 'position' && change.dragging === false
        );
        if (positionChanges.length > 0) {
          storeOnNodesChange(positionChanges);
        }
      }
    },
    [storeOnNodesChange]
  );

  // Handle edge changes
  const handleEdgesChange = useCallback((_changes: EdgeChange<Edge>[]) => {
    // For now, we don't process edge changes from React Flow
    // Edges are managed through the store
  }, []);

  // Handle new connections
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        storeOnConnect({
          source: connection.source,
          target: connection.target,
        });
      }
    },
    [storeOnConnect]
  );

  // Transform edges to add flow animation classes and highlighting
  const styledEdges: Edge[] = useMemo(() => {
    return storeEdges.map(edge => {
      const sourceState = blockStates[edge.source];
      const targetState = blockStates[edge.target];
      const isHighlighted = highlightedEdgeIds.includes(edge.id);

      let edgeClassName = '';

      // Source completed and target running = flowing data
      if (sourceState?.status === 'completed' && targetState?.status === 'running') {
        edgeClassName = 'edge-flowing';
      }
      // Both completed = completed edge
      else if (sourceState?.status === 'completed' && targetState?.status === 'completed') {
        edgeClassName = 'edge-completed';
      }
      // Highlighted edge (when block is selected)
      else if (isHighlighted) {
        edgeClassName = 'edge-highlighted';
      }

      return {
        ...edge,
        className: edgeClassName,
        style: {
          ...edge.style,
          strokeWidth: isHighlighted ? 3 : 2,
          stroke: isHighlighted ? 'var(--color-accent)' : undefined,
        },
      };
    });
  }, [storeEdges, blockStates, highlightedEdgeIds]);

  // Empty state - no agent selected
  if (!currentAgent) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center h-full bg-[var(--color-bg-primary)]',
          className
        )}
      >
        <div className="text-center p-8">
          <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-[var(--color-bg-tertiary)] flex items-center justify-center border border-[var(--color-border)]">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-white"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <path d="M10 6.5h4M6.5 10v4M17.5 10v4M10 17.5h4" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
            No Workflow
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)] max-w-[300px] leading-relaxed">
            Select an agent to view and edit its workflow, or create a new agent to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative h-full', className)}>
      {/* SVG Gradient Definition for flowing edges */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
      </svg>

      <ReactFlow
        nodes={localNodes}
        edges={styledEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onInit={handleInit}
        onPaneClick={() => selectBlock(null)}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        className="bg-[var(--color-bg-primary)]"
      >
        {/* Background Grid */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border)"
        />

        {/* Controls */}
        <Controls
          showInteractive={false}
          className="!bg-[var(--color-bg-secondary)] !border !border-[var(--color-border)] !rounded-xl !z-[5] [&_button]:!bg-[var(--color-bg-primary)] [&_button]:!text-[var(--color-text-primary)] [&_button]:!border-[var(--color-border)] [&_button]:hover:!bg-[var(--color-bg-tertiary)]"
        />

        {/* Mini Map - hidden to avoid z-index issues with nodes */}
        {/* <MiniMap
          nodeColor={node => {
            const state = blockStates[node.id];
            if (state?.status === 'completed') return 'var(--color-success)';
            if (state?.status === 'failed') return 'var(--color-error)';
            if (state?.status === 'running') return 'var(--color-accent)';
            return 'var(--color-bg-tertiary)';
          }}
          maskColor="rgba(0, 0, 0, 0.2)"
          className="!bg-[var(--color-bg-secondary)] !border !border-[var(--color-border)] !rounded-xl"
        /> */}

        {/* Toolbar Panel */}
        <Panel position="top-right" className="flex items-center gap-2.5">
          <ToolbarButton
            icon={<Undo size={16} />}
            tooltip="Undo (Ctrl+Z)"
            onClick={undo}
            disabled={workflowHistory.length === 0}
          />
          <ToolbarButton
            icon={<Redo size={16} />}
            tooltip="Redo (Ctrl+Y)"
            onClick={redo}
            disabled={workflowFuture.length === 0}
          />

          {/* Version Dropdown */}
          {workflowVersions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowVersionDropdown(!showVersionDropdown)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-2 rounded-xl transition-all text-xs font-medium',
                  showVersionDropdown
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]'
                    : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)]'
                )}
                title="Workflow versions"
              >
                <History size={14} />
                <span>{workflowVersions.length} versions</span>
                <ChevronDown
                  size={12}
                  className={cn('transition-transform', showVersionDropdown && 'rotate-180')}
                />
              </button>

              {showVersionDropdown && (
                <>
                  {/* Backdrop */}
                  <div
                    className="fixed inset-0 z-[100]"
                    onClick={() => setShowVersionDropdown(false)}
                  />
                  {/* Dropdown */}
                  <div
                    className="absolute top-full right-0 mt-2 z-[101] w-72 max-h-[300px] overflow-y-auto rounded-xl bg-[#1a1a1a] border border-[var(--color-border)] shadow-xl"
                    onWheelCapture={e => {
                      // Use capture phase to stop the event before React Flow sees it
                      e.stopPropagation();
                    }}
                  >
                    <div className="px-3 py-2 border-b border-[var(--color-border)]">
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">
                        Workflow Version History
                      </span>
                      <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                        Click to restore a previous version
                      </p>
                    </div>
                    <div className="py-1">
                      {[...workflowVersions].reverse().map(version => (
                        <button
                          key={version.id}
                          onClick={() => {
                            restoreWorkflowVersion(version.version);
                            setShowVersionDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-[var(--color-bg-tertiary)] transition-colors group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-[var(--color-accent)]">
                              Version {version.version}
                            </span>
                            <span className="text-[10px] text-[var(--color-text-tertiary)]">
                              {new Date(version.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className="text-[10px] text-[var(--color-text-secondary)] truncate flex-1">
                              {version.description || `${version.blockCount} blocks`}
                            </p>
                            <span className="text-[10px] text-[var(--color-text-tertiary)] ml-2">
                              {version.blockCount} blocks
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="w-px h-6 bg-[var(--color-border)]" />
          <ToolbarButton
            icon={<LayoutGrid size={16} />}
            tooltip="Auto-arrange blocks"
            label="Auto Arrange"
            onClick={handleAutoLayout}
            disabled={!workflow || workflow.blocks.length === 0}
          />
          <ToolbarButton
            icon={<Save size={16} />}
            tooltip="Save"
            onClick={handleSave}
            disabled={isSaving}
          />

          {/* Credentials Button - only show if workflow has tools requiring credentials */}
          {workflowCredentialInfo.toolsNeedingCredentials.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowCredentialsDropdown(!showCredentialsDropdown)}
                title={
                  workflowCredentialInfo.unconfiguredTools.length > 0
                    ? 'Some integrations need credentials'
                    : 'Manage credentials'
                }
                className={cn(
                  'rounded-xl transition-all flex items-center gap-1.5',
                  workflowCredentialInfo.unconfiguredTools.length > 0 ? 'px-3 py-2' : 'p-2.5',
                  workflowCredentialInfo.unconfiguredTools.length > 0
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)]'
                )}
              >
                {workflowCredentialInfo.unconfiguredTools.length > 0 ? (
                  <AlertTriangle size={16} />
                ) : (
                  <KeyRound size={16} />
                )}
                {workflowCredentialInfo.unconfiguredTools.length > 0 && (
                  <span className="text-xs font-medium">Setup Required</span>
                )}
              </button>

              {showCredentialsDropdown && (
                <>
                  {/* Backdrop */}
                  <div
                    className="fixed inset-0 z-[100]"
                    onClick={() => setShowCredentialsDropdown(false)}
                  />
                  {/* Dropdown */}
                  <div
                    className="absolute top-full right-0 mt-2 z-[101] w-80 max-h-[400px] overflow-y-auto rounded-xl bg-[#1a1a1a] border border-[var(--color-border)] shadow-xl"
                    onWheelCapture={e => {
                      // Use capture phase to stop the event before React Flow sees it
                      e.stopPropagation();
                    }}
                  >
                    <div className="px-3 py-2 border-b border-[var(--color-border)]">
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">
                        Workflow Integrations
                      </span>
                      <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                        {workflowCredentialInfo.unconfiguredTools.length > 0
                          ? 'Some integrations need credentials to work'
                          : 'All integrations are configured'}
                      </p>
                    </div>

                    {/* Unconfigured tools warning */}
                    {workflowCredentialInfo.unconfiguredTools.length > 0 && (
                      <div className="px-3 py-2 bg-amber-500/5 border-b border-[var(--color-border)]">
                        <div className="flex items-center gap-2 text-amber-400 mb-2">
                          <AlertTriangle size={12} />
                          <span className="text-xs font-medium">Missing Credentials</span>
                        </div>
                        <div className="space-y-1">
                          {workflowCredentialInfo.unconfiguredTools.map(({ tool, displayName }) => (
                            <div
                              key={tool}
                              className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"
                            >
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              <span>{displayName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Configured tools */}
                    {workflowCredentialInfo.configuredTools.length > 0 && (
                      <div className="px-3 py-2 border-b border-[var(--color-border)]">
                        <div className="flex items-center gap-2 text-green-400 mb-2">
                          <KeyRound size={12} />
                          <span className="text-xs font-medium">Configured</span>
                        </div>
                        <div className="space-y-1">
                          {workflowCredentialInfo.configuredTools.map(({ tool, displayName }) => (
                            <div
                              key={tool}
                              className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"
                            >
                              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                              <span>{displayName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Link to credentials page */}
                    <div className="p-2">
                      <Link
                        to="/credentials"
                        onClick={() => setShowCredentialsDropdown(false)}
                        className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium text-[var(--color-accent)] bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 rounded-lg transition-colors"
                      >
                        <ExternalLink size={12} />
                        <span>Manage All Credentials</span>
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <ToolbarButton
            icon={<Bug size={16} />}
            tooltip={debugMode ? 'Debug Mode ON - Block validation enabled' : 'Debug Mode OFF'}
            onClick={toggleDebugMode}
            className={debugMode ? 'text-yellow-500 bg-yellow-500/10' : ''}
          />
          {executionStatus === 'running' ? (
            <ToolbarButton
              icon={<Square size={16} />}
              tooltip="Stop Execution"
              onClick={handleStopExecution}
              primary
            />
          ) : (
            <ToolbarButton
              icon={<Play size={16} />}
              tooltip={
                !isWorkflowValid ? 'Complete the Start block configuration first' : 'Run Workflow'
              }
              onClick={handleRunButtonClick}
              primary
              disabled={executionStatus === 'running'}
            />
          )}
          <ToolbarButton
            icon={<Rocket size={16} />}
            tooltip="Deploy Agent"
            onClick={handleDeploy}
            disabled={!workflow || workflow.blocks.length === 0}
          />
          <div className="w-px h-6 bg-[var(--color-border)]" />
          <ToolbarButton
            icon={<FileOutput size={16} />}
            tooltip="View Output"
            onClick={() => setShowOutputPanel(!showOutputPanel)}
            disabled={!executionStatus || executionStatus === 'running'}
          />
        </Panel>

        {/* Status Panel with Glass Effect */}
        {executionStatus && (
          <Panel position="bottom-center">
            <div
              className={cn(
                'px-5 py-2.5 rounded-xl shadow-xl backdrop-blur-md flex items-center gap-2.5 border font-medium text-sm',
                executionStatus === 'running' &&
                  'bg-[var(--color-accent)] text-black border-[var(--color-accent)]',
                executionStatus === 'completed' &&
                  'bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] border-[var(--color-border)]',
                executionStatus === 'failed' &&
                  'bg-red-500 bg-opacity-90 text-white border-red-400',
                executionStatus === 'partial_failure' &&
                  'bg-yellow-500 bg-opacity-90 text-white border-yellow-400'
              )}
            >
              {executionStatus === 'running' && (
                <>
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse shadow-md" />
                  <span>Running...</span>
                </>
              )}
              {executionStatus === 'completed' && <span>✓ Execution completed</span>}
              {executionStatus === 'failed' && <span>✗ Execution failed</span>}
              {executionStatus === 'partial_failure' && <span>⚠ Partial failure</span>}
            </div>
          </Panel>
        )}

        {/* Empty workflow message */}
        {(!workflow || workflow.blocks.length === 0) && (
          <Panel position="top-center" className="mt-20">
            <div className="text-center p-6 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] shadow-lg">
              <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                Describe your agent in the chat to generate a workflow
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                Or manually add blocks using the sidebar
              </p>
            </div>
          </Panel>
        )}

        {/* Onboarding Guidance */}
        {showOnboardingGuidance && (
          <Panel position="bottom-center" className="mb-8">
            <OnboardingGuidance onRun={handleRunWorkflow} onDeploy={handleDeploy} />
          </Panel>
        )}
      </ReactFlow>

      {/* Execution Output Panel */}
      {showOutputPanel && <ExecutionOutputPanel onClose={() => setShowOutputPanel(false)} />}

      {/* Setup Required Panel - shows when clicking Run with missing credentials */}
      <SetupRequiredPanel
        validation={comprehensiveValidation}
        isOpen={showSetupPanel}
        onClose={() => setShowSetupPanel(false)}
        onSelectBlock={blockId => {
          // Select the block and close the panel
          useAgentBuilderStore.getState().selectBlock(blockId);
        }}
        onOpenCredentials={integrationTypes => {
          // Navigate to credentials page with required integrations as query params
          setShowSetupPanel(false);
          const queryParams =
            integrationTypes.length > 0 ? `?required=${integrationTypes.join(',')}` : '';
          navigate(`/credentials${queryParams}`);
        }}
      />

      {/* Deploy Panel - shows when clicking Deploy button */}
      <DeployPanel isOpen={showDeployPanel} onClose={() => setShowDeployPanel(false)} />
    </div>
  );
}

// Toolbar Button Component
interface ToolbarButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
}

function ToolbarButton({
  icon,
  tooltip,
  label,
  onClick,
  disabled,
  primary,
  className,
}: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        'rounded-xl transition-all flex items-center gap-1.5',
        label ? 'px-3 py-2' : 'p-2.5',
        primary
          ? 'bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-hover)]'
          : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)]',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {icon}
      {label && <span className="text-xs font-medium">{label}</span>}
    </button>
  );
}
