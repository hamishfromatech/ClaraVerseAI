import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Blocks, Play, Settings, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentBuilderStore } from '@/store/useAgentBuilderStore';
import { workflowExecutionService } from '@/services/workflowExecutionService';
import { AgentChat } from './AgentChat';
import { MobileBlockListView } from './MobileBlockListView';
import { MobileExecutionOutput } from './MobileExecutionOutput';
import { BlockSettingsPanel } from './BlockSettingsPanel';

type MobileTab = 'chat' | 'blocks' | 'output';

interface MobileTabLayoutProps {
  onOpenSidebar?: () => void;
  onCloseSidebar?: () => void;
}

/**
 * Tabbed layout for mobile agent builder.
 * Provides navigation between Chat, Workflow Blocks, and Execution Output views.
 */
export function MobileTabLayout({ onOpenSidebar, onCloseSidebar }: MobileTabLayoutProps) {
  const {
    workflow,
    blockStates,
    executionStatus,
    selectedBlockId,
    selectBlock,
    currentAgent,
    saveCurrentAgent,
    clearExecution,
  } = useAgentBuilderStore();

  const [activeTab, setActiveTab] = useState<MobileTab>('chat');
  const [showBlockSettings, setShowBlockSettings] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // Auto-switch to output tab when execution starts
  useEffect(() => {
    if (executionStatus === 'running') {
      setActiveTab('output');
      setIsRunning(false); // Clear the "starting" state
    }
  }, [executionStatus]);

  // Handle block selection - show settings panel
  const handleBlockSelect = useCallback(
    (blockId: string) => {
      selectBlock(blockId);
      setShowBlockSettings(true);
    },
    [selectBlock]
  );

  // Close block settings
  const handleCloseBlockSettings = useCallback(() => {
    setShowBlockSettings(false);
    selectBlock(null);
  }, [selectBlock]);

  // Handle running the workflow
  const handleRunWorkflow = useCallback(async () => {
    if (!currentAgent?.id || !workflow || workflow.blocks.length === 0) return;

    setIsRunning(true);

    try {
      // Auto-save before running
      await saveCurrentAgent();

      // Get the updated agent
      const updatedAgent = useAgentBuilderStore.getState().currentAgent;
      if (!updatedAgent?.id) {
        throw new Error('Failed to save agent');
      }

      // Extract test input value from Start block
      const startBlock = workflow.blocks.find(
        block =>
          block.type === 'variable' &&
          block.config.type === 'variable' &&
          block.config.operation === 'read' &&
          block.config.variableName === 'input'
      );

      const workflowInput: Record<string, unknown> = {};
      if (startBlock && startBlock.config.type === 'variable') {
        const config = startBlock.config as {
          defaultValue?: string;
          inputType?: 'text' | 'file';
          fileValue?: {
            fileId: string;
            filename: string;
            mimeType: string;
            size: number;
            type: string;
          } | null;
        };

        // Check input type and pass appropriate value
        if (config.inputType === 'file' && config.fileValue) {
          // Pass file reference as input
          workflowInput.input = {
            file_id: config.fileValue.fileId,
            filename: config.fileValue.filename,
            mime_type: config.fileValue.mimeType,
            size: config.fileValue.size,
            type: config.fileValue.type,
          };
        } else if (config.defaultValue) {
          // Pass text as input
          workflowInput.input = config.defaultValue;
        }
      }

      await workflowExecutionService.executeWorkflow(updatedAgent.id, workflowInput);
    } catch (error) {
      console.error('Failed to execute workflow:', error);
      setIsRunning(false);
    }
  }, [currentAgent?.id, workflow, saveCurrentAgent]);

  // Handle stopping execution
  const handleStopExecution = useCallback(() => {
    workflowExecutionService.disconnect();
    clearExecution();
  }, [clearExecution]);

  // Tab configuration
  const tabs: { id: MobileTab; icon: React.ReactNode; label: string; badge?: number | boolean }[] =
    [
      {
        id: 'chat',
        icon: <MessageSquare size={20} />,
        label: 'Chat',
      },
      {
        id: 'blocks',
        icon: <Blocks size={20} />,
        label: 'Workflow',
        badge: workflow?.blocks?.length || 0,
      },
      {
        id: 'output',
        icon: <Play size={20} />,
        label: 'Output',
        badge: executionStatus === 'running',
      },
    ];

  const canRun = workflow && workflow.blocks.length > 0;
  const isExecuting = executionStatus === 'running';

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Tab content area */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' && (
          <AgentChat
            className="h-full"
            onOpenSidebar={onOpenSidebar}
            onCloseSidebar={onCloseSidebar}
          />
        )}

        {activeTab === 'blocks' && (
          <MobileBlockListView
            blocks={workflow?.blocks || []}
            connections={workflow?.connections || []}
            blockStates={blockStates}
            selectedBlockId={selectedBlockId}
            onBlockSelect={handleBlockSelect}
          />
        )}

        {activeTab === 'output' && <MobileExecutionOutput />}
      </div>

      {/* Floating Run Button - Only show on Workflow tab */}
      {canRun && activeTab === 'blocks' && (
        <div
          className="absolute bottom-20 right-4 z-40"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          {isExecuting ? (
            <button
              onClick={handleStopExecution}
              className="w-14 h-14 rounded-full bg-red-500 text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
              aria-label="Stop execution"
            >
              <Square size={22} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleRunWorkflow}
              disabled={isRunning}
              className={cn(
                'w-14 h-14 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform',
                isRunning
                  ? 'bg-[var(--color-accent)] text-black'
                  : 'bg-[var(--color-accent)] text-black'
              )}
              aria-label="Run workflow"
            >
              {isRunning ? (
                <Loader2 size={22} className="animate-spin" />
              ) : (
                <Play size={22} fill="currentColor" />
              )}
            </button>
          )}
        </div>
      )}

      {/* Bottom tab bar */}
      <div
        className="flex-shrink-0 flex border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          const showDot = tab.badge === true;
          const showCount = typeof tab.badge === 'number' && tab.badge > 0;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors relative',
                isActive
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-tertiary)] active:text-[var(--color-text-secondary)]'
              )}
            >
              <div className="relative">
                {tab.icon}
                {/* Running indicator dot */}
                {showDot && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                )}
                {/* Count badge */}
                {showCount && (
                  <span className="absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-[var(--color-accent)] text-black rounded-full flex items-center justify-center shadow-sm">
                    {tab.badge as number}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Block Settings Modal (full-screen on mobile) */}
      {showBlockSettings && selectedBlockId && (
        <MobileBlockSettingsModal onClose={handleCloseBlockSettings} />
      )}
    </div>
  );
}

/**
 * Full-screen modal wrapper for BlockSettingsPanel on mobile
 */
function MobileBlockSettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Solid background layer to ensure opacity */}
      <div className="absolute inset-0 bg-[#0a0a0a]" />
      {/* Glass effect layer */}
      <div className="absolute inset-0 bg-[var(--color-bg-secondary)]/80 backdrop-blur-xl" />

      {/* Header */}
      <header className="relative flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span className="text-sm font-medium">Back</span>
        </button>
        <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
          <Settings size={18} />
          <span className="text-sm font-semibold">Block Settings</span>
        </div>
        <div className="w-16" /> {/* Spacer for centering */}
      </header>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden">
        <BlockSettingsPanel className="h-full" />
      </div>
    </div>
  );
}
