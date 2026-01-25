import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bot,
  MessageSquare,
  Info,
  AlertCircle,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Server,
  Link as LinkIcon,
} from 'lucide-react';
import { useSettingsStore, encryptApiKey } from '@/store/useSettingsStore';
import type { CustomProvider } from '@/store/useSettingsStore';
import { useModelStore } from '@/store/useModelStore';
import { MemorySection } from '@/components/settings/MemorySection';
import { TranscriptionSection } from '@/components/settings/TranscriptionSection';
import { VoiceSection } from '@/components/settings/VoiceSection';
import { fetchToolPredictorModels } from '@/services/modelService';
import type { Model } from '@/types/websocket';

// Interface for fetched models from custom provider
interface FetchedModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

// New provider form state
interface NewProviderForm {
  name: string;
  baseUrl: string;
  apiKey: string;
  persistApiKey: boolean;
  selectedModels: string[];
  useAllModels: boolean;
  currentModelSelection: string;
}

const defaultNewProviderForm: NewProviderForm = {
  name: '',
  baseUrl: '',
  apiKey: '',
  persistApiKey: true,
  selectedModels: [],
  useAllModels: false,
  currentModelSelection: '',
};

export interface AIConfigSectionProps {
  /** Callback when settings change */
  onSave?: () => void;
}

/**
 * AI Configuration section component.
 * Manages model selection, system instructions, and custom providers.
 */
export const AIConfigSection: React.FC<AIConfigSectionProps> = ({ onSave }) => {
  // Provider tabs state
  const [providerTab, setProviderTab] = useState<'new' | 'list'>('new');
  const [providerSearchTerm, setProviderSearchTerm] = useState('');

  // Model dropdown state
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [modelImageErrors, setModelImageErrors] = useState<Record<string, boolean>>({});

  // Tool predictor model dropdown state
  const [toolPredictorDropdownOpen, setToolPredictorDropdownOpen] = useState(false);
  const [toolPredictorSearchTerm, setToolPredictorSearchTerm] = useState('');
  const [toolPredictorModels, setToolPredictorModels] = useState<Model[]>([]);

  // New provider form state
  const [newProviderForm, setNewProviderForm] = useState<NewProviderForm>(defaultNewProviderForm);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [fetchError, setFetchError] = useState('');
  const [showAddModelInput, setShowAddModelInput] = useState(false);
  const [customModelInput, setCustomModelInput] = useState('');
  const [newProviderModelDropdownOpen, setNewProviderModelDropdownOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef<HTMLButtonElement>(null);

  // Settings store
  const {
    defaultSystemInstructions,
    defaultModelId,
    toolPredictorModelId,
    customProviders,
    setDefaultSystemInstructions,
    setDefaultModelId,
    setToolPredictorModelId,
    addCustomProvider,
    updateCustomProvider,
    removeCustomProvider,
    setSessionApiKey,
    resetSettings,
  } = useSettingsStore();

  // Model store
  const { models, fetchModels, getSelectedModel, setSelectedModel } = useModelStore();
  const selectedModel = getSelectedModel();

  // Fetch models on mount
  useEffect(() => {
    if (models.length === 0) {
      fetchModels(true);
    }
  }, [models.length, fetchModels]);

  // Fetch tool predictor models separately for efficiency
  useEffect(() => {
    const loadToolPredictorModels = async () => {
      try {
        const predictorModels = await fetchToolPredictorModels();
        setToolPredictorModels(predictorModels);
      } catch (error) {
        console.error('Failed to fetch tool predictor models:', error);
        setToolPredictorModels([]);
      }
    };
    loadToolPredictorModels();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (modelDropdownOpen && !target.closest('.ai-config-model-dropdown-wrapper')) {
        setModelDropdownOpen(false);
        setSearchTerm('');
      }
      if (
        toolPredictorDropdownOpen &&
        !target.closest('.ai-config-tool-predictor-dropdown-wrapper')
      ) {
        setToolPredictorDropdownOpen(false);
        setToolPredictorSearchTerm('');
      }
      if (newProviderModelDropdownOpen && !target.closest('.ai-config-model-select-wrapper')) {
        setNewProviderModelDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modelDropdownOpen, toolPredictorDropdownOpen, newProviderModelDropdownOpen]);

  // Update dropdown position on scroll or resize
  useEffect(() => {
    const handleUpdatePosition = () => {
      if (newProviderModelDropdownOpen) {
        calculateDropdownPosition();
      }
    };

    window.addEventListener('scroll', handleUpdatePosition);
    window.addEventListener('resize', handleUpdatePosition);
    return () => {
      window.removeEventListener('scroll', handleUpdatePosition);
      window.removeEventListener('resize', handleUpdatePosition);
    };
  }, [newProviderModelDropdownOpen]);

  // Calculate dropdown position
  const calculateDropdownPosition = () => {
    if (dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const dropdownHeight = 300;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;

      const top =
        spaceBelow >= dropdownHeight || spaceBelow > spaceAbove
          ? rect.bottom + 8
          : rect.top - dropdownHeight - 8;

      setDropdownPosition({
        top,
        left: rect.left,
        width: rect.width,
      });
    }
  };

  // Handle system instructions change
  const handleSystemInstructionsChange = (value: string) => {
    setDefaultSystemInstructions(value);
    onSave?.();
  };

  // Handle default model change
  const handleDefaultModelChange = (modelId: string) => {
    setDefaultModelId(modelId);
    setSelectedModel(modelId);
    onSave?.();
  };

  // Handle tool predictor model change
  const handleToolPredictorModelChange = (modelId: string | null) => {
    setToolPredictorModelId(modelId);
    onSave?.();
  };

  // Get selected tool predictor model
  const selectedToolPredictorModel = toolPredictorModelId
    ? toolPredictorModels.find(m => m.id === toolPredictorModelId)
    : null;

  // Update new provider form
  const updateNewProviderForm = (
    field: keyof NewProviderForm,
    value: string | string[] | boolean
  ) => {
    setNewProviderForm(prev => ({ ...prev, [field]: value }));
  };

  // Fetch models for new provider
  const handleFetchModels = async () => {
    if (!newProviderForm.baseUrl) {
      setFetchError('Base URL is required');
      return;
    }

    setFetchingModels(true);
    setFetchError('');

    try {
      let baseUrl = newProviderForm.baseUrl.trim();
      if (!baseUrl.endsWith('/')) baseUrl += '/';

      const response = await fetch(`${baseUrl}models`, {
        headers: {
          Authorization: `Bearer ${newProviderForm.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const fetchedModelsList: FetchedModel[] = data.data || data.models || [];
      setFetchedModels(fetchedModelsList);

      if (fetchedModelsList.length > 0 && !newProviderForm.currentModelSelection) {
        updateNewProviderForm('currentModelSelection', fetchedModelsList[0].id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch models';
      setFetchError(errorMessage);
    } finally {
      setFetchingModels(false);
    }
  };

  // Add selected model to the list
  const handleAddModelToList = () => {
    const modelId = newProviderForm.currentModelSelection;
    if (!modelId) return;

    if (!newProviderForm.selectedModels.includes(modelId)) {
      updateNewProviderForm('selectedModels', [...newProviderForm.selectedModels, modelId]);
    }
  };

  // Add custom model manually
  const handleAddCustomModel = () => {
    const modelId = customModelInput.trim();
    if (!modelId) return;

    if (!fetchedModels.some(m => m.id === modelId)) {
      setFetchedModels(prev => [...prev, { id: modelId, owned_by: 'custom' }]);
    }

    if (!newProviderForm.selectedModels.includes(modelId)) {
      updateNewProviderForm('selectedModels', [...newProviderForm.selectedModels, modelId]);
    }

    setCustomModelInput('');
    setShowAddModelInput(false);
  };

  // Remove model from selected list
  const handleRemoveModelFromList = (modelId: string) => {
    updateNewProviderForm(
      'selectedModels',
      newProviderForm.selectedModels.filter(m => m !== modelId)
    );
  };

  // Toggle use all models
  const handleToggleUseAllModels = (checked: boolean) => {
    updateNewProviderForm('useAllModels', checked);
    if (checked && fetchedModels.length > 0) {
      updateNewProviderForm(
        'selectedModels',
        fetchedModels.map(m => m.id)
      );
    }
  };

  // Save provider as card
  const handleSaveProvider = () => {
    if (!newProviderForm.name || !newProviderForm.baseUrl || !newProviderForm.apiKey) {
      setFetchError('Please fill in Provider Name, Base URL, and API Key');
      return;
    }

    const modelsToSave = newProviderForm.useAllModels
      ? fetchedModels.map(m => m.id)
      : newProviderForm.selectedModels;

    if (modelsToSave.length === 0) {
      setFetchError('Please select at least one model');
      return;
    }

    const newProvider: CustomProvider = {
      id: `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: newProviderForm.name,
      baseUrl: newProviderForm.baseUrl,
      apiKey: newProviderForm.persistApiKey ? encryptApiKey(newProviderForm.apiKey) : '',
      persistApiKey: newProviderForm.persistApiKey,
      enabled: true,
      selectedModels: modelsToSave,
      useAllModels: newProviderForm.useAllModels,
    };

    addCustomProvider(newProvider);

    if (!newProviderForm.persistApiKey) {
      setSessionApiKey(newProvider.id, newProviderForm.apiKey);
    }

    setNewProviderForm(defaultNewProviderForm);
    setFetchedModels([]);
    setFetchError('');
    onSave?.();
  };

  // Delete a saved provider
  const handleDeleteProvider = (id: string) => {
    if (window.confirm('Are you sure you want to delete this provider?')) {
      removeCustomProvider(id);
      onSave?.();
    }
  };

  // Toggle provider enabled state
  const handleToggleProviderEnabled = (id: string, enabled: boolean) => {
    updateCustomProvider(id, { enabled });
    onSave?.();
  };

  // Handle reset
  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset all settings to defaults?')) {
      resetSettings();
      setNewProviderForm(defaultNewProviderForm);
      setFetchedModels([]);
      setFetchError('');
      onSave?.();
    }
  };

  // Handle image error
  const handleImageError = (modelId: string) => {
    setModelImageErrors(prev => ({ ...prev, [modelId]: true }));
  };

  const canSaveProvider =
    newProviderForm.name &&
    newProviderForm.baseUrl &&
    newProviderForm.apiKey &&
    (newProviderForm.useAllModels
      ? fetchedModels.length > 0
      : newProviderForm.selectedModels.length > 0);

  return (
    <div className="ai-config-page">
      <div className="ai-config-container">
        {/* Header */}
        <header className="ai-config-header">
          <div className="ai-config-title-section">
            <div className="ai-config-title-row">
              <div>
                <h1 className="ai-config-main-title">AI Configuration</h1>
                <p className="ai-config-subtitle">
                  Manage global preferences, system instructions, and third-party provider
                  credentials.
                </p>
              </div>
              <button className="ai-config-reset-btn" onClick={handleReset}>
                <span className="material-symbols-outlined ai-config-reset-icon">restart_alt</span>
                <span className="font-medium">Reset to Default</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="ai-config-main">
          {/* Global Preferences Section */}
          <div className="ai-config-global-prefs">
            <section className="ai-config-section">
              <div className="ai-config-section-header">
                <h2 className="ai-config-section-title">
                  <span className="material-symbols-outlined ai-config-section-icon">tune</span>
                  Global Preferences
                </h2>
              </div>
              <div className="ai-config-section-body">
                {/* Model Selector */}
                <div className="ai-config-model-selector">
                  <div className="ai-config-model-selector-header">
                    <label className="ai-config-model-label">Default Model</label>
                    <span className="ai-config-active-badge">Active</span>
                  </div>
                  <div className="ai-config-model-dropdown-wrapper">
                    <button
                      className="ai-config-model-dropdown"
                      onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                    >
                      <div className="ai-config-model-selected">
                        <div className="ai-config-model-icon">
                          {selectedModel?.provider_favicon &&
                          !modelImageErrors[selectedModel.id || ''] ? (
                            <img
                              src={selectedModel.provider_favicon}
                              alt={selectedModel.provider_name || 'Model provider'}
                              className="ai-config-model-icon-img"
                              onError={() => selectedModel.id && handleImageError(selectedModel.id)}
                            />
                          ) : (
                            <Bot size={20} className="ai-config-model-icon-fallback" />
                          )}
                        </div>
                        <div className="ai-config-model-info">
                          <span className="ai-config-model-name">
                            {selectedModel?.display_name || selectedModel?.name || 'Select a model'}
                          </span>
                          <span className="ai-config-model-id">
                            {selectedModel?.id || 'No model selected'}
                          </span>
                        </div>
                      </div>
                      <span
                        className="material-symbols-outlined ai-config-dropdown-arrow"
                        style={{
                          transform: modelDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                        }}
                      >
                        {modelDropdownOpen ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>

                    {/* Dropdown Menu */}
                    {modelDropdownOpen && (
                      <div className="ai-config-dropdown-menu" onClick={e => e.stopPropagation()}>
                        <div className="ai-config-dropdown-search">
                          <div className="ai-config-search-wrapper">
                            <span className="material-symbols-outlined ai-config-search-icon">
                              search
                            </span>
                            <input
                              type="text"
                              className="ai-config-search-input"
                              placeholder="Search models..."
                              value={searchTerm}
                              autoFocus
                              onChange={e => setSearchTerm(e.target.value.toLowerCase())}
                            />
                          </div>
                        </div>
                        <div className="ai-config-models-list">
                          <div className="ai-config-models-category">
                            <h4 className="ai-config-models-category-title">Available Models</h4>
                          </div>
                          {models
                            .filter(model => {
                              const matchesSearch =
                                searchTerm === '' ||
                                model.name.toLowerCase().includes(searchTerm) ||
                                model.id.toLowerCase().includes(searchTerm) ||
                                model.provider_name.toLowerCase().includes(searchTerm) ||
                                (model.display_name &&
                                  model.display_name.toLowerCase().includes(searchTerm));
                              return matchesSearch;
                            })
                            .map(model => (
                              <button
                                key={model.id}
                                className={`ai-config-model-option ${selectedModel?.id === model.id ? 'selected' : ''}`}
                                onClick={() => {
                                  handleDefaultModelChange(model.id);
                                  setModelDropdownOpen(false);
                                }}
                              >
                                <div className="ai-config-model-option-content">
                                  <div className="ai-config-model-option-icon">
                                    {model.provider_favicon && !modelImageErrors[model.id] ? (
                                      <img
                                        src={model.provider_favicon}
                                        alt={model.provider_name || 'Model provider'}
                                        className="ai-config-model-option-icon-img"
                                        onError={() => handleImageError(model.id)}
                                      />
                                    ) : (
                                      <Bot size={16} className="ai-config-model-icon-fallback" />
                                    )}
                                  </div>
                                  <div className="ai-config-model-option-info">
                                    <span className="ai-config-model-option-name">
                                      {model.display_name || model.name}
                                    </span>
                                    <span className="ai-config-model-option-id">{model.id}</span>
                                  </div>
                                </div>
                                {selectedModel?.id === model.id && (
                                  <span className="material-symbols-outlined ai-config-model-option-check">
                                    check_circle
                                  </span>
                                )}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="ai-config-divider"></div>

                {/* Tool Predictor Model Selector */}
                <div className="ai-config-model-selector">
                  <div className="ai-config-model-selector-header">
                    <label className="ai-config-model-label">Tool Predictor Model</label>
                    <span
                      className="ai-config-active-badge"
                      style={{ opacity: selectedToolPredictorModel ? 1 : 0.5 }}
                    >
                      {selectedToolPredictorModel ? 'Active' : 'Optional'}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: '0.875rem',
                      color: '#a1a1aa',
                      marginBottom: '0.75rem',
                      lineHeight: '1.5',
                    }}
                  >
                    Select a lightweight model to predict which tools are needed for each chat
                    request. This reduces context size and improves response quality.
                  </p>
                  <div className="ai-config-tool-predictor-dropdown-wrapper">
                    <button
                      className="ai-config-model-dropdown"
                      onClick={() => setToolPredictorDropdownOpen(!toolPredictorDropdownOpen)}
                    >
                      <div className="ai-config-model-selected">
                        <div className="ai-config-model-icon">
                          {selectedToolPredictorModel?.provider_favicon &&
                          !modelImageErrors[selectedToolPredictorModel.id || ''] ? (
                            <img
                              src={selectedToolPredictorModel.provider_favicon}
                              alt={selectedToolPredictorModel.provider_name || 'Model provider'}
                              className="ai-config-model-icon-img"
                              onError={() =>
                                selectedToolPredictorModel.id &&
                                handleImageError(selectedToolPredictorModel.id)
                              }
                            />
                          ) : (
                            <Bot size={20} className="ai-config-model-icon-fallback" />
                          )}
                        </div>
                        <div className="ai-config-model-info">
                          <span className="ai-config-model-name">
                            {selectedToolPredictorModel?.display_name ||
                              selectedToolPredictorModel?.name ||
                              'Auto (default)'}
                          </span>
                          <span className="ai-config-model-id">
                            {selectedToolPredictorModel?.id || 'Uses system default'}
                          </span>
                        </div>
                      </div>
                      <span
                        className="material-symbols-outlined ai-config-dropdown-arrow"
                        style={{
                          transform: toolPredictorDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                        }}
                      >
                        {toolPredictorDropdownOpen ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>

                    {/* Dropdown Menu */}
                    {toolPredictorDropdownOpen && (
                      <div className="ai-config-dropdown-menu" onClick={e => e.stopPropagation()}>
                        <div className="ai-config-dropdown-search">
                          <div className="ai-config-search-wrapper">
                            <span className="material-symbols-outlined ai-config-search-icon">
                              search
                            </span>
                            <input
                              type="text"
                              className="ai-config-search-input"
                              placeholder="Search tool predictor models..."
                              value={toolPredictorSearchTerm}
                              autoFocus
                              onChange={e =>
                                setToolPredictorSearchTerm(e.target.value.toLowerCase())
                              }
                            />
                          </div>
                        </div>
                        <div className="ai-config-models-list">
                          <div className="ai-config-models-category">
                            <h4 className="ai-config-models-category-title">Smart Tool Routers</h4>
                          </div>
                          {/* Auto/Default option */}
                          <button
                            className={`ai-config-model-option ${!toolPredictorModelId ? 'selected' : ''}`}
                            onClick={() => {
                              handleToolPredictorModelChange(null);
                              setToolPredictorDropdownOpen(false);
                            }}
                          >
                            <div className="ai-config-model-option-content">
                              <div className="ai-config-model-option-icon">
                                <Bot size={16} className="ai-config-model-icon-fallback" />
                              </div>
                              <div className="ai-config-model-option-info">
                                <span className="ai-config-model-option-name">Auto (default)</span>
                                <span className="ai-config-model-option-id">
                                  Uses system default
                                </span>
                              </div>
                            </div>
                            {!toolPredictorModelId && (
                              <span className="material-symbols-outlined ai-config-model-option-check">
                                check_circle
                              </span>
                            )}
                          </button>
                          {toolPredictorModels
                            .filter(model => {
                              const matchesSearch =
                                toolPredictorSearchTerm === '' ||
                                model.name.toLowerCase().includes(toolPredictorSearchTerm) ||
                                model.id.toLowerCase().includes(toolPredictorSearchTerm) ||
                                model.provider_name
                                  .toLowerCase()
                                  .includes(toolPredictorSearchTerm) ||
                                (model.display_name &&
                                  model.display_name
                                    .toLowerCase()
                                    .includes(toolPredictorSearchTerm));
                              return matchesSearch;
                            })
                            .map(model => (
                              <button
                                key={model.id}
                                className={`ai-config-model-option ${toolPredictorModelId === model.id ? 'selected' : ''}`}
                                onClick={() => {
                                  handleToolPredictorModelChange(model.id);
                                  setToolPredictorDropdownOpen(false);
                                }}
                              >
                                <div className="ai-config-model-option-content">
                                  <div className="ai-config-model-option-icon">
                                    {model.provider_favicon && !modelImageErrors[model.id] ? (
                                      <img
                                        src={model.provider_favicon}
                                        alt={model.provider_name || 'Model provider'}
                                        className="ai-config-model-option-icon-img"
                                        onError={() => handleImageError(model.id)}
                                      />
                                    ) : (
                                      <Bot size={16} className="ai-config-model-icon-fallback" />
                                    )}
                                  </div>
                                  <div className="ai-config-model-option-info">
                                    <span className="ai-config-model-option-name">
                                      {model.display_name || model.name}
                                    </span>
                                    <span className="ai-config-model-option-id">{model.id}</span>
                                  </div>
                                </div>
                                {toolPredictorModelId === model.id && (
                                  <span className="material-symbols-outlined ai-config-model-option-check">
                                    check_circle
                                  </span>
                                )}
                              </button>
                            ))}
                          {toolPredictorModels.filter(model => {
                            const matchesSearch =
                              toolPredictorSearchTerm === '' ||
                              model.name.toLowerCase().includes(toolPredictorSearchTerm) ||
                              model.id.toLowerCase().includes(toolPredictorSearchTerm) ||
                              model.provider_name.toLowerCase().includes(toolPredictorSearchTerm) ||
                              (model.display_name &&
                                model.display_name.toLowerCase().includes(toolPredictorSearchTerm));
                            return matchesSearch;
                          }).length === 0 && (
                            <div
                              style={{
                                padding: '1rem',
                                textAlign: 'center',
                                color: '#a1a1aa',
                                fontSize: '0.875rem',
                              }}
                            >
                              No smart tool router models found
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="ai-config-divider"></div>

                {/* System Instructions */}
                <div className="ai-config-system-instructions">
                  <div className="ai-config-instructions-header">
                    <label className="ai-config-model-label">System Instructions</label>
                    <div className="ai-config-saved-indicator" title="Changes saved automatically">
                      <span className="material-symbols-outlined ai-config-saved-icon">
                        check_circle
                      </span>
                      <span className="ai-config-saved-text">Saved</span>
                    </div>
                  </div>
                  <div className="ai-config-textarea-wrapper">
                    <div className="ai-config-textarea-bg"></div>
                    <textarea
                      className="ai-config-textarea"
                      value={defaultSystemInstructions}
                      onChange={e => handleSystemInstructionsChange(e.target.value)}
                      placeholder="You are a helpful AI assistant designed to assist developers..."
                    />
                    <span className="material-symbols-outlined ai-config-drag-handle">
                      drag_handle
                    </span>
                  </div>
                  <p className="ai-config-instructions-hint">
                    These instructions are injected into the context window for every new session.
                    Individual agents may override this behavior.
                  </p>
                </div>

                {/* Divider */}
                <div className="ai-config-divider"></div>

                {/* Memory System */}
                <MemorySection onSave={onSave} />

                {/* Divider */}
                <div className="ai-config-divider"></div>

                {/* Transcription Settings */}
                <TranscriptionSection onSave={onSave} />

                {/* Divider */}
                <div className="ai-config-divider"></div>

                {/* Voice Settings */}
                <VoiceSection onSave={onSave} />
              </div>
            </section>
          </div>

          {/* Configure Provider Section */}
          <div className="ai-config-provider-section">
            <section className="ai-config-section ai-config-provider-tabbed">
              {/* Tab Navigation */}
              <nav className="ai-config-provider-tabs">
                <input
                  type="radio"
                  id="tab-new"
                  name="provider-tabs"
                  className="ai-config-tab-radio"
                  checked={providerTab === 'new'}
                  onChange={() => setProviderTab('new')}
                />
                <input
                  type="radio"
                  id="tab-list"
                  name="provider-tabs"
                  className="ai-config-tab-radio"
                  checked={providerTab === 'list'}
                  onChange={() => setProviderTab('list')}
                />

                <label
                  htmlFor="tab-new"
                  className={`ai-config-tab-label ${providerTab === 'new' ? 'active' : ''}`}
                >
                  <span className="material-symbols-outlined ai-config-tab-icon">add_circle</span>
                  Add New Provider
                </label>

                <div className="ai-config-tab-divider"></div>

                <label
                  htmlFor="tab-list"
                  className={`ai-config-tab-label ${providerTab === 'list' ? 'active' : ''}`}
                >
                  <span className="material-symbols-outlined ai-config-tab-icon">view_list</span>
                  Manage Providers
                  <span className="ai-config-provider-count">{customProviders.length}</span>
                </label>
              </nav>

              {/* Add New Provider Tab Content */}
              {providerTab === 'new' && (
                <div className="ai-config-tab-content">
                  <div className="ai-config-provider-header">
                    <div className="ai-config-provider-title-wrapper">
                      <div>
                        <h2 className="ai-config-section-title">Configure Provider</h2>
                        <p className="ai-config-provider-subtitle">
                          Connect a new AI model provider to your workspace.
                        </p>
                      </div>
                      <div className="ai-config-provider-icon-wrapper">
                        <span className="material-symbols-outlined ai-config-provider-icon">
                          add_link
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="ai-config-provider-body">
                    {/* Provider Form */}
                    <div className="ai-config-form-grid">
                      <div className="ai-config-form-group">
                        <label className="ai-config-form-label">Provider Name</label>
                        <input
                          type="text"
                          className="ai-config-form-input"
                          placeholder="e.g. Anthropic"
                          value={newProviderForm.name}
                          onChange={e => updateNewProviderForm('name', e.target.value)}
                        />
                      </div>
                      <div className="ai-config-form-group">
                        <label className="ai-config-form-label">
                          API Base URL
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: '#e91e63',
                              fontWeight: 'normal',
                            }}
                          >
                            *
                          </span>
                        </label>
                        <div className="ai-config-input-wrapper">
                          <span className="material-symbols-outlined ai-config-input-icon">
                            link
                          </span>
                          <input
                            type="text"
                            className="ai-config-form-input"
                            placeholder="https://api.example.com/v1"
                            value={newProviderForm.baseUrl}
                            onChange={e => updateNewProviderForm('baseUrl', e.target.value)}
                            style={{
                              borderColor:
                                newProviderForm.apiKey && !newProviderForm.baseUrl
                                  ? '#e91e63'
                                  : undefined,
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* API Key */}
                    <div className="ai-config-api-key-group">
                      <label className="ai-config-form-label">API Key</label>
                      <div className="ai-config-api-key-wrapper">
                        <input
                          type="text"
                          className="ai-config-form-input ai-config-api-key-input"
                          placeholder="sk-..."
                          value={newProviderForm.apiKey}
                          onChange={e => updateNewProviderForm('apiKey', e.target.value)}
                        />
                        {newProviderForm.apiKey && (
                          <button
                            className="ai-config-api-key-test-btn"
                            onClick={handleFetchModels}
                            disabled={
                              !newProviderForm.baseUrl || !newProviderForm.apiKey || fetchingModels
                            }
                            title={
                              newProviderForm.baseUrl
                                ? 'Test API connection and fetch models'
                                : 'API Base URL is required to test'
                            }
                          >
                            {fetchingModels ? (
                              <div className="ai-config-spinner-small"></div>
                            ) : (
                              <LinkIcon size={16} />
                            )}
                          </button>
                        )}
                      </div>
                      <div className="ai-config-checkbox-group">
                        <label className="ai-config-checkbox-wrapper">
                          <input
                            type="checkbox"
                            className="ai-config-checkbox"
                            checked={newProviderForm.persistApiKey}
                            onChange={e => updateNewProviderForm('persistApiKey', e.target.checked)}
                          />
                          <span className="ai-config-checkbox-slider"></span>
                        </label>
                        <span className="ai-config-checkbox-label">
                          Store safely in local keychain
                        </span>
                      </div>
                    </div>

                    {/* Model Availability */}
                    <div className="ai-config-model-availability">
                      <div className="ai-config-model-availability-bg"></div>
                      <div className="ai-config-model-availability-header">
                        <div className="ai-config-model-availability-title-row">
                          <div>
                            <h4 className="ai-config-model-availability-title">
                              Model Availability
                            </h4>
                            <p className="ai-config-model-availability-subtitle">
                              Fetch and whitelist models for this provider.
                            </p>
                          </div>
                          <button
                            className="ai-config-fetch-models-btn"
                            onClick={handleFetchModels}
                            disabled={
                              !newProviderForm.baseUrl || !newProviderForm.apiKey || fetchingModels
                            }
                          >
                            {fetchingModels ? (
                              <div
                                className="settings-spinner"
                                style={{ width: '14px', height: '14px' }}
                              ></div>
                            ) : (
                              <span className="material-symbols-outlined ai-config-fetch-icon">
                                sync
                              </span>
                            )}
                            {fetchingModels ? 'Fetching...' : 'Fetch Models'}
                          </button>
                        </div>
                      </div>

                      {/* Model Selection Controls */}
                      <div className="ai-config-model-selection-controls">
                        <label className="ai-config-use-all-checkbox-wrapper">
                          <span className="ai-config-checkbox-label">
                            Enable all{' '}
                            <span
                              style={{
                                fontFamily: 'ui-monospace',
                                color: '#e91e63',
                                background: 'rgba(233, 30, 99, 0.1)',
                                padding: '0.125rem 0.375rem',
                                borderRadius: '0.25rem',
                                fontSize: '0.75rem',
                              }}
                            >
                              {fetchedModels.length}
                            </span>{' '}
                            detected models
                            {newProviderForm.selectedModels.length > 0 && (
                              <span
                                style={{
                                  marginLeft: '0.5rem',
                                  fontSize: '0.75rem',
                                  color: '#a1a1aa',
                                }}
                              >
                                ({newProviderForm.selectedModels.length} selected)
                              </span>
                            )}
                          </span>
                          <input
                            type="checkbox"
                            className="ai-config-checkbox"
                            checked={newProviderForm.useAllModels}
                            onChange={e => handleToggleUseAllModels(e.target.checked)}
                          />
                          <span className="ai-config-checkbox-slider"></span>
                        </label>

                        <div className="ai-config-model-select-row">
                          <div className="ai-config-model-select-wrapper">
                            <button
                              ref={dropdownRef}
                              className="ai-config-model-select-btn"
                              onClick={() => {
                                if (!newProviderModelDropdownOpen) {
                                  calculateDropdownPosition();
                                }
                                setNewProviderModelDropdownOpen(!newProviderModelDropdownOpen);
                              }}
                            >
                              <span className="ai-config-select-text">
                                {newProviderForm.currentModelSelection
                                  ? newProviderForm.currentModelSelection
                                  : 'Select a specific model...'}
                              </span>
                              <span
                                className="material-symbols-outlined ai-config-select-arrow"
                                style={{
                                  transform: newProviderModelDropdownOpen
                                    ? 'rotate(180deg)'
                                    : 'rotate(0deg)',
                                  transition: 'transform 0.2s',
                                }}
                              >
                                arrow_drop_down
                              </span>
                            </button>

                            {/* Dropdown Menu */}
                            {newProviderModelDropdownOpen && fetchedModels.length > 0 && (
                              <div
                                className="ai-config-dropdown-menu-models"
                                style={{
                                  top: `${dropdownPosition.top}px`,
                                  left: `${dropdownPosition.left}px`,
                                  width: `${dropdownPosition.width}px`,
                                }}
                              >
                                <div className="ai-config-models-list-header">
                                  <span className="ai-config-models-list-title">
                                    Available Models
                                  </span>
                                </div>
                                <div className="ai-config-models-list-content">
                                  {fetchedModels.map(model => (
                                    <button
                                      key={model.id}
                                      className={`ai-config-model-item ${newProviderForm.currentModelSelection === model.id ? 'selected' : ''}`}
                                      onClick={() => {
                                        updateNewProviderForm('currentModelSelection', model.id);
                                        setNewProviderModelDropdownOpen(false);
                                      }}
                                    >
                                      <div className="ai-config-model-item-info">
                                        <span className="ai-config-model-item-name">
                                          {model.id}
                                        </span>
                                        <span className="ai-config-model-item-provider">
                                          {model.owned_by || 'custom'}
                                        </span>
                                      </div>
                                      {newProviderForm.currentModelSelection === model.id ? (
                                        <span className="material-symbols-outlined ai-config-model-item-check">
                                          check_circle
                                        </span>
                                      ) : (
                                        <span className="material-symbols-outlined ai-config-model-item-add">
                                          add_circle
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          {!newProviderForm.useAllModels && (
                            <button
                              className="ai-config-add-model-btn"
                              onClick={handleAddModelToList}
                              disabled={!newProviderForm.currentModelSelection}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: '18px' }}
                              >
                                add
                              </span>
                              Add
                            </button>
                          )}
                        </div>

                        {/* Model Tags */}
                        {newProviderForm.selectedModels.length > 0 && (
                          <div className="ai-config-model-tags">
                            {newProviderForm.selectedModels.map(modelId => (
                              <div key={modelId} className="ai-config-model-tag">
                                <span className="ai-config-model-tag-id">{modelId}</span>
                                <button
                                  onClick={() => handleRemoveModelFromList(modelId)}
                                  className="ai-config-model-tag-remove"
                                  title="Remove model"
                                >
                                  <span
                                    className="material-symbols-outlined"
                                    style={{ fontSize: '14px' }}
                                  >
                                    close
                                  </span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Manual Model Entry */}
                        {!newProviderForm.useAllModels && (
                          <div className="ai-config-manual-model-section">
                            {showAddModelInput ? (
                              <div className="ai-config-custom-model-input">
                                <div className="ai-config-input-with-icons">
                                  <input
                                    type="text"
                                    className="ai-config-form-input ai-config-custom-input"
                                    placeholder="Enter model ID manually (e.g., gpt-4-turbo, claude-3-sonnet)"
                                    value={customModelInput}
                                    onChange={e => setCustomModelInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddCustomModel()}
                                  />
                                  <div className="ai-config-input-icons">
                                    {customModelInput.trim() && (
                                      <button
                                        className="ai-config-input-icon-btn ai-config-check-btn"
                                        onClick={handleAddCustomModel}
                                        title="Add model"
                                      >
                                        <span className="material-symbols-outlined">check</span>
                                      </button>
                                    )}
                                    <button
                                      className="ai-config-input-icon-btn ai-config-close-btn"
                                      onClick={() => {
                                        setShowAddModelInput(false);
                                        setCustomModelInput('');
                                      }}
                                      title="Cancel"
                                    >
                                      <span className="material-symbols-outlined">close</span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <button
                                className="ai-config-add-manual-btn"
                                onClick={() => setShowAddModelInput(true)}
                              >
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: '16px' }}
                                >
                                  add_circle
                                </span>
                                Add model manually
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Error Message */}
                    {fetchError && (
                      <div
                        style={{
                          color: '#ef4444',
                          fontSize: '0.875rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                          error
                        </span>
                        {fetchError}
                      </div>
                    )}

                    {/* Save Button */}
                    <div className="ai-config-save-provider-wrapper">
                      <button
                        className="ai-config-save-provider-btn"
                        onClick={handleSaveProvider}
                        disabled={!canSaveProvider}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                          save
                        </span>
                        Save Provider
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Manage Providers Tab Content */}
              {providerTab === 'list' && (
                <div className="ai-config-tab-content ai-config-manage-providers">
                  <div className="ai-config-manage-header">
                    <div className="ai-config-manage-title-wrapper">
                      <h3 className="ai-config-manage-title">
                        <span className="material-symbols-outlined ai-config-manage-icon">
                          verified_user
                        </span>
                        Configured Services
                      </h3>
                      <div className="ai-config-manage-search-wrapper">
                        <span className="material-symbols-outlined ai-config-manage-search-icon">
                          search
                        </span>
                        <input
                          type="text"
                          className="ai-config-manage-search"
                          placeholder="Filter providers..."
                          value={providerSearchTerm}
                          onChange={e => setProviderSearchTerm(e.target.value.toLowerCase())}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="ai-config-providers-list">
                    {customProviders.length === 0 ? (
                      <div className="ai-config-empty-state">
                        <Server size={32} />
                        <p>No providers configured yet</p>
                        <button onClick={() => setProviderTab('new')}>
                          Add your first provider
                        </button>
                      </div>
                    ) : (
                      customProviders
                        .filter(
                          provider =>
                            provider.name.toLowerCase().includes(providerSearchTerm) ||
                            provider.baseUrl.toLowerCase().includes(providerSearchTerm)
                        )
                        .map(provider => (
                          <div key={provider.id} className="ai-config-provider-item">
                            <div className="ai-config-provider-info">
                              <div className="ai-config-provider-logo">
                                <span className="material-symbols-outlined">dns</span>
                              </div>
                              <div className="ai-config-provider-details">
                                <h3 className="ai-config-provider-name">{provider.name}</h3>
                                <div className="ai-config-provider-meta">
                                  <span className="ai-config-provider-key">
                                    {provider.apiKey
                                      ? `sk-...${provider.apiKey.slice(-4)}`
                                      : 'Session key'}
                                  </span>
                                  <span className="ai-config-provider-status connected">
                                    Connected
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="ai-config-provider-actions">
                              <div className="ai-config-provider-toggle">
                                <span className="ai-config-toggle-label">Enabled</span>
                                <label className="ai-config-toggle-switch">
                                  <input
                                    type="checkbox"
                                    className="ai-config-toggle-input"
                                    checked={provider.enabled}
                                    onChange={e =>
                                      handleToggleProviderEnabled(provider.id, e.target.checked)
                                    }
                                  />
                                  <span className="ai-config-toggle-slider"></span>
                                </label>
                              </div>
                              <div className="ai-config-provider-divider"></div>
                              <button
                                className="ai-config-provider-delete-btn"
                                onClick={() => handleDeleteProvider(provider.id)}
                              >
                                <span className="material-symbols-outlined ai-config-delete-icon">
                                  delete
                                </span>
                                <span>Remove</span>
                              </button>
                            </div>
                          </div>
                        ))
                    )}
                  </div>

                  <div className="ai-config-manage-footer">
                    <p>Changes to provider configurations apply immediately to new sessions.</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
};
