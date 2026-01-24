import { api } from './api';
import type { ChatFolder } from '@/types/chat';

interface FolderListResponse {
  folders: ChatFolder[];
  folder_counts: Record<string, number>;
}

interface DeleteFolderResponse {
  message: string;
  chat_count: number;
}

interface MoveChatResponse {
  message: string;
}

/**
 * Folder service for managing chat folders
 */
export const folderService = {
  /**
   * Get all folders for the current user with chat counts
   */
  async getFolders(): Promise<FolderListResponse> {
    return api.get<FolderListResponse>('/api/conversations/folders');
  },

  /**
   * Create a new folder
   */
  async createFolder(name: string, color?: string, icon?: string, order?: number): Promise<ChatFolder> {
    return api.post<ChatFolder>('/api/conversations/folders', {
      name,
      color,
      icon,
      order,
    });
  },

  /**
   * Get a specific folder by ID
   */
  async getFolder(folderId: string): Promise<ChatFolder> {
    return api.get<ChatFolder>(`/api/conversations/folders/${folderId}`);
  },

  /**
   * Update a folder
   */
  async updateFolder(
    folderId: string,
    updates: {
      name?: string;
      color?: string;
      icon?: string;
      order?: number;
    }
  ): Promise<ChatFolder> {
    // Convert to partial update format (only send provided fields)
    const data: Record<string, any> = {};
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.color !== undefined) data.color = updates.color;
    if (updates.icon !== undefined) data.icon = updates.icon;
    if (updates.order !== undefined) data.order = updates.order;

    return api.put<ChatFolder>(`/api/conversations/folders/${folderId}`, data);
  },

  /**
   * Delete a folder (and all chats in it)
   */
  async deleteFolder(folderId: string): Promise<DeleteFolderResponse> {
    return api.delete<DeleteFolderResponse>(`/api/conversations/folders/${folderId}`);
  },

  /**
   * Move a chat to a folder (or out of folder by passing null)
   */
  async moveChatToFolder(chatId: string, folderId: string | null): Promise<MoveChatResponse> {
    return api.put<MoveChatResponse>(`/api/conversations/${chatId}/folder`, {
      folder_id: folderId,
    });
  },

  /**
   * Get chats in a specific folder
   */
  async getFolderChats(folderId: string, page = 1, pageSize = 20): Promise<{
    chats: Array<{
      id: string;
      title: string;
      is_starred: boolean;
      model?: string;
      message_count: number;
      version: number;
      folder_id?: string | null;
      created_at: string;
      updated_at: string;
    }>;
    total_count: number;
    page: number;
    page_size: number;
    has_more: boolean;
  }> {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });

    return api.get(`/api/conversations/folders/${folderId}/chats?${params.toString()}`);
  },
};