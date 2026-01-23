import { useState, useEffect } from 'react';
import { adminService } from '@/services/adminService';
import type { TierAssignment, AdminModelView } from '@/types/admin';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Star, Diamond, Target, Zap, Sparkles, Edit2, X, Search } from 'lucide-react';

interface TierConfig {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  iconColor: string;
  bgColor: string;
}

const TIER_CONFIGS: TierConfig[] = [
  {
    key: 'tier1',
    label: 'Elite',
    description: 'Most powerful and capable models',
    icon: <Star size={20} strokeWidth={2} />,
    iconColor: 'text-[var(--color-warning)]',
    bgColor: 'bg-[var(--color-warning-light)]',
  },
  {
    key: 'tier2',
    label: 'Premium',
    description: 'High-quality professional models',
    icon: <Diamond size={20} strokeWidth={2} />,
    iconColor: 'text-[var(--color-info)]',
    bgColor: 'bg-[var(--color-info-light)]',
  },
  {
    key: 'tier3',
    label: 'Standard',
    description: 'Balanced performance and cost',
    icon: <Target size={20} strokeWidth={2} />,
    iconColor: 'text-[var(--color-accent)]',
    bgColor: 'bg-[var(--color-accent-light)]',
  },
  {
    key: 'tier4',
    label: 'Fast',
    description: 'Speed-optimized models',
    icon: <Zap size={20} strokeWidth={2} />,
    iconColor: 'text-[var(--color-success)]',
    bgColor: 'bg-[var(--color-success-light)]',
  },
  {
    key: 'tier5',
    label: 'New',
    description: 'Latest model additions',
    icon: <Sparkles size={20} strokeWidth={2} />,
    iconColor: 'text-[var(--color-text-secondary)]',
    bgColor: 'bg-[var(--color-surface-hover)]',
  },
];

export const TierManagement: React.FC = () => {
  const [tiers, setTiers] = useState<Record<string, TierAssignment>>({});
  const [models, setModels] = useState<AdminModelView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [selectedTierForEdit, setSelectedTierForEdit] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [tierToClear, setTierToClear] = useState<{ key: string; label: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadTiers();
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const modelData = await adminService.getModels();
      setModels(modelData || []);
    } catch (err) {
      console.error('Failed to load models:', err);
    }
  };

  const loadTiers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const tierData = await adminService.getTiers();
      setTiers(tierData || {});
    } catch (err) {
      console.error('Failed to load tiers:', err);
      setError('Failed to load global tiers');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssignModel = (tierKey: string) => {
    setSelectedTierForEdit(tierKey);
    setShowModelSelector(true);
  };

  const handleModelSelect = async (model: AdminModelView) => {
    if (!selectedTierForEdit) return;

    try {
      await adminService.setModelTier(model.id, model.provider_id, selectedTierForEdit);
      await loadTiers();
      setShowModelSelector(false);
      setSelectedTierForEdit(null);
      setSearchQuery('');
    } catch (err) {
      console.error('Failed to assign model to tier:', err);
      setError('Failed to assign model to tier. It may already be assigned to another tier.');
    }
  };

  const filteredModels = (models || []).filter(model => {
    if (!model.isVisible) return false;
    const query = searchQuery.toLowerCase();
    return (
      model.display_name.toLowerCase().includes(query) ||
      model.id.toLowerCase().includes(query) ||
      model.provider_name.toLowerCase().includes(query) ||
      model.description?.toLowerCase().includes(query)
    );
  });

  const handleClearClick = (tierKey: string, tierLabel: string) => {
    setTierToClear({ key: tierKey, label: tierLabel });
    setShowClearConfirm(true);
  };

  const handleClearConfirm = async () => {
    if (!tierToClear) return;

    try {
      await adminService.clearModelTier(tierToClear.key);
      await loadTiers();
      setShowClearConfirm(false);
      setTierToClear(null);
    } catch (err) {
      console.error('Failed to clear tier:', err);
      setError('Failed to clear tier assignment');
    }
  };

  if (isLoading) {
    return (
      <div className="bg-[var(--color-surface)] rounded-lg p-6" style={{ backdropFilter: 'blur(20px)' }}>
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          Global Model Recommendation Tiers
        </h3>
        <p className="text-[var(--color-text-secondary)]">Loading tiers...</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-6" style={{ backdropFilter: 'blur(20px)' }}>
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Global Model Recommendation Tiers
        </h3>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Only 5 models (one per tier) can be recommended across all providers
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-[var(--color-error-light)] text-[var(--color-error)] px-4 py-3 rounded-lg text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-3">
        {TIER_CONFIGS.map(tierConfig => {
          const assignment = tiers[tierConfig.key];
          const hasAssignment = !!assignment;

          return (
            <div
              key={tierConfig.key}
              className="flex items-center justify-between p-4 bg-[var(--color-background)] rounded-lg border border-[var(--color-surface-hover)] hover:border-[var(--color-accent)] transition-colors"
            >
              <div className="flex items-center gap-4 flex-1">
                {/* Tier Icon and Label */}
                <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${tierConfig.bgColor}`}>
                  <div className={tierConfig.iconColor}>{tierConfig.icon}</div>
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {tierConfig.label}
                    </h4>
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      ({tierConfig.key})
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    {tierConfig.description}
                  </p>

                  {/* Assigned Model */}
                  {hasAssignment ? (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-surface)] rounded-lg">
                        <span className="text-sm font-medium text-[var(--color-text-primary)]">
                          {assignment.display_name}
                        </span>
                        <span className="text-xs text-[var(--color-text-tertiary)]">
                          (ID: {assignment.model_id})
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-[var(--color-text-tertiary)] italic">
                      No model assigned
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {hasAssignment ? (
                  <>
                    <button
                      onClick={() => handleAssignModel(tierConfig.key)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] bg-[var(--color-surface)] hover:bg-[var(--color-accent-light)] rounded-lg transition-colors"
                      title="Change assigned model"
                    >
                      <Edit2 size={14} />
                      Change
                    </button>
                    <button
                      onClick={() => handleClearClick(tierConfig.key, tierConfig.label)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-error)] bg-[var(--color-surface)] hover:bg-[var(--color-error-light)] rounded-lg transition-colors"
                      title="Remove model from tier"
                    >
                      <X size={14} />
                      Clear
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleAssignModel(tierConfig.key)}
                    className="px-4 py-1.5 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-lg transition-colors"
                  >
                    Assign Model
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Model Selector Modal */}
      {showModelSelector && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => {
            setShowModelSelector(false);
            setSelectedTierForEdit(null);
            setSearchQuery('');
          }}
        >
          <div
            className="bg-[var(--color-surface)] rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col"
            style={{ backdropFilter: 'blur(20px)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 border-b border-[var(--color-surface-hover)]">
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                Select a model for {TIER_CONFIGS.find(t => t.key === selectedTierForEdit)?.label} tier
              </h3>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-[var(--color-surface-hover)]">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search models by name, ID, or provider..."
                  className="w-full pl-10 pr-4 py-2 bg-[var(--color-background)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  autoFocus
                />
              </div>
            </div>

            {/* Model List */}
            <div className="flex-1 overflow-y-auto p-4">
              {filteredModels.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-[var(--color-text-tertiary)]">
                    {searchQuery ? `No models found matching "${searchQuery}"` : 'No visible models available'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredModels.map(model => (
                    <button
                      key={model.id}
                      onClick={() => handleModelSelect(model)}
                      className="w-full p-3 bg-[var(--color-background)] hover:bg-[var(--color-surface-hover)] rounded-lg text-left transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-[var(--color-text-primary)]">
                            {model.display_name}
                          </div>
                          <div className="text-sm text-[var(--color-text-tertiary)] mt-1">
                            {model.provider_name} • {model.id}
                          </div>
                          {model.description && (
                            <div className="text-xs text-[var(--color-text-tertiary)] mt-1">
                              {model.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[var(--color-surface-hover)] flex justify-end">
              <button
                onClick={() => {
                  setShowModelSelector(false);
                  setSelectedTierForEdit(null);
                  setSearchQuery('');
                }}
                className="px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => {
          setShowClearConfirm(false);
          setTierToClear(null);
        }}
        onConfirm={handleClearConfirm}
        title="Clear Tier Assignment"
        message={`Are you sure you want to remove the model from ${tierToClear?.label} tier?`}
        confirmText="Clear"
        cancelText="Cancel"
        variant="warning"
      />
    </div>
  );
};
