import { apiClient } from '@/lib/apiClient';
import type { Model, ModelsResponse } from '@/types/websocket';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Fetch available models from the backend API
 * Uses apiClient which automatically includes JWT token from auth store
 * @param requireAuth If true, requires authentication. If false, fetches anonymous models
 * @returns Array of available models
 */
export async function fetchModels(requireAuth = true): Promise<Model[]> {
  try {
    const response = await apiClient.get(`${API_BASE_URL}/api/models`, {
      requiresAuth: requireAuth,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data: ModelsResponse = await response.json();

    return data.models || [];
  } catch (error) {
    console.error('Error fetching models:', error);
    throw error;
  }
}

/**
 * Fetch only models that can be used as tool predictors
 * These are models with smart_tool_router = true and is_visible = true
 * More efficient than fetching all models and filtering client-side
 * @returns Array of tool predictor models
 */
export async function fetchToolPredictorModels(): Promise<Model[]> {
  try {
    const response = await apiClient.get(`${API_BASE_URL}/api/models/tool-predictors`, {
      requiresAuth: false,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tool predictor models: ${response.statusText}`);
    }

    const data: ModelsResponse = await response.json();

    return data.models || [];
  } catch (error) {
    console.error('Error fetching tool predictor models:', error);
    throw error;
  }
}

/**
 * Group models by provider name
 * @param models Array of models
 * @returns Object with provider names as keys and model arrays as values
 */
export function groupByProvider(models: Model[]): Record<string, Model[]> {
  return models.reduce(
    (groups, model) => {
      const provider = model.provider_name;
      if (!groups[provider]) {
        groups[provider] = [];
      }
      groups[provider].push(model);
      return groups;
    },
    {} as Record<string, Model[]>
  );
}

/**
 * Filter models by capability
 */
export function filterModelsByCapability(
  models: Model[],
  capability: 'vision' | 'tools' | 'streaming'
): Model[] {
  switch (capability) {
    case 'vision':
      return models.filter(m => m.supports_vision);
    case 'tools':
      return models.filter(m => m.supports_tools);
    case 'streaming':
      return models.filter(m => m.supports_streaming);
    default:
      return models;
  }
}

/**
 * Filter models that are enabled for agents (builder, chat, start blocks)
 * Only models with agents_enabled: true will be shown
 */
export function filterAgentModels(models: Model[]): Model[] {
  return models.filter(m => m.agents_enabled === true);
}
