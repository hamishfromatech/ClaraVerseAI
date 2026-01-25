/**
 * API Key service
 * Handles backend API calls for API key management
 */

import { api } from './api';

// ============================================================================
// Types
// ============================================================================

export interface APIKeyRateLimit {
  requestsPerMinute: number;
  requestsPerHour: number;
}

export interface APIKey {
  id: string;
  keyPrefix: string;
  key?: string; // Plain key (temporarily available for early platform phase)
  name: string;
  description?: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  isRevoked: boolean;
  createdAt: string;
}

export interface CreateAPIKeyRequest {
  name: string;
  description?: string;
  scopes: string[];
  rateLimit?: APIKeyRateLimit;
  expiresIn?: number; // Days until expiration
}

export interface CreateAPIKeyResponse {
  id: string;
  key: string; // Full API key - ONLY shown once!
  keyPrefix: string;
  name: string;
  scopes: string[];
  expiresAt?: string;
  createdAt: string;
}

export interface TriggerAgentRequest {
  input?: Record<string, unknown>;
}

export interface TriggerAgentResponse {
  executionId: string;
  status: 'queued' | 'running';
  message: string;
}

// ============================================================================
// Available Scopes
// ============================================================================

export const AVAILABLE_SCOPES = [
  {
    value: 'execute:*',
    label: 'Execute All Agents',
    description: 'Execute any agent owned by this user',
  },
  {
    value: 'read:executions',
    label: 'Read Executions',
    description: 'View execution history and results',
  },
  {
    value: 'upload',
    label: 'Upload Files',
    description: 'Upload files for workflows with file inputs',
  },
  {
    value: 'read:*',
    label: 'Read All',
    description: 'Read access to all resources',
  },
];

// ============================================================================
// API Functions
// ============================================================================

/**
 * Create a new API key
 * IMPORTANT: The full key is only returned once - user must save it immediately
 */
export async function createAPIKey(data: CreateAPIKeyRequest): Promise<CreateAPIKeyResponse> {
  const response = await api.post<CreateAPIKeyResponse>('/api/keys', {
    name: data.name,
    description: data.description || '',
    scopes: data.scopes,
    rateLimit: data.rateLimit,
    expiresIn: data.expiresIn,
  });
  return response;
}

/**
 * List all API keys for the current user
 * Note: This returns safe list items without key hashes
 */
export async function listAPIKeys(): Promise<APIKey[]> {
  try {
    const response = await api.get<{ keys: APIKey[] }>('/api/keys');
    return response.keys || [];
  } catch (error) {
    console.error('Failed to fetch API keys:', error);
    return [];
  }
}

/**
 * Revoke an API key (soft delete)
 */
export async function revokeAPIKey(keyId: string): Promise<void> {
  await api.delete(`/api/keys/${keyId}`);
}

/**
 * Trigger an agent execution using an API key
 * Note: This endpoint uses X-API-Key header instead of JWT
 */
export async function triggerAgent(
  agentId: string,
  apiKey: string,
  input?: Record<string, unknown>
): Promise<TriggerAgentResponse> {
  const baseUrl = window.location.origin;
  const response = await fetch(`${baseUrl}/api/trigger/${agentId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ input: input || {} }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format scope for display
 */
export function formatScope(scope: string): string {
  const found = AVAILABLE_SCOPES.find(s => s.value === scope);
  if (found) return found.label;

  // Handle agent-specific scopes like "execute:agent-123"
  if (scope.startsWith('execute:')) {
    const agentId = scope.slice(8);
    return `Execute: ${agentId.slice(0, 8)}...`;
  }

  return scope;
}

/**
 * Format last used time
 */
export function formatLastUsed(lastUsedAt?: string): string {
  if (!lastUsedAt) return 'Never used';

  const date = new Date(lastUsedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Mask the API key prefix for display
 */
export function maskKeyPrefix(keyPrefix: string): string {
  if (!keyPrefix || keyPrefix.length < 4) return keyPrefix;
  return keyPrefix.slice(0, 8) + '****';
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch {
      document.body.removeChild(textArea);
      return false;
    }
  }
}
