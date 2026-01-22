import { useState, useEffect, useRef } from 'react';
import {
  X,
  Clock,
  Wrench,
  Cpu,
  KeyRound,
  AlertCircle,
  Type,
  Upload,
  Loader2,
  FileText,
  Image,
  Mic,
  File,
  Braces,
} from 'lucide-react';
import { useAgentBuilderStore } from '@/store/useAgentBuilderStore';
import { useModelStore } from '@/store/useModelStore';
import { filterAgentModels } from '@/services/modelService';
import { uploadFile, formatFileSize, checkFileStatus } from '@/services/uploadService';
import type { Block, FileReference, FileType } from '@/types/agent';
import { ToolSelector } from './ToolSelector';
import { IntegrationPicker } from './IntegrationPicker';

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

interface BlockSettingsPanelProps {
  className?: string;
}

export function BlockSettingsPanel({ className }: BlockSettingsPanelProps) {
  const { workflow, selectedBlockId, selectBlock, updateBlock } = useAgentBuilderStore();

  const block = workflow?.blocks.find(b => b.id === selectedBlockId);

  const [localBlock, setLocalBlock] = useState<Block | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync local state when block changes
  useEffect(() => {
    if (block) {
      setLocalBlock({ ...block });
      setHasChanges(false);
    }
  }, [block]);

  const handleSave = () => {
    if (localBlock) {
      updateBlock(localBlock.id, localBlock);
      setHasChanges(false);
    }
  };

  const handleClose = () => {
    selectBlock(null);
  };

  const updateLocalBlock = (updates: Partial<Block>) => {
    setLocalBlock(prev => (prev ? { ...prev, ...updates } : null));
    setHasChanges(true);
  };

  if (!selectedBlockId || !block || !localBlock) {
    return null;
  }

  return (
    <div className={`h-full flex flex-col bg-[var(--color-bg-secondary)] ${className || ''}`}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white/5">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Block Settings</h2>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/10 transition-colors"
        >
          <X size={18} />
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Block Name
          </label>
          <input
            type="text"
            value={localBlock.name}
            onChange={e => updateLocalBlock({ name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Description
          </label>
          <textarea
            value={localBlock.description}
            onChange={e => updateLocalBlock({ description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
          />
        </div>

        {/* Timeout */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
            <Clock size={14} />
            Execution Timeout
          </label>
          <select
            value={localBlock.timeout}
            onChange={e => updateLocalBlock({ timeout: Number(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
          >
            <option value={30}>30 seconds (default)</option>
            <option value={45}>45 seconds</option>
            <option value={60}>60 seconds (max)</option>
          </select>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            Maximum time this block can run before timing out
          </p>
        </div>

        {/* Block Type Specific Settings */}
        <BlockTypeSettings
          block={localBlock}
          onUpdate={config => updateLocalBlock({ config: { ...localBlock.config, ...config } })}
        />
      </div>

      {/* Footer with Save */}
      {hasChanges && (
        <footer className="px-4 py-3 bg-white/5">
          <button
            onClick={handleSave}
            className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-black font-medium text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            Save Changes
          </button>
        </footer>
      )}
    </div>
  );
}

// Tools that require credentials - maps to integration types
// This should match the backend ToolIntegrationMap
const TOOLS_REQUIRING_CREDENTIALS: Record<string, string> = {
  send_discord_message: 'Discord',
  send_slack_message: 'Slack',
  send_telegram_message: 'Telegram',
  send_google_chat_message: 'Google Chat',
  send_webhook: 'Webhook',
};

// Helper to get tools that need credentials from a list of selected tools
function getToolsNeedingCredentials(selectedTools: string[]): string[] {
  return selectedTools
    .filter(tool => tool in TOOLS_REQUIRING_CREDENTIALS)
    .map(tool => TOOLS_REQUIRING_CREDENTIALS[tool]);
}

// Block Type Specific Settings Component
interface BlockTypeSettingsProps {
  block: Block;
  onUpdate: (config: Record<string, unknown>) => void;
}

function BlockTypeSettings({ block, onUpdate }: BlockTypeSettingsProps) {
  const config = block.config;

  switch (block.type) {
    case 'llm_inference': {
      // Handle both old format (modelId) and new AI-generated format (systemPrompt/enabledTools)
      // Get tools from either 'tools' or 'enabledTools' key
      const tools = (config.tools as string[]) || (config.enabledTools as string[]) || [];

      return (
        <div className="space-y-4 pt-4">
          <h3 className="text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wide">
            LLM Settings
          </h3>

          {/* System Prompt */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              System Prompt
            </label>
            <textarea
              value={(config.systemPrompt as string) || ''}
              onChange={e => onUpdate({ systemPrompt: e.target.value })}
              rows={4}
              placeholder="Instructions for the LLM agent..."
              className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
            />
          </div>

          {/* User Prompt */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              User Prompt
            </label>
            <textarea
              value={(config.userPrompt as string) || ''}
              onChange={e => onUpdate({ userPrompt: e.target.value })}
              rows={2}
              placeholder="{{input}} or {{previous-block.response}}"
              className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
            />
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Use {'{{input}}'} for workflow input or {'{{block-id.response}}'} for previous block
              output
            </p>
          </div>

          {/* Temperature */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Temperature: {config.temperature ?? 0.7}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={(config.temperature as number) ?? 0.7}
              onChange={e => onUpdate({ temperature: parseFloat(e.target.value) })}
              className="w-full accent-[var(--color-accent)]"
            />
          </div>

          {/* Tool Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
              <Wrench size={14} />
              Enabled Tools
            </label>
            <ToolSelector
              selectedTools={tools}
              onSelectionChange={newTools => onUpdate({ tools: newTools, enabledTools: newTools })}
              blockContext={{
                name: block.name,
                description: block.description,
                type: block.type,
              }}
            />
          </div>

          {/* Integration Credentials - show when tools are selected */}
          {tools.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
                <KeyRound size={14} />
                Available Credentials
              </label>
              <IntegrationPicker
                selectedCredentials={(config.credentials as string[]) || []}
                onSelectionChange={credentials => onUpdate({ credentials })}
                toolFilter={tools}
                compact
              />
              {/* Warning when tools need credentials but none selected */}
              {(() => {
                const toolsNeedingCreds = getToolsNeedingCredentials(tools);
                const selectedCreds = (config.credentials as string[]) || [];
                if (toolsNeedingCreds.length > 0 && selectedCreds.length === 0) {
                  return (
                    <div className="flex items-center gap-1.5 text-xs text-amber-500 mt-2 p-2 rounded-md bg-amber-500/10">
                      <AlertCircle size={14} className="flex-shrink-0" />
                      <span>
                        Select a credential for {toolsNeedingCreds.join(', ')} tool
                        {toolsNeedingCreds.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>
      );
    }

    case 'webhook':
      if ('url' in config) {
        return (
          <div className="space-y-4 pt-4">
            <h3 className="text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wide">
              Webhook Settings
            </h3>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">URL</label>
              <input
                type="url"
                value={config.url}
                onChange={e => onUpdate({ url: e.target.value })}
                placeholder="https://api.example.com/webhook"
                className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                Method
              </label>
              <select
                value={config.method}
                onChange={e =>
                  onUpdate({
                    method: e.target.value as 'GET' | 'POST' | 'PUT' | 'DELETE',
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                Body Template
              </label>
              <textarea
                value={config.bodyTemplate}
                onChange={e => onUpdate({ bodyTemplate: e.target.value })}
                rows={4}
                placeholder='{"data": "{{input.result}}"}'
                className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">
                Use {'{{input.fieldName}}'} for variable interpolation
              </p>
            </div>
          </div>
        );
      }
      break;

    case 'variable':
      if ('operation' in config) {
        return <VariableBlockSettings config={config} onUpdate={onUpdate} />;
      }
      break;

    case 'code_block': {
      const toolName = 'toolName' in config ? (config.toolName as string) : '';
      const argumentMapping =
        'argumentMapping' in config ? (config.argumentMapping as Record<string, string>) : {};

      return (
        <div className="space-y-4 pt-4">
          <h3 className="text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wide">
            Tool Settings
          </h3>

          {/* Tool Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
              <Wrench size={14} />
              Tool Name
            </label>
            <input
              type="text"
              value={toolName}
              onChange={e => onUpdate({ toolName: e.target.value })}
              placeholder="e.g., send_discord_message"
              className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
            />
            <p className="text-xs text-[var(--color-text-tertiary)]">
              The tool to execute directly (no LLM reasoning)
            </p>
          </div>

          {/* Argument Mapping */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Argument Mapping (JSON)
            </label>
            <textarea
              value={JSON.stringify(argumentMapping, null, 2)}
              onChange={e => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  onUpdate({ argumentMapping: parsed });
                } catch {
                  // Ignore invalid JSON while typing
                }
              }}
              rows={6}
              placeholder={'{\n  "content": "{{input}}",\n  "channel": "general"\n}'}
              className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
            />
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Map tool arguments to variables using {'{{input}}'} or {'{{block-id.response}}'}
            </p>
          </div>

          {/* Info Box */}
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <p className="text-xs text-blue-400">
              <strong>Code Block</strong> executes tools directly without LLM. Use for mechanical
              tasks like sending pre-formatted messages or getting the current time.
            </p>
          </div>
        </div>
      );
    }

    default:
      return (
        <div className="pt-4">
          <p className="text-xs text-[var(--color-text-tertiary)]">
            No additional settings for this block type.
          </p>
        </div>
      );
  }

  return null;
}

// Variable Block Settings with Model Selector for Start Block
interface VariableBlockSettingsProps {
  config: {
    operation?: 'set' | 'read';
    variableName?: string;
    valueExpression?: string;
    defaultValue?: string;
    workflowModelId?: string;
    inputType?: 'text' | 'file' | 'json';
    fileValue?: FileReference | null;
    jsonValue?: Record<string, unknown> | null;
    requiresInput?: boolean;
  };
  onUpdate: (config: Record<string, unknown>) => void;
}

function VariableBlockSettings({ config, onUpdate }: VariableBlockSettingsProps) {
  const { models, fetchModels, isLoading: modelsLoading } = useModelStore();
  const { currentAgent } = useAgentBuilderStore();
  const isStartBlock = config.operation === 'read' && config.variableName === 'input';

  // Filter models to only show agent-enabled models
  const agentModels = filterAgentModels(models);

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isFileExpired, setIsFileExpired] = useState(false);
  const [isCheckingFileStatus, setIsCheckingFileStatus] = useState(false);

  // Input type (text or file)
  const inputType = config.inputType || 'text';
  const fileValue = config.fileValue;
  const requiresInput = config.requiresInput !== false;

  // Fetch models on mount if this is the start block
  useEffect(() => {
    if (isStartBlock && models.length === 0) {
      fetchModels();
    }
  }, [isStartBlock, models.length, fetchModels]);

  // Check file expiration status when file is attached
  useEffect(() => {
    if (!isStartBlock || !fileValue?.fileId) {
      setIsFileExpired(false);
      return;
    }

    const checkStatus = async () => {
      setIsCheckingFileStatus(true);
      try {
        const status = await checkFileStatus(fileValue.fileId);
        setIsFileExpired(!status.available || status.expired);
      } catch (err) {
        console.error('Failed to check file status:', err);
      } finally {
        setIsCheckingFileStatus(false);
      }
    };

    checkStatus();
    // Re-check every 5 minutes
    const interval = setInterval(checkStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isStartBlock, fileValue?.fileId]);

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const conversationId = currentAgent?.id || 'workflow-test';
      const uploadedFile = await uploadFile(file, conversationId);

      const fileRef: FileReference = {
        fileId: uploadedFile.file_id,
        filename: uploadedFile.filename,
        mimeType: uploadedFile.mime_type,
        size: uploadedFile.size,
        type: getFileTypeFromMime(uploadedFile.mime_type),
      };

      onUpdate({ fileValue: fileRef });
      setIsFileExpired(false);
    } catch (err) {
      console.error('File upload failed:', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Remove selected file
  const handleRemoveFile = () => {
    onUpdate({ fileValue: null });
    setIsFileExpired(false);
    setUploadError(null);
  };

  // Toggle input type
  const handleInputTypeChange = (newType: 'text' | 'file' | 'json') => {
    onUpdate({ inputType: newType });
  };

  return (
    <div className="space-y-4 pt-4">
      <h3 className="text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wide">
        Variable Settings
      </h3>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Operation</label>
        <select
          value={config.operation as string}
          onChange={e => onUpdate({ operation: e.target.value as 'set' | 'read' })}
          className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
        >
          <option value="set">Set Variable</option>
          <option value="read">Read Variable</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">
          Variable Name
        </label>
        <input
          type="text"
          value={config.variableName as string}
          onChange={e => onUpdate({ variableName: e.target.value })}
          placeholder="myVariable"
          className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
        />
      </div>

      {config.operation === 'set' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Value Expression
          </label>
          <input
            type="text"
            value={(config.valueExpression as string) || ''}
            onChange={e => onUpdate({ valueExpression: e.target.value })}
            placeholder="{{input.result}}"
            className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
          />
        </div>
      )}

      {isStartBlock && (
        <>
          {/* Model Selector for Workflow */}
          <div className="p-3 rounded-lg bg-[var(--color-accent)]/5 space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-accent)] flex items-center gap-1.5">
              <Cpu size={14} />
              Workflow Model
            </label>
            <select
              value={(config.workflowModelId as string) || ''}
              onChange={e => onUpdate({ workflowModelId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
              disabled={modelsLoading}
            >
              <option value="">Use default model</option>
              {agentModels.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name || model.id}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Select a model to use for all LLM blocks in this workflow.
            </p>
          </div>

          {/* Requires Input Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Requires Input
            </label>
            <button
              onClick={() => onUpdate({ requiresInput: !requiresInput })}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                requiresInput ? 'bg-[var(--color-accent)]' : 'bg-white/10'
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${
                  requiresInput ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          {/* Test Input Section - only shown when input is required */}
          {requiresInput && (
            <div className="p-3 rounded-lg bg-[var(--color-accent)]/5 space-y-3">
              {/* Input Type Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-accent)]">Input Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleInputTypeChange('text')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-colors ${
                      inputType === 'text'
                        ? 'bg-[var(--color-accent)] text-black'
                        : 'bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10'
                    }`}
                  >
                    <Type size={14} />
                    Text
                  </button>
                  <button
                    onClick={() => handleInputTypeChange('json')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-colors ${
                      inputType === 'json'
                        ? 'bg-[var(--color-accent)] text-black'
                        : 'bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10'
                    }`}
                  >
                    <Braces size={14} />
                    JSON
                  </button>
                  <button
                    onClick={() => handleInputTypeChange('file')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-colors ${
                      inputType === 'file'
                        ? 'bg-[var(--color-accent)] text-black'
                        : 'bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10'
                    }`}
                  >
                    <Upload size={14} />
                    File
                  </button>
                </div>
              </div>

              {/* Text Input Mode */}
              {inputType === 'text' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--color-accent)]">
                    Test Input Value
                  </label>
                  <textarea
                    value={(config.defaultValue as string) || ''}
                    onChange={e => onUpdate({ defaultValue: e.target.value })}
                    placeholder="Enter a test value to run your workflow with..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
                  />
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    This value will be passed to the workflow when you click Run.
                  </p>
                </div>
              )}

              {/* JSON Input Mode */}
              {inputType === 'json' && <JsonInputSection config={config} onUpdate={onUpdate} />}

              {/* File Input Mode */}
              {inputType === 'file' && (
                <div className="space-y-2">
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    className="hidden"
                    accept="image/*,application/pdf,.docx,.pptx,.csv,.xlsx,.xls,.json,.txt,audio/*"
                  />

                  {/* File display or upload button */}
                  {fileValue ? (
                    <div
                      className={`flex items-center gap-3 p-3 rounded-lg ${
                        isFileExpired ? 'bg-red-500/10' : 'bg-white/5'
                      }`}
                    >
                      {/* File type icon or expired warning */}
                      {isFileExpired ? (
                        <AlertCircle size={20} className="text-red-400 flex-shrink-0" />
                      ) : isCheckingFileStatus ? (
                        <Loader2
                          size={20}
                          className="text-[var(--color-accent)] flex-shrink-0 animate-spin"
                        />
                      ) : (
                        (() => {
                          const FileIcon = FILE_TYPE_ICONS[fileValue.type] || File;
                          return (
                            <FileIcon
                              size={20}
                              className="text-[var(--color-accent)] flex-shrink-0"
                            />
                          );
                        })()
                      )}

                      {/* File info */}
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            isFileExpired ? 'text-red-400' : 'text-[var(--color-text-primary)]'
                          }`}
                        >
                          {fileValue.filename}
                        </p>
                        <p
                          className={`text-xs ${
                            isFileExpired ? 'text-red-400/80' : 'text-[var(--color-text-tertiary)]'
                          }`}
                        >
                          {isFileExpired
                            ? 'File expired - please re-upload'
                            : `${formatFileSize(fileValue.size)} • ${fileValue.type}`}
                        </p>
                      </div>

                      {/* Remove button */}
                      <button
                        onClick={handleRemoveFile}
                        className="p-1.5 rounded-md hover:bg-red-500/20 text-[var(--color-text-tertiary)] hover:text-red-400 transition-colors"
                        title="Remove file"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className={`w-full flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed transition-colors cursor-pointer ${
                        isUploading
                          ? 'opacity-50 cursor-wait border-white/10'
                          : 'border-[var(--color-accent)]/30 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/5'
                      }`}
                    >
                      {isUploading ? (
                        <>
                          <Loader2 size={24} className="text-[var(--color-accent)] animate-spin" />
                          <span className="text-xs text-[var(--color-text-tertiary)]">
                            Uploading...
                          </span>
                        </>
                      ) : (
                        <>
                          <Upload size={24} className="text-[var(--color-text-tertiary)]" />
                          <span className="text-sm text-[var(--color-text-secondary)]">
                            Tap to upload file
                          </span>
                          <span className="text-xs text-[var(--color-text-tertiary)]">
                            Images, PDFs, Audio, Data files
                          </span>
                        </>
                      )}
                    </button>
                  )}

                  {/* Upload error */}
                  {uploadError && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10">
                      <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                      <p className="text-xs text-red-400">{uploadError}</p>
                    </div>
                  )}

                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    Files are available for 30 minutes after upload.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// JSON Input Section Component
interface JsonInputSectionProps {
  config: {
    jsonValue?: Record<string, unknown> | null;
  };
  onUpdate: (config: Record<string, unknown>) => void;
}

function JsonInputSection({ config, onUpdate }: JsonInputSectionProps) {
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  // Initialize JSON text from config
  useEffect(() => {
    if (config.jsonValue) {
      try {
        setJsonText(JSON.stringify(config.jsonValue, null, 2));
        setParseError(null);
      } catch {
        setJsonText('');
      }
    } else {
      setJsonText('{\n  \n}');
    }
  }, [config.jsonValue]);

  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setJsonText(text);

    // Try to parse and validate
    try {
      const parsed = JSON.parse(text);
      setParseError(null);
      onUpdate({ jsonValue: parsed });
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const hasValidJson = config.jsonValue !== null && config.jsonValue !== undefined && !parseError;

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--color-accent)]">JSON Input Value</label>
      <textarea
        value={jsonText}
        onChange={handleJsonChange}
        placeholder='{\n  "key": "value"\n}'
        rows={5}
        className={`w-full px-3 py-2 rounded-lg bg-white/5 text-sm text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:ring-2 ${
          parseError
            ? 'focus:ring-red-500/50'
            : !hasValidJson
              ? 'focus:ring-amber-500/50'
              : 'focus:ring-[var(--color-accent)]/50'
        }`}
      />
      {parseError && (
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle size={12} />
          {parseError}
        </div>
      )}
      {!parseError && hasValidJson && (
        <div className="flex items-center gap-1.5 text-xs text-green-400">
          <span>✓ Valid JSON</span>
        </div>
      )}
      <p className="text-xs text-[var(--color-text-tertiary)]">
        Enter JSON data to be passed as workflow input.
      </p>
    </div>
  );
}
