import React, { memo, useEffect, useState, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Brain,
  Variable,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  SkipForward,
  ChevronDown,
  Play,
  AlertCircle,
  Cpu,
  Save,
  Copy,
  Sparkles,
  Type,
  Upload,
  FileText,
  Image,
  Mic,
  File,
  X,
  Search,
  Globe,
  MessageCircle,
  Hash,
  Calculator,
  Code,
  FileCode,
  Webhook,
  Send,
  BarChart2,
  Database,
  FilePlus,
  Pencil,
  GitBranch,
  List,
  MessageSquare,
  Braces,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentBuilderStore } from '@/store/useAgentBuilderStore';
import { useModelStore } from '@/store/useModelStore';
import { filterAgentModels } from '@/services/modelService';
import { useCredentialsStore } from '@/store/useCredentialsStore';
import { workflowExecutionService } from '@/services/workflowExecutionService';
import { generateSampleInput } from '@/services/workflowService';
import { ModelTooltip } from '@/components/ui/ModelTooltip';
import { uploadFile, formatFileSize, checkFileStatus } from '@/services/uploadService';
import {
  getBlockToolsRequiringCredentials,
  TOOL_CREDENTIAL_REQUIREMENTS,
} from '@/utils/blockValidation';
import type {
  Block,
  BlockExecutionState,
  BlockExecutionStatus,
  VariableConfig,
  FileReference,
  FileType,
  LLMInferenceConfig,
} from '@/types/agent';

// File type icon mapping
const FILE_TYPE_ICONS: Record<FileType, React.ElementType> = {
  image: Image,
  document: FileText,
  audio: Mic,
  data: File,
};

// Get file type from MIME type
function getFileTypeFromMime(mimeType: string): FileType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType === 'application/pdf' ||
    mimeType.includes('wordprocessingml') ||
    mimeType.includes('presentationml')
  )
    return 'document';
  return 'data';
}

// Block type icons and colors
const BLOCK_CONFIG: Record<string, { icon: React.ElementType; color: string; bgColor: string }> = {
  llm_inference: {
    icon: Brain,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
  variable: {
    icon: Variable,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
  },
  code_block: {
    icon: Wrench,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
};

// Default config for unknown/deprecated block types
const DEFAULT_BLOCK_CONFIG = {
  icon: Cpu,
  color: 'text-gray-500',
  bgColor: 'bg-gray-500/10',
};

// Tool icons mapping for visual display
const TOOL_ICONS: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  search_web: { icon: Search, color: 'text-blue-400', label: 'Search' },
  search_images: { icon: Image, color: 'text-pink-400', label: 'Images' },
  scrape_web: { icon: Globe, color: 'text-green-400', label: 'Scrape' },
  get_current_time: { icon: Clock, color: 'text-yellow-400', label: 'Time' },
  calculate_math: { icon: Calculator, color: 'text-cyan-400', label: 'Math' },
  send_discord_message: { icon: MessageCircle, color: 'text-indigo-400', label: 'Discord' },
  send_slack_message: { icon: Hash, color: 'text-pink-400', label: 'Slack' },
  send_webhook: { icon: Webhook, color: 'text-orange-400', label: 'Webhook' },
  send_telegram_message: { icon: Send, color: 'text-sky-400', label: 'Telegram' },
  send_google_chat_message: { icon: MessageCircle, color: 'text-green-400', label: 'GChat' },
  analyze_data: { icon: BarChart2, color: 'text-emerald-400', label: 'Analyze' },
  run_python: { icon: Code, color: 'text-yellow-400', label: 'Python' },
  create_document: { icon: FileText, color: 'text-blue-400', label: 'Document' },
  create_text_file: { icon: FileCode, color: 'text-gray-400', label: 'Text File' },
  create_presentation: { icon: FileText, color: 'text-orange-400', label: 'Slides' },
  // Audio/Media tools
  transcribe_audio: { icon: Mic, color: 'text-red-400', label: 'Transcribe' },
  describe_image: { icon: Image, color: 'text-violet-400', label: 'Vision' },
  // File tools
  read_document: { icon: FileText, color: 'text-blue-300', label: 'Read Doc' },
  read_data_file: { icon: File, color: 'text-green-300', label: 'Read Data' },
  download_file: { icon: File, color: 'text-gray-400', label: 'Download' },
  // Notion tools
  notion_search: { icon: Search, color: 'text-gray-300', label: 'Notion' },
  notion_query_database: { icon: Database, color: 'text-gray-300', label: 'Notion DB' },
  notion_create_page: { icon: FilePlus, color: 'text-gray-300', label: 'Notion+' },
  notion_update_page: { icon: Pencil, color: 'text-gray-300', label: 'Notion✎' },
  // GitHub tools
  github_create_issue: { icon: AlertCircle, color: 'text-purple-400', label: 'GitHub+' },
  github_list_issues: { icon: List, color: 'text-purple-400', label: 'GitHub' },
  github_get_repo: { icon: GitBranch, color: 'text-purple-400', label: 'Repo' },
  github_add_comment: { icon: MessageSquare, color: 'text-purple-400', label: 'Comment' },
};

// Tools Badge Component - shows what tools a block has
function ToolsBadge({ tools }: { tools: string[] }) {
  if (!tools || tools.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tools.slice(0, 3).map(tool => {
        const config = TOOL_ICONS[tool] || { icon: Code, color: 'text-gray-400', label: tool };
        const ToolIcon = config.icon;
        return (
          <div
            key={tool}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]',
              'bg-[var(--color-bg-tertiary)] border border-[var(--color-border)]',
              config.color
            )}
            title={tool}
          >
            <ToolIcon size={10} />
            <span className="text-[var(--color-text-secondary)]">{config.label}</span>
          </div>
        );
      })}
      {tools.length > 3 && (
        <div className="flex items-center px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] text-[var(--color-text-tertiary)]">
          +{tools.length - 3}
        </div>
      )}
    </div>
  );
}

// Credential Warning Badge - shows when block tools need credentials
function CredentialWarningBadge({ block }: { block: Block }) {
  // Get globally configured credentials from the store
  const { credentialReferences } = useCredentialsStore();

  if (block.type !== 'llm_inference') return null;

  const toolsNeedingCreds = getBlockToolsRequiringCredentials(block);
  if (toolsNeedingCreds.length === 0) return null;

  // Check if credentials are configured - both block-level and global credentials
  const config = block.config as LLMInferenceConfig;
  const blockCredentials = config.credentials || [];

  // Get integration types that have global credentials configured
  const globallyConfiguredTypes = new Set(
    credentialReferences.map(cred => cred.integrationType.toLowerCase())
  );

  // Get unique integrations that are missing credentials
  const missingIntegrations = new Set<string>();
  for (const toolId of toolsNeedingCreds) {
    const req = TOOL_CREDENTIAL_REQUIREMENTS[toolId];
    if (req) {
      // Check if credential exists either at block level or globally
      const hasBlockCredential = blockCredentials.some(credId =>
        credId.toLowerCase().includes(req.integrationType.toLowerCase())
      );
      const hasGlobalCredential = globallyConfiguredTypes.has(req.integrationType.toLowerCase());

      if (!hasBlockCredential && !hasGlobalCredential) {
        missingIntegrations.add(req.integrationName);
      }
    }
  }

  if (missingIntegrations.size === 0) return null;

  const integrationNames = Array.from(missingIntegrations);

  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 border border-red-500/30 text-red-400 cursor-help"
      title={`Missing credentials: ${integrationNames.join(', ')}`}
    >
      <AlertCircle size={10} />
      <span>
        {integrationNames.length} credential{integrationNames.length > 1 ? 's' : ''} needed
      </span>
    </div>
  );
}

// Status icons
const STATUS_CONFIG: Record<
  BlockExecutionStatus,
  { icon: React.ElementType; color: string; animate?: boolean }
> = {
  pending: { icon: Clock, color: 'text-gray-400' },
  running: { icon: Loader2, color: 'text-blue-500', animate: true },
  completed: { icon: CheckCircle, color: 'text-green-500' },
  failed: { icon: XCircle, color: 'text-red-500' },
  skipped: { icon: SkipForward, color: 'text-yellow-500' },
};

// Execution Status Icon Component with optional error tooltip
function ExecutionStatusIcon({ status, error }: { status: BlockExecutionStatus; error?: string }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <div
      className={cn(config.color, error && 'cursor-help')}
      title={error ? `Error: ${error}` : undefined}
    >
      <Icon size={16} className={config.animate ? 'animate-spin' : ''} />
    </div>
  );
}

// Error Display Component with Copy and Fix buttons
function ErrorDisplay({ error, blockName }: { error: string; blockName: string }) {
  const [copied, setCopied] = useState(false);
  const { setPendingChatMessage } = useAgentBuilderStore();

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFixWithAgent = (e: React.MouseEvent) => {
    e.stopPropagation();
    const fixMessage = `The "${blockName}" block failed with this error:\n\n${error}\n\nPlease help me fix this issue in the workflow.`;
    setPendingChatMessage(fixMessage);
  };

  return (
    <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30">
      <div className="flex items-start gap-2">
        <XCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-red-400 mb-0.5">Execution Failed</p>
          <p className="text-xs text-red-300/80 break-words line-clamp-3">{error}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-red-500/20">
        <button
          onClick={handleCopy}
          onMouseDown={e => e.stopPropagation()}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors"
          title="Copy error message"
        >
          <Copy size={10} />
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button
          onClick={handleFixWithAgent}
          onMouseDown={e => e.stopPropagation()}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30 text-[var(--color-accent)] transition-colors"
          title="Ask agent to fix this error"
        >
          <Sparkles size={10} />
          Fix with Agent
        </button>
      </div>
    </div>
  );
}

interface BlockNodeData {
  block: Block;
  executionState?: BlockExecutionState;
}

interface BlockNodeProps {
  data: BlockNodeData;
  selected?: boolean;
}

function BlockNodeComponent({ data, selected }: BlockNodeProps) {
  const { block, executionState } = data;

  const {
    selectedBlockId,
    selectBlock,
    updateBlock,
    currentAgent,
    executionStatus,
    highlightedUpstreamIds,
    highlightedDownstreamIds,
  } = useAgentBuilderStore();
  const {
    models,
    fetchModels,
    isLoading: modelsLoading,
    getDefaultModelForContext,
    setDefaultModelForContext,
  } = useModelStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [isInputTypeDropdownOpen, setIsInputTypeDropdownOpen] = useState(false);
  const [isFileExpired, setIsFileExpired] = useState(false);
  const [isCheckingFileStatus, setIsCheckingFileStatus] = useState(false);
  const [jsonInputText, setJsonInputText] = useState('');
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [isGeneratingInput, setIsGeneratingInput] = useState(false);

  const isSelected = selectedBlockId === block.id || selected;
  const isUpstreamHighlighted = highlightedUpstreamIds.includes(block.id);
  const isDownstreamHighlighted = highlightedDownstreamIds.includes(block.id);
  const blockConfig = BLOCK_CONFIG[block.type] || DEFAULT_BLOCK_CONFIG;
  const Icon = blockConfig.icon;

  // Check if this is the Start block (variable block with operation 'read' and variableName 'input')
  const isStartBlock =
    block.type === 'variable' &&
    (block.config as VariableConfig).operation === 'read' &&
    (block.config as VariableConfig).variableName === 'input';

  const variableConfig = isStartBlock
    ? (block.config as VariableConfig & { workflowModelId?: string; requiresInput?: boolean })
    : null;

  // Input type (text or file)
  const inputType = variableConfig?.inputType || 'text';
  const fileValue = variableConfig?.fileValue;
  // Whether this workflow requires user input (default: true)
  const requiresInput = variableConfig?.requiresInput !== false;

  // Check if start block needs attention (no model or no test input when required)
  const hasTextInput =
    inputType === 'text' &&
    typeof variableConfig?.defaultValue === 'string' &&
    variableConfig.defaultValue.trim();
  const hasFileInput = inputType === 'file' && fileValue?.fileId;
  const hasJsonInput =
    inputType === 'json' &&
    variableConfig?.jsonValue !== null &&
    variableConfig?.jsonValue !== undefined;
  const needsAttention =
    isStartBlock &&
    (!variableConfig?.workflowModelId ||
      (requiresInput && !hasTextInput && !hasFileInput && !hasJsonInput));

  // Get the currently selected model for display
  const selectedModel = models.find(m => m.id === variableConfig?.workflowModelId);

  // Fetch models on mount if this is the start block
  useEffect(() => {
    if (isStartBlock && models.length === 0) {
      fetchModels();
    }
  }, [isStartBlock, models.length, fetchModels]);

  // Auto-select default model for start block if none selected
  useEffect(() => {
    if (isStartBlock && models.length > 0 && variableConfig && !variableConfig.workflowModelId) {
      // First try to use saved startBlock default
      const defaultStartBlockId = getDefaultModelForContext('startBlock');
      let defaultModel = defaultStartBlockId
        ? models.find(m => m.id === defaultStartBlockId)
        : null;

      // If no saved default, find a Haiku model as fallback
      if (!defaultModel) {
        defaultModel = models.find(
          m =>
            m.name.toLowerCase().includes('haiku') ||
            m.display_name?.toLowerCase().includes('haiku')
        );
      }

      if (defaultModel) {
        updateBlock(block.id, { config: { ...variableConfig, workflowModelId: defaultModel.id } });
        // Auto-save after setting default model
        setTimeout(() => {
          useAgentBuilderStore
            .getState()
            .saveCurrentAgent()
            .catch(err => console.warn('Failed to auto-save:', err));
        }, 100);
      }
    }
  }, [isStartBlock, models, variableConfig, block.id, updateBlock, getDefaultModelForContext]);

  // Check file expiration status when file is attached
  useEffect(() => {
    if (!isStartBlock || !fileValue?.fileId) {
      setIsFileExpired(false);
      return;
    }

    // Check file status on mount and periodically
    const checkStatus = async () => {
      setIsCheckingFileStatus(true);
      try {
        const status = await checkFileStatus(fileValue.fileId);
        setIsFileExpired(!status.available || status.expired);
        if (!status.available || status.expired) {
          console.warn('⚠️ [BLOCK] Attached file has expired:', fileValue.filename);
        }
      } catch (err) {
        console.error('Failed to check file status:', err);
      } finally {
        setIsCheckingFileStatus(false);
      }
    };

    checkStatus();

    // Re-check every 5 minutes to catch expiring files
    const interval = setInterval(checkStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isStartBlock, fileValue?.fileId, fileValue?.filename]);

  const handleModelSelect = (modelId: string) => {
    if (variableConfig) {
      updateBlock(block.id, { config: { ...variableConfig, workflowModelId: modelId } });
      // Save as startBlock default for future use
      if (isStartBlock) {
        setDefaultModelForContext('startBlock', modelId);
      }
      setIsModelDropdownOpen(false);
      setModelSearchQuery('');
      // Auto-save after model change
      setTimeout(() => {
        useAgentBuilderStore
          .getState()
          .saveCurrentAgent()
          .catch(err => {
            console.warn('Failed to auto-save workflow:', err);
          });
      }, 100);
    }
  };

  // Filter models: first filter by agents_enabled, then by search query
  const filteredModels = filterAgentModels(models).filter(model => {
    if (!modelSearchQuery.trim()) return true;
    const query = modelSearchQuery.toLowerCase();
    return (
      model.name.toLowerCase().includes(query) ||
      model.display_name?.toLowerCase().includes(query) ||
      model.provider_name?.toLowerCase().includes(query)
    );
  });

  const handleTestInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (variableConfig) {
      updateBlock(block.id, { config: { ...variableConfig, defaultValue: e.target.value } });
    }
  };

  const handleTestInputBlur = () => {
    // Auto-save when user finishes editing test input
    useAgentBuilderStore
      .getState()
      .saveCurrentAgent()
      .catch(err => {
        console.warn('Failed to auto-save workflow:', err);
      });
  };

  // Initialize JSON text from stored value
  useEffect(() => {
    if (
      isStartBlock &&
      variableConfig?.jsonValue !== undefined &&
      variableConfig?.jsonValue !== null
    ) {
      try {
        setJsonInputText(JSON.stringify(variableConfig.jsonValue, null, 2));
        setJsonParseError(null);
      } catch {
        setJsonInputText('');
      }
    } else if (isStartBlock && inputType === 'json') {
      // Set default empty object for new JSON inputs
      setJsonInputText('{\n  \n}');
    }
  }, [isStartBlock, variableConfig?.jsonValue, inputType]);

  // Handle JSON input change with validation
  const handleJsonInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const text = e.target.value;
    setJsonInputText(text);

    // Try to parse and validate JSON
    if (!text.trim()) {
      setJsonParseError(null);
      if (variableConfig) {
        updateBlock(block.id, { config: { ...variableConfig, jsonValue: null } });
      }
      return;
    }

    try {
      const parsed = JSON.parse(text);
      setJsonParseError(null);
      if (variableConfig) {
        updateBlock(block.id, { config: { ...variableConfig, jsonValue: parsed } });
      }
    } catch (err) {
      setJsonParseError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleJsonInputBlur = () => {
    // Auto-save when user finishes editing JSON input (only if valid)
    if (!jsonParseError) {
      useAgentBuilderStore
        .getState()
        .saveCurrentAgent()
        .catch(err => {
          console.warn('Failed to auto-save workflow:', err);
        });
    }
  };

  // Set input type (text, file, or json)
  const handleInputTypeChange = (newType: 'text' | 'file' | 'json', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (variableConfig && inputType !== newType) {
      updateBlock(block.id, { config: { ...variableConfig, inputType: newType } });
      // Auto-save
      setTimeout(() => {
        useAgentBuilderStore
          .getState()
          .saveCurrentAgent()
          .catch(err => console.warn('Failed to auto-save:', err));
      }, 100);
    }
  };

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const file = e.target.files?.[0];
    if (!file || !variableConfig) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      // Use agent ID or a temp ID for the conversation
      const conversationId = currentAgent?.id || 'workflow-test';
      const uploadedFile = await uploadFile(file, conversationId);

      // Create file reference
      const fileRef: FileReference = {
        fileId: uploadedFile.file_id,
        filename: uploadedFile.filename,
        mimeType: uploadedFile.mime_type,
        size: uploadedFile.size,
        type: getFileTypeFromMime(uploadedFile.mime_type),
      };

      // Update block config with file reference
      updateBlock(block.id, { config: { ...variableConfig, fileValue: fileRef } });

      // Auto-save
      setTimeout(() => {
        useAgentBuilderStore
          .getState()
          .saveCurrentAgent()
          .catch(err => console.warn('Failed to auto-save:', err));
      }, 100);

      console.log('📁 [BLOCK] File uploaded:', fileRef);
    } catch (err) {
      console.error('File upload failed:', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Remove selected file
  const handleRemoveFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (variableConfig) {
      updateBlock(block.id, { config: { ...variableConfig, fileValue: null } });
      // Auto-save
      setTimeout(() => {
        useAgentBuilderStore
          .getState()
          .saveCurrentAgent()
          .catch(err => console.warn('Failed to auto-save:', err));
      }, 100);
    }
  };

  const handleSaveAndRunClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      // If using file input, validate file is still available before execution
      if (inputType === 'file' && fileValue) {
        console.log('🔍 [BLOCK] Checking file availability before execution...');
        const fileStatus = await checkFileStatus(fileValue.fileId);

        if (!fileStatus.available || fileStatus.expired) {
          // File has expired - show error and clear the file reference
          const errorMsg = `File "${fileValue.filename}" has expired (files are only available for 30 minutes). Please upload a new file.`;
          console.warn('⚠️ [BLOCK] File expired:', fileValue.fileId);
          setUploadError(errorMsg);

          // Clear the expired file reference from the block
          if (variableConfig) {
            updateBlock(block.id, { config: { ...variableConfig, fileValue: null } });
          }
          return;
        }
        console.log('✅ [BLOCK] File is available:', fileValue.filename);
      }

      // Save first
      console.log('💾 [BLOCK] Saving workflow before execution...');
      await useAgentBuilderStore.getState().saveCurrentAgent();

      // Get the current agent ID
      const currentAgent = useAgentBuilderStore.getState().currentAgent;
      if (!currentAgent?.id) {
        console.error('No agent to execute');
        return;
      }

      // Build workflow input from test value (text, file, or JSON)
      const workflowInput: Record<string, unknown> = {};

      if (inputType === 'file' && fileValue) {
        // Pass file reference as input
        workflowInput.input = {
          file_id: fileValue.fileId,
          filename: fileValue.filename,
          mime_type: fileValue.mimeType,
          size: fileValue.size,
          type: fileValue.type,
        };
        console.log('📁 [BLOCK] Running workflow with file input:', fileValue.filename);
      } else if (inputType === 'json' && variableConfig?.jsonValue) {
        // Pass JSON object as input
        workflowInput.input = variableConfig.jsonValue;
        console.log('📋 [BLOCK] Running workflow with JSON input:', variableConfig.jsonValue);
      } else if (variableConfig?.defaultValue) {
        // Pass text as input
        workflowInput.input = variableConfig.defaultValue;
      }

      console.log(
        '▶️ [BLOCK] Running workflow for agent:',
        currentAgent.id,
        'with input:',
        workflowInput
      );
      await workflowExecutionService.executeWorkflow(currentAgent.id, workflowInput);
    } catch (err) {
      console.error('Failed to execute workflow:', err);
    }
  };

  // Handle AI-generated sample input
  const handleGenerateSampleInput = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!currentAgent?.id || !variableConfig?.workflowModelId) {
      console.warn('Cannot generate sample input: missing agent ID or model');
      return;
    }

    setIsGeneratingInput(true);
    setJsonParseError(null);

    try {
      console.log('🤖 [BLOCK] Generating sample input for workflow...');
      const response = await generateSampleInput(currentAgent.id, variableConfig.workflowModelId);

      if (response.success && response.sample_input) {
        // Format the JSON nicely
        const formattedJson = JSON.stringify(response.sample_input, null, 2);
        setJsonInputText(formattedJson);

        // Update the block config with the new JSON value
        updateBlock(block.id, {
          config: { ...variableConfig, jsonValue: response.sample_input },
        });

        // Auto-save
        setTimeout(() => {
          useAgentBuilderStore
            .getState()
            .saveCurrentAgent()
            .catch(err => console.warn('Failed to auto-save:', err));
        }, 100);

        console.log('✅ [BLOCK] Sample input generated successfully');
      } else {
        setJsonParseError(response.error || 'Failed to generate sample input');
        console.error('❌ [BLOCK] Sample input generation failed:', response.error);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate sample input';
      setJsonParseError(errorMessage);
      console.error('❌ [BLOCK] Sample input generation error:', err);
    } finally {
      setIsGeneratingInput(false);
    }
  };

  // Handle AI-generated text input (extracts text from sample input)
  const handleGenerateTextInput = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!currentAgent?.id || !variableConfig?.workflowModelId) {
      console.warn('Cannot generate sample input: missing agent ID or model');
      return;
    }

    setIsGeneratingInput(true);

    try {
      console.log('🤖 [BLOCK] Generating sample text input for workflow...');
      const response = await generateSampleInput(currentAgent.id, variableConfig.workflowModelId);

      if (response.success && response.sample_input) {
        // Extract text from the sample input - look for 'input' key or stringify the whole thing
        let textValue: string;
        if (typeof response.sample_input.input === 'string') {
          textValue = response.sample_input.input;
        } else if (typeof response.sample_input.input === 'object') {
          textValue = JSON.stringify(response.sample_input.input);
        } else {
          // Use the first string value found, or stringify the whole object
          const firstStringValue = Object.values(response.sample_input).find(
            v => typeof v === 'string'
          );
          textValue =
            typeof firstStringValue === 'string'
              ? firstStringValue
              : JSON.stringify(response.sample_input);
        }

        // Update the block config with the new text value
        updateBlock(block.id, {
          config: { ...variableConfig, defaultValue: textValue },
        });

        // Auto-save
        setTimeout(() => {
          useAgentBuilderStore
            .getState()
            .saveCurrentAgent()
            .catch(err => console.warn('Failed to auto-save:', err));
        }, 100);

        console.log('✅ [BLOCK] Sample text input generated successfully');
      } else {
        console.error('❌ [BLOCK] Sample text input generation failed:', response.error);
      }
    } catch (err) {
      console.error('❌ [BLOCK] Sample text input generation error:', err);
    } finally {
      setIsGeneratingInput(false);
    }
  };

  // Check if we have valid input for the run button
  const hasValidInput =
    inputType === 'file'
      ? !!fileValue?.fileId
      : inputType === 'json'
        ? !!(variableConfig?.jsonValue !== null && variableConfig?.jsonValue !== undefined)
        : !!(
            typeof variableConfig?.defaultValue === 'string' && variableConfig.defaultValue.trim()
          );

  // Apply animation class for running state or needs attention
  const getBorderAnimationClass = () => {
    if (executionState?.status === 'running') return 'block-running-border';
    if (needsAttention) return 'block-needs-attention-border';
    return '';
  };

  return (
    <div
      className={cn(
        'rounded-lg shadow-lg transition-all backdrop-blur-xl',
        isStartBlock ? 'min-w-[300px] max-w-[340px]' : 'min-w-[200px] max-w-[280px]',
        // Only add border for states that DON'T have animated borders
        executionState?.status === 'running' || needsAttention
          ? '' // No border - animation provides it
          : 'border-2',
        // Priority: selected > upstream highlight > downstream highlight > execution states > default
        isSelected
          ? 'border-[var(--color-accent)] shadow-[var(--color-accent)]/20'
          : isUpstreamHighlighted
            ? 'border-emerald-500 shadow-emerald-500/30 ring-2 ring-emerald-500/20'
            : isDownstreamHighlighted
              ? 'border-sky-500 shadow-sky-500/30 ring-2 ring-sky-500/20'
              : executionState?.status === 'running'
                ? '' // Animation provides border
                : executionState?.status === 'failed'
                  ? 'border-red-500 shadow-red-500/20'
                  : needsAttention
                    ? '' // Animation provides border
                    : 'border-[var(--color-border)] hover:border-[var(--color-text-tertiary)]',
        'bg-[var(--color-surface-elevated)]',
        getBorderAnimationClass()
      )}
      onClick={() => selectBlock(block.id)}
    >
      {/* Input Handle - Left side (hidden, positioned to touch block edge) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-0 !h-0 !bg-transparent !border-0 !min-w-0 !min-h-0 !left-0"
      />

      {/* Header */}
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-t-lg', blockConfig.bgColor)}>
        <div className={cn('p-1 rounded-md', blockConfig.color)}>
          <Icon size={16} />
        </div>
        <span className="flex-1 font-medium text-sm text-[var(--color-text-primary)] truncate">
          {block.name}
        </span>

        {/* Dependency Highlight Badge - Upstream (this block feeds into selected) */}
        {isUpstreamHighlighted && (
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40"
            title="This block feeds data to the selected block"
          >
            <GitBranch size={11} className="text-emerald-400" />
            <span className="text-[10px] font-medium text-emerald-400">Upstream</span>
          </div>
        )}

        {/* Dependency Highlight Badge - Downstream (this block receives from selected) */}
        {isDownstreamHighlighted && (
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-500/20 border border-sky-500/40"
            title="This block receives data from the selected block"
          >
            <GitBranch size={11} className="text-sky-400 rotate-180" />
            <span className="text-[10px] font-medium text-sky-400">Downstream</span>
          </div>
        )}

        {/* Structured Output Badge */}
        {block.type === 'llm_inference' &&
          'outputFormat' in block.config &&
          block.config.outputFormat === 'json' &&
          block.config.outputSchema && (
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/30"
              title="Structured JSON output"
            >
              <Code size={11} className="text-blue-400" />
              <span className="text-[10px] font-medium text-blue-400">Structured</span>
            </div>
          )}

        {/* Needs attention indicator with label */}
        {needsAttention && (
          <div className="flex items-center gap-1 text-amber-500" title="Configure to run workflow">
            <AlertCircle size={14} />
            <span className="text-[10px] font-medium">Input needed</span>
          </div>
        )}

        {/* Execution Status */}
        {executionState && (
          <ExecutionStatusIcon status={executionState.status} error={executionState.error} />
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-3">
        {/* Description */}
        <p className="text-xs text-[var(--color-text-tertiary)] line-clamp-2">
          {block.description || 'No description'}
        </p>

        {/* Tools Badge - show what tools this LLM block uses */}
        {block.type === 'llm_inference' && (
          <ToolsBadge
            tools={
              (block.config.tools as string[]) || (block.config.enabledTools as string[]) || []
            }
          />
        )}

        {/* Code Block Tool Badge - show the single tool this block executes */}
        {block.type === 'code_block' &&
          'toolName' in block.config &&
          (block.config as { toolName?: string }).toolName && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Wrench size={10} />
              <span>{(block.config as { toolName: string }).toolName}</span>
            </div>
          )}

        {/* Credential Warning Badge - show when tools need credentials */}
        <CredentialWarningBadge block={block} />

        {/* Error Display */}
        {executionState?.status === 'failed' && executionState.error && (
          <ErrorDisplay error={executionState.error} blockName={block.name} />
        )}

        {/* Start Block specific controls */}
        {isStartBlock && (
          <>
            {/* Workflow Model Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
                <Cpu size={12} />
                Workflow Model
              </label>
              <div className="relative">
                {/* Custom dropdown trigger */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setIsModelDropdownOpen(!isModelDropdownOpen);
                  }}
                  onMouseDown={e => e.stopPropagation()}
                  disabled={modelsLoading}
                  className={cn(
                    'nodrag nowheel',
                    'w-full px-2.5 py-1.5 text-xs rounded-lg cursor-pointer text-left',
                    'bg-[#1a1a1a] border transition-colors flex items-center gap-2',
                    !variableConfig?.workflowModelId
                      ? 'border-amber-500/50'
                      : 'border-[var(--color-border)]',
                    'hover:border-[var(--color-text-tertiary)]',
                    modelsLoading && 'opacity-50 cursor-wait'
                  )}
                >
                  {selectedModel?.provider_favicon && (
                    <img
                      src={selectedModel.provider_favicon}
                      alt={selectedModel.provider_name}
                      className="w-4 h-4 rounded-sm flex-shrink-0"
                      onError={e => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <span
                    className={cn(
                      'flex-1 truncate',
                      selectedModel
                        ? 'text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-tertiary)]'
                    )}
                  >
                    {selectedModel?.display_name || selectedModel?.name || 'Select a model...'}
                  </span>
                  <ChevronDown
                    size={14}
                    className={cn(
                      'text-[var(--color-text-tertiary)] transition-transform flex-shrink-0',
                      isModelDropdownOpen && 'rotate-180'
                    )}
                  />
                </button>

                {/* Dropdown menu */}
                {isModelDropdownOpen && (
                  <>
                    {/* Backdrop to close dropdown */}
                    <div
                      className="fixed inset-0 z-[100]"
                      onClick={e => {
                        e.stopPropagation();
                        setIsModelDropdownOpen(false);
                        setModelSearchQuery('');
                      }}
                    />
                    {/* Dropdown container */}
                    <div
                      className="nowheel absolute top-full left-0 mt-1 z-[101] w-full rounded-lg bg-[#1a1a1a]/95 backdrop-blur-xl border border-[var(--color-border)] shadow-xl overflow-hidden"
                      onWheel={e => e.stopPropagation()}
                    >
                      {/* Search input */}
                      <div className="p-2 border-b border-[var(--color-border)]">
                        <div className="relative">
                          <Search
                            size={12}
                            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                          />
                          <input
                            type="text"
                            value={modelSearchQuery}
                            onChange={e => setModelSearchQuery(e.target.value)}
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => e.stopPropagation()}
                            placeholder="Search models..."
                            className="nodrag nowheel w-full pl-6 pr-2 py-1.5 text-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
                            autoFocus
                          />
                        </div>
                      </div>
                      {/* Model list with styled scrollbar */}
                      <div
                        className="nowheel max-h-[160px] overflow-y-auto py-1 model-dropdown-scrollbar"
                        onWheel={e => e.stopPropagation()}
                      >
                        {modelsLoading ? (
                          <div className="px-3 py-2 text-xs text-[var(--color-text-tertiary)] flex items-center gap-2">
                            <Loader2 size={12} className="animate-spin" />
                            Loading models...
                          </div>
                        ) : filteredModels.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
                            {models.length === 0
                              ? 'No models available'
                              : 'No models match your search'}
                          </div>
                        ) : (
                          filteredModels.map(model => (
                            <ModelTooltip key={model.id} model={model}>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  handleModelSelect(model.id);
                                }}
                                onMouseDown={e => e.stopPropagation()}
                                className={cn(
                                  'nodrag w-full px-2.5 py-2 text-left text-xs hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center gap-2 overflow-hidden',
                                  model.id === variableConfig?.workflowModelId
                                    ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                                    : 'text-[var(--color-text-primary)]'
                                )}
                              >
                                {model.provider_favicon && (
                                  <img
                                    src={model.provider_favicon}
                                    alt={model.provider_name}
                                    className="w-4 h-4 rounded-sm flex-shrink-0"
                                    onError={e => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                )}
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <div className="font-medium truncate flex items-center gap-1.5">
                                    {model.display_name || model.name}
                                    {/* Show speed tier badge - only FASTEST and FAST, no MEDIUM */}
                                    {model.structured_output_badge && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-semibold">
                                        {model.structured_output_badge}
                                      </span>
                                    )}
                                    {!model.structured_output_badge &&
                                      model.structured_output_speed_ms &&
                                      model.structured_output_speed_ms < 5000 && (
                                        <span
                                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                                            model.structured_output_speed_ms < 2000
                                              ? 'bg-green-500/20 text-green-400'
                                              : 'bg-blue-500/20 text-blue-400'
                                          }`}
                                        >
                                          {model.structured_output_speed_ms < 2000
                                            ? 'FASTEST'
                                            : 'FAST'}
                                        </span>
                                      )}
                                  </div>
                                  {model.provider_name && (
                                    <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 truncate">
                                      {model.provider_name}
                                    </div>
                                  )}
                                </div>
                              </button>
                            </ModelTooltip>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Requires Input Toggle */}
            <div className="flex items-center justify-between">
              <label className="text-xs text-[var(--color-text-secondary)]">Requires Input</label>
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (variableConfig) {
                    updateBlock(block.id, {
                      config: { ...variableConfig, requiresInput: !requiresInput },
                    });
                    // Auto-save
                    setTimeout(() => {
                      useAgentBuilderStore
                        .getState()
                        .saveCurrentAgent()
                        .catch(err => console.warn('Failed to auto-save:', err));
                    }, 100);
                  }
                }}
                onMouseDown={e => e.stopPropagation()}
                className={cn(
                  'nodrag relative w-9 h-5 rounded-full transition-colors',
                  requiresInput ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-tertiary)]'
                )}
              >
                <div
                  className={cn(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
                    requiresInput ? 'left-[18px]' : 'left-0.5'
                  )}
                />
              </button>
            </div>

            {/* Test Input - only shown when input is required */}
            {requiresInput && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                    Test Input
                  </label>
                  {/* Input Type Dropdown */}
                  <div className="relative">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setIsInputTypeDropdownOpen(!isInputTypeDropdownOpen);
                      }}
                      onMouseDown={e => e.stopPropagation()}
                      className={cn(
                        'nodrag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all cursor-pointer',
                        'border border-[var(--color-border)] hover:border-[var(--color-accent)]',
                        'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-accent)]/10',
                        'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]'
                      )}
                    >
                      {inputType === 'text' ? (
                        <>
                          <Type size={10} />
                          Text
                        </>
                      ) : inputType === 'file' ? (
                        <>
                          <Upload size={10} />
                          File
                        </>
                      ) : (
                        <>
                          <Braces size={10} />
                          JSON
                        </>
                      )}
                      <ChevronDown
                        size={10}
                        className={cn(
                          'transition-transform',
                          isInputTypeDropdownOpen && 'rotate-180'
                        )}
                      />
                    </button>
                    {isInputTypeDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-[100]"
                          onClick={e => {
                            e.stopPropagation();
                            setIsInputTypeDropdownOpen(false);
                          }}
                        />
                        <div
                          className="absolute top-full right-0 mt-1 z-[101] w-[100px] rounded-lg bg-[#1a1a1a]/95 backdrop-blur-xl border border-[var(--color-border)] shadow-xl py-1 overflow-hidden"
                          onWheelCapture={e => {
                            // Use capture phase to stop the event before React Flow sees it
                            e.stopPropagation();
                          }}
                        >
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              handleInputTypeChange('text', e);
                              setIsInputTypeDropdownOpen(false);
                            }}
                            onMouseDown={e => e.stopPropagation()}
                            className={cn(
                              'nodrag w-full px-2.5 py-1.5 text-left text-[10px] hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center gap-1.5',
                              inputType === 'text'
                                ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                                : 'text-[var(--color-text-primary)]'
                            )}
                          >
                            <Type size={10} />
                            Text
                          </button>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              handleInputTypeChange('file', e);
                              setIsInputTypeDropdownOpen(false);
                            }}
                            onMouseDown={e => e.stopPropagation()}
                            className={cn(
                              'nodrag w-full px-2.5 py-1.5 text-left text-[10px] hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center gap-1.5',
                              inputType === 'file'
                                ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                                : 'text-[var(--color-text-primary)]'
                            )}
                          >
                            <Upload size={10} />
                            File
                          </button>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              handleInputTypeChange('json', e);
                              setIsInputTypeDropdownOpen(false);
                            }}
                            onMouseDown={e => e.stopPropagation()}
                            className={cn(
                              'nodrag w-full px-2.5 py-1.5 text-left text-[10px] hover:bg-[var(--color-bg-tertiary)] transition-colors flex items-center gap-1.5',
                              inputType === 'json'
                                ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                                : 'text-[var(--color-text-primary)]'
                            )}
                          >
                            <Braces size={10} />
                            JSON
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Text Input Mode */}
                {inputType === 'text' && (
                  <div className="relative">
                    <textarea
                      value={
                        typeof variableConfig?.defaultValue === 'string'
                          ? variableConfig.defaultValue
                          : variableConfig?.defaultValue
                            ? JSON.stringify(variableConfig.defaultValue)
                            : ''
                      }
                      onChange={handleTestInputChange}
                      onBlur={handleTestInputBlur}
                      onClick={e => e.stopPropagation()}
                      onMouseDown={e => e.stopPropagation()}
                      onKeyDown={e => e.stopPropagation()}
                      placeholder="Enter test input..."
                      rows={2}
                      className={cn(
                        'nodrag nowheel nopan',
                        'w-full px-2.5 py-1.5 text-xs rounded-lg resize-none',
                        'bg-[var(--color-bg-tertiary)] border transition-colors',
                        !hasTextInput ? 'border-amber-500/50' : 'border-[var(--color-border)]',
                        'text-[var(--color-text-primary)]',
                        'hover:border-[var(--color-text-tertiary)]',
                        'focus:outline-none focus:border-[var(--color-accent)]',
                        'placeholder:text-[var(--color-text-tertiary)]'
                      )}
                    />
                    {/* AI Generate Button - only shown when model is selected */}
                    {variableConfig?.workflowModelId && (
                      <button
                        onClick={handleGenerateTextInput}
                        onMouseDown={e => e.stopPropagation()}
                        disabled={isGeneratingInput}
                        title="Generate sample input with AI"
                        className={cn(
                          'nodrag absolute bottom-1.5 right-1.5 p-1.5 rounded-md transition-all',
                          'bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30',
                          'text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]',
                          isGeneratingInput && 'opacity-50 cursor-wait'
                        )}
                      >
                        {isGeneratingInput ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Sparkles size={14} />
                        )}
                      </button>
                    )}
                  </div>
                )}

                {/* File Input Mode */}
                {inputType === 'file' && (
                  <div className="space-y-2">
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileSelect}
                      onClick={e => e.stopPropagation()}
                      className="hidden"
                      accept="image/*,application/pdf,.docx,.pptx,.csv,.xlsx,.xls,.json,.txt,audio/*"
                    />

                    {/* File display or upload button */}
                    {fileValue ? (
                      <div
                        className={cn(
                          'flex items-center gap-2 p-2 rounded-lg',
                          'bg-[var(--color-bg-tertiary)] border',
                          isFileExpired
                            ? 'border-red-500/50 bg-red-500/10'
                            : 'border-[var(--color-border)]'
                        )}
                      >
                        {/* File type icon or expired warning */}
                        {isFileExpired ? (
                          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                        ) : isCheckingFileStatus ? (
                          <Loader2
                            size={16}
                            className="text-[var(--color-accent)] flex-shrink-0 animate-spin"
                          />
                        ) : (
                          (() => {
                            const FileIcon = FILE_TYPE_ICONS[fileValue.type] || File;
                            return (
                              <FileIcon
                                size={16}
                                className="text-[var(--color-accent)] flex-shrink-0"
                              />
                            );
                          })()
                        )}

                        {/* File info */}
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              'text-xs font-medium truncate',
                              isFileExpired ? 'text-red-400' : 'text-[var(--color-text-primary)]'
                            )}
                          >
                            {fileValue.filename}
                          </p>
                          <p
                            className={cn(
                              'text-[10px]',
                              isFileExpired
                                ? 'text-red-400/80'
                                : 'text-[var(--color-text-tertiary)]'
                            )}
                          >
                            {isFileExpired
                              ? 'File expired - please re-upload'
                              : `${formatFileSize(fileValue.size)} • ${fileValue.type}`}
                          </p>
                        </div>

                        {/* Remove button */}
                        <button
                          onClick={handleRemoveFile}
                          onMouseDown={e => e.stopPropagation()}
                          className="p-1 rounded hover:bg-red-500/20 text-[var(--color-text-tertiary)] hover:text-red-400 transition-colors"
                          title="Remove file"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        disabled={isUploading}
                        className={cn(
                          'nodrag w-full flex flex-col items-center justify-center gap-1 p-3 rounded-lg',
                          'border-2 border-dashed transition-colors cursor-pointer',
                          !fileValue
                            ? 'border-amber-500/50 bg-amber-500/5'
                            : 'border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
                          'hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/5',
                          isUploading && 'opacity-50 cursor-wait'
                        )}
                      >
                        {isUploading ? (
                          <>
                            <Loader2
                              size={20}
                              className="text-[var(--color-accent)] animate-spin"
                            />
                            <span className="text-[10px] text-[var(--color-text-tertiary)]">
                              Uploading...
                            </span>
                          </>
                        ) : (
                          <>
                            <Upload size={20} className="text-[var(--color-text-tertiary)]" />
                            <span className="text-[10px] text-[var(--color-text-tertiary)]">
                              Click to upload file
                            </span>
                            <span className="text-[9px] text-[var(--color-text-tertiary)] opacity-70">
                              Images, PDFs, Audio, Data files
                            </span>
                          </>
                        )}
                      </button>
                    )}

                    {/* Upload error */}
                    {uploadError && <p className="text-[10px] text-red-400">{uploadError}</p>}
                  </div>
                )}

                {/* JSON Input Mode */}
                {inputType === 'json' && (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <textarea
                        value={jsonInputText}
                        onChange={handleJsonInputChange}
                        onBlur={handleJsonInputBlur}
                        onClick={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                        onKeyDown={e => e.stopPropagation()}
                        placeholder='{\n  "key": "value"\n}'
                        rows={4}
                        className={cn(
                          'nodrag nowheel nopan',
                          'w-full px-2.5 py-1.5 text-xs rounded-lg resize-none font-mono',
                          'bg-[var(--color-bg-tertiary)] border transition-colors',
                          jsonParseError
                            ? 'border-red-500/50'
                            : !hasJsonInput
                              ? 'border-amber-500/50'
                              : 'border-[var(--color-border)]',
                          'text-[var(--color-text-primary)]',
                          'hover:border-[var(--color-text-tertiary)]',
                          'focus:outline-none focus:border-[var(--color-accent)]',
                          'placeholder:text-[var(--color-text-tertiary)]'
                        )}
                      />
                      {/* AI Generate Button - only shown when model is selected */}
                      {variableConfig?.workflowModelId && (
                        <button
                          onClick={handleGenerateSampleInput}
                          onMouseDown={e => e.stopPropagation()}
                          disabled={isGeneratingInput}
                          title="Generate sample input with AI"
                          className={cn(
                            'nodrag absolute bottom-2 right-2 p-1.5 rounded-md transition-all',
                            'bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30',
                            'text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]',
                            isGeneratingInput && 'opacity-50 cursor-wait'
                          )}
                        >
                          {isGeneratingInput ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Sparkles size={14} />
                          )}
                        </button>
                      )}
                    </div>
                    {jsonParseError && (
                      <p className="text-[10px] text-red-400 flex items-center gap-1">
                        <AlertCircle size={10} />
                        {jsonParseError}
                      </p>
                    )}
                    {!jsonParseError && hasJsonInput && (
                      <p className="text-[10px] text-green-400 flex items-center gap-1">
                        <CheckCircle size={10} />
                        Valid JSON
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Save and Run Button */}
            <button
              onClick={handleSaveAndRunClick}
              disabled={
                executionStatus === 'running' ||
                !variableConfig?.workflowModelId ||
                (requiresInput && !hasValidInput)
              }
              className={cn(
                'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors',
                executionStatus === 'running'
                  ? 'bg-[var(--color-accent)] text-black cursor-not-allowed opacity-80'
                  : variableConfig?.workflowModelId && (!requiresInput || hasValidInput)
                    ? 'bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-hover)]'
                    : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed'
              )}
            >
              {executionStatus === 'running' ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <Save size={14} />
                  <Play size={14} />
                  Save & Run
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Output Handle - Right side (hidden, positioned to touch block edge) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-0 !h-0 !bg-transparent !border-0 !min-w-0 !min-h-0 !right-0"
      />
    </div>
  );
}

export const BlockNode = memo(BlockNodeComponent);
