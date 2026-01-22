import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  History,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  Key,
  Globe,
  ChevronRight,
  MessageSquare,
  Wrench,
  Coins,
  Code,
  FileText,
} from 'lucide-react';
import {
  getAgentExecutions,
  formatDuration,
  formatTimestamp,
  getStatusColor,
  getTriggerTypeLabel,
  type ExecutionRecord,
  type PaginatedExecutions,
} from '@/services/executionService';

// Types for extracted output data (legacy fallback)
interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
  result?: string;
  duration?: number;
  error?: string;
}

interface ExtractedOutput {
  response: string | null;
  toolCalls: ToolCall[];
  tokens: { input: number; output: number; total: number } | null;
}

// Helper to extract presentable output from nested workflow data (fallback for old executions)
function extractOutputData(output: Record<string, unknown>): ExtractedOutput {
  const result: ExtractedOutput = {
    response: null,
    toolCalls: [],
    tokens: null,
  };

  // First, find the main workflow block (first key that's an object with response/output)
  let mainBlock: Record<string, unknown> | null = null;

  for (const [key, value] of Object.entries(output)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !key.startsWith('_')) {
      const block = value as Record<string, unknown>;
      // Check if this looks like a workflow block (has response, output, or toolCalls)
      if (block.response || block.output || block.toolCalls) {
        mainBlock = block;
        break;
      }
    }
  }

  // If no main block found, use the output itself
  const sourceBlock = mainBlock || output;

  // Extract response - check direct response first, then output.response
  if (sourceBlock.response && typeof sourceBlock.response === 'string') {
    result.response = sourceBlock.response;
  } else if (
    sourceBlock.output &&
    typeof sourceBlock.output === 'object' &&
    (sourceBlock.output as Record<string, unknown>).response
  ) {
    const outputResponse = (sourceBlock.output as Record<string, unknown>).response;
    if (typeof outputResponse === 'string') {
      result.response = outputResponse;
    }
  }

  // NOTE: We no longer extract 'model' - it's an internal ID that shouldn't be shown

  // Collect all tool calls and sum tokens recursively
  const totalTokens = { input: 0, output: 0, total: 0 };
  let hasTokens = false;

  function collectData(obj: Record<string, unknown>): void {
    if (!obj || typeof obj !== 'object') return;

    // Collect tool calls
    if (Array.isArray(obj.toolCalls)) {
      for (const tc of obj.toolCalls) {
        if (tc && typeof tc === 'object' && tc.name) {
          result.toolCalls.push({
            name: tc.name,
            arguments: tc.arguments,
            result: tc.result,
            duration: tc.duration,
            error: tc.error,
          });
        }
      }
    }

    // Sum tokens from this block (only if it has tokens directly)
    if (obj.tokens && typeof obj.tokens === 'object') {
      const t = obj.tokens as Record<string, number>;
      if (t.input !== undefined && t.output !== undefined) {
        let hasNestedTokens = false;
        for (const [key, value] of Object.entries(obj)) {
          if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            !['input', 'output', 'tokens', 'start', 'toolCalls'].includes(key)
          ) {
            const nested = value as Record<string, unknown>;
            if (nested.tokens) {
              hasNestedTokens = true;
              break;
            }
          }
        }

        if (!hasNestedTokens) {
          totalTokens.input += t.input;
          totalTokens.output += t.output;
          totalTokens.total += t.total || t.input + t.output;
          hasTokens = true;
        }
      }
    }

    // Traverse nested objects
    for (const [key, value] of Object.entries(obj)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !['input', 'output', 'tokens', 'start', 'toolCalls'].includes(key)
      ) {
        collectData(value as Record<string, unknown>);
      }
    }
  }

  collectData(sourceBlock);

  if (hasTokens) {
    result.tokens = totalTokens;
  }

  return result;
}

// Simple markdown-like text renderer
function formatResponse(text: string): React.ReactNode {
  // Split by newlines and process each line
  const lines = text.split('\n');

  return lines.map((line, i) => {
    // Bold text: **text**
    let processed: React.ReactNode = line;
    const boldRegex = /\*\*([^*]+)\*\*/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = boldRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }
      parts.push(
        <strong key={`bold-${i}-${match.index}`} className="text-[var(--color-text-primary)]">
          {match[1]}
        </strong>
      );
      lastIndex = match.index + match[0].length;
    }

    if (parts.length > 0) {
      if (lastIndex < line.length) {
        parts.push(line.substring(lastIndex));
      }
      processed = <>{parts}</>;
    }

    return (
      <span key={i}>
        {processed}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

// Component to display execution output in a presentable way
function ExecutionOutputView({
  output,
  result,
  artifacts,
  files,
}: {
  output?: Record<string, unknown>;
  result?: string;
  artifacts?: Array<{ type: string; format: string; data: string; title?: string }>;
  files?: Array<{ filename: string; download_url: string }>;
}) {
  const [showRawJson, setShowRawJson] = useState(false);
  const [expandedToolCalls, setExpandedToolCalls] = useState(false);

  // Use clean result if available, otherwise extract from legacy output
  const extracted = useMemo(() => (output ? extractOutputData(output) : null), [output]);
  const displayResponse = result || extracted?.response;

  return (
    <div className="mt-2 space-y-2">
      {/* Response Section - Prefer clean result */}
      {displayResponse && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-text-tertiary)] mb-1">
            <MessageSquare size={12} />
            Response
          </div>
          <div className="p-3 rounded-lg bg-[var(--color-surface)] text-xs text-[var(--color-text-secondary)] leading-relaxed">
            {formatResponse(displayResponse.trim())}
          </div>
        </div>
      )}

      {/* Artifacts Section (Charts/Images) */}
      {artifacts && artifacts.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-text-tertiary)] mb-1">
            <FileText size={12} />
            Generated Charts ({artifacts.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {artifacts.map((artifact, idx) => (
              <div key={idx} className="relative group">
                <img
                  src={
                    artifact.data.startsWith('data:')
                      ? artifact.data
                      : `data:image/${artifact.format || 'png'};base64,${artifact.data}`
                  }
                  alt={artifact.title || `Chart ${idx + 1}`}
                  className="h-20 w-auto rounded border border-[var(--color-border)] object-contain bg-white"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files Section */}
      {files && files.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-text-tertiary)] mb-1">
            <FileText size={12} />
            Generated Files ({files.length})
          </div>
          <div className="space-y-1">
            {files.map((file, idx) => (
              <a
                key={idx}
                href={file.download_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[10px] text-[var(--color-accent)] hover:underline"
              >
                <FileText size={10} />
                {file.filename}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Tool Calls Section (from legacy output) */}
      {extracted && extracted.toolCalls.length > 0 && (
        <div>
          <button
            onClick={() => setExpandedToolCalls(!expandedToolCalls)}
            className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <Wrench size={12} />
            Tool Calls ({extracted.toolCalls.length})
            <ChevronRight
              size={12}
              className={`transition-transform ${expandedToolCalls ? 'rotate-90' : ''}`}
            />
          </button>

          {expandedToolCalls && (
            <div className="mt-1.5 space-y-1.5">
              {extracted.toolCalls.map((tc, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono font-medium text-[var(--color-accent)]">
                      {tc.name}
                    </span>
                    {tc.error && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/20 text-red-400">
                        Error
                      </span>
                    )}
                  </div>
                  {tc.arguments && Object.keys(tc.arguments).length > 0 && (
                    <div className="text-[9px] text-[var(--color-text-tertiary)] font-mono mb-1">
                      Args: {JSON.stringify(tc.arguments)}
                    </div>
                  )}
                  {tc.result && (
                    <div className="text-[10px] text-[var(--color-text-secondary)] font-mono bg-[var(--color-surface)] p-1.5 rounded max-h-20 overflow-y-auto">
                      {tc.result.length > 500 ? tc.result.substring(0, 500) + '...' : tc.result}
                    </div>
                  )}
                  {tc.error && <div className="text-[10px] text-red-400 font-mono">{tc.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Metadata Row - No model ID shown */}
      <div className="flex items-center gap-3 text-[9px] text-[var(--color-text-tertiary)]">
        {extracted?.tokens && (
          <span className="flex items-center gap-1">
            <Coins size={10} />
            {extracted.tokens.total.toLocaleString()} tokens
          </span>
        )}
        {output && (
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            className="flex items-center gap-1 hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <Code size={10} />
            {showRawJson ? 'Hide' : 'Show'} Raw
          </button>
        )}
      </div>

      {/* Raw JSON (collapsible) */}
      {showRawJson && output && (
        <pre className="p-2 rounded bg-[var(--color-surface)] text-[9px] text-[var(--color-text-tertiary)] font-mono overflow-x-auto max-h-48 overflow-y-auto">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  );
}

interface ExecutionHistoryPanelProps {
  agentId: string;
  className?: string;
  defaultExpanded?: boolean;
}

export function ExecutionHistoryPanel({
  agentId,
  className,
  defaultExpanded = false,
}: ExecutionHistoryPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [data, setData] = useState<PaginatedExecutions | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null);

  const loadExecutions = useCallback(
    async (offset = 0) => {
      if (offset === 0) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const result = await getAgentExecutions(agentId, {
          limit: 10,
          offset,
          status: statusFilter !== 'all' ? statusFilter : undefined,
        });

        if (offset === 0) {
          setData(result);
        } else {
          setData(prev =>
            prev
              ? {
                  ...result,
                  executions: [...prev.executions, ...result.executions],
                }
              : result
          );
        }
      } catch (err) {
        console.error('Failed to load executions:', err);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [agentId, statusFilter]
  );

  // Load executions when panel is expanded
  useEffect(() => {
    if (isExpanded && agentId) {
      loadExecutions();
    }
  }, [isExpanded, agentId, loadExecutions]);

  const handleLoadMore = () => {
    if (data) {
      loadExecutions(data.executions.length);
    }
  };

  const handleRefresh = () => {
    loadExecutions(0);
  };

  const toggleExecutionDetails = (executionId: string) => {
    setExpandedExecutionId(prev => (prev === executionId ? null : executionId));
  };

  const getStatusIcon = (status: ExecutionRecord['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={14} className="text-green-400" />;
      case 'failed':
        return <XCircle size={14} className="text-red-400" />;
      case 'running':
        return <Loader2 size={14} className="text-[var(--color-accent)] animate-spin" />;
      case 'pending':
        return <Clock size={14} className="text-yellow-400" />;
      default:
        return <Clock size={14} className="text-[var(--color-text-tertiary)]" />;
    }
  };

  const getTriggerIcon = (triggerType: ExecutionRecord['triggerType']) => {
    switch (triggerType) {
      case 'manual':
        return <Play size={12} />;
      case 'scheduled':
        return <Clock size={12} />;
      case 'api':
        return <Key size={12} />;
      case 'webhook':
        return <Globe size={12} />;
      default:
        return null;
    }
  };

  return (
    <div className={`border-b border-[var(--color-border)] ${className || ''}`}>
      {/* Header - Clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <History size={16} className="text-[var(--color-accent)]" />
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            Execution History
          </span>
          {data && data.total > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
              {data.total}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp size={16} className="text-[var(--color-text-tertiary)]" />
        ) : (
          <ChevronDown size={16} className="text-[var(--color-text-tertiary)]" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Filter and Refresh */}
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="flex-1 px-2 py-1.5 rounded-md bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-xs text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] [color-scheme:dark]"
            >
              <option value="all" className="bg-[var(--color-charcoal)] text-white">
                All Status
              </option>
              <option value="completed" className="bg-[var(--color-charcoal)] text-white">
                Completed
              </option>
              <option value="failed" className="bg-[var(--color-charcoal)] text-white">
                Failed
              </option>
              <option value="running" className="bg-[var(--color-charcoal)] text-white">
                Running
              </option>
              <option value="pending" className="bg-[var(--color-charcoal)] text-white">
                Pending
              </option>
            </select>
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="p-1.5 rounded-md hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors"
              title="Refresh"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
            </button>
          </div>

          {/* Loading State */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-[var(--color-text-tertiary)]" />
            </div>
          ) : !data || data.executions.length === 0 ? (
            <div className="text-center py-6 text-xs text-[var(--color-text-tertiary)]">
              No executions yet
            </div>
          ) : (
            <>
              {/* Execution List */}
              <div className="space-y-2">
                {data.executions.map(execution => (
                  <div
                    key={execution.id}
                    className="rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] overflow-hidden"
                  >
                    {/* Execution Header */}
                    <button
                      onClick={() => toggleExecutionDetails(execution.id)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      {getStatusIcon(execution.status)}

                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs font-medium capitalize"
                            style={{ color: getStatusColor(execution.status) }}
                          >
                            {execution.status}
                          </span>
                          <span className="text-[10px] text-[var(--color-text-tertiary)]">
                            {formatDuration(execution.durationMs)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-[var(--color-text-tertiary)]">
                            {formatTimestamp(execution.startedAt)}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)]">
                            {getTriggerIcon(execution.triggerType)}
                            {getTriggerTypeLabel(execution.triggerType)}
                          </span>
                        </div>
                      </div>

                      <ChevronRight
                        size={14}
                        className={`text-[var(--color-text-tertiary)] transition-transform ${
                          expandedExecutionId === execution.id ? 'rotate-90' : ''
                        }`}
                      />
                    </button>

                    {/* Execution Details */}
                    {expandedExecutionId === execution.id && (
                      <div className="px-3 pb-3 space-y-2 border-t border-[var(--color-border)]">
                        {/* Error */}
                        {execution.error && (
                          <div className="mt-2 p-2 rounded bg-red-500/10 text-red-400 text-xs">
                            <strong>Error:</strong> {execution.error}
                          </div>
                        )}

                        {/* Input */}
                        {execution.input && Object.keys(execution.input).length > 0 && (
                          <div className="mt-2">
                            <div className="text-[10px] font-medium text-[var(--color-text-tertiary)] mb-1">
                              Input
                            </div>
                            <pre className="p-2 rounded bg-[var(--color-surface)] text-[10px] text-[var(--color-text-secondary)] font-mono overflow-x-auto">
                              {JSON.stringify(execution.input, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Output - Presentable View */}
                        {(execution.result ||
                          (execution.output && Object.keys(execution.output).length > 0)) && (
                          <ExecutionOutputView
                            output={execution.output}
                            result={execution.result}
                            artifacts={execution.artifacts}
                            files={execution.files}
                          />
                        )}

                        {/* Execution ID */}
                        <div className="text-[10px] text-[var(--color-text-tertiary)]">
                          ID: {execution.id}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Load More */}
              {data.has_more && (
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full py-2 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
                >
                  {isLoadingMore ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={12} className="animate-spin" />
                      Loading...
                    </span>
                  ) : (
                    'Load more...'
                  )}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
