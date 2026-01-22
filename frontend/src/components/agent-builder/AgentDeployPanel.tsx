import { useState, useEffect, useCallback } from 'react';
import { Clock, Key, History, Rocket, Play, Pause, ExternalLink, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SchedulePanel } from './SchedulePanel';
import { ExecutionHistoryPanel } from './ExecutionHistoryPanel';
import { AgentAPIKeysPanel } from './AgentAPIKeysPanel';
import { AgentDocsPanel } from './AgentDocsPanel';
import { getAgentWorkflow, type AgentListItem } from '@/services/agentService';
import type { Workflow, Block } from '@/types/agent';

interface AgentDeployPanelProps {
  agent: AgentListItem | null;
  className?: string;
  onDeploy?: () => void;
  onPause?: () => void;
  /** Hide the header (for mobile when parent provides header with back button) */
  hideHeader?: boolean;
  /** Compact mode for mobile */
  isMobile?: boolean;
  /** Navigate to workflow editor */
  onOpenWorkflow?: () => void;
}

type Tab = 'schedule' | 'api-keys' | 'history' | 'docs';

// Helper to detect if workflow has file inputs in variable blocks
function hasFileInputInWorkflow(workflow: Workflow | null): boolean {
  if (!workflow) return false;
  return workflow.blocks.some((block: Block) => {
    const config = block.config as { inputType?: string };
    return block.type === 'variable' && config?.inputType === 'file';
  });
}

// Helper to extract Start block's default input from workflow
function extractStartBlockInput(workflow: Workflow | null): Record<string, unknown> | null {
  if (!workflow) {
    console.log('[extractStartBlockInput] No workflow provided');
    return null;
  }

  console.log('[extractStartBlockInput] Workflow blocks:', workflow.blocks);

  // Find the Start block (variable block with operation='read' and variableName='input')
  // Also check for name-based matching as a fallback
  const startBlock = workflow.blocks.find((block: Block) => {
    const config = block.config as {
      type?: string;
      operation?: string;
      variableName?: string;
      variable_name?: string; // Backend might use snake_case
    };

    // Log full config details
    console.log('[extractStartBlockInput] Checking block:', {
      name: block.name,
      blockType: block.type,
      configType: config?.type,
      operation: config?.operation,
      variableName: config?.variableName,
      variable_name: config?.variable_name,
      fullConfig: JSON.stringify(config),
    });

    // Check multiple possible structures (camelCase vs snake_case)
    const varName = config?.variableName || config?.variable_name;
    const isStart =
      block.type === 'variable' &&
      (config?.type === 'variable' || !config?.type) && // Backend might not include type
      config?.operation === 'read' &&
      varName === 'input';

    // Fallback: if block is named "Start" and is a variable type
    const isStartByName = block.type === 'variable' && block.name.toLowerCase().includes('start');

    console.log('[extractStartBlockInput] isStart:', isStart, 'isStartByName:', isStartByName);

    return isStart || isStartByName;
  });

  console.log('[extractStartBlockInput] Found start block:', startBlock);

  if (startBlock) {
    const config = startBlock.config as {
      defaultValue?: string;
      default_value?: string; // Backend might use snake_case
    };
    const defaultVal = config?.defaultValue || config?.default_value;

    console.log('[extractStartBlockInput] Start block config:', {
      defaultValue: config?.defaultValue,
      default_value: config?.default_value,
      resolvedValue: defaultVal,
    });

    if (defaultVal) {
      console.log('[extractStartBlockInput] Start block defaultValue:', defaultVal);
      // If defaultValue is a string, try to parse it as JSON
      if (typeof defaultVal === 'string') {
        try {
          return JSON.parse(defaultVal);
        } catch {
          return { input: defaultVal };
        }
      }
      return defaultVal as unknown as Record<string, unknown>;
    }
  }

  console.log('[extractStartBlockInput] No start block or no defaultValue found');
  return null;
}

export function AgentDeployPanel({
  agent,
  className,
  onDeploy,
  onPause,
  hideHeader = false,
  isMobile = false,
  onOpenWorkflow,
}: AgentDeployPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('schedule');
  const [startBlockInput, setStartBlockInput] = useState<Record<string, unknown> | null>(null);
  const [hasFileInput, setHasFileInput] = useState(false);

  // Fetch workflow when agent changes to extract start block input
  const fetchWorkflow = useCallback(async (agentId: string) => {
    console.log('[AgentDeployPanel] Fetching workflow for agent:', agentId);
    try {
      const wf = await getAgentWorkflow(agentId);
      console.log('[AgentDeployPanel] Fetched workflow:', wf);
      const input = extractStartBlockInput(wf);
      console.log('[AgentDeployPanel] Extracted start block input:', input);
      setStartBlockInput(input);
      setHasFileInput(hasFileInputInWorkflow(wf));
    } catch (err) {
      console.error('[AgentDeployPanel] Failed to fetch workflow:', err);
      setStartBlockInput(null);
      setHasFileInput(false);
    }
  }, []);

  useEffect(() => {
    if (agent?.id) {
      fetchWorkflow(agent.id);
    } else {
      setStartBlockInput(null);
      setHasFileInput(false);
    }
  }, [agent?.id, fetchWorkflow]);

  if (!agent) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center h-full bg-[var(--color-bg-secondary)]',
          className
        )}
      >
        <div className="text-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-surface)] flex items-center justify-center mb-4 mx-auto">
            <Rocket size={28} className="text-[var(--color-text-tertiary)]" />
          </div>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
            Select an Agent
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)] max-w-[280px]">
            Choose an agent from the list to view its deployment settings, schedules, and execution
            history.
          </p>
        </div>
      </div>
    );
  }

  const isDeployed = agent.status === 'deployed';
  const isPaused = agent.status === 'paused';

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'schedule', label: 'Schedule', icon: <Clock size={14} /> },
    { id: 'api-keys', label: 'API Keys', icon: <Key size={14} /> },
    { id: 'history', label: 'History', icon: <History size={14} /> },
    { id: 'docs', label: 'API Docs', icon: <Code2 size={14} /> },
  ];

  return (
    <div className={cn('flex flex-col h-full bg-[var(--color-bg-secondary)]', className)}>
      {/* Header - hidden on mobile when parent provides it */}
      {!hideHeader && (
        <div className="flex-shrink-0 px-6 py-5 border-b border-[var(--color-border)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)] truncate">
                  {agent.name}
                </h2>
                <span
                  className={cn(
                    'px-2 py-0.5 text-[10px] font-medium rounded-full',
                    isDeployed && 'bg-green-500/20 text-green-400',
                    isPaused && 'bg-yellow-500/20 text-yellow-400',
                    !isDeployed &&
                      !isPaused &&
                      'bg-[var(--color-surface)] text-[var(--color-text-tertiary)]'
                  )}
                >
                  {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
                </span>
              </div>
              {agent.description && (
                <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2">
                  {agent.description}
                </p>
              )}
              <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-text-tertiary)]">
                <span>{agent.block_count} blocks</span>
                <span>•</span>
                <span>Updated {formatTimeAgo(agent.updated_at)}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              {isDeployed ? (
                <button
                  onClick={onPause}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 text-yellow-400 text-sm font-medium hover:bg-yellow-500/20 transition-colors"
                >
                  <Pause size={14} />
                  Pause
                </button>
              ) : (
                <button
                  onClick={onDeploy}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-accent)] text-black text-sm font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
                >
                  <Play size={14} />
                  Deploy
                </button>
              )}
              <button
                onClick={() => setActiveTab('api-keys')}
                className="p-2 rounded-lg hover:bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors"
                title="API Keys"
              >
                <Key size={16} />
              </button>
              {onOpenWorkflow && (
                <button
                  onClick={onOpenWorkflow}
                  className="p-2 rounded-lg hover:bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors"
                  title="Open Workflow Editor"
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile action bar - shown when header is hidden */}
      {hideHeader && (
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
            <span>{agent.block_count} blocks</span>
            <span>•</span>
            <span>Updated {formatTimeAgo(agent.updated_at)}</span>
          </div>
          <div className="flex items-center gap-2">
            {isDeployed ? (
              <button
                onClick={onPause}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 text-xs font-medium"
              >
                <Pause size={12} />
                Pause
              </button>
            ) : (
              <button
                onClick={onDeploy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-black text-xs font-medium"
              >
                <Play size={12} />
                Deploy
              </button>
            )}
            <button
              onClick={() => setActiveTab('api-keys')}
              className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
              title="API Keys"
            >
              <Key size={14} />
            </button>
            {onOpenWorkflow && (
              <button
                onClick={onOpenWorkflow}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                title="Open Workflow Editor"
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tabs - scrollable on mobile */}
      <div
        className={cn(
          'flex-shrink-0 border-b border-[var(--color-border)]',
          isMobile ? 'px-2 overflow-x-auto' : 'px-6'
        )}
      >
        <div className={cn('flex', isMobile ? 'gap-0' : 'gap-1')}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 text-sm font-medium transition-colors relative whitespace-nowrap',
                isMobile ? 'px-3 py-2.5' : 'px-4 py-3 gap-2',
                activeTab === tab.id
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              )}
            >
              {tab.icon}
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-accent)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'schedule' && (
          <div className="p-0">
            <SchedulePanel
              agentId={agent.id}
              defaultExpanded
              className="border-b-0"
              startBlockInput={startBlockInput}
              hasFileInput={hasFileInput}
              agentStatus={agent.status as 'draft' | 'deployed' | 'paused'}
              onDeployAgent={
                onDeploy
                  ? async () => {
                      onDeploy();
                    }
                  : undefined
              }
            />
          </div>
        )}
        {activeTab === 'api-keys' && (
          <div className="p-6">
            <AgentAPIKeysPanel agentId={agent.id} />
          </div>
        )}
        {activeTab === 'history' && (
          <div className="p-0">
            <ExecutionHistoryPanelExpanded agentId={agent.id} />
          </div>
        )}
        {activeTab === 'docs' && (
          <AgentDocsPanel
            agentId={agent.id}
            agentName={agent.name}
            agentDescription={agent.description}
            hasFileInput={hasFileInput}
          />
        )}
      </div>
    </div>
  );
}

// Helper function to format time ago
function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Expanded version of ExecutionHistoryPanel for tab view (always expanded)
function ExecutionHistoryPanelExpanded({ agentId }: { agentId: string }) {
  return <ExecutionHistoryPanel agentId={agentId} defaultExpanded className="border-b-0" />;
}
