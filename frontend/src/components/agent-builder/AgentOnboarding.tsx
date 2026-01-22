import { useState, useEffect, useRef } from 'react';
import { ArrowRight, Loader2, ChevronDown, Sparkles, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentBuilderStore } from '@/store/useAgentBuilderStore';
import { useModelStore } from '@/store/useModelStore';
import { filterAgentModels } from '@/services/modelService';
import { ModelTooltip } from '@/components/ui/ModelTooltip';
import {
  generateWorkflowV2,
  getToolRegistry,
  isSuccessfulV2Generation,
  type GenerationStep,
  type SelectedTool,
  type ToolDefinition,
} from '@/services/workflowService';
import {
  addBuilderMessage as addBuilderMessageAPI,
  getOrCreateBuilderConversation,
} from '@/services/conversationService';
import { normalizeBlockName } from '@/utils/blockUtils';
import { AGENT_SUGGESTIONS, type AgentSuggestion } from './AgentChat';
import { ToolSelectionProgress } from './ToolSelectionProgress';
import type { Workflow, Block, Connection } from '@/types/agent';

// Helper to detect if input is needed (duplicated from AgentChat for now)
function detectRequiresInput(userMessage: string): boolean {
  const message = userMessage.toLowerCase();
  const noInputPatterns = [
    /\b(daily|every\s*day|everyday)\b/,
    /\b(hourly|every\s*hour)\b/,
    /\b(weekly|every\s*week)\b/,
    /\b(monthly|every\s*month)\b/,
    /\b(scheduled|schedule|cron)\b/,
    /\b(periodic|periodically)\b/,
    /\b(automatic|automated|automatically)\b/,
    /\bbot\s+that\s+(posts?|sends?|shares?)\b/,
    /\b(posts?|sends?|shares?)\s+(daily|hourly|weekly)\b/,
    /\b(notifier|notification|alert|alerts)\s+(for|when)\b/,
    /\bmonitor(s|ing)?\b/,
    /\b(reminder|reminders)\b/,
    /\b(motivational|inspirational)\s+quotes?\b/,
    /\bquote\s+of\s+the\s+day\b/,
    /\b(weather|news|stock)\s+(update|report|alert)/,
    /\btrending\s+news\b/,
  ];
  const inputNeededPatterns = [
    /\b(analyze|process|convert|summarize|review|check|read)\s+(this|the|my|a|an)\b/,
    /\b(upload|uploaded|file|document|pdf|csv|image|photo)\b/,
    /\bfrom\s+(user|input|text|file)\b/,
    /\bgiven\s+(a|the|some)\b/,
    /\bbased\s+on\s+(user|input|the)\b/,
    /\bask\s+(me|user|for)\b/,
    /\bwhen\s+(i|user)\s+(provide|give|enter|type)\b/,
  ];

  const matchesNoInput = noInputPatterns.some(pattern => pattern.test(message));
  const matchesNeedsInput = inputNeededPatterns.some(pattern => pattern.test(message));

  if (matchesNeedsInput && !matchesNoInput) return true;
  if (matchesNoInput && !matchesNeedsInput) return false;
  return true;
}

export function AgentOnboarding() {
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [localSelectedModelId, setLocalSelectedModelId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // V2 multi-step generation state
  const [generationSteps, setGenerationSteps] = useState<GenerationStep[]>([]);
  const [selectedTools, setSelectedTools] = useState<SelectedTool[]>([]);
  const [toolRegistry, setToolRegistry] = useState<ToolDefinition[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isGenerationComplete, setIsGenerationComplete] = useState(false);

  // Auto-resize textarea based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
    }
  };

  const {
    selectedAgentId,
    currentAgent,
    setActiveView,
    setWorkflow,
    addBuilderMessage,
    saveWorkflowVersion,
    saveCurrentAgent,
    updateAgent,
    createAgent,
  } = useAgentBuilderStore();

  const {
    selectedModelId,
    models,
    fetchModels,
    isLoading: modelsLoading,
    getDefaultModelForContext,
    setDefaultModelForContext,
  } = useModelStore();

  // Fetch models on mount
  useEffect(() => {
    if (models.length === 0) {
      fetchModels();
    }
  }, [models.length, fetchModels]);

  // Fetch tool registry on mount for floating icons
  useEffect(() => {
    const loadToolRegistry = async () => {
      try {
        const response = await getToolRegistry();
        if (response.tools) {
          setToolRegistry(response.tools);
        }
      } catch (err) {
        console.warn('Failed to load tool registry:', err);
      }
    };
    loadToolRegistry();
  }, []);

  // Initialize local model selection from builderMode default or fallback
  useEffect(() => {
    if (!localSelectedModelId && models.length > 0) {
      const defaultBuilderId = getDefaultModelForContext('builderMode');
      setLocalSelectedModelId(defaultBuilderId || selectedModelId || models[0]?.id || null);
    }
  }, [selectedModelId, models, localSelectedModelId, getDefaultModelForContext]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
        setModelSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get the currently selected model object
  const selectedModel = models.find(m => m.id === localSelectedModelId) || models[0];

  // Filter models: first filter by agents_enabled, then by search query
  const filteredModels = filterAgentModels(models).filter(
    model =>
      model.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
      model.id.toLowerCase().includes(modelSearchQuery.toLowerCase())
  );

  // Shuffle suggestions on mount
  useEffect(() => {
    const shuffled = [...AGENT_SUGGESTIONS].sort(() => 0.5 - Math.random()).slice(0, 3);
    setSuggestions(shuffled);
  }, []);

  // Auto-create agent if none selected (for first-time users)
  useEffect(() => {
    const autoCreateAgent = async () => {
      if (!selectedAgentId && !isGenerating) {
        console.log('🤖 [ONBOARDING] No agent selected, creating initial agent...');
        await createAgent('My Workflow', 'Created from onboarding');
      }
    };
    autoCreateAgent();
  }, [selectedAgentId, isGenerating, createAgent]);

  const handleGenerate = async (prompt: string) => {
    if (!prompt.trim() || !selectedAgentId) return;

    setIsGenerating(true);
    setIsGenerationComplete(false);
    setSelectedTools([]);
    setCurrentStep(0);

    // Initialize generation steps
    const initialSteps: GenerationStep[] = [
      {
        step_number: 1,
        step_name: 'Analyzing Request',
        status: 'running',
        description: 'Identifying the best tools for your workflow...',
      },
      {
        step_number: 2,
        step_name: 'Building Workflow',
        status: 'pending',
        description: 'Generating workflow structure with selected tools...',
      },
    ];
    setGenerationSteps(initialSteps);

    try {
      // 1. Add user message to local store immediately
      const userMsg = {
        role: 'user' as const,
        content: prompt,
        id: `msg-${Date.now()}`,
        timestamp: new Date(),
      };
      addBuilderMessage(userMsg);

      // 2. Persist user message to backend
      let conversationId: string | undefined;
      try {
        const modelId = localSelectedModelId || selectedModelId || models[0]?.id;
        const conversation = await getOrCreateBuilderConversation(selectedAgentId, modelId);
        if (conversation) {
          conversationId = conversation.id;
          await addBuilderMessageAPI(selectedAgentId, conversation.id, {
            role: 'user',
            content: prompt,
          });
        }
      } catch (err) {
        console.warn('Failed to persist user message:', err);
      }

      // 3. Generate workflow with V2 multi-step process
      const modelId = localSelectedModelId || selectedModelId || models[0]?.id;
      let response;
      let lastError;
      const MAX_RETRIES = 3;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          response = await generateWorkflowV2(
            selectedAgentId,
            prompt,
            undefined,
            modelId,
            // Progress callback to update UI as steps complete
            (steps, tools) => {
              setGenerationSteps(steps);
              if (tools && tools.length > 0) {
                setSelectedTools(tools);
              }
              // Find current running step
              const runningStep = steps.findIndex(s => s.status === 'running');
              setCurrentStep(runningStep >= 0 ? runningStep + 1 : steps.length);
            }
          );
          break; // Success, exit loop
        } catch (err) {
          lastError = err;
          console.warn(`Generation attempt ${attempt} failed:`, err);
          if (attempt < MAX_RETRIES) {
            // Exponential backoff: 1s, 2s, 4s...
            const delay = 1000 * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!response) {
        // Mark steps as failed
        setGenerationSteps(prev =>
          prev.map(s => (s.status === 'running' ? { ...s, status: 'failed' as const } : s))
        );
        throw lastError || new Error('Failed to generate workflow after retries');
      }

      if (isSuccessfulV2Generation(response) && response.workflow) {
        // Mark all steps as completed
        setGenerationSteps(prev => prev.map(s => ({ ...s, status: 'completed' as const })));
        setIsGenerationComplete(true);

        // Update selected tools from response
        if (response.selected_tools) {
          setSelectedTools(response.selected_tools);
        }

        const apiWorkflow = response.workflow;
        const timestamp = Date.now();
        const requiresInput = detectRequiresInput(prompt);

        // Create complete workflow object
        const newWorkflow: Workflow = {
          id: `workflow-${timestamp}`,
          blocks: apiWorkflow.blocks.map((block: Partial<Block>, index: number) => {
            const blockName = block.name || `Block ${index + 1}`;
            const isStartBlock = block.type === 'variable';
            const blockConfig = isStartBlock
              ? { ...block.config, type: block.type || 'variable', requiresInput }
              : block.config || { type: block.type || 'llm_inference' };

            return {
              id: block.id || `block-${timestamp}-${index}`,
              normalizedId: normalizeBlockName(blockName),
              type: block.type || 'llm_inference',
              name: blockName,
              description: block.description || '',
              config: blockConfig,
              position: block.position || { x: 250, y: 50 + index * 150 },
              timeout: block.timeout || 30,
            };
          }) as Block[],
          connections: (apiWorkflow.connections || []).map(
            (conn: Partial<Connection>, index: number) => ({
              id: conn.id || `conn-${timestamp}-${index}`,
              sourceBlockId: conn.sourceBlockId || '',
              sourceOutput: conn.sourceOutput || 'output',
              targetBlockId: conn.targetBlockId || '',
              targetInput: conn.targetInput || 'input',
            })
          ) as Connection[],
          variables: apiWorkflow.variables || [],
          version: 1,
        };

        // 4. Update store
        setWorkflow(newWorkflow);

        // 5. Save version and agent
        const versionDescription = `Created: ${response.explanation?.substring(0, 50) || 'Initial workflow'}...`;
        saveWorkflowVersion(versionDescription);
        await saveCurrentAgent(true, versionDescription);

        // 6. Update agent name/description if suggested
        if (currentAgent && (response.suggested_name || response.suggested_description)) {
          const updates: { name?: string; description?: string } = {};
          if (response.suggested_name) updates.name = response.suggested_name;
          if (response.suggested_description) updates.description = response.suggested_description;
          updateAgent(currentAgent.id, updates);
        }

        // 7. Add assistant message
        const assistantMsg = {
          role: 'assistant' as const,
          content: response.explanation || 'Workflow generated successfully.',
          workflowUpdate: {
            action: (response.action || 'create') as 'create' | 'modify',
            workflow: newWorkflow,
            explanation: `Created a ${newWorkflow.blocks.length}-block workflow.`,
          },
          id: `msg-${Date.now() + 1}`,
          timestamp: new Date(),
        };
        addBuilderMessage(assistantMsg);
        try {
          if (conversationId) {
            await addBuilderMessageAPI(selectedAgentId, conversationId, {
              role: 'assistant',
              content: assistantMsg.content,
              workflow_snapshot: {
                version: newWorkflow.version,
                action: response.action,
                explanation: assistantMsg.workflowUpdate.explanation,
              },
            });
          }
        } catch (err) {
          console.warn('Failed to persist assistant message:', err);
        }

        // 8. Brief delay to show completion state, then switch to canvas
        setTimeout(() => {
          // Onboarding guidance is deprecated - just switch to canvas
          setActiveView('canvas');
        }, 1500);
      }
    } catch (error) {
      console.error('Failed to generate workflow:', error);
      // Mark steps as failed
      setGenerationSteps(prev =>
        prev.map(s => (s.status === 'running' ? { ...s, status: 'failed' as const } : s))
      );
    } finally {
      // Don't immediately clear isGenerating to allow animation to complete
      setTimeout(() => {
        setIsGenerating(false);
      }, 2000);
    }
  };

  // Show generation progress UI
  if (isGenerating && generationSteps.length > 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[var(--color-bg-primary)] p-8 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[var(--color-accent)] opacity-[0.03] blur-[100px] rounded-full" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500 opacity-[0.03] blur-[100px] rounded-full" />
        </div>

        <div className="z-10 animate-in fade-in zoom-in duration-500">
          <ToolSelectionProgress
            steps={generationSteps}
            currentStep={currentStep}
            selectedTools={selectedTools}
            toolRegistry={toolRegistry}
            isComplete={isGenerationComplete}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-[var(--color-bg-primary)] p-8 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[var(--color-accent)] opacity-[0.03] blur-[100px] rounded-full" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500 opacity-[0.03] blur-[100px] rounded-full" />
      </div>

      <div className="max-w-2xl w-full z-10 flex flex-col gap-8 animate-in fade-in zoom-in duration-500">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-[var(--color-text-primary)] tracking-tight">
            What would you like to build?
          </h1>
          <p className="text-lg text-[var(--color-text-secondary)] max-w-lg mx-auto">
            Describe your workflow and I'll build the initial structure for you.
          </p>
        </div>

        {/* Model Selector */}
        <div className="flex justify-center">
          <div className="relative" ref={modelDropdownRef}>
            <button
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              disabled={isGenerating || modelsLoading}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all',
                'bg-[var(--color-surface-elevated)]',
                'hover:bg-[var(--color-surface)]',
                'text-sm font-medium text-[var(--color-text-secondary)]',
                isModelDropdownOpen && 'bg-[var(--color-surface)]',
                (isGenerating || modelsLoading) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {selectedModel?.provider_favicon ? (
                <img
                  src={selectedModel.provider_favicon}
                  alt={selectedModel.provider_name}
                  className="w-4 h-4 rounded"
                  onError={e => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <Sparkles size={16} className="text-[var(--color-accent)]" />
              )}
              <span className="text-[var(--color-text-tertiary)]">Using:</span>
              <span className="text-[var(--color-text-primary)] max-w-[200px] truncate">
                {modelsLoading ? 'Loading...' : selectedModel?.name || 'Select a model'}
              </span>
              <ChevronDown
                size={16}
                className={cn(
                  'text-[var(--color-text-tertiary)] transition-transform',
                  isModelDropdownOpen && 'rotate-180'
                )}
              />
            </button>

            {/* Model Dropdown */}
            {isModelDropdownOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-80 max-h-[400px] overflow-hidden rounded-lg bg-[var(--color-charcoal)]/95 backdrop-blur-xl shadow-2xl z-50">
                {/* Search */}
                <div className="p-2 bg-[var(--color-charcoal)]">
                  <div className="relative">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                    />
                    <input
                      type="text"
                      value={modelSearchQuery}
                      onChange={e => setModelSearchQuery(e.target.value)}
                      placeholder="Search models..."
                      className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--color-background)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Model List */}
                <div className="max-h-[300px] overflow-y-auto p-1 bg-[var(--color-charcoal)]">
                  {filteredModels.length === 0 ? (
                    <div className="px-3 py-4 text-center text-sm text-[var(--color-text-tertiary)]">
                      No models found
                    </div>
                  ) : (
                    filteredModels.map(model => {
                      return (
                        <ModelTooltip key={model.id} model={model}>
                          <button
                            onClick={() => {
                              setLocalSelectedModelId(model.id);
                              setDefaultModelForContext('builderMode', model.id);
                              setIsModelDropdownOpen(false);
                              setModelSearchQuery('');
                            }}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                              model.id === localSelectedModelId
                                ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                                : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
                            )}
                          >
                            {model.provider_favicon ? (
                              <img
                                src={model.provider_favicon}
                                alt={model.provider_name}
                                className="w-5 h-5 rounded flex-shrink-0"
                                onError={e => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <div className="w-5 h-5 rounded bg-[var(--color-accent)]/20 flex items-center justify-center flex-shrink-0">
                                <Sparkles size={12} className="text-[var(--color-accent)]" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate flex items-center gap-1.5">
                                {model.name}
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
                                      {model.structured_output_speed_ms < 2000 ? 'FASTEST' : 'FAST'}
                                    </span>
                                  )}
                              </div>
                              <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                                {model.id}
                              </div>
                            </div>
                            {model.id === localSelectedModelId && (
                              <div className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                            )}
                          </button>
                        </ModelTooltip>
                      );
                    })
                  )}
                </div>

                {/* Hint */}
                <div className="px-3 py-2 bg-[var(--color-surface-elevated)]">
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    This model will generate your workflow structure
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--color-accent)] to-blue-600 rounded-lg opacity-20 group-hover:opacity-40 transition duration-500 blur"></div>
          <div className="relative bg-[var(--color-surface)] rounded-lg shadow-2xl">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={e => {
                setInputValue(e.target.value);
                adjustTextareaHeight();
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate(inputValue);
                }
              }}
              placeholder="e.g. Create a Discord bot that summarizes Hacker News top stories every morning..."
              className="w-full bg-transparent text-[var(--color-text-primary)] p-6 text-lg placeholder:text-[var(--color-text-tertiary)] focus:outline-none resize-none min-h-[120px] max-h-[300px]"
              disabled={isGenerating}
            />
            <div className="flex justify-end items-center px-4 pb-4">
              <button
                onClick={() => handleGenerate(inputValue)}
                disabled={!inputValue.trim() || isGenerating}
                className="flex items-center gap-2 px-6 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Building...
                  </>
                ) : (
                  <>
                    Generate Workflow
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Suggestions - hide when user starts typing */}
        {!inputValue.trim() && (
          <div className="space-y-3 animate-in fade-in duration-300">
            <p className="text-sm font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider text-center">
              Try these examples
            </p>
            <div className="grid grid-cols-1 gap-3">
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => {
                    // Auto-generate when clicking a suggestion
                    setInputValue(suggestion.text);
                    handleGenerate(suggestion.text);
                  }}
                  disabled={isGenerating}
                  className="text-left p-4 rounded-lg bg-[var(--color-surface-elevated)] hover:bg-[var(--color-surface)] transition-all group"
                >
                  <span className="text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors">
                    {suggestion.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
