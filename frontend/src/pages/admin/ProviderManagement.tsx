import { useState, useEffect } from 'react';
import { adminService } from '@/services/adminService';
import type { ProvidersConfig, ProviderConfig, CreateProviderRequest } from '@/types/admin';
import { ProviderForm } from '@/components/admin';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Check,
  Circle,
  Shield,
  Mic,
  Image as ImageIcon,
  Star,
  Target,
  Zap,
  Sparkles,
  Bot,
  Eye,
  Database,
  Gift,
  ChevronDown,
  Search,
  Plus,
  Edit2,
  Trash2,
  Power,
} from 'lucide-react';

export const ProviderManagement = () => {
  const [providersConfig, setProvidersConfig] = useState<ProvidersConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Form and dialog states
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<{ name: string; id: number } | null>(null);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const config = await adminService.getProviders();
      // Normalize response: handle both array and object formats
      if (Array.isArray(config)) {
        setProvidersConfig({ providers: config });
      } else {
        setProvidersConfig(config);
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
      setError('Failed to load providers');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProvider = () => {
    setEditingProvider(null);
    setShowProviderForm(true);
  };

  const handleEditProvider = (provider: ProviderConfig) => {
    setEditingProvider(provider);
    setShowProviderForm(true);
  };

  const handleSaveProvider = async (data: CreateProviderRequest) => {
    if (editingProvider) {
      // Update existing provider - use actual database ID
      const provider = providersConfig?.providers.find(p => p.name === editingProvider.name);
      if (provider?.id) {
        await adminService.updateProvider(String(provider.id), data);
      }
      await loadProviders();
    } else {
      // Create new provider
      await adminService.addProvider(data);

      // Reload providers to get the new provider's ID
      await loadProviders();

      // Auto-fetch models from the newly created provider
      const updatedConfig = await adminService.getProviders();
      const providers = Array.isArray(updatedConfig) ? updatedConfig : updatedConfig.providers;
      const newProvider = providers?.find((p: ProviderConfig) => p.name === data.name);

      if (newProvider?.id) {
        try {
          console.log(`Auto-fetching models from provider: ${data.name} (ID: ${newProvider.id})`);
          await adminService.fetchModelsFromProvider(newProvider.id);
          console.log(`Successfully fetched models from ${data.name}`);
        } catch (err) {
          console.error(`Failed to auto-fetch models from ${data.name}:`, err);
          // Non-fatal: provider was created successfully, just model fetch failed
        }
      }
    }
  };

  const handleDeleteClick = (provider: ProviderConfig) => {
    if (provider.id) {
      setProviderToDelete({ name: provider.name, id: provider.id });
      setDeleteConfirmOpen(true);
    }
  };

  const handleDeleteConfirm = async () => {
    if (providerToDelete) {
      try {
        await adminService.deleteProvider(String(providerToDelete.id));
        await loadProviders();
      } catch (err) {
        console.error('Failed to delete provider:', err);
        setError('Failed to delete provider');
      }
    }
  };

  const handleToggleProvider = async (providerId: number, currentEnabled: boolean) => {
    try {
      await adminService.toggleProvider(String(providerId), !currentEnabled);
      await loadProviders();
    } catch (err) {
      console.error('Failed to toggle provider:', err);
      setError('Failed to toggle provider');
    }
  };

  const toggleProviderExpansion = (providerName: string) => {
    const newExpanded = new Set(expandedProviders);
    if (newExpanded.has(providerName)) {
      newExpanded.delete(providerName);
    } else {
      newExpanded.add(providerName);
    }
    setExpandedProviders(newExpanded);
  };

  const maskApiKey = (apiKey: string | undefined) => {
    if (!apiKey) return '***';
    if (apiKey.length <= 8) return '***';
    return '***' + apiKey.slice(-4);
  };

  const filterProviders = (providers: ProviderConfig[] | null | undefined) => {
    if (!providers || !Array.isArray(providers)) return [];
    return providers.filter(provider => {
      if (filter === 'enabled' && !provider.enabled) return false;
      if (filter === 'disabled' && provider.enabled) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = provider.name.toLowerCase().includes(query);
        const matchesModels = Object.values(provider.model_aliases || {}).some(
          model => model.display_name.toLowerCase().includes(query)
        );
        return matchesName || matchesModels;
      }

      return true;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Provider Management</h1>
        <p className="text-[var(--color-text-secondary)]">Loading providers...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Provider Management</h1>
        <div
          className="bg-[var(--color-error-light)] rounded-lg p-4"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <p className="text-[var(--color-error)]">{error}</p>
        </div>
        <button
          onClick={loadProviders}
          className="px-4 py-2 bg-[var(--color-accent)] text-black rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const filteredProviders = providersConfig ? filterProviders(providersConfig.providers) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Provider Management</h1>
          <p className="text-[var(--color-text-secondary)] mt-2">
            Manage AI providers and model configurations
          </p>
        </div>
        <button
          onClick={handleCreateProvider}
          data-tour="add-provider"
          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] text-black rounded-lg transition-colors font-medium"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <Plus size={18} />
          Add Provider
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          />
          <input
            type="text"
            placeholder="Search providers or models..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--color-surface)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:bg-[var(--color-surface-hover)] transition-colors"
            style={{ backdropFilter: 'blur(20px)' }}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              filter === 'all'
                ? 'bg-[var(--color-accent)] text-black'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
            style={{ backdropFilter: 'blur(20px)' }}
          >
            All ({providersConfig?.providers?.length || 0})
          </button>
          <button
            onClick={() => setFilter('enabled')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              filter === 'enabled'
                ? 'bg-[var(--color-success)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
            style={{ backdropFilter: 'blur(20px)' }}
          >
            Enabled ({providersConfig?.providers?.filter(p => p.enabled).length || 0})
          </button>
          <button
            onClick={() => setFilter('disabled')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              filter === 'disabled'
                ? 'bg-[var(--color-error)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
            style={{ backdropFilter: 'blur(20px)' }}
          >
            Disabled ({providersConfig?.providers?.filter(p => !p.enabled).length || 0})
          </button>
        </div>
      </div>

      {/* Providers List */}
      <div className="space-y-4">
        {filteredProviders.map((provider, index) => {
          const isExpanded = expandedProviders.has(provider.name);

          // Count models: check model_aliases first, then default_model, then filters
          let modelCount = 0;
          let modelSource: 'aliases' | 'default' | 'dynamic' | 'none' = 'none';

          if (provider.model_aliases && Object.keys(provider.model_aliases).length > 0) {
            modelCount = Object.keys(provider.model_aliases).length;
            modelSource = 'aliases';
          } else if (provider.default_model) {
            modelCount = 1;
            modelSource = 'default';
          } else if (provider.filters && provider.filters.length > 0) {
            modelSource = 'dynamic';
          }

          return (
            <div
              key={index}
              className="bg-[var(--color-surface)] rounded-lg overflow-hidden"
              style={{ backdropFilter: 'blur(20px)' }}
            >
              {/* Provider Header */}
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => toggleProviderExpansion(provider.name)}
                  >
                    <div className="flex items-center gap-3">
                      {provider.favicon && (
                        <img
                          src={provider.favicon}
                          alt={provider.name}
                          className="w-8 h-8 rounded"
                          onError={e => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}
                      <div>
                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                          {provider.name}
                        </h3>
                        <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
                          {provider.base_url}
                        </p>
                      </div>
                    </div>

                    {/* Provider Badges */}
                    <div className="flex flex-wrap gap-2 mt-3">
                      <span
                        className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded ${
                          provider.enabled
                            ? 'bg-[var(--color-success-light)] text-[var(--color-success)]'
                            : 'bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {provider.enabled ? (
                          <Check size={14} strokeWidth={2.5} />
                        ) : (
                          <Circle size={14} strokeWidth={2} />
                        )}
                        {provider.enabled ? 'Enabled' : 'Disabled'}
                      </span>

                      {provider.secure && (
                        <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded bg-[var(--color-info-light)] text-[var(--color-info)]">
                          <Shield size={14} strokeWidth={2} />
                          Private TEE
                        </span>
                      )}

                      {provider.audio_only && (
                        <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                          <Mic size={14} strokeWidth={2} />
                          Audio
                        </span>
                      )}

                      {provider.image_only && (
                        <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded bg-[var(--color-warning-light)] text-[var(--color-warning)]">
                          <ImageIcon size={14} strokeWidth={2} />
                          Image
                        </span>
                      )}

                      <span className="px-2 py-1 text-xs font-medium rounded bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]">
                        {modelSource === 'dynamic'
                          ? 'Dynamic Models'
                          : modelSource === 'default'
                            ? '1 Default Model'
                            : modelSource === 'aliases'
                              ? `${modelCount} ${modelCount === 1 ? 'Model' : 'Models'}`
                              : 'No Models'}
                      </span>
                    </div>

                    {/* API Key */}
                    <div className="mt-3">
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        API Key:{' '}
                        <code className="bg-[var(--color-background)] px-2 py-1 rounded ml-1 text-[var(--color-text-secondary)]">
                          {maskApiKey(provider.api_key)}
                        </code>
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 ml-4">
                    {/* Toggle Enable/Disable */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (provider.id) handleToggleProvider(provider.id, provider.enabled);
                      }}
                      className={`p-2 rounded-lg transition-colors ${
                        provider.enabled
                          ? 'text-[var(--color-success)] hover:bg-[var(--color-success-light)]'
                          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]'
                      }`}
                      title={provider.enabled ? 'Disable provider' : 'Enable provider'}
                    >
                      <Power size={18} />
                    </button>

                    {/* Edit Button */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleEditProvider(provider);
                      }}
                      className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-light)] rounded-lg transition-colors"
                      title="Edit provider"
                    >
                      <Edit2 size={18} />
                    </button>

                    {/* Delete Button */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDeleteClick(provider);
                      }}
                      className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-light)] rounded-lg transition-colors"
                      title="Delete provider"
                    >
                      <Trash2 size={18} />
                    </button>

                    {/* Expand Icon */}
                    <div
                      className="ml-2 cursor-pointer"
                      onClick={() => toggleProviderExpansion(provider.name)}
                    >
                      <ChevronDown
                        size={20}
                        className={`text-[var(--color-text-tertiary)] transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="bg-[var(--color-background)] p-6 space-y-4"
                     style={{ backdropFilter: 'blur(20px)' }}
                >
                  {/* Recommended Models */}
                  {provider.recommended_models && (
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                        Recommended:
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {provider.recommended_models.top && (
                          <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-[var(--color-warning-light)] text-[var(--color-warning)]">
                            <Star size={14} strokeWidth={2} />
                            {provider.recommended_models.top}
                          </span>
                        )}
                        {provider.recommended_models.medium && (
                          <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-[var(--color-info-light)] text-[var(--color-info)]">
                            <Target size={14} strokeWidth={2} />
                            {provider.recommended_models.medium}
                          </span>
                        )}
                        {provider.recommended_models.fastest && (
                          <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-[var(--color-success-light)] text-[var(--color-success)]">
                            <Zap size={14} strokeWidth={2} />
                            {provider.recommended_models.fastest}
                          </span>
                        )}
                        {provider.recommended_models.new && (
                          <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                            <Sparkles size={14} strokeWidth={2} />
                            {provider.recommended_models.new}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Default Model Display */}
                  {modelSource === 'default' && provider.default_model && (
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                        Default Model:
                      </h4>
                      <div className="bg-[var(--color-surface)] rounded-lg p-3">
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">
                          {provider.default_model}
                        </p>
                        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                          {provider.audio_only && 'Audio generation model'}
                          {provider.image_only && 'Image generation model'}
                          {provider.image_edit_only && 'Image editing model'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Dynamic Models Display */}
                  {modelSource === 'dynamic' && provider.filters && provider.filters.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                        Model Filters:
                      </h4>
                      <div className="space-y-2">
                        {provider.filters.map((filter, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-[var(--color-surface)] rounded-lg p-3">
                            <code className="text-xs bg-[var(--color-background)] px-2 py-1 rounded text-[var(--color-text-secondary)]">
                              {filter.pattern}
                            </code>
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded ${
                                filter.action === 'include'
                                  ? 'bg-[var(--color-success-light)] text-[var(--color-success)]'
                                  : 'bg-[var(--color-error-light)] text-[var(--color-error)]'
                              }`}
                            >
                              {filter.action}
                            </span>
                            <span className="text-xs text-[var(--color-text-tertiary)]">
                              Priority: {filter.priority}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Models Table */}
                  {modelSource === 'aliases' && provider.model_aliases && Object.keys(provider.model_aliases).length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="opacity-60">
                            <th className="text-left py-2 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                              Model
                            </th>
                            <th className="text-left py-2 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                              Capabilities
                            </th>
                            <th className="text-left py-2 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                              Output Quality
                            </th>
                            <th className="text-right py-2 text-xs font-medium text-[var(--color-text-tertiary)] uppercase">
                              Speed
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-surface-hover)]">
                          {Object.entries(provider.model_aliases).map(([modelId, model]) => (
                            <tr key={modelId}>
                              <td className="py-3">
                                <div className="text-sm font-medium text-[var(--color-text-primary)]">
                                  {model.display_name}
                                </div>
                                <div className="text-xs text-[var(--color-text-tertiary)] mt-1">
                                  {model.description}
                                </div>
                              </td>
                              <td className="py-3">
                                <div className="flex flex-wrap gap-1">
                                  {model.agents && (
                                    <span className="flex items-center justify-center p-1.5 rounded bg-[var(--color-accent-light)] text-[var(--color-accent)]" title="Agents">
                                      <Bot size={14} strokeWidth={2} />
                                    </span>
                                  )}
                                  {model.supports_vision && (
                                    <span className="flex items-center justify-center p-1.5 rounded bg-[var(--color-info-light)] text-[var(--color-info)]" title="Vision">
                                      <Eye size={14} strokeWidth={2} />
                                    </span>
                                  )}
                                  {model.memory_extractor && (
                                    <span className="flex items-center justify-center p-1.5 rounded bg-[var(--color-warning-light)] text-[var(--color-warning)]" title="Memory">
                                      <Database size={14} strokeWidth={2} />
                                    </span>
                                  )}
                                  {model.free_tier && (
                                    <span className="flex items-center justify-center p-1.5 rounded bg-[var(--color-success-light)] text-[var(--color-success)]" title="Free Tier">
                                      <Gift size={14} strokeWidth={2} />
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3">
                                {model.structured_output_support && (
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`px-2 py-1 text-xs font-medium rounded uppercase ${
                                        model.structured_output_support === 'excellent'
                                          ? 'bg-[var(--color-success-light)] text-[var(--color-success)]'
                                          : model.structured_output_support === 'good'
                                            ? 'bg-[var(--color-info-light)] text-[var(--color-info)]'
                                            : model.structured_output_support === 'fair'
                                              ? 'bg-[var(--color-warning-light)] text-[var(--color-warning)]'
                                              : 'bg-[var(--color-error-light)] text-[var(--color-error)]'
                                      }`}
                                    >
                                      {model.structured_output_support}
                                    </span>
                                    {model.structured_output_compliance !== undefined && (
                                      <span className="text-xs text-[var(--color-text-tertiary)]">
                                        {model.structured_output_compliance}%
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 text-right">
                                {model.structured_output_speed_ms && (
                                  <span className="text-sm text-[var(--color-text-secondary)]">
                                    {model.structured_output_speed_ms}ms
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {/* No Models Message */}
                  {modelSource === 'none' && (
                    <div className="text-center py-6">
                      <p className="text-sm text-[var(--color-text-tertiary)]">
                        {provider.audio_only
                          ? 'Audio provider - models loaded dynamically from API'
                          : provider.image_only
                            ? 'Image provider - models loaded dynamically from API'
                            : provider.image_edit_only
                              ? 'Image editing provider - models loaded dynamically from API'
                              : 'No models configured'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredProviders.length === 0 && (
        <div
          className="text-center py-12 bg-[var(--color-surface)] rounded-lg"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <p className="text-[var(--color-text-tertiary)]">
            No providers found matching your filters
          </p>
        </div>
      )}

      {/* Provider Form Modal */}
      <ProviderForm
        isOpen={showProviderForm}
        onClose={() => {
          setShowProviderForm(false);
          setEditingProvider(null);
        }}
        onSave={handleSaveProvider}
        provider={editingProvider}
        mode={editingProvider ? 'edit' : 'create'}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setProviderToDelete(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Provider"
        message={`Are you sure you want to delete "${providerToDelete?.name}"? This will also remove all associated models and cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
};
