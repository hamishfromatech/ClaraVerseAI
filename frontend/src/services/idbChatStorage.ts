/**
 * IndexedDB Chat Storage Adapter
 *
 * Custom storage adapter for Zustand's persist middleware.
 * Replaces localStorage with IndexedDB for unlimited storage.
 * Includes throttling during streaming to prevent excessive writes.
 */

import type { StateStorage } from 'zustand/middleware';
import type { Chat, Folder } from '@/types/chat';
import * as chatDB from './chatDatabase';

// Throttle configuration
const THROTTLE_MS = 1000; // Max 1 write per second during streaming

// Throttle state
let pendingWrite: { chats: Chat[]; folders: Folder[]; activeNav: string } | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let isStreaming = false;

/**
 * Get user-specific storage name (for multi-user support)
 */
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
 * Flush pending write to IndexedDB
 */
async function flushWrite(): Promise<void> {
  if (pendingWrite) {
    try {
      await Promise.all([
        chatDB.saveChats(pendingWrite.chats),
        chatDB.saveFolders(pendingWrite.folders),
      ]);
      // Also persist activeNav to localStorage (small, ok for localStorage)
      const userKey = getUserStorageName('chat-nav');
      localStorage.setItem(userKey, pendingWrite.activeNav);
    } catch (error) {
      console.error('[IDBStorage] Failed to flush write:', error);
    }
    pendingWrite = null;
  }
  writeTimer = null;
}

/**
 * Convert date strings back to Date objects (for data loaded from IDB)
 */
function reviveDates(chats: Chat[]): Chat[] {
  return chats.map(chat => ({
    ...chat,
    createdAt: chat.createdAt instanceof Date ? chat.createdAt : new Date(chat.createdAt),
    updatedAt: chat.updatedAt instanceof Date ? chat.updatedAt : new Date(chat.updatedAt),
    lastActivityAt: chat.lastActivityAt
      ? chat.lastActivityAt instanceof Date
        ? chat.lastActivityAt
        : new Date(chat.lastActivityAt)
      : undefined,
    messages: chat.messages.map(msg => ({
      ...msg,
      timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
      // Clean up stale streaming state
      isStreaming: false,
      // Clean up stale tool states
      toolCalls: msg.toolCalls?.map(tool => ({
        ...tool,
        status: (tool.status === 'executing' ? 'completed' : tool.status) as
          | 'executing'
          | 'completed',
      })),
    })),
  }));
}

/**
 * Migrate data from localStorage to IndexedDB (one-time)
 */
async function migrateFromLocalStorage(): Promise<void> {
  const needsMigration = await chatDB.needsMigration();
  if (!needsMigration) return;

  console.log('[IDBStorage] Checking for localStorage data to migrate...');

  // Try user-specific storage first, then fallback to generic
  const userKey = getUserStorageName('chat-storage');
  const legacyData = localStorage.getItem(userKey) || localStorage.getItem('chat-storage');

  if (legacyData) {
    try {
      const { state } = JSON.parse(legacyData);
      if (state?.chats?.length > 0) {
        console.log(`[IDBStorage] Migrating ${state.chats.length} chats from localStorage...`);

        // Revive dates before saving
        const chats = reviveDates(state.chats);
        await chatDB.saveChats(chats);

        // Create backup and remove original
        localStorage.setItem(`${userKey}-backup`, legacyData);
        localStorage.removeItem(userKey);
        if (userKey !== 'chat-storage') {
          localStorage.removeItem('chat-storage');
        }

        console.log('[IDBStorage] Migration complete!');
      }
    } catch (error) {
      console.error('[IDBStorage] Migration failed:', error);
    }
  }

  await chatDB.markMigrationComplete();
}

// Migration promise - ensures migration completes before any reads
let migrationPromise: Promise<void> | null = null;

/**
 * Create the IDB storage adapter for Zustand persist middleware
 */
export function createIDBChatStorage(): StateStorage {
  // Start migration on first load (will be awaited in getItem)
  migrationPromise = migrateFromLocalStorage().catch(err => {
    console.error('[IDBStorage] Initial migration failed:', err);
  });

  return {
    getItem: async (_name: string): Promise<string | null> => {
      try {
        // CRITICAL: Wait for migration to complete before reading
        // This ensures existing localStorage data is migrated to IDB first
        if (migrationPromise) {
          await migrationPromise;
          migrationPromise = null; // Only need to wait once
        }

        // Get chats from IndexedDB
        const [chats, folders] = await Promise.all([
          chatDB.getAllChats(),
          chatDB.getAllFolders(),
        ]);

        // Get activeNav from localStorage (small enough)
        const userKey = getUserStorageName('chat-nav');
        const activeNav = localStorage.getItem(userKey) || 'chats';

        // Get deletedChatIds from localStorage (stored as JSON array)
        const deletedKey = getUserStorageName('chat-deleted-ids');
        let deletedChatIds: string[] = [];
        try {
          const deletedJson = localStorage.getItem(deletedKey);
          if (deletedJson) {
            deletedChatIds = JSON.parse(deletedJson);
          }
        } catch {
          // Invalid JSON, start fresh
        }

        // Revive dates and clean up stale states
        const revivedChats = reviveDates(chats);

        // Return in format expected by Zustand persist
        // Note: deletedChatIds is stored as array, will be converted to Set by store
        return JSON.stringify({
          state: {
            chats: revivedChats,
            folders,
            activeNav,
            deletedChatIds: deletedChatIds,
          },
        });
      } catch (error) {
        console.error('[IDBStorage] getItem failed:', error);
        return null;
      }
    },

    setItem: async (_name: string, value: string): Promise<void> => {
      try {
        const parsed = JSON.parse(value);
        const chats: Chat[] = parsed.state?.chats || [];
        const folders: Folder[] = parsed.state?.folders || [];
        const activeNav: string = parsed.state?.activeNav || 'chats';

        // Handle deletedChatIds - can be Set, array, or object (from bad serialization)
        let deletedChatIds: string[] = [];
        const rawDeleted = parsed.state?.deletedChatIds;
        if (rawDeleted) {
          if (Array.isArray(rawDeleted)) {
            deletedChatIds = rawDeleted;
          } else if (rawDeleted instanceof Set) {
            deletedChatIds = Array.from(rawDeleted);
          } else if (typeof rawDeleted === 'object') {
            // Handle case where Set was serialized as object with numeric keys
            deletedChatIds = Object.values(rawDeleted);
          }
        }

        // Persist deletedChatIds to localStorage (small, separate from chats)
        const deletedKey = getUserStorageName('chat-deleted-ids');
        localStorage.setItem(deletedKey, JSON.stringify(deletedChatIds));

        // Check if we're currently streaming
        isStreaming = parsed.state?.streamingMessageId !== null;

        if (isStreaming) {
          // Throttle writes during streaming
          pendingWrite = { chats, folders, activeNav };
          if (!writeTimer) {
            writeTimer = setTimeout(() => {
              flushWrite();
            }, THROTTLE_MS);
          }
        } else {
          // Immediate write when not streaming
          if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
          }
          // Flush any pending write first
          if (pendingWrite) {
            await flushWrite();
          }
          // Then write current data
          pendingWrite = { chats, folders, activeNav };
          await flushWrite();
        }
      } catch (error) {
        console.error('[IDBStorage] setItem failed:', error);
      }
    },

    removeItem: async (_name: string): Promise<void> => {
      try {
        // Clear timer
        if (writeTimer) {
          clearTimeout(writeTimer);
          writeTimer = null;
        }
        pendingWrite = null;

        // Clear IndexedDB
        await chatDB.clearAll();

        // Clear localStorage nav
        const userKey = getUserStorageName('chat-nav');
        localStorage.removeItem(userKey);

        console.log('[IDBStorage] Storage cleared');
      } catch (error) {
        console.error('[IDBStorage] removeItem failed:', error);
      }
    },
  };
}

/**
 * Force flush any pending writes (call before logout, etc.)
 */
export async function flushPendingWrites(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  await flushWrite();
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{
  chatCount: number;
  messageCount: number;
  estimatedSize: string;
}> {
  const stats = await chatDB.getStats();

  // Estimate size (rough approximation)
  const estimatedBytes = stats.messageCount * 2000; // ~2KB per message average
  const estimatedSize =
    estimatedBytes < 1024 * 1024
      ? `${Math.round(estimatedBytes / 1024)} KB`
      : `${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;

  return {
    ...stats,
    estimatedSize,
  };
}
