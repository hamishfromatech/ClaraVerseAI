/**
 * ModelSelectorModal Component
 *
 * Modal for browsing and searching all available models.
 * Opened from the "More models" option in the main dropdown.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Search, Check, Image, Shield } from 'lucide-react';
import { useModelStore } from '@/store/useModelStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { BadgeInfoModal, type BadgeType } from './BadgeInfoModal';
import type { Model } from '@/types/websocket';
import styles from './ModelSelectorModal.module.css';

interface ModelSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectModel: (modelId: string) => void;
  currentModelId: string | null;
}

export function ModelSelectorModal({
  isOpen,
  onClose,
  onSelectModel,
  currentModelId,
}: ModelSelectorModalProps) {
  const { models } = useModelStore();
  const { customProviders } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [badgeModalOpen, setBadgeModalOpen] = useState(false);
  const [badgeModalType, setBadgeModalType] = useState<BadgeType>('secure');
  const [badgeModalAnchor, setBadgeModalAnchor] = useState<DOMRect | null>(null);

  // Handle badge click to open info modal
  const handleBadgeClick = (e: React.MouseEvent, badgeType: BadgeType) => {
    e.stopPropagation(); // Prevent model selection
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setBadgeModalAnchor(rect);
    setBadgeModalType(badgeType);
    setBadgeModalOpen(true);
  };

  // Combine backend models with custom provider models
  const allModels = useMemo(() => {
    const backendModels = [...models];

    // Add models from all enabled custom providers
    customProviders.forEach(provider => {
      if (
        provider.enabled &&
        provider.baseUrl &&
        provider.apiKey &&
        provider.selectedModels.length > 0
      ) {
        provider.selectedModels.forEach(modelId => {
          const customModelId = `custom:${provider.id}:${modelId}`;
          if (!backendModels.some(m => m.id === customModelId)) {
            backendModels.unshift({
              id: customModelId,
              provider_id: 0,
              name: modelId,
              display_name: modelId,
              provider_name: provider.name || 'Custom Provider',
              provider_favicon: '',
              description: `From ${provider.name}`,
              isVisible: true,
              supports_vision: false,
              supports_tools: true,
              supports_streaming: true,
              provider_secure: false,
            });
          }
        });
      }
    });

    return backendModels;
  }, [models, customProviders]);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Filter models based on search query
  const filteredModels = allModels.filter(model => {
    const query = searchQuery.toLowerCase();
    return (
      model.display_name.toLowerCase().includes(query) ||
      model.name.toLowerCase().includes(query) ||
      model.provider_name.toLowerCase().includes(query) ||
      model.description?.toLowerCase().includes(query)
    );
  });

  // Group models by provider
  const groupedModels = filteredModels.reduce(
    (acc, model) => {
      if (!acc[model.provider_name]) {
        acc[model.provider_name] = [];
      }
      acc[model.provider_name].push(model);
      return acc;
    },
    {} as Record<string, Model[]>
  );

  const handleSelectModel = (modelId: string) => {
    onSelectModel(modelId);
    onClose();
  };

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Select a model</h2>
          <button onClick={onClose} className={styles.closeButton} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className={styles.searchContainer}>
          <Search size={18} className={styles.searchIcon} />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search models..."
            className={styles.searchInput}
          />
        </div>

        {/* Model List */}
        <div className={styles.modelList}>
          {filteredModels.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No models found matching "{searchQuery}"</p>
            </div>
          ) : (
            Object.entries(groupedModels).map(([providerName, providerModels]) => (
              <div key={providerName} className={styles.providerGroup}>
                <div className={styles.providerName}>{providerName}</div>
                {providerModels.map(model => (
                  <button
                    key={model.id}
                    onClick={() => handleSelectModel(model.id)}
                    className={`${styles.modelItem} ${currentModelId === model.id ? styles.selected : ''}`}
                  >
                    {model.provider_favicon && (
                      <img
                        src={model.provider_favicon}
                        alt={model.provider_name}
                        className={styles.providerIcon}
                        onError={e => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    <div className={styles.modelInfo}>
                      <div className={styles.modelNameRow}>
                        <span className={styles.modelName}>{model.display_name}</span>
                        <div className={styles.modelBadges}>
                          {model.supports_vision && (
                            <span
                              className={styles.badge}
                              onClick={e => handleBadgeClick(e, 'vision')}
                            >
                              <Image size={12} />
                            </span>
                          )}
                          {model.provider_secure && (
                            <span
                              className={`${styles.badge} ${styles.secureBadge}`}
                              onClick={e => handleBadgeClick(e, 'secure')}
                            >
                              <Shield size={12} />
                            </span>
                          )}
                        </div>
                      </div>
                      {(model.description || (model.recommendation_tier && typeof model.recommendation_tier === 'object' && model.recommendation_tier.description)) && (
                        <div className={styles.modelDescription}>
                          {model.description || (model.recommendation_tier && typeof model.recommendation_tier === 'object' ? model.recommendation_tier.description : '')}
                        </div>
                      )}
                    </div>
                    {currentModelId === model.id && (
                      <Check size={18} className={styles.checkIcon} />
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Badge Info Modal */}
      <BadgeInfoModal
        isOpen={badgeModalOpen}
        onClose={() => setBadgeModalOpen(false)}
        badgeType={badgeModalType}
        anchorRect={badgeModalAnchor}
      />
    </div>
  );
}
