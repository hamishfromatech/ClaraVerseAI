import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Rocket,
  Search,
  Loader2,
  CheckCircle,
  Clock,
  PauseCircle,
  FileCode,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Calendar,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentDeployPanel } from './AgentDeployPanel';
import { getAgentsPaginated, type AgentListItem } from '@/services/agentService';
import { getScheduleUsage, type ScheduleUsage } from '@/services/scheduleService';
import { api } from '@/services/api';
import { useIsMobile } from '@/hooks';
import { useAgentBuilderStore } from '@/store/useAgentBuilderStore';

interface DeployedListViewProps {
  className?: string;
  /** Initial agent ID to auto-select (from URL deep link) */
  initialAgentId?: string;
}

type StatusFilter = 'all' | 'deployed' | 'draft' | 'paused';

export function DeployedListView({ className, initialAgentId }: DeployedListViewProps) {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentListItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [scheduleUsage, setScheduleUsage] = useState<ScheduleUsage | null>(null);

  // Mobile detection
  const isMobile = useIsMobile();

  // Navigation and store
  const navigate = useNavigate();
  const { loadAgentFromBackend, setActiveView, trackAgentAccess } = useAgentBuilderStore();

  // Handle opening workflow editor
  const handleOpenWorkflow = useCallback(async () => {
    if (!selectedAgent) return;
    // Load the agent into the store and navigate to canvas
    trackAgentAccess(selectedAgent.id);
    await loadAgentFromBackend(selectedAgent.id);
    setActiveView('canvas');
    navigate(`/agents/builder/${selectedAgent.id}`);
  }, [selectedAgent, loadAgentFromBackend, setActiveView, trackAgentAccess, navigate]);

  // Collapsible section states - Live expanded by default, others collapsed
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    live: true,
    paused: false,
    drafts: false,
  });

  // Track which agent ID we've already processed for auto-selection
  const processedAgentIdRef = useRef<string | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const loadScheduleUsage = useCallback(async () => {
    try {
      const usage = await getScheduleUsage();
      setScheduleUsage(usage);
    } catch (error) {
      console.error('Failed to load schedule usage:', error);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getAgentsPaginated(100, 0);
      setAgents(response.agents);
      return response.agents;
    } catch (error) {
      console.error('Failed to load agents:', error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load agents, schedule usage, and auto-select from URL if provided
  useEffect(() => {
    const init = async () => {
      const loadedAgents = await loadAgents();
      await loadScheduleUsage();

      // Auto-select agent from URL if provided and not already processed
      if (
        initialAgentId &&
        processedAgentIdRef.current !== initialAgentId &&
        loadedAgents.length > 0
      ) {
        const agentFromUrl = loadedAgents.find(a => a.id === initialAgentId);
        if (agentFromUrl) {
          console.log('🔗 [DEPLOYED] Auto-selecting agent from URL:', initialAgentId);
          setSelectedAgent(agentFromUrl);
          processedAgentIdRef.current = initialAgentId;
        }
      }
    };
    init();
  }, [loadAgents, loadScheduleUsage, initialAgentId]);

  // Filter agents based on search and status
  const filteredAgents = agents.filter(agent => {
    const matchesSearch =
      !searchQuery ||
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (agent.description && agent.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || agent.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Group agents by status for display
  const deployedAgents = filteredAgents.filter(a => a.status === 'deployed');
  const draftAgents = filteredAgents.filter(a => a.status === 'draft');
  const pausedAgents = filteredAgents.filter(a => a.status === 'paused');

  const handleSelectAgent = (agent: AgentListItem) => {
    setSelectedAgent(agent);
  };

  // Mobile: go back to list
  const handleBackToList = () => {
    setSelectedAgent(null);
  };

  const handleDeploy = async () => {
    if (!selectedAgent) return;
    try {
      await api.put(`/api/agents/${selectedAgent.id}`, { status: 'deployed' });
      // Refresh the list and selected agent
      await loadAgents();
      setSelectedAgent(prev => (prev ? { ...prev, status: 'deployed' } : null));
    } catch (error) {
      console.error('Failed to deploy agent:', error);
    }
  };

  const handlePause = async () => {
    if (!selectedAgent) return;
    try {
      await api.put(`/api/agents/${selectedAgent.id}`, { status: 'paused' });
      // Refresh the list and selected agent
      await loadAgents();
      setSelectedAgent(prev => (prev ? { ...prev, status: 'paused' } : null));
    } catch (error) {
      console.error('Failed to pause agent:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'deployed':
        return <CheckCircle size={12} className="text-green-400" />;
      case 'paused':
        return <PauseCircle size={12} className="text-yellow-400" />;
      default:
        return <Clock size={12} className="text-[var(--color-text-tertiary)]" />;
    }
  };

  const getStatusCounts = () => {
    const deployed = agents.filter(a => a.status === 'deployed').length;
    const draft = agents.filter(a => a.status === 'draft').length;
    const paused = agents.filter(a => a.status === 'paused').length;
    return { deployed, draft, paused, total: agents.length };
  };

  const counts = getStatusCounts();

  // =============================================================================
  // MOBILE LAYOUT
  // =============================================================================
  if (isMobile) {
    // On mobile, show either list OR detail panel (not both)
    if (selectedAgent) {
      // Show detail panel with back button
      return (
        <div className={cn('flex flex-col h-full bg-[var(--color-bg-primary)]', className)}>
          {/* Mobile header with back button */}
          <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            <button
              onClick={handleBackToList}
              className="p-2 -ml-2 rounded-lg hover:bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--color-text-primary)] truncate">
                {selectedAgent.name}
              </h2>
              <div className="flex items-center gap-1.5">
                {getStatusIcon(selectedAgent.status)}
                <span className="text-xs text-[var(--color-text-tertiary)] capitalize">
                  {selectedAgent.status}
                </span>
              </div>
            </div>
          </div>

          {/* Full-screen deploy panel */}
          <div className="flex-1 overflow-hidden">
            <AgentDeployPanel
              agent={selectedAgent}
              onDeploy={handleDeploy}
              onPause={handlePause}
              onOpenWorkflow={handleOpenWorkflow}
              hideHeader
              isMobile
              className="h-full"
            />
          </div>
        </div>
      );
    }

    // Show full-width list
    return (
      <div className={cn('flex flex-col h-full bg-[var(--color-bg-primary)]', className)}>
        {/* Header */}
        <div className="flex-shrink-0 px-4 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Rocket size={18} className="text-[var(--color-accent)]" />
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
                Deployments
              </h2>
            </div>
            <button
              onClick={async () => {
                await loadAgents();
                await loadScheduleUsage();
              }}
              disabled={isLoading}
              className="p-1.5 rounded-lg hover:bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} />
            </button>
          </div>

          {/* Schedule Usage Indicator */}
          {scheduleUsage && (
            <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg bg-[var(--color-surface)]">
              <Calendar size={14} className="text-[var(--color-accent)]" />
              <span className="text-xs text-[var(--color-text-secondary)]">Schedules:</span>
              <span
                className={cn(
                  'text-xs font-medium',
                  scheduleUsage.canCreate ? 'text-[var(--color-text-primary)]' : 'text-amber-400'
                )}
              >
                {scheduleUsage.active}/{scheduleUsage.limit === -1 ? '∞' : scheduleUsage.limit}{' '}
                active
              </span>
              {scheduleUsage.paused > 0 && (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  ({scheduleUsage.paused} paused)
                </span>
              )}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search agents..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {/* Status Filter Pills - scrollable on mobile */}
          <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-1 -mb-1">
            <FilterPill
              label="All"
              count={counts.total}
              active={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
            />
            <FilterPill
              label="Live"
              count={counts.deployed}
              active={statusFilter === 'deployed'}
              onClick={() => setStatusFilter('deployed')}
              color="green"
            />
            <FilterPill
              label="Draft"
              count={counts.draft}
              active={statusFilter === 'draft'}
              onClick={() => setStatusFilter('draft')}
            />
            <FilterPill
              label="Paused"
              count={counts.paused}
              active={statusFilter === 'paused'}
              onClick={() => setStatusFilter('paused')}
              color="yellow"
            />
          </div>
        </div>

        {/* Agent List - full width on mobile */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-[var(--color-text-tertiary)]" />
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <FileCode size={32} className="text-[var(--color-text-tertiary)] opacity-50 mb-3" />
              <p className="text-sm text-[var(--color-text-secondary)] text-center">
                {searchQuery ? 'No agents match your search' : 'No agents found'}
              </p>
            </div>
          ) : (
            <div className="py-2">
              {/* Deployed Section */}
              {deployedAgents.length > 0 &&
                statusFilter !== 'draft' &&
                statusFilter !== 'paused' && (
                  <AgentSection
                    title="Live"
                    sectionKey="live"
                    agents={deployedAgents}
                    selectedId={selectedAgent?.id}
                    onSelect={handleSelectAgent}
                    getStatusIcon={getStatusIcon}
                    isExpanded={expandedSections.live}
                    onToggle={() => toggleSection('live')}
                  />
                )}

              {/* Paused Section */}
              {pausedAgents.length > 0 &&
                statusFilter !== 'draft' &&
                statusFilter !== 'deployed' && (
                  <AgentSection
                    title="Paused"
                    sectionKey="paused"
                    agents={pausedAgents}
                    selectedId={selectedAgent?.id}
                    onSelect={handleSelectAgent}
                    getStatusIcon={getStatusIcon}
                    isExpanded={expandedSections.paused}
                    onToggle={() => toggleSection('paused')}
                  />
                )}

              {/* Draft Section */}
              {draftAgents.length > 0 &&
                statusFilter !== 'deployed' &&
                statusFilter !== 'paused' && (
                  <AgentSection
                    title="Drafts"
                    sectionKey="drafts"
                    agents={draftAgents}
                    selectedId={selectedAgent?.id}
                    onSelect={handleSelectAgent}
                    getStatusIcon={getStatusIcon}
                    isExpanded={expandedSections.drafts}
                    onToggle={() => toggleSection('drafts')}
                  />
                )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // =============================================================================
  // DESKTOP LAYOUT (unchanged)
  // =============================================================================
  return (
    <div className={cn('flex h-full bg-[var(--color-bg-primary)]', className)}>
      {/* Left Panel - Agent List */}
      <div className="w-[320px] flex-shrink-0 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        {/* Header */}
        <div className="flex-shrink-0 px-4 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Rocket size={18} className="text-[var(--color-accent)]" />
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
                Deployments
              </h2>
            </div>
            <button
              onClick={async () => {
                await loadAgents();
                await loadScheduleUsage();
              }}
              disabled={isLoading}
              className="p-1.5 rounded-lg hover:bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} />
            </button>
          </div>

          {/* Schedule Usage Indicator */}
          {scheduleUsage && (
            <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg bg-[var(--color-surface)]">
              <Calendar size={14} className="text-[var(--color-accent)]" />
              <span className="text-xs text-[var(--color-text-secondary)]">Schedules:</span>
              <span
                className={cn(
                  'text-xs font-medium',
                  scheduleUsage.canCreate ? 'text-[var(--color-text-primary)]' : 'text-amber-400'
                )}
              >
                {scheduleUsage.active}/{scheduleUsage.limit === -1 ? '∞' : scheduleUsage.limit}{' '}
                active
              </span>
              {scheduleUsage.paused > 0 && (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  ({scheduleUsage.paused} paused)
                </span>
              )}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search agents..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {/* Status Filter Pills */}
          <div className="flex items-center gap-1.5 mt-3">
            <FilterPill
              label="All"
              count={counts.total}
              active={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
            />
            <FilterPill
              label="Live"
              count={counts.deployed}
              active={statusFilter === 'deployed'}
              onClick={() => setStatusFilter('deployed')}
              color="green"
            />
            <FilterPill
              label="Draft"
              count={counts.draft}
              active={statusFilter === 'draft'}
              onClick={() => setStatusFilter('draft')}
            />
            <FilterPill
              label="Paused"
              count={counts.paused}
              active={statusFilter === 'paused'}
              onClick={() => setStatusFilter('paused')}
              color="yellow"
            />
          </div>
        </div>

        {/* Agent List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-[var(--color-text-tertiary)]" />
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <FileCode size={32} className="text-[var(--color-text-tertiary)] opacity-50 mb-3" />
              <p className="text-sm text-[var(--color-text-secondary)] text-center">
                {searchQuery ? 'No agents match your search' : 'No agents found'}
              </p>
            </div>
          ) : (
            <div className="py-2">
              {/* Deployed Section */}
              {deployedAgents.length > 0 &&
                statusFilter !== 'draft' &&
                statusFilter !== 'paused' && (
                  <AgentSection
                    title="Live"
                    sectionKey="live"
                    agents={deployedAgents}
                    selectedId={selectedAgent?.id}
                    onSelect={handleSelectAgent}
                    getStatusIcon={getStatusIcon}
                    isExpanded={expandedSections.live}
                    onToggle={() => toggleSection('live')}
                  />
                )}

              {/* Paused Section */}
              {pausedAgents.length > 0 &&
                statusFilter !== 'draft' &&
                statusFilter !== 'deployed' && (
                  <AgentSection
                    title="Paused"
                    sectionKey="paused"
                    agents={pausedAgents}
                    selectedId={selectedAgent?.id}
                    onSelect={handleSelectAgent}
                    getStatusIcon={getStatusIcon}
                    isExpanded={expandedSections.paused}
                    onToggle={() => toggleSection('paused')}
                  />
                )}

              {/* Draft Section */}
              {draftAgents.length > 0 &&
                statusFilter !== 'deployed' &&
                statusFilter !== 'paused' && (
                  <AgentSection
                    title="Drafts"
                    sectionKey="drafts"
                    agents={draftAgents}
                    selectedId={selectedAgent?.id}
                    onSelect={handleSelectAgent}
                    getStatusIcon={getStatusIcon}
                    isExpanded={expandedSections.drafts}
                    onToggle={() => toggleSection('drafts')}
                  />
                )}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Agent Details */}
      <div className="flex-1">
        <AgentDeployPanel
          agent={selectedAgent}
          onDeploy={handleDeploy}
          onPause={handlePause}
          onOpenWorkflow={handleOpenWorkflow}
          className="h-full"
        />
      </div>
    </div>
  );
}

// Filter Pill Component
interface FilterPillProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: 'green' | 'yellow' | 'default';
}

function FilterPill({ label, count, active, onClick, color = 'default' }: FilterPillProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors',
        active
          ? 'bg-[var(--color-accent)] text-black'
          : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      )}
    >
      {label}
      <span
        className={cn(
          'px-1.5 py-0.5 rounded-full text-[10px]',
          active
            ? 'bg-white/20 text-white'
            : color === 'green'
              ? 'bg-green-500/20 text-green-400'
              : color === 'yellow'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-[var(--color-bg-primary)] text-[var(--color-text-tertiary)]'
        )}
      >
        {count}
      </span>
    </button>
  );
}

// Agent Section Component
interface AgentSectionProps {
  title: string;
  sectionKey: string;
  agents: AgentListItem[];
  selectedId?: string;
  onSelect: (agent: AgentListItem) => void;
  getStatusIcon: (status: string) => React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
}

function AgentSection({
  title,
  agents,
  selectedId,
  onSelect,
  getStatusIcon,
  isExpanded,
  onToggle,
}: AgentSectionProps) {
  if (agents.length === 0) return null;

  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="w-full px-4 py-1.5 flex items-center gap-1.5 hover:bg-[var(--color-surface)] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown size={12} className="text-[var(--color-text-tertiary)]" />
        ) : (
          <ChevronRight size={12} className="text-[var(--color-text-tertiary)]" />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
          {title} ({agents.length})
        </span>
      </button>
      {isExpanded &&
        agents.map(agent => (
          <button
            key={agent.id}
            onClick={() => onSelect(agent)}
            className={cn(
              'w-full px-4 py-2.5 text-left transition-colors',
              selectedId === agent.id
                ? 'bg-[var(--color-accent)]/10 border-l-2 border-[var(--color-accent)]'
                : 'hover:bg-[var(--color-surface)] border-l-2 border-transparent'
            )}
          >
            <div className="flex items-center gap-2">
              {getStatusIcon(agent.status)}
              <span
                className={cn(
                  'text-sm font-medium truncate',
                  selectedId === agent.id
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-text-primary)]'
                )}
              >
                {agent.name}
              </span>
            </div>
            {agent.description && (
              <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)] truncate pl-5">
                {agent.description}
              </p>
            )}
            <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-text-tertiary)] pl-5">
              <span>{agent.block_count} blocks</span>
              <span>•</span>
              <span>Updated {formatTimeAgo(agent.updated_at)}</span>
            </div>
          </button>
        ))}
    </div>
  );
}

// Helper function
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
