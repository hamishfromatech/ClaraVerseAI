import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  AlertCircle,
  MessageSquare,
  Rocket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentBuilderStore } from '@/store/useAgentBuilderStore';
import { MarkdownRenderer } from '@/components/design-system';
import type { ExecutionStatus } from '@/types/agent';

interface ChatExecutionOutputProps {
  onBackToChat: () => void;
  onDeploy?: () => void;
}

/**
 * Desktop execution output view embedded in the chat panel.
 * Shows live block outputs during workflow execution.
 * Replaces the modal-style output panel with an inline chat panel experience.
 */
export function ChatExecutionOutput({ onBackToChat, onDeploy }: ChatExecutionOutputProps) {
  const { blockStates, workflow, executionStatus, lastExecutionResult } = useAgentBuilderStore();
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedInputs, setExpandedInputs] = useState<Record<string, Set<string>>>({});

  const toggleBlock = (blockId: string) => {
    setExpandedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  };

  const toggleInput = (blockId: string, inputKey: string) => {
    setExpandedInputs(prev => {
      const blockInputs = prev[blockId] || new Set();
      const next = new Set(blockInputs);
      if (next.has(inputKey)) {
        next.delete(inputKey);
      } else {
        next.add(inputKey);
      }
      return { ...prev, [blockId]: next };
    });
  };

  const formatInputValue = (value: unknown): string => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Extract readable content from output
  const extractReadableContent = (output: unknown): string => {
    if (!output) return 'No output';

    // Helper to safely stringify a value
    const stringify = (val: unknown): string => {
      if (typeof val === 'string') return val;
      if (typeof val === 'object' && val !== null) return JSON.stringify(val, null, 2);
      return String(val);
    };

    const data = typeof output === 'object' && output !== null ? output : { value: output };
    const obj = data as Record<string, unknown>;

    // Look for common output fields
    if (obj.output && typeof obj.output === 'object') {
      const innerOutput = obj.output as Record<string, unknown>;
      if (innerOutput.summary) return stringify(innerOutput.summary);
      if (innerOutput.result) return stringify(innerOutput.result);
      if (innerOutput.content) return stringify(innerOutput.content);
      if (innerOutput.text) return stringify(innerOutput.text);
      if (innerOutput.response) return stringify(innerOutput.response);
    }

    // Direct fields - response may now be an object (from schema formatting)
    if (obj.response !== undefined) return stringify(obj.response);
    if (obj.summary) return stringify(obj.summary);
    if (obj.result) return stringify(obj.result);
    if (obj.content) return stringify(obj.content);
    if (obj.rawResponse) return stringify(obj.rawResponse);
    if (obj.text) return stringify(obj.text);

    if (typeof output === 'string') return output;

    return JSON.stringify(output, null, 2);
  };

  const completedCount = Object.values(blockStates).filter(s => s.status === 'completed').length;
  const failedCount = Object.values(blockStates).filter(s => s.status === 'failed').length;
  const totalBlocks = workflow?.blocks?.length || 0;

  const isRunning = executionStatus === 'running';
  const isCompleted = executionStatus === 'completed';
  const isFailed = executionStatus === 'failed';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with status and back button */}
      <div className="flex-shrink-0 px-4 py-3 bg-white/5">
        <div className="flex items-center justify-between mb-2">
          <ExecutionStatusBadge status={executionStatus} />
          <button
            onClick={onBackToChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <MessageSquare size={14} />
            Back to Chat
          </button>
        </div>

        {/* Progress stats - don't show running count since the badge already shows "Running..." */}
        <div className="flex items-center gap-4 text-xs text-[var(--color-text-tertiary)]">
          <span className="flex items-center gap-1">
            <CheckCircle2 size={12} className="text-green-400" />
            {completedCount}/{totalBlocks} completed
          </span>
          {failedCount > 0 && (
            <span className="flex items-center gap-1">
              <XCircle size={12} className="text-red-400" />
              {failedCount} failed
            </span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Final result section - shown when execution completes */}
        {lastExecutionResult?.result && !isRunning && (
          <div className="p-4 border-b border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                Final Output
              </span>
              <button
                onClick={() => copyToClipboard(lastExecutionResult.result!, 'final')}
                className="p-1.5 rounded-md hover:bg-white/10 text-[var(--color-text-tertiary)]"
              >
                {copiedId === 'final' ? (
                  <Check size={14} className="text-green-400" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
            <div
              className={cn(
                'p-3 rounded-xl text-sm text-[var(--color-text-primary)] max-h-64 overflow-y-auto',
                isCompleted && 'bg-green-500/10',
                isFailed && 'bg-red-500/10',
                !isCompleted && !isFailed && 'bg-yellow-500/10'
              )}
            >
              <MarkdownRenderer
                content={lastExecutionResult.result}
                className="[&_p]:mb-2 [&_p:last-child]:mb-0 [&_pre]:bg-black/20 [&_code]:text-xs"
              />
            </div>

            {/* Action buttons for completed execution */}
            {isCompleted && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={onDeploy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--color-accent)] text-black transition-all"
                >
                  <Rocket size={14} />
                  Deploy Agent
                </button>
                <button
                  onClick={onBackToChat}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)] transition-all"
                >
                  <MessageSquare size={14} />
                  Refine with Chat
                </button>
              </div>
            )}
          </div>
        )}

        {/* Block outputs */}
        <div className="p-4 space-y-2">
          <h3 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wide mb-3">
            Block Outputs
          </h3>

          {workflow?.blocks?.map(block => {
            const state = blockStates[block.id];
            const isExpanded = expandedBlocks.has(block.id);
            const hasOutput = state?.outputs && Object.keys(state.outputs).length > 0;
            const hasError = state?.error;
            const outputText = hasOutput ? extractReadableContent(state.outputs) : null;

            return (
              <div
                key={block.id}
                className={cn(
                  'rounded-xl bg-white/5 overflow-hidden transition-colors',
                  state?.status === 'running' && 'ring-1 ring-blue-400/50',
                  state?.status === 'completed' && 'ring-1 ring-green-400/20',
                  state?.status === 'failed' && 'ring-1 ring-red-400/30'
                )}
              >
                {/* Block header */}
                <button
                  onClick={() => (hasOutput || hasError) && toggleBlock(block.id)}
                  disabled={!hasOutput && !hasError}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 text-left transition-colors',
                    (hasOutput || hasError) && 'hover:bg-white/5'
                  )}
                >
                  {/* Expand icon */}
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                    {hasOutput || hasError ? (
                      isExpanded ? (
                        <ChevronDown size={16} className="text-[var(--color-text-tertiary)]" />
                      ) : (
                        <ChevronRight size={16} className="text-[var(--color-text-tertiary)]" />
                      )
                    ) : null}
                  </div>

                  {/* Block info */}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate block">
                      {block.name}
                    </span>
                    {state?.status === 'running' && (
                      <span className="text-xs text-blue-400 mt-0.5 block">Processing...</span>
                    )}
                  </div>

                  {/* Status */}
                  <BlockStatusIcon status={state?.status} />
                </button>

                {/* Expanded output */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3">
                    {/* Available Inputs Section */}
                    {state?.inputs && Object.keys(state.inputs).length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wide">
                            Available Inputs
                          </h4>
                          <span className="text-xs text-[var(--color-text-tertiary)] bg-white/10 px-2 py-0.5 rounded-full">
                            {Object.keys(state.inputs).length} keys
                          </span>
                        </div>
                        <div className="p-3 rounded-lg bg-black/20 border border-white/10 space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {Object.keys(state.inputs).map(key => {
                              const isInputExpanded = expandedInputs[block.id]?.has(key);
                              return (
                                <div key={key} className="w-full">
                                  <button
                                    onClick={() => toggleInput(block.id, key)}
                                    className="text-xs font-mono px-2 py-1 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors cursor-pointer"
                                    title={`Click to ${isInputExpanded ? 'hide' : 'show'} value`}
                                  >
                                    {isInputExpanded ? '▼' : '▶'} {key}
                                  </button>
                                  {isInputExpanded && (
                                    <div className="mt-1 ml-4 p-2 rounded bg-black/40 border border-white/5">
                                      <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                                        {formatInputValue(state.inputs[key])}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-2 text-xs text-[var(--color-text-tertiary)] italic">
                            Use these in variable paths like{' '}
                            <span className="font-mono text-[var(--color-text-secondary)]">
                              {'{{'}
                              {Object.keys(state.inputs)[0] || 'key'}
                              {'}}'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {hasError && (
                      <div className="p-3 rounded-lg bg-red-500/10 text-xs text-red-400">
                        <div className="flex items-center gap-1.5 mb-1 font-medium">
                          <AlertCircle size={12} />
                          Error
                        </div>
                        <p className="whitespace-pre-wrap break-words">{state.error}</p>
                      </div>
                    )}
                    {outputText && (
                      <div className="relative">
                        <button
                          onClick={() => copyToClipboard(outputText, block.id)}
                          className="absolute top-2 right-2 p-1.5 rounded-md bg-black/20 hover:bg-black/30 text-[var(--color-text-tertiary)]"
                        >
                          {copiedId === block.id ? (
                            <Check size={12} className="text-green-400" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                        <div className="p-3 rounded-lg bg-black/20 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono">
                          {outputText}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Execution status badge with icon
 */
function ExecutionStatusBadge({ status }: { status: ExecutionStatus | null }) {
  const getStatusInfo = () => {
    switch (status) {
      case 'running':
        return {
          icon: <Loader2 size={16} className="animate-spin" />,
          text: 'Running...',
          color: 'text-blue-400',
          bg: 'bg-blue-500/20',
        };
      case 'completed':
        return {
          icon: <CheckCircle2 size={16} />,
          text: 'Completed',
          color: 'text-green-400',
          bg: 'bg-green-500/20',
        };
      case 'failed':
        return {
          icon: <XCircle size={16} />,
          text: 'Failed',
          color: 'text-red-400',
          bg: 'bg-red-500/20',
        };
      case 'partial_failure':
        return {
          icon: <AlertCircle size={16} />,
          text: 'Partial Failure',
          color: 'text-yellow-400',
          bg: 'bg-yellow-500/20',
        };
      default:
        return {
          icon: <Circle size={16} />,
          text: 'Pending',
          color: 'text-[var(--color-text-tertiary)]',
          bg: 'bg-white/10',
        };
    }
  };

  const info = getStatusInfo();

  return (
    <div
      className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-full', info.bg, info.color)}
    >
      {info.icon}
      <span className="text-sm font-medium">{info.text}</span>
    </div>
  );
}

/**
 * Small status icon for block row
 */
function BlockStatusIcon({ status }: { status?: string }) {
  switch (status) {
    case 'running':
      return <Loader2 size={16} className="text-blue-400 animate-spin" />;
    case 'completed':
      return <CheckCircle2 size={16} className="text-green-400" />;
    case 'failed':
      return <XCircle size={16} className="text-red-400" />;
    case 'skipped':
      return <Circle size={16} className="text-yellow-400" />;
    default:
      return <Circle size={16} className="text-[var(--color-text-tertiary)]" />;
  }
}
