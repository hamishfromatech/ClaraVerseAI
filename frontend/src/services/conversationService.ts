/**
 * Conversation service
 * Handles conversation status, staleness detection, and builder conversation persistence
 */

import { api } from './api';
import type { BuilderMessage } from '@/types/agent';

const API_BASE_URL = window.location.origin;

// Conversation is considered stale after 25 minutes (backend TTL is 30 minutes)
const STALE_THRESHOLD_MS = 25 * 60 * 1000; // 25 minutes in milliseconds

export interface ConversationStatus {
  exists: boolean;
  hasFiles: boolean;
  expiresIn: number; // seconds until expiration, -1 if expired
}

/**
 * Check if a conversation exists on the backend
 */
export async function checkConversationStatus(conversationId: string): Promise<ConversationStatus> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/status`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const status: ConversationStatus = await response.json();
    return status;
  } catch (error) {
    console.error('Failed to check conversation status:', error);
    // Return default expired status on error
    return {
      exists: false,
      hasFiles: false,
      expiresIn: -1,
    };
  }
}

/**
 * Check if a conversation is stale based on last activity timestamp
 * Returns true if conversation hasn't been active for >25 minutes
 */
export function isConversationStale(lastActivityAt?: Date | string | number): boolean {
  if (!lastActivityAt) {
    return false; // No activity timestamp means it's a new conversation
  }

  const now = new Date().getTime();
  // Ensure lastActivityAt is a proper Date object (handles string/number from JSON/IndexedDB)
  const dateObj = lastActivityAt instanceof Date ? lastActivityAt : new Date(lastActivityAt);
  const lastActivity = dateObj.getTime();
  const timeSinceActivity = now - lastActivity;

  return timeSinceActivity > STALE_THRESHOLD_MS;
}

/**
 * Get time remaining until conversation becomes stale (in milliseconds)
 * Returns negative value if already stale
 */
export function getTimeUntilStale(lastActivityAt?: Date | string | number): number {
  if (!lastActivityAt) {
    return STALE_THRESHOLD_MS; // Full time available for new conversations
  }

  const now = new Date().getTime();
  // Ensure lastActivityAt is a proper Date object (handles string/number from JSON/IndexedDB)
  const dateObj = lastActivityAt instanceof Date ? lastActivityAt : new Date(lastActivityAt);
  const lastActivity = dateObj.getTime();
  const timeSinceActivity = now - lastActivity;

  return STALE_THRESHOLD_MS - timeSinceActivity;
}

/**
 * Format time until expiration in human-readable format
 */
export function formatTimeUntilExpiration(seconds: number): string {
  if (seconds < 0) {
    return 'Expired';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

// ============================================
// Builder Conversation API (MongoDB persistence)
// ============================================

export interface BuilderConversationListItem {
  id: string;
  agent_id: string;
  model_id: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface BuilderConversationResponse {
  id: string;
  agent_id: string;
  model_id: string;
  messages: BuilderMessage[];
  created_at: string;
  updated_at: string;
}

export interface WorkflowSnapshotData {
  version: number;
  action?: 'create' | 'modify';
  explanation?: string;
}

// Export for use in store
export type { WorkflowSnapshotData as WorkflowSnapshot };

export interface AddBuilderMessageRequest {
  role: 'user' | 'assistant';
  content: string;
  workflow_snapshot?: WorkflowSnapshotData;
}

/**
 * List all builder conversations for an agent
 */
export async function listBuilderConversations(
  agentId: string
): Promise<BuilderConversationListItem[]> {
  try {
    const response = await api.get<BuilderConversationListItem[]>(
      `/api/agents/${agentId}/conversations`
    );
    return response || [];
  } catch (error) {
    console.error('Failed to list builder conversations:', error);
    return [];
  }
}

/**
 * Get a specific builder conversation with decrypted messages
 */
export async function getBuilderConversation(
  agentId: string,
  conversationId: string
): Promise<BuilderConversationResponse | null> {
  try {
    const response = await api.get<BuilderConversationResponse>(
      `/api/agents/${agentId}/conversations/${conversationId}`
    );
    return response;
  } catch (error) {
    console.error('Failed to get builder conversation:', error);
    return null;
  }
}

/**
 * Get or create the current (most recent) conversation for an agent
 */
export async function getOrCreateBuilderConversation(
  agentId: string,
  modelId?: string
): Promise<BuilderConversationResponse | null> {
  try {
    const params = modelId ? `?model_id=${encodeURIComponent(modelId)}` : '';
    const response = await api.get<BuilderConversationResponse>(
      `/api/agents/${agentId}/conversations/current${params}`
    );
    return response;
  } catch (error) {
    console.error('Failed to get/create builder conversation:', error);
    return null;
  }
}

/**
 * Create a new builder conversation for an agent
 */
export async function createBuilderConversation(
  agentId: string,
  modelId: string
): Promise<BuilderConversationResponse | null> {
  try {
    const response = await api.post<BuilderConversationResponse>(
      `/api/agents/${agentId}/conversations`,
      { model_id: modelId }
    );
    return response;
  } catch (error) {
    console.error('Failed to create builder conversation:', error);
    return null;
  }
}

/**
 * Add a message to a builder conversation (with optional workflow snapshot)
 */
export async function addBuilderMessage(
  agentId: string,
  conversationId: string,
  message: AddBuilderMessageRequest
): Promise<BuilderMessage | null> {
  try {
    const response = await api.post<BuilderMessage>(
      `/api/agents/${agentId}/conversations/${conversationId}/messages`,
      message
    );
    return response;
  } catch (error) {
    console.error('Failed to add builder message:', error);
    return null;
  }
}

/**
 * Delete a builder conversation
 */
export async function deleteBuilderConversation(
  agentId: string,
  conversationId: string
): Promise<boolean> {
  try {
    await api.delete(`/api/agents/${agentId}/conversations/${conversationId}`);
    return true;
  } catch (error) {
    console.error('Failed to delete builder conversation:', error);
    return false;
  }
}
