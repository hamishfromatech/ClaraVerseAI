import { api, ApiError } from '@/services/api';
import type { Chat, Message, ToolCall } from '@/types/chat';
import type { Attachment, PlotData } from '@/types/websocket';
import type { Artifact, ArtifactImage } from '@/types/artifact';

// API response types (match backend models)
interface ApiChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number; // Unix milliseconds
  isStreaming?: boolean;
  status?: string;
  error?: string;
  attachments?: ApiAttachment[];
  toolCalls?: ApiToolCall[];
  reasoning?: string;
  artifacts?: ApiArtifact[];
  agentId?: string;
  agentName?: string;
  agentAvatar?: string;
  // Response versioning fields
  versionGroupId?: string;
  versionNumber?: number;
  isHidden?: boolean;
  retryType?: string;
}

interface ApiToolCall {
  id: string;
  name: string;
  displayName?: string;
  icon?: string;
  status: string;
  query?: string;
  result?: string;
  plots?: ApiPlotData[];
  timestamp: number;
  isExpanded?: boolean;
}

interface ApiPlotData {
  format: string; // "png", "jpg", "svg"
  data: string; // Base64-encoded image data
}

interface ApiArtifact {
  id: string;
  type: string;
  title: string;
  content: string;
  images?: ApiArtifactImage[];
  metadata?: Record<string, unknown>;
}

interface ApiArtifactImage {
  data: string;
  format: string;
  caption?: string;
}

// Full attachment format for API storage (matches backend ChatAttachment)
interface ApiAttachment {
  file_id: string;
  type: string; // "image", "document", "data"
  url: string;
  mime_type: string;
  size: number;
  filename?: string;
  expired?: boolean;
  // Document-specific fields
  page_count?: number;
  word_count?: number;
  preview?: string;
  // Data file-specific fields
  data_preview?: ApiDataPreview;
}

interface ApiDataPreview {
  headers: string[];
  rows: string[][];
  row_count: number;
  col_count: number;
}

interface ApiChatResponse {
  id: string;
  folder_id?: string;
  title: string;
  messages: ApiChatMessage[];
  is_starred: boolean;
  model?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ApiChatListItem {
  id: string;
  folder_id?: string;
  title: string;
  is_starred: boolean;
  model?: string;
  message_count: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ApiFolder {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ApiChatListResponse {
  chats: ApiChatListItem[];
  total_count: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

interface ApiBulkSyncResponse {
  synced: number;
  failed: number;
  errors?: string[];
  chat_ids: string[];
}

interface ApiSyncAllResponse {
  chats: ApiChatResponse[];
  total_count: number;
  synced_at: string;
}

// Version tracking for optimistic locking
const chatVersions = new Map<string, number>();

// Debounce tracking for sync operations
const pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 1000;

/**
 * Convert frontend attachment to API format
 */
function attachmentToApiFormat(att: Attachment): ApiAttachment {
  const base: ApiAttachment = {
    file_id: att.file_id,
    type: att.type,
    url: att.url,
    mime_type: att.mime_type,
    size: att.size,
    filename: att.filename,
    expired: att.expired,
  };

  // Add document-specific fields
  if (att.type === 'document') {
    const docAtt = att as import('@/types/websocket').DocumentAttachment;
    base.page_count = docAtt.page_count;
    base.word_count = docAtt.word_count;
    base.preview = docAtt.preview;
  }

  // Add data-specific fields
  if (att.type === 'data') {
    const dataAtt = att as import('@/types/websocket').DataAttachment;
    if (dataAtt.data_preview) {
      base.data_preview = {
        headers: dataAtt.data_preview.headers,
        rows: dataAtt.data_preview.rows,
        row_count: dataAtt.data_preview.row_count,
        col_count: dataAtt.data_preview.col_count,
      };
    }
  }

  return base;
}

/**
 * Convert API attachment to frontend format
 */
function apiToAttachmentFormat(att: ApiAttachment): Attachment {
  const attachmentType = att.type as 'image' | 'document' | 'data';

  // Base fields common to all attachment types
  const base = {
    type: attachmentType || 'image',
    file_id: att.file_id,
    url: att.url,
    mime_type: att.mime_type,
    size: att.size,
    filename: att.filename,
    expired: att.expired,
  };

  // Return type-specific attachment
  if (attachmentType === 'document') {
    return {
      ...base,
      type: 'document',
      page_count: att.page_count,
      word_count: att.word_count,
      preview: att.preview,
    } as import('@/types/websocket').DocumentAttachment;
  }

  if (attachmentType === 'data') {
    return {
      ...base,
      type: 'data',
      data_preview: att.data_preview
        ? {
            headers: att.data_preview.headers,
            rows: att.data_preview.rows,
            row_count: att.data_preview.row_count,
            col_count: att.data_preview.col_count,
          }
        : undefined,
    } as import('@/types/websocket').DataAttachment;
  }

  // Default to image
  return {
    ...base,
    type: 'image',
  } as import('@/types/websocket').ImageAttachment;
}

/**
 * Convert frontend ToolCall to API format
 */
function toolCallToApiFormat(tc: ToolCall): ApiToolCall {
  return {
    id: tc.id,
    name: tc.name,
    displayName: tc.displayName,
    icon: tc.icon,
    status: tc.status,
    query: tc.query,
    result: tc.result,
    plots: tc.plots?.map(p => ({
      format: p.format,
      data: p.data,
    })),
    timestamp: tc.timestamp,
    isExpanded: tc.isExpanded,
  };
}

/**
 * Convert API ToolCall to frontend format
 */
function apiToToolCallFormat(tc: ApiToolCall): ToolCall {
  return {
    id: tc.id,
    name: tc.name,
    displayName: tc.displayName,
    icon: tc.icon,
    status: tc.status as 'executing' | 'completed',
    query: tc.query,
    result: tc.result,
    plots: tc.plots?.map(p => ({
      format: p.format,
      data: p.data,
    })) as PlotData[] | undefined,
    timestamp: tc.timestamp,
    isExpanded: tc.isExpanded,
  };
}

/**
 * Convert frontend Artifact to API format
 */
function artifactToApiFormat(art: Artifact): ApiArtifact {
  return {
    id: art.id,
    type: art.type,
    title: art.title,
    content: art.content,
    images: art.images?.map(img => ({
      data: img.data,
      format: img.format,
      caption: img.caption,
    })),
    metadata: art.metadata as Record<string, unknown>,
  };
}

/**
 * Convert API Artifact to frontend format
 */
function apiToArtifactFormat(art: ApiArtifact): Artifact {
  return {
    id: art.id,
    type: art.type as Artifact['type'],
    title: art.title,
    content: art.content,
    images: art.images?.map(img => ({
      data: img.data,
      format: img.format,
      caption: img.caption,
    })) as ArtifactImage[] | undefined,
    metadata: art.metadata,
  };
}

/**
 * Convert frontend Chat to API format
 */
function chatToApiFormat(chat: Chat): {
  id: string;
  folder_id?: string;
  title: string;
  messages: ApiChatMessage[];
  is_starred: boolean;
  model?: string;
  version?: number;
} {
  return {
    id: chat.id,
    folder_id: chat.folderId,
    title: chat.title,
    messages: chat.messages.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp instanceof Date ? msg.timestamp.getTime() : Number(msg.timestamp),
      isStreaming: msg.isStreaming,
      status: msg.status,
      error: msg.error,
      attachments: msg.attachments?.map(attachmentToApiFormat),
      toolCalls: msg.toolCalls?.map(toolCallToApiFormat),
      reasoning: msg.reasoning,
      artifacts: msg.artifacts?.map(artifactToApiFormat),
      // Response versioning fields
      versionGroupId: msg.versionGroupId,
      versionNumber: msg.versionNumber,
      isHidden: msg.isHidden,
      retryType: msg.retryType,
    })),
    is_starred: chat.isStarred || false,
    version: chatVersions.get(chat.id),
  };
}

/**
 * Convert API response to frontend Chat format
 */
function apiToChatFormat(apiChat: ApiChatResponse): Chat {
  // Store the version for optimistic locking
  chatVersions.set(apiChat.id, apiChat.version);

  return {
    id: apiChat.id,
    folderId: apiChat.folder_id,
    title: apiChat.title,
    messages: apiChat.messages.map(msg => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      timestamp: new Date(msg.timestamp),
      isStreaming: msg.isStreaming,
      status: msg.status as Message['status'],
      error: msg.error,
      attachments: msg.attachments?.map(apiToAttachmentFormat),
      toolCalls: msg.toolCalls?.map(apiToToolCallFormat),
      reasoning: msg.reasoning,
      artifacts: msg.artifacts?.map(apiToArtifactFormat),
      // Response versioning fields
      versionGroupId: msg.versionGroupId,
      versionNumber: msg.versionNumber,
      isHidden: msg.isHidden,
      retryType: msg.retryType as Message['retryType'],
    })),
    createdAt: new Date(apiChat.created_at),
    updatedAt: new Date(apiChat.updated_at),
    isStarred: apiChat.is_starred,
  };
}

/**
 * Fetch all chats from cloud for initial sync
 */
export async function fetchAllCloudChats(): Promise<Chat[]> {
  try {
    const response = await api.get<ApiSyncAllResponse>('/api/chats/sync');
    // Handle null/undefined chats array (backend may return null for empty results)
    if (!response.chats || !Array.isArray(response.chats)) {
      return [];
    }
    return response.chats.map(apiToChatFormat);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      console.log('User not authenticated, skipping cloud sync');
      return [];
    }
    console.error('Failed to fetch cloud chats:', error);
    throw error;
  }
}

/**
 * List chats with pagination (metadata only)
 */
export async function listCloudChats(
  page = 1,
  pageSize = 20,
  starredOnly = false
): Promise<ApiChatListResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    page_size: pageSize.toString(),
  });
  if (starredOnly) {
    params.append('starred', 'true');
  }

  return api.get<ApiChatListResponse>(`/api/chats?${params.toString()}`);
}

/**
 * Get a single chat from cloud
 */
export async function getCloudChat(chatId: string): Promise<Chat> {
  const response = await api.get<ApiChatResponse>(`/api/chats/${chatId}`);
  return apiToChatFormat(response);
}

/**
 * Sync a single chat to cloud
 * @throws ChatTooLargeError if chat exceeds MongoDB size limit
 */
export async function syncChatToCloud(chat: Chat): Promise<Chat> {
  const apiFormat = chatToApiFormat(chat);
  try {
    const response = await api.post<ApiChatResponse>('/api/chats', apiFormat);
    return apiToChatFormat(response);
  } catch (error) {
    // Check if error is due to chat being too large
    if (error instanceof ApiError && (error.status === 413 || error.status === 500)) {
      const errorMsg = error.message?.toLowerCase() || '';
      const rawErrorStr = JSON.stringify(error.data || {}).toLowerCase();

      if (
        errorMsg.includes('too large') ||
        errorMsg.includes('16mb') ||
        errorMsg.includes('entity') ||
        errorMsg.includes('bsonobjecttoolar') ||
        rawErrorStr.includes('too large') ||
        rawErrorStr.includes('16mb') ||
        rawErrorStr.includes('bsonobjecttoolar')
      ) {
        throw new ChatTooLargeError(chat.id, chat.title);
      }
    }
    throw error;
  }
}

/**
 * Custom error for chats that exceed MongoDB size limit
 */
export class ChatTooLargeError extends Error {
  constructor(
    public chatId: string,
    public chatTitle: string
  ) {
    super(`Chat "${chatTitle}" is too large to sync (exceeds 16MB limit)`);
    this.name = 'ChatTooLargeError';
  }
}

/**
 * Bulk sync multiple chats to cloud
 */
export async function bulkSyncToCloud(chats: Chat[]): Promise<ApiBulkSyncResponse> {
  const apiFormat = {
    chats: chats.map(chatToApiFormat),
  };
  return api.post<ApiBulkSyncResponse>('/api/chats/sync', apiFormat);
}

/**
 * Update chat metadata (title, starred) without replacing messages
 */
export async function updateCloudChat(
  chatId: string,
  updates: { title?: string; is_starred?: boolean; model?: string }
): Promise<ApiChatListItem> {
  const version = chatVersions.get(chatId) || 0;
  const response = await api.put<ApiChatListItem>(`/api/chats/${chatId}`, {
    ...updates,
    version,
  });

  // Update stored version
  chatVersions.set(chatId, response.version);
  return response;
}

/**
 * Delete a chat from cloud
 * Treats 404 (Not Found) as success since the chat is already gone
 */
export async function deleteCloudChat(chatId: string): Promise<void> {
  try {
    await api.delete(`/api/chats/${chatId}`);
    chatVersions.delete(chatId);
  } catch (error) {
    // If chat doesn't exist (404), consider it a successful delete
    if (error instanceof ApiError && error.status === 404) {
      console.log(`Chat ${chatId} not found in cloud (already deleted)`);
      chatVersions.delete(chatId);
      return;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Delete all chats from cloud (GDPR compliance)
 */
export async function deleteAllCloudChats(): Promise<{ deleted: number }> {
  const response = await api.delete<{ success: boolean; deleted: number }>('/api/chats');
  chatVersions.clear();
  return { deleted: response.deleted };
}

/**
 * Add a single message to a cloud chat
 */
export async function addMessageToCloudChat(chatId: string, message: Message): Promise<Chat> {
  const version = chatVersions.get(chatId) || 0;
  const apiMessage: ApiChatMessage = {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp:
      message.timestamp instanceof Date ? message.timestamp.getTime() : Number(message.timestamp),
    isStreaming: message.isStreaming,
    status: message.status,
    error: message.error,
    attachments: message.attachments?.map(attachmentToApiFormat),
    toolCalls: message.toolCalls?.map(toolCallToApiFormat),
    reasoning: message.reasoning,
    artifacts: message.artifacts?.map(artifactToApiFormat),
    // Response versioning fields
    versionGroupId: message.versionGroupId,
    versionNumber: message.versionNumber,
    isHidden: message.isHidden,
    retryType: message.retryType,
  };

  const response = await api.post<ApiChatResponse>(`/api/chats/${chatId}/messages`, {
    message: apiMessage,
    version,
  });

  return apiToChatFormat(response);
}

/**
 * Debounced sync for a chat - prevents excessive API calls during typing
 */
export function debouncedSyncChat(
  chat: Chat,
  onSync: (result: Chat) => void,
  onError?: (error: Error) => void
): void {
  // Cancel any pending sync for this chat
  const existingTimeout = pendingSyncs.get(chat.id);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Schedule new sync
  const timeout = setTimeout(async () => {
    pendingSyncs.delete(chat.id);
    try {
      const result = await syncChatToCloud(chat);
      onSync(result);
    } catch (error) {
      console.error(`Failed to sync chat ${chat.id}:`, error);
      if (onError && error instanceof Error) {
        onError(error);
      }
    }
  }, DEBOUNCE_MS);

  pendingSyncs.set(chat.id, timeout);
}

/**
 * Cancel pending sync for a chat
 */
export function cancelPendingSync(chatId: string): void {
  const timeout = pendingSyncs.get(chatId);
  if (timeout) {
    clearTimeout(timeout);
    pendingSyncs.delete(chatId);
  }
}

/**
 * Get the current version for a chat (for optimistic locking)
 */
export function getChatVersion(chatId: string): number | undefined {
  return chatVersions.get(chatId);
}

/**
 * Set the version for a chat (after syncing from cloud)
 */
export function setChatVersion(chatId: string, version: number): void {
  chatVersions.set(chatId, version);
}

/**
 * Clear all stored versions (on logout or mode switch)
 */
export function clearChatVersions(): void {
  chatVersions.clear();
}

/**
 * Check if user is authenticated (can use cloud sync)
 */
export function isAuthenticated(): boolean {
  try {
    const authStorage = localStorage.getItem('auth-storage');
    if (authStorage) {
      const { state } = JSON.parse(authStorage);
      return !!state?.accessToken;
    }
  } catch {
    // Invalid JSON
  }
  return false;
}

/**
 * Download a chat as JSON file
 * Useful when a chat is too large to sync to cloud
 */
export function downloadChatAsJSON(chat: Chat): void {
  const chatData = {
    id: chat.id,
    folderId: chat.folderId,
    title: chat.title,
    messages: chat.messages.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      attachments: msg.attachments,
      toolCalls: msg.toolCalls,
      reasoning: msg.reasoning,
      artifacts: msg.artifacts,
    })),
    isStarred: chat.isStarred,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };

  const blob = new Blob([JSON.stringify(chatData, null, 2)], {
    type: 'application/json',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  // Create safe filename
  const safeTitle = chat.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
  const dateStr = new Date().toISOString().split('T')[0];
  link.download = `chat-${safeTitle}-${dateStr}.json`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ===== FOLDERS =====

/**
 * Fetch all folders from cloud
 */
export async function fetchAllCloudFolders(): Promise<import('@/types/chat').Folder[]> {
  try {
    const response = await api.get<ApiFolder[]>('/api/chats/folders');
    if (!Array.isArray(response)) return [];
    return response.map(f => ({
      id: f.id,
      name: f.name,
      createdAt: new Date(f.created_at),
      updatedAt: new Date(f.updated_at),
    }));
  } catch (error) {
    console.error('Failed to fetch cloud folders:', error);
    return [];
  }
}

/**
 * Sync folder to cloud
 */
export async function syncFolderToCloud(folder: import('@/types/chat').Folder): Promise<void> {
  await api.post('/api/chats/folders', {
    id: folder.id,
    name: folder.name,
  });
}

/**
 * Delete folder from cloud
 */
export async function deleteCloudFolder(folderId: string): Promise<void> {
  await api.delete(`/api/chats/folders/${folderId}`);
}
