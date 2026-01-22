import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { adminService } from '@/services/adminService';
import type {
  AdminModelView,
  ModelFilters,
  UpdateModelRequest,
  ModelAliasView,
} from '@/types/admin';
import { TierManagement } from '@/components/admin/TierManagement';
import {
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Search,
  Zap,
  Eye,
  MessageSquare,
  Wifi,
  Download,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

export const ModelManagement = () => {
  const [models, setModels] = useState<AdminModelView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [testingModels, setTestingModels] = useState<Set<string>>(new Set());

  // Filters
  const [filters, setFilters] = useState<ModelFilters>({
    provider: undefined,
    capability: undefined,
    tier: undefined,
    test_status: undefined,
    visibility: 'all',
    search: '',
  });

  // Modals
  const [showFetchModal, setShowFetchModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadModels();
    autoFetchAllProviders(); // Auto-fetch models from all providers on page load
  }, []);

  const loadModels = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await adminService.getModels();
      setModels(data || []);
    } catch (err) {
      console.error('Failed to load models:', err);
      setError('Failed to load models');
    } finally {
      setIsLoading(false);
    }
  };

  const autoFetchAllProviders = async () => {
    try {
      const config = await adminService.getProviders();
      const providers = config.providers || [];

      // Filter to enabled providers (exclude audio-only and image-only providers)
      const eligibleProviders = providers
        .filter(p => p.enabled && !p.audio_only && !p.image_only && p.id)
        .map(p => ({ id: p.id!, name: p.name }));

      if (eligibleProviders.length === 0) {
        console.log('No eligible providers found for auto-fetch');
        return;
      }

      console.log(`Auto-fetching models from ${eligibleProviders.length} provider(s)...`);

      // Fetch models from all providers in parallel
      const fetchPromises = eligibleProviders.map(async provider => {
        try {
          const result = await adminService.fetchModelsFromProvider(provider.id);
          console.log(`✅ Auto-fetched ${result.models_fetched} models from ${provider.name}`);
          return { success: true, provider: provider.name, count: result.models_fetched };
        } catch (err) {
          console.error(`Failed to auto-fetch from ${provider.name}:`, err);
          return { success: false, provider: provider.name, error: err };
        }
      });

      await Promise.all(fetchPromises);

      // Reload models to show newly fetched ones
      await loadModels();
      console.log('Auto-fetch completed for all providers');
    } catch (err) {
      console.error('Failed to auto-fetch models:', err);
      // Non-fatal: page will still show existing models
    }
  };

  const handleImportAliases = async () => {
    if (!confirm('Import all aliases from providers.json into the database?\n\nThis will sync any missing aliases and can be run safely multiple times (existing aliases will be skipped).')) {
      return;
    }

    try {
      const result = await adminService.importAliasesFromJSON();
      alert(result.message || 'Aliases imported successfully!');
      // Reload models to reflect any changes
      await loadModels();
    } catch (err: any) {
      console.error('Failed to import aliases:', err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Unknown error';
      alert(`Failed to import aliases:\n\n${errorMessage}`);
    }
  };

  const toggleRowExpansion = (modelId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(modelId)) {
      newExpanded.delete(modelId);
    } else {
      newExpanded.add(modelId);
    }
    setExpandedRows(newExpanded);
  };

  const toggleModelSelection = (modelId: string) => {
    const newSelected = new Set(selectedModels);
    if (newSelected.has(modelId)) {
      newSelected.delete(modelId);
    } else {
      newSelected.add(modelId);
    }
    setSelectedModels(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedModels.size === filteredModels.length) {
      setSelectedModels(new Set());
    } else {
      setSelectedModels(new Set(filteredModels.map(m => m.id)));
    }
  };

  const handleTestConnection = async (modelId: string) => {
    try {
      setTestingModels(prev => new Set(prev).add(modelId));
      const result = await adminService.testModelConnection(modelId);

      if (result.passed) {
        alert(`✅ Connection test passed!\nLatency: ${result.latency_ms}ms`);
      } else {
        alert(`❌ Connection test failed!\n${result.error || 'Unknown error'}`);
      }

      // Reload models to get updated test results
      await loadModels();
    } catch (err) {
      console.error('Test failed:', err);
      alert('Test failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setTestingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelId);
        return newSet;
      });
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!confirm(`Are you sure you want to delete model ${modelId}? This will remove it from both the database and providers.json file.`)) {
      return;
    }

    try {
      await adminService.deleteModel(modelId);
      alert('Model deleted successfully');
      await loadModels();
    } catch (err) {
      console.error('Failed to delete model:', err);
      alert('Failed to delete model: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleUpdateModel = async (modelId: string, updates: UpdateModelRequest) => {
    try {
      // Optimistic update - update local state immediately
      setModels(prevModels =>
        prevModels?.map(m =>
          m.id === modelId ? { ...m, ...updates } : m
        ) || null
      );

      // Send update to backend
      const updatedModel = await adminService.updateModel(modelId, updates);

      // Update with actual response from backend
      setModels(prevModels =>
        prevModels?.map(m =>
          m.id === modelId ? updatedModel : m
        ) || null
      );
    } catch (err) {
      console.error('Failed to update model:', err);
      setError('Failed to update model: ' + (err instanceof Error ? err.message : 'Unknown error'));
      // Revert optimistic update on error
      await loadModels();
    }
  };

  const filterModels = (models: AdminModelView[] | null | undefined) => {
    if (!models || !Array.isArray(models)) return [];
    return models.filter(model => {
      // Provider filter
      if (filters.provider && model.provider_id !== filters.provider) {
        return false;
      }

      // Capability filter
      if (filters.capability) {
        if (filters.capability === 'tools' && !model.supports_tools) return false;
        if (filters.capability === 'vision' && !model.supports_vision) return false;
        if (filters.capability === 'streaming' && !model.supports_streaming) return false;
      }

      // Visibility filter
      if (filters.visibility) {
        if (filters.visibility === 'visible' && !model.is_visible) return false;
        if (filters.visibility === 'hidden' && model.is_visible) return false;
      }

      // Search filter
      if (filters.search) {
        const query = filters.search.toLowerCase();
        const matchesId = model.id.toLowerCase().includes(query);
        const matchesName = model.name?.toLowerCase().includes(query);
        const matchesDisplayName = model.display_name?.toLowerCase().includes(query);
        const matchesDescription = model.description?.toLowerCase().includes(query);

        return matchesId || matchesName || matchesDisplayName || matchesDescription;
      }

      return true;
    });
  };

  const filteredModels = filterModels(models);
  const uniqueProviders = Array.from(
    new Map((models || []).map(m => [m.provider_id, { id: m.provider_id, name: m.provider_name }])).values()
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Model Management</h1>
        <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
          <Loader2 size={20} className="animate-spin" />
          <span>Loading models...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Model Management</h1>
        <div
          className="bg-[var(--color-error-light)] rounded-lg p-4"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <p className="text-[var(--color-error)]">{error}</p>
        </div>
        <button
          onClick={loadModels}
          className="px-4 py-2 bg-[var(--color-accent)] text-black rounded-lg hover:bg-[var(--color-accent-dark)] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Model Management</h1>
        <p className="text-[var(--color-text-secondary)] mt-2">
          Configure and manage AI models across all providers
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div
          className="bg-[var(--color-surface)] rounded-lg p-4"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <p className="text-sm text-[var(--color-text-tertiary)]">Total Models</p>
          <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{models.length}</p>
        </div>
        <div
          className="bg-[var(--color-surface)] rounded-lg p-4"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <p className="text-sm text-[var(--color-text-tertiary)]">Visible Models</p>
          <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">
            {models.filter(m => m.is_visible).length}
          </p>
        </div>
        <div
          className="bg-[var(--color-surface)] rounded-lg p-4"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <p className="text-sm text-[var(--color-text-tertiary)]">Providers</p>
          <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">
            {uniqueProviders.length}
          </p>
        </div>
        <div
          className="bg-[var(--color-surface)] rounded-lg p-4"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <p className="text-sm text-[var(--color-text-tertiary)]">Selected</p>
          <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">
            {selectedModels.size}
          </p>
        </div>
      </div>

      {/* Global Tier Management */}
      <TierManagement />

      {/* Filters & Actions */}
      <div
        className="bg-[var(--color-surface)] rounded-lg p-4"
        style={{ backdropFilter: 'blur(20px)' }}
      >
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search models by name, ID, or description..."
                value={filters.search}
                onChange={e => setFilters({ ...filters, search: e.target.value })}
                className="w-full pl-10 pr-4 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
          </div>

          {/* Provider Filter */}
          <select
            value={filters.provider || ''}
            onChange={e => setFilters({ ...filters, provider: e.target.value ? parseInt(e.target.value) : undefined })}
            className="px-4 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">All Providers</option>
            {uniqueProviders.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Capability Filter */}
          <select
            value={filters.capability || ''}
            onChange={e => setFilters({ ...filters, capability: e.target.value as any })}
            className="px-4 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">All Capabilities</option>
            <option value="tools">Tools</option>
            <option value="vision">Vision</option>
            <option value="streaming">Streaming</option>
          </select>

          {/* Visibility Filter */}
          <select
            value={filters.visibility || 'all'}
            onChange={e => setFilters({ ...filters, visibility: e.target.value as any })}
            className="px-4 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded-lg border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
          >
            <option value="all">All Models</option>
            <option value="visible">Visible Only</option>
            <option value="hidden">Hidden Only</option>
          </select>

          {/* Actions */}
          <button
            onClick={() => setShowFetchModal(true)}
            className="px-4 py-2 bg-[var(--color-accent)] text-black rounded-lg hover:bg-[var(--color-accent-dark)] transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Download size={18} />
            <span>Fetch Models</span>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-accent-light)] transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Plus size={18} />
            <span>Add Model</span>
          </button>

          <button
            onClick={handleImportAliases}
            className="px-4 py-2 bg-[var(--color-info)] text-white rounded-lg hover:bg-[var(--color-info-dark)] transition-colors flex items-center gap-2 whitespace-nowrap"
            title="Import aliases from providers.json into database"
          >
            <Download size={18} />
            <span>Import Aliases</span>
          </button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedModels.size > 0 && (
        <div
          className="bg-[var(--color-accent-light)] rounded-lg p-4 flex items-center justify-between"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              {selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setSelectedModels(new Set())}
              className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline"
            >
              Clear selection
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                const selectedIds = Array.from(selectedModels);
                try {
                  // Optimistic update
                  setModels(prevModels =>
                    prevModels?.map(m =>
                      selectedIds.includes(m.id) ? { ...m, is_visible: true } : m
                    ) || null
                  );
                  setSelectedModels(new Set());

                  await adminService.bulkUpdateVisibility({
                    model_ids: selectedIds,
                    visible: true,
                  });
                } catch (err) {
                  console.error('Failed to show models:', err);
                  setError('Failed to show selected models');
                  await loadModels(); // Revert on error
                }
              }}
              className="px-4 py-2 bg-[var(--color-success)] text-white rounded-lg hover:bg-[var(--color-success-dark)] transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Eye size={16} />
              Show Selected
            </button>
            <button
              onClick={async () => {
                const selectedIds = Array.from(selectedModels);
                try {
                  // Optimistic update
                  setModels(prevModels =>
                    prevModels?.map(m =>
                      selectedIds.includes(m.id) ? { ...m, is_visible: false } : m
                    ) || null
                  );
                  setSelectedModels(new Set());

                  await adminService.bulkUpdateVisibility({
                    model_ids: selectedIds,
                    visible: false,
                  });
                } catch (err) {
                  console.error('Failed to hide models:', err);
                  setError('Failed to hide selected models');
                  await loadModels(); // Revert on error
                }
              }}
              className="px-4 py-2 bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <XCircle size={16} />
              Hide Selected
            </button>
            <div className="w-px h-6 bg-[var(--color-border)]" />
            <button
              onClick={async () => {
                const selectedIds = Array.from(selectedModels);
                try {
                  // Optimistic update
                  setModels(prevModels =>
                    prevModels?.map(m =>
                      selectedIds.includes(m.id) ? { ...m, agents_enabled: true } : m
                    ) || null
                  );
                  setSelectedModels(new Set());

                  await adminService.bulkUpdateAgentsEnabled({
                    model_ids: selectedIds,
                    enabled: true,
                  });
                } catch (err) {
                  console.error('Failed to enable agents:', err);
                  setError('Failed to enable agents for selected models');
                  await loadModels(); // Revert on error
                }
              }}
              className="px-4 py-2 bg-[var(--color-accent)] text-black rounded-lg hover:bg-[var(--color-accent-dark)] transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <CheckCircle size={16} />
              Enable for Agents
            </button>
            <button
              onClick={async () => {
                const selectedIds = Array.from(selectedModels);
                try {
                  // Optimistic update
                  setModels(prevModels =>
                    prevModels?.map(m =>
                      selectedIds.includes(m.id) ? { ...m, agents_enabled: false } : m
                    ) || null
                  );
                  setSelectedModels(new Set());

                  await adminService.bulkUpdateAgentsEnabled({
                    model_ids: selectedIds,
                    enabled: false,
                  });
                } catch (err) {
                  console.error('Failed to disable agents:', err);
                  setError('Failed to disable agents for selected models');
                  await loadModels(); // Revert on error
                }
              }}
              className="px-4 py-2 bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <XCircle size={16} />
              Disable for Agents
            </button>
          </div>
        </div>
      )}

      {/* Models Table */}
      <div
        className="bg-[var(--color-surface)] rounded-lg overflow-hidden"
        style={{ backdropFilter: 'blur(20px)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left p-4">
                  <input
                    type="checkbox"
                    checked={selectedModels.size === filteredModels.length && filteredModels.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="text-left p-4 text-sm font-semibold text-[var(--color-text-primary)]">Model</th>
                <th className="text-left p-4 text-sm font-semibold text-[var(--color-text-primary)]">Provider</th>
                <th className="text-left p-4 text-sm font-semibold text-[var(--color-text-primary)]">Capabilities</th>
                <th className="text-left p-4 text-sm font-semibold text-[var(--color-text-primary)]">Status</th>
                <th className="text-left p-4 text-sm font-semibold text-[var(--color-text-primary)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-[var(--color-text-tertiary)]">
                    No models found matching your filters
                  </td>
                </tr>
              ) : (
                filteredModels.map(model => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    isExpanded={expandedRows.has(model.id)}
                    isSelected={selectedModels.has(model.id)}
                    isTesting={testingModels.has(model.id)}
                    onToggleExpansion={() => toggleRowExpansion(model.id)}
                    onToggleSelection={() => toggleModelSelection(model.id)}
                    onTestConnection={() => handleTestConnection(model.id)}
                    onDelete={() => handleDeleteModel(model.id)}
                    onUpdate={(updates) => handleUpdateModel(model.id, updates)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedModels.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--color-surface)] rounded-lg p-4 shadow-lg border border-[var(--color-border)]"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--color-text-primary)]">
              {selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setSelectedModels(new Set())}
              className="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showFetchModal && (
        <FetchModelsModal
          onClose={() => setShowFetchModal(false)}
          onSuccess={() => {
            setShowFetchModal(false);
            loadModels();
          }}
        />
      )}

      {showCreateModal && (
        <CreateModelModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadModels();
          }}
        />
      )}
    </div>
  );
};

// Model Row Component
interface ModelRowProps {
  model: AdminModelView;
  isExpanded: boolean;
  isSelected: boolean;
  isTesting: boolean;
  onToggleExpansion: () => void;
  onToggleSelection: () => void;
  onTestConnection: () => void;
  onDelete: () => void;
  onUpdate: (updates: UpdateModelRequest) => void;
}

const ModelRow = ({
  model,
  isExpanded,
  isSelected,
  isTesting,
  onToggleExpansion,
  onToggleSelection,
  onTestConnection,
  onDelete,
  onUpdate,
}: ModelRowProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedDisplayName, setEditedDisplayName] = useState(model.display_name || '');
  const [editedDescription, setEditedDescription] = useState(model.description || '');

  // Alias management state
  const [aliases, setAliases] = useState<ModelAliasView[]>([]);
  const [showAliasModal, setShowAliasModal] = useState(false);
  const [editingAlias, setEditingAlias] = useState<ModelAliasView | null>(null);
  const [loadingAliases, setLoadingAliases] = useState(false);

  // Load aliases when row is expanded
  useEffect(() => {
    if (isExpanded && aliases.length === 0) {
      loadAliases();
    }
  }, [isExpanded]);

  const loadAliases = async () => {
    try {
      setLoadingAliases(true);
      const data = await adminService.getModelAliases(model.id);
      // Ensure data is an array
      setAliases(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load aliases:', err);
      setAliases([]); // Reset to empty array on error
    } finally {
      setLoadingAliases(false);
    }
  };

  const handleDeleteAlias = async (alias: ModelAliasView) => {
    if (!confirm(`Delete alias "${alias.alias_name}"?`)) return;

    try {
      await adminService.deleteModelAlias(model.id, alias.alias_name, alias.provider_id);
      await loadAliases();
    } catch (err) {
      console.error('Failed to delete alias:', err);
      alert('Failed to delete alias');
    }
  };

  const handleEditAlias = (alias: ModelAliasView) => {
    setEditingAlias(alias);
    setShowAliasModal(true);
  };

  const handleAddAlias = () => {
    setEditingAlias(null);
    setShowAliasModal(true);
  };

  const handleSave = () => {
    onUpdate({
      display_name: editedDisplayName,
      description: editedDescription,
    });
    setIsEditing(false);
  };

  return (
    <>
      <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors">
        <td className="p-4">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelection}
            className="rounded"
          />
        </td>
        <td className="p-4">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleExpansion}
              className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <div
              onClick={onToggleExpansion}
              className="cursor-pointer flex-1"
            >
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {model.display_name || model.name}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{model.id}</p>
            </div>
          </div>
        </td>
        <td className="p-4">
          <span className="text-sm text-[var(--color-text-secondary)]">{model.provider_name}</span>
        </td>
        <td className="p-4">
          <div className="flex flex-wrap gap-1">
            {model.supports_tools && (
              <span className="px-2 py-1 bg-[var(--color-info-light)] text-[var(--color-info)] text-xs rounded">
                Tools
              </span>
            )}
            {model.supports_vision && (
              <span className="px-2 py-1 bg-[var(--color-success-light)] text-[var(--color-success)] text-xs rounded">
                Vision
              </span>
            )}
            {model.supports_streaming && (
              <span className="px-2 py-1 bg-[var(--color-accent-light)] text-[var(--color-accent)] text-xs rounded">
                Stream
              </span>
            )}
            {model.smart_tool_router && (
              <span className="px-2 py-1 bg-[var(--color-warning-light)] text-[var(--color-warning)] text-xs rounded">
                Smart Router
              </span>
            )}
          </div>
        </td>
        <td className="p-4">
          <button
            onClick={() => onUpdate({ is_visible: !model.is_visible })}
            data-tour="toggle-visibility"
            className={`flex items-center gap-1 text-sm px-3 py-1 rounded-lg transition-colors ${
              model.is_visible
                ? 'text-[var(--color-success)] bg-[var(--color-success-light)] hover:bg-[var(--color-success-alpha-20)]'
                : 'text-[var(--color-text-tertiary)] bg-[var(--color-surface-hover)] hover:bg-[var(--color-surface-active)]'
            }`}
            title={model.is_visible ? 'Click to hide' : 'Click to show'}
          >
            {model.is_visible ? (
              <>
                <Eye size={14} />
                Visible
              </>
            ) : (
              <>
                <XCircle size={14} />
                Hidden
              </>
            )}
          </button>
        </td>
        <td className="p-4">
          <div className="flex items-center gap-2">
            <button
              onClick={onTestConnection}
              disabled={isTesting}
              className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] rounded transition-colors disabled:opacity-50"
              title="Test Connection"
            >
              {isTesting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            </button>
            <button
              onClick={() => {
                if (!isExpanded) {
                  onToggleExpansion();
                }
                setIsEditing(!isEditing);
              }}
              className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] rounded transition-colors"
              title="Edit"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={onDelete}
              className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] hover:bg-[var(--color-surface-hover)] rounded transition-colors"
              title="Delete"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded Row */}
      {isExpanded && (
        <tr className="bg-[var(--color-surface-hover)]">
          <td colSpan={6} className="p-6">
            <div className="space-y-4">
              {/* Metadata Section */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Metadata</h3>
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-[var(--color-text-tertiary)] mb-1">
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={editedDisplayName}
                        onChange={e => setEditedDisplayName(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--color-text-tertiary)] mb-1">
                        Description
                      </label>
                      <textarea
                        value={editedDescription}
                        onChange={e => setEditedDescription(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-[var(--color-accent)] text-black rounded hover:bg-[var(--color-accent-dark)] transition-colors"
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="px-4 py-2 bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded hover:bg-[var(--color-surface-hover)] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--color-text-tertiary)]">Display Name:</span>
                      <span className="ml-2 text-[var(--color-text-primary)]">
                        {model.display_name || 'Not set'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-tertiary)]">Description:</span>
                      <span className="ml-2 text-[var(--color-text-primary)]">
                        {model.description || 'Not set'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-tertiary)]">Context Length:</span>
                      <span className="ml-2 text-[var(--color-text-primary)]">
                        {model.context_length || 'Unknown'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-tertiary)]">Fetched At:</span>
                      <span className="ml-2 text-[var(--color-text-primary)]">
                        {model.fetched_at ? new Date(model.fetched_at).toLocaleString() : 'Unknown'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Capabilities Grid */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Capabilities</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-tour="model-capabilities">
                  <CapabilityToggle
                    icon={<MessageSquare size={16} />}
                    label="Tools"
                    enabled={model.supports_tools}
                    onToggle={() => onUpdate({ supports_tools: !model.supports_tools })}
                  />
                  <CapabilityToggle
                    icon={<Eye size={16} />}
                    label="Vision"
                    enabled={model.supports_vision}
                    onToggle={() => onUpdate({ supports_vision: !model.supports_vision })}
                  />
                  <CapabilityToggle
                    icon={<Wifi size={16} />}
                    label="Streaming"
                    enabled={model.supports_streaming}
                    onToggle={() => onUpdate({ supports_streaming: !model.supports_streaming })}
                  />
                  <CapabilityToggle
                    icon={<Zap size={16} />}
                    label="Smart Router"
                    enabled={model.smart_tool_router || false}
                    onToggle={() => onUpdate({ smart_tool_router: !model.smart_tool_router })}
                  />
                </div>
              </div>

              {/* Aliases Section */}
              <div data-tour="model-aliases">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Aliases ({aliases.length})
                  </h3>
                  <button
                    onClick={handleAddAlias}
                    className="flex items-center gap-1 px-3 py-1 bg-[var(--color-accent)] text-black rounded hover:bg-[var(--color-accent-dark)] transition-colors text-sm"
                  >
                    <Plus size={14} />
                    Add Alias
                  </button>
                </div>

                {loadingAliases ? (
                  <div className="flex items-center gap-2 text-[var(--color-text-tertiary)] text-sm">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Loading aliases...</span>
                  </div>
                ) : aliases.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-tertiary)]">
                    No aliases yet. Add an alias to create alternative configurations for this model.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {Array.isArray(aliases) && aliases.map(alias => (
                      <div
                        key={alias.id}
                        className="flex items-start justify-between p-3 bg-[var(--color-surface)] rounded border border-[var(--color-border)]"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-[var(--color-text-primary)] text-sm">
                              {alias.alias_name}
                            </span>
                            <span className="text-xs text-[var(--color-text-tertiary)]">
                              → {alias.display_name}
                            </span>
                          </div>
                          {alias.description && (
                            <p className="text-xs text-[var(--color-text-secondary)] mb-2">
                              {alias.description}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {alias.agents_enabled && (
                              <span className="px-2 py-0.5 bg-[var(--color-accent-light)] text-[var(--color-accent)] text-xs rounded">
                                Agents
                              </span>
                            )}
                            {alias.supports_vision && (
                              <span className="px-2 py-0.5 bg-[var(--color-success-light)] text-[var(--color-success)] text-xs rounded">
                                Vision
                              </span>
                            )}
                            {alias.smart_tool_router && (
                              <span className="px-2 py-0.5 bg-[var(--color-info-light)] text-[var(--color-info)] text-xs rounded">
                                Smart Router
                              </span>
                            )}
                            {alias.free_tier && (
                              <span className="px-2 py-0.5 bg-[var(--color-warning-light)] text-[var(--color-warning)] text-xs rounded">
                                Free Tier
                              </span>
                            )}
                            {alias.memory_extractor && (
                              <span className="px-2 py-0.5 bg-[var(--color-info-light)] text-[var(--color-info)] text-xs rounded">
                                Memory Extractor
                              </span>
                            )}
                            {alias.memory_selector && (
                              <span className="px-2 py-0.5 bg-[var(--color-info-light)] text-[var(--color-info)] text-xs rounded">
                                Memory Selector
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-4">
                          <button
                            onClick={() => handleEditAlias(alias)}
                            className="p-1.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] rounded transition-colors"
                            title="Edit Alias"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteAlias(alias)}
                            className="p-1.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] hover:bg-[var(--color-surface-hover)] rounded transition-colors"
                            title="Delete Alias"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Alias Editor Modal */}
            {showAliasModal && (
              <AliasEditorModal
                modelId={model.id}
                providerId={model.provider_id}
                alias={editingAlias}
                onClose={() => {
                  setShowAliasModal(false);
                  setEditingAlias(null);
                }}
                onSuccess={() => {
                  setShowAliasModal(false);
                  setEditingAlias(null);
                  loadAliases();
                }}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
};

// Capability Toggle Component (clickable)
const CapabilityToggle = ({
  icon,
  label,
  enabled,
  onToggle
}: {
  icon: React.ReactNode;
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) => (
  <button
    onClick={onToggle}
    className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)] rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
  >
    <div className={enabled ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}>
      {icon}
    </div>
    <span className="text-sm text-[var(--color-text-primary)]">{label}</span>
    {enabled ? (
      <Check size={14} className="ml-auto text-[var(--color-success)]" />
    ) : (
      <X size={14} className="ml-auto text-[var(--color-text-tertiary)]" />
    )}
  </button>
);

// Fetch Models Modal
const FetchModelsModal = ({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) => {
  const [providers, setProviders] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedProvider, setSelectedProvider] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      const config = await adminService.getProviders();
      const providerList = config.providers
        .filter(p => p.enabled && !p.audio_only && !p.image_only && p.id)
        .map(p => ({ id: p.id!, name: p.name }));
      setProviders(providerList);
    } catch (err) {
      console.error('Failed to load providers:', err);
    }
  };

  const handleFetch = async () => {
    if (!selectedProvider) {
      alert('Please select a provider');
      return;
    }

    try {
      setIsFetching(true);
      const result = await adminService.fetchModelsFromProvider(selectedProvider);
      alert(`✅ Successfully fetched ${result.models_fetched} models`);
      onSuccess();
    } catch (err) {
      console.error('Failed to fetch models:', err);
      alert('Failed to fetch models: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[var(--color-surface)] rounded-lg p-6 max-w-md w-full"
        style={{ backdropFilter: 'blur(20px)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-4">Fetch Models from Provider</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-text-tertiary)] mb-2">
              Select Provider
            </label>
            <select
              value={selectedProvider || ''}
              onChange={e => setSelectedProvider(parseInt(e.target.value))}
              className="w-full px-3 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">Choose a provider...</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleFetch}
              disabled={!selectedProvider || isFetching}
              className="flex-1 px-4 py-2 bg-[var(--color-accent)] text-black rounded hover:bg-[var(--color-accent-dark)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isFetching ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Fetching...</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span>Fetch Models</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded hover:bg-[var(--color-surface)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Create Model Modal (Placeholder)
const CreateModelModal = ({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[var(--color-surface)] rounded-lg p-6 max-w-md w-full"
        style={{ backdropFilter: 'blur(20px)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-4">Create Model</h2>

        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Manual model creation coming soon. For now, use "Fetch Models" to import models from providers.
        </p>

        <button
          onClick={onClose}
          className="w-full px-4 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded hover:bg-[var(--color-surface)] transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};

// Alias Editor Modal
interface AliasEditorModalProps {
  modelId: string;
  providerId: number;
  alias: ModelAliasView | null;
  onClose: () => void;
  onSuccess: () => void;
}

const AliasEditorModal = ({ modelId, providerId, alias, onClose, onSuccess }: AliasEditorModalProps) => {
  const isEditing = !!alias;
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Alias modal tour
  useEffect(() => {
    const ALIAS_TOUR_KEY = 'admin_alias_modal_tour_completed';
    const hasCompletedAliasTour = localStorage.getItem(ALIAS_TOUR_KEY);

    if (!hasCompletedAliasTour && !isEditing) {
      const timer = setTimeout(() => {
        const driverObj = driver({
          showProgress: true,
          steps: [
            {
              popover: {
                title: 'Create Model Alias',
                description: 'Aliases let you create different configurations for the same model. Let\'s explore the capabilities you can configure.',
              },
            },
            {
              element: '[data-tour="alias-vision"]',
              popover: {
                title: 'Vision Support',
                description: 'Enable this if you want the model to analyze and understand images. Useful for models like GPT-4 Vision or Claude 3 with image capabilities.',
                side: 'top',
                align: 'start',
              },
            },
            {
              element: '[data-tour="alias-agents"]',
              popover: {
                title: 'Enable for Agents',
                description: 'Allow this model to be used by autonomous agents. Agents can use models to perform tasks and make decisions.',
                side: 'top',
                align: 'start',
              },
            },
            {
              element: '[data-tour="alias-smart-router"]',
              popover: {
                title: 'Smart Tool Router',
                description: 'Enables intelligent routing of tool calls. The model will automatically select the best tool for each task.',
                side: 'top',
                align: 'start',
              },
            },
            {
              element: '[data-tour="alias-free-tier"]',
              popover: {
                title: 'Free Tier',
                description: 'Mark this alias as available for free tier users. Useful for controlling costs by limiting expensive models.',
                side: 'top',
                align: 'start',
              },
            },
            {
              element: '[data-tour="alias-memory-extractor"]',
              popover: {
                title: 'Memory Extractor',
                description: 'Use this model to extract and store important information from conversations into long-term memory.',
                side: 'top',
                align: 'start',
              },
            },
            {
              element: '[data-tour="alias-memory-selector"]',
              popover: {
                title: 'Memory Selector',
                description: 'Use this model to select relevant memories when retrieving context for conversations.',
                side: 'top',
                align: 'start',
              },
            },
            {
              popover: {
                title: 'Ready to Create!',
                description: 'You can now configure your alias with the exact capabilities you need. Click "Create Alias" when ready.',
              },
            },
          ],
          onDestroyStarted: () => {
            localStorage.setItem(ALIAS_TOUR_KEY, 'true');
            driverObj.destroy();
          },
        });

        driverObj.drive();
      }, 600);

      return () => clearTimeout(timer);
    }
  }, [isEditing]);

  // Form state - alias_name is auto-populated with model ID and cannot be changed
  const [formData, setFormData] = useState({
    alias_name: alias?.alias_name || modelId, // Auto-populate with model ID for new aliases
    display_name: alias?.display_name || '',
    description: alias?.description || '',
    supports_vision: alias?.supports_vision || false,
    agents_enabled: alias?.agents_enabled || false,
    smart_tool_router: alias?.smart_tool_router || false,
    free_tier: alias?.free_tier || false,
    structured_output_support: alias?.structured_output_support || '',
    structured_output_compliance: alias?.structured_output_compliance || 0,
    structured_output_warning: alias?.structured_output_warning || '',
    structured_output_speed_ms: alias?.structured_output_speed_ms || 0,
    structured_output_badge: alias?.structured_output_badge || '',
    memory_extractor: alias?.memory_extractor || false,
    memory_selector: alias?.memory_selector || false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.alias_name.trim() || !formData.display_name.trim()) {
      alert('Alias name and display name are required');
      return;
    }

    try {
      setIsSaving(true);

      if (isEditing) {
        // Update existing alias
        await adminService.updateModelAlias(modelId, alias.alias_name, {
          display_name: formData.display_name,
          description: formData.description || undefined,
          supports_vision: formData.supports_vision,
          agents_enabled: formData.agents_enabled,
          smart_tool_router: formData.smart_tool_router,
          free_tier: formData.free_tier,
          structured_output_support: formData.structured_output_support || undefined,
          structured_output_compliance: formData.structured_output_compliance || undefined,
          structured_output_warning: formData.structured_output_warning || undefined,
          structured_output_speed_ms: formData.structured_output_speed_ms || undefined,
          structured_output_badge: formData.structured_output_badge || undefined,
          memory_extractor: formData.memory_extractor,
          memory_selector: formData.memory_selector,
        });
      } else {
        // Create new alias
        await adminService.createModelAlias(modelId, {
          alias_name: formData.alias_name,
          provider_id: providerId,
          display_name: formData.display_name,
          description: formData.description || undefined,
          supports_vision: formData.supports_vision,
          agents_enabled: formData.agents_enabled,
          smart_tool_router: formData.smart_tool_router,
          free_tier: formData.free_tier,
          structured_output_support: formData.structured_output_support || undefined,
          structured_output_compliance: formData.structured_output_compliance || undefined,
          structured_output_warning: formData.structured_output_warning || undefined,
          structured_output_speed_ms: formData.structured_output_speed_ms || undefined,
          structured_output_badge: formData.structured_output_badge || undefined,
          memory_extractor: formData.memory_extractor,
          memory_selector: formData.memory_selector,
        });
      }

      onSuccess();
    } catch (err) {
      console.error('Failed to save alias:', err);
      alert(`Failed to ${isEditing ? 'update' : 'create'} alias`);
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleRunTest = async () => {
    try {
      setIsTesting(true);
      console.log('Running benchmark for model:', modelId);

      const results = await adminService.runModelBenchmark(modelId);
      console.log('Benchmark results:', results);

      // Auto-populate structured output fields from benchmark results
      if (results.structured_output) {
        updateField('structured_output_compliance', results.structured_output.compliance_percentage || 0);
        updateField('structured_output_speed_ms', results.structured_output.average_speed_ms || 0);
        updateField('structured_output_support', results.structured_output.quality_level || 'unknown');

        // Generate badge based on quality
        const badges: Record<string, string> = {
          excellent: '🏆 Excellent',
          good: '✅ Good',
          fair: '⚠️ Fair',
          poor: '❌ Poor',
        };
        updateField('structured_output_badge', badges[results.structured_output.quality_level] || '');

        // Generate warning if needed
        if (results.structured_output.compliance_percentage < 80) {
          updateField('structured_output_warning', 'Lower compliance - may produce invalid JSON');
        } else {
          updateField('structured_output_warning', '');
        }

        alert(
          `Test completed!\n\n` +
          `Compliance: ${results.structured_output.compliance_percentage}%\n` +
          `Speed: ${results.structured_output.average_speed_ms}ms\n` +
          `Quality: ${results.structured_output.quality_level}\n` +
          `Passed: ${results.structured_output.tests_passed}/${results.structured_output.tests_passed + results.structured_output.tests_failed}`
        );
      } else {
        alert('Test completed, but no structured output results were returned. Check backend logs for details.');
      }
    } catch (err: any) {
      console.error('Failed to run benchmark:', err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Unknown error';
      alert(`Failed to run benchmark test:\n\n${errorMessage}\n\nCheck browser console and backend logs for details.`);
    } finally {
      setIsTesting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[var(--color-surface)] rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        style={{ backdropFilter: 'blur(20px)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-4">
          {isEditing ? 'Edit Alias' : 'Create Alias'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                Alias Name *
              </label>
              <input
                type="text"
                value={formData.alias_name}
                disabled
                readOnly
                required
                className="w-full px-3 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] opacity-60 cursor-not-allowed"
              />
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                Auto-populated from model ID (read-only)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                Display Name *
              </label>
              <input
                type="text"
                value={formData.display_name}
                onChange={e => updateField('display_name', e.target.value)}
                required
                placeholder="e.g., GPT-4 Turbo"
                className="w-full px-3 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                User-friendly name shown in the UI
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={e => updateField('description', e.target.value)}
              rows={3}
              placeholder="Optional description for this alias"
              className="w-full px-3 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          {/* Capabilities */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">Capabilities</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <label className="flex items-center gap-2 cursor-pointer" data-tour="alias-vision">
                <input
                  type="checkbox"
                  checked={formData.supports_vision}
                  onChange={e => updateField('supports_vision', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-[var(--color-text-primary)]">Supports Vision</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer" data-tour="alias-agents">
                <input
                  type="checkbox"
                  checked={formData.agents_enabled}
                  onChange={e => updateField('agents_enabled', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-[var(--color-text-primary)]">Enable for Agents</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer" data-tour="alias-smart-router">
                <input
                  type="checkbox"
                  checked={formData.smart_tool_router}
                  onChange={e => updateField('smart_tool_router', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-[var(--color-text-primary)]">Smart Tool Router</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer" data-tour="alias-free-tier">
                <input
                  type="checkbox"
                  checked={formData.free_tier}
                  onChange={e => updateField('free_tier', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-[var(--color-text-primary)]">Free Tier</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer" data-tour="alias-memory-extractor">
                <input
                  type="checkbox"
                  checked={formData.memory_extractor}
                  onChange={e => updateField('memory_extractor', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-[var(--color-text-primary)]">Memory Extractor</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer" data-tour="alias-memory-selector">
                <input
                  type="checkbox"
                  checked={formData.memory_selector}
                  onChange={e => updateField('memory_selector', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-[var(--color-text-primary)]">Memory Selector</span>
              </label>
            </div>
          </div>

          {/* Structured Output Settings */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Structured Output Settings
              </h3>
              <button
                type="button"
                onClick={handleRunTest}
                disabled={isTesting}
                className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-info)] text-white rounded hover:bg-[var(--color-info-dark)] transition-colors text-sm disabled:opacity-50"
              >
                {isTesting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    <span>Run Test</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[var(--color-text-tertiary)] mb-1">
                  Support Level
                </label>
                <select
                  value={formData.structured_output_support}
                  onChange={e => updateField('structured_output_support', e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">Unknown</option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-tertiary)] mb-1">
                  Compliance %
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={formData.structured_output_compliance}
                  onChange={e => updateField('structured_output_compliance', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-tertiary)] mb-1">
                  Speed (ms)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.structured_output_speed_ms}
                  onChange={e => updateField('structured_output_speed_ms', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-tertiary)] mb-1">
                  Badge
                </label>
                <input
                  type="text"
                  value={formData.structured_output_badge}
                  onChange={e => updateField('structured_output_badge', e.target.value)}
                  placeholder="e.g., 🏆 Excellent"
                  className="w-full px-3 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--color-text-tertiary)] mb-1">
                  Warning Message
                </label>
                <input
                  type="text"
                  value={formData.structured_output_warning}
                  onChange={e => updateField('structured_output_warning', e.target.value)}
                  placeholder="Optional warning about structured output limitations"
                  className="w-full px-3 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>

            <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
              Click "Run Test" to automatically populate these fields with benchmark results
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-[var(--color-accent)] text-black rounded hover:bg-[var(--color-accent-dark)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>{isEditing ? 'Update Alias' : 'Create Alias'}</span>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] rounded hover:bg-[var(--color-surface)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
