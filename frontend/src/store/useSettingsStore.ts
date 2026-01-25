import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import * as userPreferencesService from '@/services/userPreferencesService';

// Helper function to get user-specific storage name
function getUserStorageName(baseName: string): string {
  try {
    const authStorage = localStorage.getItem('auth-storage');
    if (authStorage) {
      const { state } = JSON.parse(authStorage);
      if (state?.user?.id) {
        return `${baseName}-${state.user.id}`;
      }
    }
  } catch (error) {
    console.warn('Failed to get user ID for storage name:', error);
  }
  return baseName;
}

/**
 * SECURITY NOTE: API Key Storage
 *
 * API keys are stored in localStorage with BASE64 encoding (NOT encryption).
 * This provides basic obfuscation to prevent casual viewing but is NOT secure
 * against determined attackers with browser access.
 *
 * RISKS:
 * - XSS attacks can read localStorage
 * - Anyone with physical access to the browser can decode keys
 * - Keys are sent to our backend on each request (over WSS)
 *
 * MITIGATIONS:
 * - Backend never stores user API keys (memory only)
 * - Keys are cleared when user removes provider
 * - User-specific storage prevents cross-user access
 *
 * For higher security, users should:
 * - Use API keys with limited scopes/permissions
 * - Rotate keys regularly
 * - Use our platform-provided models when possible
 */

// Simple base64 encoding for API keys (obfuscation, NOT security)
// This prevents casual viewing but is easily reversible
export const encryptApiKey = (apiKey: string): string => {
  if (!apiKey) return '';
  try {
    // Double encode to make it slightly less obvious
    return btoa(btoa(apiKey));
  } catch {
    return apiKey;
  }
};

export const decryptApiKey = (encoded: string): string => {
  if (!encoded) return '';
  try {
    // Double decode
    return atob(atob(encoded));
  } catch {
    // Try single decode for backwards compatibility
    try {
      return atob(encoded);
    } catch {
      return encoded;
    }
  }
};

// New multi-provider interface
export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string; // Stored encrypted if persistApiKey is true, otherwise empty
  persistApiKey?: boolean; // Whether to save the API key to localStorage
  enabled: boolean;
  selectedModels: string[]; // Model IDs selected for use in chat
  useAllModels: boolean; // When true, all fetched models are available
}

// Legacy single provider config (for backwards compatibility) - DEPRECATED
export interface CustomProviderConfig {
  enabled: boolean;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export type ChatPrivacyMode = 'local' | 'cloud' | null;

export interface SettingsState {
  // AI Configuration
  defaultSystemInstructions: string;
  defaultModelId: string | null;
  toolPredictorModelId: string | null;
  customProviders: CustomProvider[];
  sessionApiKeys: Record<string, string>; // In-memory storage for session-only keys

  // Legacy - kept for backwards compatibility
  customProvider: CustomProviderConfig;

  // Privacy
  chatPrivacyMode: ChatPrivacyMode; // null means not yet configured

  // Appearance
  theme: 'dark' | 'light' | 'system';
  fontSize: 'small' | 'medium' | 'large';

  // Memory System
  memoryEnabled: boolean;
  memoryExtractionThreshold: number;
  memoryMaxInjection: number;
  memoryExtractorModelId: string | null;
  memorySelectorModelId: string | null;

  // Transcription
  transcriptionProvider: 'local' | 'remote';
  transcriptionModel: string;

  // Text-to-Speech
  ttsEnabled: boolean;
  ttsVoice: string; // Built-in voice ID or 'custom'
  ttsCustomVoiceId: string | null; // Custom voice file ID
  ttsHuggingFaceToken: string; // HuggingFace token for gated models

  // Actions
  setDefaultSystemInstructions: (instructions: string) => void;
  setDefaultModelId: (modelId: string | null) => void;
  setToolPredictorModelId: (modelId: string | null) => void;

  // Multi-provider actions
  addCustomProvider: (provider: CustomProvider) => void;
  updateCustomProvider: (id: string, updates: Partial<CustomProvider>) => void;
  removeCustomProvider: (id: string) => void;
  getActiveProviders: () => CustomProvider[];
  setSessionApiKey: (providerId: string, apiKey: string) => void;

  // Legacy actions (kept for backwards compatibility)
  setCustomProvider: (config: Partial<CustomProviderConfig>) => void;
  toggleCustomProvider: (enabled: boolean) => void;

  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setChatPrivacyMode: (mode: ChatPrivacyMode) => void;
  resetSettings: () => void;

  // Memory system actions
  setMemoryEnabled: (enabled: boolean) => void;
  setMemoryExtractionThreshold: (threshold: number) => void;
  setMemoryMaxInjection: (max: number) => void;
  setMemoryExtractorModelId: (modelId: string | null) => void;
  setMemorySelectorModelId: (modelId: string | null) => void;

  // Transcription actions
  setTranscriptionProvider: (provider: 'local' | 'remote') => void;
  setTranscriptionModel: (model: string) => void;

  // TTS actions
  setTTSEnabled: (enabled: boolean) => void;
  setTTSVoice: (voice: string) => void;
  setTTSCustomVoiceId: (customVoiceId: string | null) => void;
  setTTSHuggingFaceToken: (token: string) => void;

  // Backend sync
  initializeFromBackend: () => Promise<void>;
  isSyncingPreferences: boolean;

  // Getters
  getEffectiveCustomConfig: () => { base_url: string; api_key: string; model: string } | undefined;
  getProviderApiKey: (providerId: string) => string | null;
}

const defaultCustomProvider: CustomProviderConfig = {
  enabled: false,
  providerName: '',
  baseUrl: '',
  apiKey: '',
  modelName: '',
};

export const useSettingsStore = create<SettingsState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        defaultSystemInstructions: '',
        defaultModelId: null,
        toolPredictorModelId: null,
        customProviders: [],
        sessionApiKeys: {},
        customProvider: { ...defaultCustomProvider },
        chatPrivacyMode: null,
        theme: 'dark',
        fontSize: 'medium',
        isSyncingPreferences: false,

        // Memory system defaults
        memoryEnabled: false,
        memoryExtractionThreshold: 20, // Conservative default to save credits
        memoryMaxInjection: 5,
        memoryExtractorModelId: null,
        memorySelectorModelId: null,

        // Transcription
        transcriptionProvider: 'local',
        transcriptionModel: 'base.en',

        // Text-to-Speech
        ttsEnabled: false,
        ttsVoice: 'alba',
        ttsCustomVoiceId: null,
        ttsHuggingFaceToken: '',

        // Actions
        setDefaultSystemInstructions: (instructions: string) => {
          set({ defaultSystemInstructions: instructions });
        },

        setDefaultModelId: (modelId: string | null) => {
          set({ defaultModelId: modelId });
        },

        setToolPredictorModelId: (modelId: string | null) => {
          set({ toolPredictorModelId: modelId });

          // Sync to backend if authenticated
          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService
              .updatePreferences({ tool_predictor_model_id: modelId || undefined })
              .catch(error => {
                console.error('Failed to sync tool predictor model to backend:', error);
              });
          }
        },

        // Multi-provider actions
        addCustomProvider: (provider: CustomProvider) => {
          set(state => ({
            customProviders: [...state.customProviders, provider],
          }));
        },

        updateCustomProvider: (id: string, updates: Partial<CustomProvider>) => {
          set(state => ({
            customProviders: state.customProviders.map(p =>
              p.id === id ? { ...p, ...updates } : p
            ),
          }));
        },

        removeCustomProvider: (id: string) => {
          set(state => {
            // Also remove from session keys
            const newSessionKeys = { ...state.sessionApiKeys };
            delete newSessionKeys[id];
            return {
              customProviders: state.customProviders.filter(p => p.id !== id),
              sessionApiKeys: newSessionKeys,
            };
          });
        },

        getActiveProviders: () => {
          // A provider is active if enabled and has baseUrl and selected models
          // We don't strictly require apiKey here because it might be in session
          return get().customProviders.filter(
            p => p.enabled && p.baseUrl && p.selectedModels.length > 0
          );
        },

        setSessionApiKey: (providerId: string, apiKey: string) => {
          set(state => ({
            sessionApiKeys: { ...state.sessionApiKeys, [providerId]: apiKey },
          }));
        },

        // Legacy actions
        setCustomProvider: (config: Partial<CustomProviderConfig>) => {
          set(state => ({
            customProvider: { ...state.customProvider, ...config },
          }));
        },

        toggleCustomProvider: (enabled: boolean) => {
          set(state => ({
            customProvider: { ...state.customProvider, enabled },
          }));
        },

        setTheme: (theme: 'dark' | 'light' | 'system') => {
          set({ theme });

          // Sync to backend if authenticated
          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService.updatePreferences({ theme }).catch(error => {
              console.error('Failed to sync theme to backend:', error);
            });
          }
        },

        setFontSize: (size: 'small' | 'medium' | 'large') => {
          set({ fontSize: size });

          // Sync to backend if authenticated
          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService.updatePreferences({ font_size: size }).catch(error => {
              console.error('Failed to sync font size to backend:', error);
            });
          }
        },

        setChatPrivacyMode: (mode: ChatPrivacyMode) => {
          set({ chatPrivacyMode: mode });

          // Sync to backend if authenticated
          if (userPreferencesService.isAuthenticated() && mode) {
            userPreferencesService.setChatPrivacyMode(mode).catch(error => {
              console.error('Failed to sync chat privacy mode to backend:', error);
            });
          }
        },

        // Memory system actions
        setMemoryEnabled: (enabled: boolean) => {
          set({ memoryEnabled: enabled });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService.updatePreferences({ memory_enabled: enabled }).catch(error => {
              console.error('Failed to sync memory enabled to backend:', error);
            });
          }
        },

        setMemoryExtractionThreshold: (threshold: number) => {
          set({ memoryExtractionThreshold: threshold });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService
              .updatePreferences({ memory_extraction_threshold: threshold })
              .catch(error => {
                console.error('Failed to sync memory extraction threshold to backend:', error);
              });
          }
        },

        setMemoryMaxInjection: (max: number) => {
          set({ memoryMaxInjection: max });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService.updatePreferences({ memory_max_injection: max }).catch(error => {
              console.error('Failed to sync memory max injection to backend:', error);
            });
          }
        },

        setMemoryExtractorModelId: (modelId: string | null) => {
          set({ memoryExtractorModelId: modelId });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService
              .updatePreferences({ memory_extractor_model_id: modelId || undefined })
              .catch(error => {
                console.error('Failed to sync memory extractor model to backend:', error);
              });
          }
        },

        setMemorySelectorModelId: (modelId: string | null) => {
          set({ memorySelectorModelId: modelId });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService
              .updatePreferences({ memory_selector_model_id: modelId || undefined })
              .catch(error => {
                console.error('Failed to sync memory selector model to backend:', error);
              });
          }
        },

        setTranscriptionProvider: (provider: 'local' | 'remote') => {
          set({ transcriptionProvider: provider });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService
              .updatePreferences({ transcription_provider: provider })
              .catch(error => {
                console.error('Failed to sync transcription provider to backend:', error);
              });
          }
        },

        setTranscriptionModel: (model: string) => {
          set({ transcriptionModel: model });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService
              .updatePreferences({ transcription_model: model })
              .catch(error => {
                console.error('Failed to sync transcription model to backend:', error);
              });
          }
        },

        setTTSEnabled: (enabled: boolean) => {
          set({ ttsEnabled: enabled });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService
              .updatePreferences({ tts_enabled: enabled })
              .catch(error => {
                console.error('Failed to sync TTS enabled to backend:', error);
              });
          }
        },

        setTTSVoice: (voice: string) => {
          set({ ttsVoice: voice });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService
              .updatePreferences({ tts_voice: voice })
              .catch(error => {
                console.error('Failed to sync TTS voice to backend:', error);
              });
          }
        },

        setTTSCustomVoiceId: (customVoiceId: string | null) => {
          set({ ttsCustomVoiceId: customVoiceId });

          if (userPreferencesService.isAuthenticated()) {
            userPreferencesService
              .updatePreferences({ tts_custom_voice_id: customVoiceId || undefined })
              .catch(error => {
                console.error('Failed to sync TTS custom voice ID to backend:', error);
              });
          }
        },

        setTTSHuggingFaceToken: (token: string) => {
          set({ ttsHuggingFaceToken: token });
        },

        resetSettings: () => {
          set({
            defaultSystemInstructions: '',
            defaultModelId: null,
            toolPredictorModelId: null,
            customProviders: [],
            sessionApiKeys: {},
            customProvider: { ...defaultCustomProvider },
            chatPrivacyMode: null,
            theme: 'dark',
            fontSize: 'medium',
            memoryEnabled: false,
            memoryExtractionThreshold: 20,
            memoryMaxInjection: 5,
            memoryExtractorModelId: null,
            memorySelectorModelId: null,
            transcriptionProvider: 'local',
            transcriptionModel: 'base.en',
            ttsEnabled: false,
            ttsVoice: 'alba',
            ttsCustomVoiceId: null,
            ttsHuggingFaceToken: '',
          });
        },

        // Initialize preferences from backend
        initializeFromBackend: async () => {
          if (!userPreferencesService.isAuthenticated()) {
            return;
          }

          set({ isSyncingPreferences: true });

          try {
            const prefs = await userPreferencesService.getPreferences();

            // Only update if backend has values
            const updates: Partial<{
              chatPrivacyMode: ChatPrivacyMode;
              theme: 'dark' | 'light' | 'system';
              fontSize: 'small' | 'medium' | 'large';
              toolPredictorModelId: string | null;
              memoryEnabled: boolean;
              memoryExtractionThreshold: number;
              memoryMaxInjection: number;
              memoryExtractorModelId: string | null;
              memorySelectorModelId: string | null;
              transcriptionProvider: 'local' | 'remote';
              transcriptionModel: string;
              ttsEnabled: boolean;
              ttsVoice: string;
              ttsCustomVoiceId: string | null;
            }> = {};

            if (prefs.chat_privacy_mode) {
              updates.chatPrivacyMode = prefs.chat_privacy_mode;
            }
            if (prefs.theme && ['dark', 'light', 'system'].includes(prefs.theme)) {
              updates.theme = prefs.theme as 'dark' | 'light' | 'system';
            }
            if (prefs.font_size && ['small', 'medium', 'large'].includes(prefs.font_size)) {
              updates.fontSize = prefs.font_size as 'small' | 'medium' | 'large';
            }
            if (prefs.tool_predictor_model_id) {
              updates.toolPredictorModelId = prefs.tool_predictor_model_id;
            }
            if (prefs.memory_enabled !== undefined) {
              updates.memoryEnabled = prefs.memory_enabled;
            }
            if (prefs.memory_extraction_threshold) {
              updates.memoryExtractionThreshold = prefs.memory_extraction_threshold;
            }
            if (prefs.memory_max_injection) {
              updates.memoryMaxInjection = prefs.memory_max_injection;
            }
            if (prefs.memory_extractor_model_id) {
              updates.memoryExtractorModelId = prefs.memory_extractor_model_id;
            }
            if (prefs.memory_selector_model_id) {
              updates.memorySelectorModelId = prefs.memory_selector_model_id;
            }
            if (prefs.transcription_provider) {
              updates.transcriptionProvider = prefs.transcription_provider as 'local' | 'remote';
            }
            if (prefs.transcription_model) {
              updates.transcriptionModel = prefs.transcription_model;
            }
            if (prefs.tts_enabled !== undefined) {
              updates.ttsEnabled = prefs.tts_enabled;
            }
            if (prefs.tts_voice) {
              updates.ttsVoice = prefs.tts_voice;
            }
            if (prefs.tts_custom_voice_id) {
              updates.ttsCustomVoiceId = prefs.tts_custom_voice_id;
            }

            if (Object.keys(updates).length > 0) {
              set(updates);
              console.log('Settings synced from backend:', updates);
            }
          } catch (error) {
            console.error('Failed to fetch preferences from backend:', error);
          } finally {
            set({ isSyncingPreferences: false });
          }
        },

        // Getters - checks both new multi-provider and legacy single provider
        getEffectiveCustomConfig: () => {
          const { customProviders, customProvider, sessionApiKeys } = get();

          // First check new multi-provider system
          const activeProvider = customProviders.find(
            p => p.enabled && p.baseUrl && p.selectedModels.length > 0
          );

          if (activeProvider) {
            // Check for key in persistent storage or session
            let apiKey = '';
            if (activeProvider.apiKey) {
              apiKey = decryptApiKey(activeProvider.apiKey);
            } else if (sessionApiKeys[activeProvider.id]) {
              apiKey = sessionApiKeys[activeProvider.id];
            }

            if (apiKey) {
              return {
                base_url: activeProvider.baseUrl,
                api_key: apiKey,
                model: activeProvider.selectedModels[0], // Use first selected model
              };
            }
          }

          // Fall back to legacy single provider
          if (
            customProvider.enabled &&
            customProvider.baseUrl &&
            customProvider.apiKey &&
            customProvider.modelName
          ) {
            return {
              base_url: customProvider.baseUrl,
              api_key: customProvider.apiKey,
              model: customProvider.modelName,
            };
          }

          return undefined;
        },

        getProviderApiKey: (providerId: string) => {
          const { customProviders, sessionApiKeys } = get();
          const provider = customProviders.find(p => p.id === providerId);

          if (!provider) return null;

          if (provider.apiKey) {
            return decryptApiKey(provider.apiKey);
          }

          return sessionApiKeys[providerId] || null;
        },
      }),
      {
        name: getUserStorageName('settings-storage'),
        partialize: state => {
          // Exclude sessionApiKeys from persistence
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { sessionApiKeys, ...persistedState } = state;
          return persistedState;
        },
      }
    ),
    { name: 'SettingsStore' }
  )
);
