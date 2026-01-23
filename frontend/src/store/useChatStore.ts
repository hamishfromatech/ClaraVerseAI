import { create } from 'zustand';
import { devtools, persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { Chat, Message, Folder } from '@/types/chat';
import type { ActivePrompt, PromptAnswer } from '@/types/interactivePrompt';
import * as chatSyncService from '@/services/chatSyncService';
import { useSettingsStore } from '@/store/useSettingsStore';
import { createIDBChatStorage } from '@/services/idbChatStorage';
import * as chatDatabase from '@/services/chatDatabase';

// Create the IDB storage adapter (replaces localStorage for unlimited storage)
const idbStorage = createIDBChatStorage();

/**
 * Process markdown tags (<think>, tool markers) from raw content.
 * Called ONCE after streaming completes to avoid heavy regex on every chunk.
 */
function processMarkdownTags(rawContent: string): { content: string; reasoning: string } {
  let content = rawContent;
  let reasoning = '';

  const thinkStartTag = '<think>';
  const thinkEndTag = '</think>';

  // Case 1: Handle </think> without opening <think> tag
  // Some models output reasoning content followed by just </think>
  const hasOpeningTag = content.includes(thinkStartTag);
  const hasClosingTag = content.includes(thinkEndTag);

  if (hasClosingTag && !hasOpeningTag) {
    // No opening tag but has closing tag - treat everything before </think> as reasoning
    const closeIndex = content.indexOf(thinkEndTag);
    const reasoningContent = content.substring(0, closeIndex).trim();
    if (reasoningContent) {
      reasoning += reasoningContent;
    }
    // Content after </think> is the actual response
    content = content.substring(closeIndex + thinkEndTag.length).trim();
  } else {
    // Case 2: Extract all complete <think>...</think> blocks (normal case)
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let thinkMatch;
    while ((thinkMatch = thinkRegex.exec(content)) !== null) {
      reasoning += thinkMatch[1];
    }
    // Remove complete think blocks from content
    content = content.replace(thinkRegex, '');

    // Case 3: Handle incomplete think block at the end (still streaming)
    const lastThinkStart = content.lastIndexOf(thinkStartTag);
    if (lastThinkStart !== -1) {
      const afterStart = content.substring(lastThinkStart + thinkStartTag.length);
      // Check if there's no closing tag after this opening tag
      if (!afterStart.includes(thinkEndTag)) {
        // This is an incomplete think block - extract reasoning content
        reasoning += afterStart;
        // Remove the incomplete think block from content
        content = content.substring(0, lastThinkStart);
      }
    }
  }

  // Clean up any tool call markers (used by some models like Kimi)
  content = content
    .replace(/<\|tool_call_begin\|>/g, '')
    .replace(/<\|tool_call_end\|>/g, '')
    .replace(/<\|tool_call_argument_begin\|>/g, '')
    .trim();

  return { content, reasoning };
}

interface ChatState {
  // State
  chats: Chat[];
  folders: Folder[];
  activeNav: string;
  selectedChatId: string | null;
  isNewChat: boolean;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  isHistoryOpen: boolean;
  streamingMessageId: string | null;
  conversationId: string | null;
  _persistThrottle?: number; // Internal: timestamp for throttling persist

  // Interactive prompt state
  activePrompt: ActivePrompt | null;
  isPromptOpen: boolean;
  promptQueue: ActivePrompt[];

  // Cloud sync state
  isSyncing: boolean;
  syncError: string | null;
  lastSyncAt: Date | null;
  pendingSyncIds: Set<string>;
  deletedChatIds: Set<string>; // Track deleted chats to prevent re-sync from cloud
  deletedFolderIds: Set<string>;

  // Computed
  selectedChat: () => Chat | null;
  filteredChats: () => Chat[];
  recentChats: () => Chat[];

  // Actions
  setActiveNav: (nav: string) => void;
  setSearchQuery: (query: string) => void;
  selectChat: (chatId: string) => void;
  startNewChat: () => void;
  showHistory: () => void;
  createChat: (
    title: string,
    firstMessage: Message,
    systemInstructions?: string,
    chatId?: string,
    folderId?: string
  ) => string;
  updateChatTitle: (chatId: string, title: string) => void;
  toggleStarChat: (chatId: string) => void;
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  updateMessageStatus: (
    chatId: string,
    messageId: string,
    status: 'sending' | 'sent' | 'error'
  ) => void;
  editMessage: (chatId: string, messageId: string, newContent: string) => void;
  deleteChat: (chatId: string) => Promise<void>;
  moveChatToFolder: (chatId: string, folderId: string | null) => void;

  // Folder actions
  createFolder: (name: string) => void;
  updateFolder: (folderId: string, name: string) => void;
  deleteFolder: (folderId: string) => Promise<void>;
  toggleFolderExpanded: (folderId: string) => void;

  clearError: () => void;
  setError: (error: string) => void;
  setLoading: (loading: boolean) => void;
  openHistory: () => void;
  closeHistory: () => void;
  // Streaming actions
  startStreaming: (chatId: string, messageId: string) => void;
  appendStreamChunk: (chatId: string, messageId: string, chunk: string) => void;
  finalizeStreamingMessage: (chatId: string, messageId: string) => void;
  setConversationId: (conversationId: string) => void;

  // Interactive prompt actions
  setActivePrompt: (prompt: ActivePrompt | null) => void;
  clearActivePrompt: () => void;
  submitPromptResponse: (promptId: string, answers: Record<string, PromptAnswer>) => void;
  skipPrompt: (promptId: string) => void;

  // Cloud sync actions
  initializeCloudSync: () => Promise<void>;
  syncChatToCloud: (chatId: string) => Promise<void>;
  syncFolderToCloud: (folderId: string) => Promise<void>;
  syncAllToCloud: () => Promise<void>;
  handlePrivacyModeSwitch: (newMode: 'local' | 'cloud') => Promise<void>;
  clearSyncError: () => void;
  retryPendingDeletes: () => Promise<void>;

  // Reset store (call on logout to clear in-memory state)
  resetStore: () => void;
}

export const useChatStore = create<ChatState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        chats: [],
        folders: [],
        activeNav: 'chats',
        selectedChatId: null,
        isNewChat: true,
        searchQuery: '',
        isLoading: false,
        error: null,
        isHistoryOpen: false,
        streamingMessageId: null,
        conversationId: null,

        // Interactive prompt state
        activePrompt: null,
        isPromptOpen: false,
        promptQueue: [],

        // Cloud sync state
        isSyncing: false,
        syncError: null,
        lastSyncAt: null,
        pendingSyncIds: new Set(),
        deletedChatIds: new Set(),
        deletedFolderIds: new Set(),

        // Computed
        selectedChat: () => {
          const { chats, selectedChatId } = get();
          return chats.find(chat => chat.id === selectedChatId) || null;
        },

        filteredChats: () => {
          const { chats, searchQuery } = get();
          if (!searchQuery.trim()) return chats;

          const query = searchQuery.toLowerCase();
          return chats.filter(
            chat =>
              chat.title.toLowerCase().includes(query) ||
              chat.messages.some(msg => msg.content.toLowerCase().includes(query))
          );
        },

        recentChats: () => {
          const { chats } = get();
          return [...chats]
            .sort((a, b) => {
              // Ensure dates are Date objects
              const dateA = a.updatedAt instanceof Date ? a.updatedAt : new Date(a.updatedAt);
              const dateB = b.updatedAt instanceof Date ? b.updatedAt : new Date(b.updatedAt);
              return dateB.getTime() - dateA.getTime();
            })
            .slice(0, 10);
        },

        // Actions
        setActiveNav: nav => set({ activeNav: nav }),

        setSearchQuery: query => set({ searchQuery: query }),

        selectChat: chatId =>
          set(state => {
            // Save current prompt to the old chat (if any)
            let chats = state.chats;
            if (state.selectedChatId && state.activePrompt) {
              chats = chats.map(chat =>
                chat.id === state.selectedChatId
                  ? { ...chat, pendingPrompt: state.activePrompt ?? undefined }
                  : chat
              );
            }

            // Find the target chat and restore its pending prompt
            const targetChat = chats.find(c => c.id === chatId);
            const restoredPrompt = targetChat?.pendingPrompt ?? null;

            // Clear pendingPrompt from target chat since we're restoring it
            if (restoredPrompt) {
              chats = chats.map(chat =>
                chat.id === chatId ? { ...chat, pendingPrompt: undefined } : chat
              );
            }

            return {
              chats,
              selectedChatId: chatId,
              isNewChat: false,
              error: null,
              activePrompt: restoredPrompt,
              isPromptOpen: restoredPrompt !== null,
              promptQueue: [],
            };
          }),

        startNewChat: () =>
          set(state => {
            // Save current prompt to the current chat (if any)
            let chats = state.chats;
            if (state.selectedChatId && state.activePrompt) {
              chats = chats.map(chat =>
                chat.id === state.selectedChatId
                  ? { ...chat, pendingPrompt: state.activePrompt ?? undefined }
                  : chat
              );
            }

            return {
              chats,
              selectedChatId: null,
              isNewChat: true,
              error: null,
              activePrompt: null,
              isPromptOpen: false,
              promptQueue: [],
            };
          }),

        showHistory: () =>
          set(state => {
            // Save current prompt to the current chat (if any)
            let chats = state.chats;
            if (state.selectedChatId && state.activePrompt) {
              chats = chats.map(chat =>
                chat.id === state.selectedChatId
                  ? { ...chat, pendingPrompt: state.activePrompt ?? undefined }
                  : chat
              );
            }

            return {
              chats,
              selectedChatId: null,
              isNewChat: false,
              error: null,
              activePrompt: null,
              isPromptOpen: false,
              promptQueue: [],
            };
          }),

        createChat: (title, firstMessage, systemInstructions?, chatId?, folderId?) => {
          const finalChatId = chatId || crypto.randomUUID(); // Use provided ID or generate new UUID v4
          const now = new Date();

          const newChat: Chat = {
            id: finalChatId,
            folderId,
            title,
            messages: [firstMessage],
            createdAt: now,
            updatedAt: now,
            lastActivityAt: firstMessage.role === 'user' ? now : undefined, // Track user message activity
            systemInstructions, // Support custom prompts
          };

          set(state => ({
            chats: [newChat, ...state.chats],
            selectedChatId: finalChatId,
            isNewChat: false,
            error: null,
          }));

          // Trigger cloud sync
          get().syncChatToCloud(finalChatId);

          return finalChatId;
        },

        updateChatTitle: (chatId, title) => {
          set(state => ({
            chats: state.chats.map(chat =>
              chat.id === chatId ? { ...chat, title, updatedAt: new Date() } : chat
            ),
          }));
          // Trigger cloud sync
          get().syncChatToCloud(chatId);
        },

        toggleStarChat: chatId => {
          set(state => ({
            chats: state.chats.map(chat =>
              chat.id === chatId ? { ...chat, isStarred: !chat.isStarred } : chat
            ),
          }));
          // Trigger cloud sync
          get().syncChatToCloud(chatId);
        },

        addMessage: (chatId, message) => {
          set(state => ({
            chats: state.chats.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: [...chat.messages, message],
                    updatedAt: new Date(),
                    lastActivityAt: message.role === 'user' ? new Date() : chat.lastActivityAt, // Update on user messages only
                  }
                : chat
            ),
          }));
          // Only sync user messages immediately (assistant messages sync after streaming completes)
          if (message.role === 'user') {
            get().syncChatToCloud(chatId);
          }
        },

        updateMessage: (chatId, messageId, updates) => {
          set(state => ({
            chats: state.chats.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === messageId ? { ...msg, ...updates } : msg
                    ),
                    updatedAt: new Date(),
                  }
                : chat
            ),
          }));
          // Trigger cloud sync for significant updates (not during streaming)
          const streamingId = get().streamingMessageId;
          if (streamingId !== messageId) {
            get().syncChatToCloud(chatId);
          }
        },

        updateMessageStatus: (chatId, messageId, status) =>
          set(state => ({
            chats: state.chats.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === messageId ? { ...msg, status } : msg
                    ),
                  }
                : chat
            ),
          })),

        editMessage: (chatId, messageId, newContent) => {
          set(state => ({
            chats: state.chats.map(chat => {
              if (chat.id !== chatId) return chat;
              const messageIndex = chat.messages.findIndex(m => m.id === messageId);
              if (messageIndex === -1) return chat;

              // Keep all messages up to the edited one, update it, and discard all after it
              const updatedMessages = chat.messages.slice(0, messageIndex + 1).map(msg =>
                msg.id === messageId ? { ...msg, content: newContent, updatedAt: new Date() } : msg
              );

              return {
                ...chat,
                messages: updatedMessages,
                updatedAt: new Date(),
              };
            }),
          }));
          // Trigger cloud sync
          get().syncChatToCloud(chatId);
        },

        deleteChat: async chatId => {
          // Add to deleted IDs immediately to prevent re-sync
          set(state => {
            const newDeletedIds = new Set(state.deletedChatIds);
            newDeletedIds.add(chatId);
            return {
              chats: state.chats.filter(chat => chat.id !== chatId),
              selectedChatId: state.selectedChatId === chatId ? null : state.selectedChatId,
              deletedChatIds: newDeletedIds,
            };
          });

          // Delete from IndexedDB (critical fix!)
          try {
            await chatDatabase.deleteChat(chatId);
            console.log(`✅ Deleted chat ${chatId} from IndexedDB`);
          } catch (error) {
            console.error('Failed to delete chat from IndexedDB:', error);
          }

          // Delete from cloud
          const chatPrivacyMode = useSettingsStore.getState().chatPrivacyMode;
          if (chatPrivacyMode === 'cloud' && chatSyncService.isAuthenticated()) {
            try {
              await chatSyncService.deleteCloudChat(chatId);
              // Only remove from deletedChatIds if cloud delete succeeds
              set(state => {
                const newDeletedIds = new Set(state.deletedChatIds);
                newDeletedIds.delete(chatId);
                return { deletedChatIds: newDeletedIds };
              });
            } catch (error) {
              console.error('Failed to delete chat from cloud:', error);
              // Keep chatId in deletedChatIds to prevent it from being re-synced
              set({
                syncError: 'Failed to delete chat from cloud. It will be removed on next sync.',
              });
            }
          } else {
            // Not syncing to cloud, so remove from deletedChatIds immediately
            set(state => {
              const newDeletedIds = new Set(state.deletedChatIds);
              newDeletedIds.delete(chatId);
              return { deletedChatIds: newDeletedIds };
            });
          }
        },

        moveChatToFolder: (chatId, folderId) => {
          set(state => ({
            chats: state.chats.map(chat =>
              chat.id === chatId ? { ...chat, folderId: folderId || undefined, updatedAt: new Date() } : chat
            ),
          }));
          // Trigger cloud sync
          get().syncChatToCloud(chatId);
        },

        // Folder actions
        createFolder: name => {
          const id = crypto.randomUUID();
          const now = new Date();
          const newFolder: Folder = {
            id,
            name,
            createdAt: now,
            updatedAt: now,
            isExpanded: true,
          };

          set(state => ({
            folders: [newFolder, ...state.folders],
          }));

          // Trigger cloud sync
          get().syncFolderToCloud(id);
        },

        updateFolder: (folderId, name) => {
          set(state => ({
            folders: state.folders.map(f =>
              f.id === folderId ? { ...f, name, updatedAt: new Date() } : f
            ),
          }));
          // Trigger cloud sync
          get().syncFolderToCloud(folderId);
        },

        deleteFolder: async folderId => {
          // Track for deletion
          set(state => {
            const newDeletedIds = new Set(state.deletedFolderIds);
            newDeletedIds.add(folderId);
            return {
              folders: state.folders.filter(f => f.id !== folderId),
              // Uncategorize chats in this folder
              chats: state.chats.map(chat =>
                chat.folderId === folderId ? { ...chat, folderId: undefined, updatedAt: new Date() } : chat
              ),
              deletedFolderIds: newDeletedIds,
            };
          });

          // Delete from IndexedDB
          try {
            await chatDatabase.deleteFolder(folderId);
            // Also need to update chats in IndexedDB that were in this folder
            get().chats.forEach(chat => {
              if (chat.folderId === undefined) {
                // If it was just uncategorized, trigger sync to cloud to update folderId
                get().syncChatToCloud(chat.id);
              }
            });
          } catch (error) {
            console.error('Failed to delete folder from IndexedDB:', error);
          }

          // Delete from cloud
          const chatPrivacyMode = useSettingsStore.getState().chatPrivacyMode;
          if (chatPrivacyMode === 'cloud' && chatSyncService.isAuthenticated()) {
            try {
              await chatSyncService.deleteCloudFolder(folderId);
              set(state => {
                const newDeletedIds = new Set(state.deletedFolderIds);
                newDeletedIds.delete(folderId);
                return { deletedFolderIds: newDeletedIds };
              });
            } catch (error) {
              console.error('Failed to delete folder from cloud:', error);
            }
          } else {
            set(state => {
              const newDeletedIds = new Set(state.deletedFolderIds);
              newDeletedIds.delete(folderId);
              return { deletedFolderIds: newDeletedIds };
            });
          }
        },

        toggleFolderExpanded: folderId => {
          set(state => ({
            folders: state.folders.map(f =>
              f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f
            ),
          }));
        },

        clearError: () => set({ error: null }),

        setError: error => set({ error, isLoading: false }),

        setLoading: loading => set({ isLoading: loading }),

        openHistory: () => set({ isHistoryOpen: true }),

        closeHistory: () => set({ isHistoryOpen: false }),

        // Streaming actions
        startStreaming: (chatId, messageId) =>
          set(state => ({
            streamingMessageId: messageId,
            chats: state.chats.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === messageId ? { ...msg, isStreaming: true, content: '' } : msg
                    ),
                  }
                : chat
            ),
          })),

        appendStreamChunk: (chatId, messageId, chunk) =>
          set(state => {
            // Find the target chat and message to minimize cloning
            const chatIndex = state.chats.findIndex(c => c.id === chatId);
            if (chatIndex === -1) return state;

            const chat = state.chats[chatIndex];
            const messageIndex = chat.messages.findIndex(m => m.id === messageId);
            if (messageIndex === -1) return state;

            const message = chat.messages[messageIndex];

            // Direct concatenation - NO PROCESSING during streaming for performance
            // Tag processing deferred to finalizeStreamingMessage
            const newContent = (message.content || '') + chunk;

            // Create new arrays only for the affected chat and message
            const newChats = [...state.chats];
            newChats[chatIndex] = {
              ...chat,
              messages: [...chat.messages],
            };
            newChats[chatIndex].messages[messageIndex] = {
              ...message,
              content: newContent,
            };

            return { chats: newChats };
          }),

        finalizeStreamingMessage: (chatId, messageId) => {
          set(state => {
            // Find the message and process markdown tags ONCE
            const chat = state.chats.find(c => c.id === chatId);
            const message = chat?.messages.find(m => m.id === messageId);

            if (message && message.content) {
              // Process markdown tags now that streaming is complete
              const { content, reasoning } = processMarkdownTags(message.content);

              return {
                streamingMessageId: null,
                chats: state.chats.map(c =>
                  c.id === chatId
                    ? {
                        ...c,
                        messages: c.messages.map(msg =>
                          msg.id === messageId
                            ? {
                                ...msg,
                                content,
                                reasoning: reasoning || msg.reasoning || undefined,
                                isStreaming: false,
                                status: 'sent',
                              }
                            : msg
                        ),
                        updatedAt: new Date(),
                      }
                    : c
                ),
              };
            }

            // Fallback if message not found or no content
            return {
              streamingMessageId: null,
              chats: state.chats.map(c =>
                c.id === chatId
                  ? {
                      ...c,
                      messages: c.messages.map(msg =>
                        msg.id === messageId
                          ? {
                              ...msg,
                              isStreaming: false,
                              status: 'sent',
                            }
                          : msg
                      ),
                      updatedAt: new Date(),
                    }
                  : c
              ),
            };
          });
          // Sync after streaming completes
          get().syncChatToCloud(chatId);
        },

        setConversationId: conversationId => set({ conversationId }),

        // Interactive prompt actions
        setActivePrompt: prompt => {
          const current = get().activePrompt;
          const selectedChatId = get().selectedChatId;

          if (current && prompt) {
            // Another prompt is active, queue this one
            set(state => ({
              promptQueue: [...state.promptQueue, prompt],
            }));
          } else {
            // Clear pendingPrompt from current chat since we're activating a prompt
            set(state => ({
              activePrompt: prompt,
              isPromptOpen: prompt !== null,
              // Clear pendingPrompt from chat if setting an active prompt
              chats:
                prompt && selectedChatId
                  ? state.chats.map(chat =>
                      chat.id === selectedChatId ? { ...chat, pendingPrompt: undefined } : chat
                    )
                  : state.chats,
            }));
          }
        },

        clearActivePrompt: () => {
          const queue = get().promptQueue;

          if (queue.length > 0) {
            // Show next prompt from queue
            const [next, ...remaining] = queue;
            set({
              activePrompt: next,
              isPromptOpen: true,
              promptQueue: remaining,
            });
          } else {
            set({
              activePrompt: null,
              isPromptOpen: false,
            });
          }
        },

        submitPromptResponse: (promptId, answers) => {
          const state = get();
          if (!state.activePrompt || state.activePrompt.promptId !== promptId) {
            console.warn('Prompt mismatch or no active prompt');
            return;
          }

          // NOTE: We don't add the prompt response as a separate message to history
          // The prompt is already visible as a tool call in the streaming message
          // The answers are sent to the backend and will be incorporated in the LLM's response
          // This prevents the UI from showing copy/retry buttons while generation is still ongoing

          console.log('📋 [PROMPT] Submitted response:', {
            promptId,
            title: state.activePrompt.title,
            answers: Object.entries(answers).map(([qId, answer]) => ({
              questionId: qId,
              value: answer.value,
            })),
          });

          // Clear active prompt (will show next queued prompt if any)
          state.clearActivePrompt();
        },

        skipPrompt: promptId => {
          const state = get();
          if (!state.activePrompt || state.activePrompt.promptId !== promptId) {
            return;
          }

          // Clear active prompt (will show next queued prompt if any)
          state.clearActivePrompt();
        },

        // Cloud sync actions
        initializeCloudSync: async () => {
          const chatPrivacyMode = useSettingsStore.getState().chatPrivacyMode;
          if (chatPrivacyMode !== 'cloud') return;

          if (!chatSyncService.isAuthenticated()) {
            console.log('User not authenticated, skipping cloud sync initialization');
            return;
          }

          set({ isSyncing: true, syncError: null });

          try {
            // First, retry any pending deletes
            await get().retryPendingDeletes();

            const [cloudChats, cloudFolders] = await Promise.all([
              chatSyncService.fetchAllCloudChats(),
              chatSyncService.fetchAllCloudFolders(),
            ]);

            // Sync Folders
            if (cloudFolders.length > 0) {
              const localFolders = get().folders;
              const deletedFolderIds = get().deletedFolderIds;
              const localFolderIds = new Set(localFolders.map(f => f.id));

              const newFolders = cloudFolders.filter(
                f => !localFolderIds.has(f.id) && !deletedFolderIds.has(f.id)
              );

              const mergedFolders = localFolders.map(localFolder => {
                const cloudVersion = cloudFolders.find(f => f.id === localFolder.id);
                if (cloudVersion && !deletedFolderIds.has(localFolder.id)) {
                  const localTime = new Date(localFolder.updatedAt).getTime();
                  const cloudTime = new Date(cloudVersion.updatedAt).getTime();
                  return cloudTime > localTime ? cloudVersion : localFolder;
                }
                return localFolder;
              });

              set({ folders: [...newFolders, ...mergedFolders] });
            }

            // Sync Chats
            if (cloudChats.length > 0) {
              // Merge cloud chats with local chats
              const localChats = get().chats;
              const deletedChatIds = get().deletedChatIds;
              const localChatIds = new Set(localChats.map(c => c.id));

              // Filter out deleted chats and add cloud chats that don't exist locally
              const newChats = cloudChats.filter(
                c => !localChatIds.has(c.id) && !deletedChatIds.has(c.id)
              );

              // Merge local and cloud chats, keeping the newer version based on updatedAt
              // This prevents data loss when local changes haven't been synced yet
              const mergedChats = localChats.map(localChat => {
                const cloudVersion = cloudChats.find(c => c.id === localChat.id);
                if (cloudVersion && !deletedChatIds.has(localChat.id)) {
                  // Compare timestamps - keep the one with more recent updatedAt
                  const localTime = new Date(localChat.updatedAt).getTime();
                  const cloudTime = new Date(cloudVersion.updatedAt).getTime();

                  if (cloudTime > localTime) {
                    // Cloud is newer, use cloud version
                    return cloudVersion;
                  } else if (localTime > cloudTime) {
                    // Local is newer, keep local and trigger sync to cloud
                    console.log(
                      `Chat ${localChat.id}: local is newer (${localChat.updatedAt}) than cloud (${cloudVersion.updatedAt}), keeping local`
                    );
                    // Schedule sync to push local changes to cloud
                    setTimeout(() => {
                      get().syncChatToCloud(localChat.id);
                    }, 100);
                    return localChat;
                  } else {
                    // Same timestamp, prefer cloud (has server-side version number)
                    return cloudVersion;
                  }
                }
                return localChat;
              });

              set({
                chats: [...newChats, ...mergedChats],
                lastSyncAt: new Date(),
              });

              console.log(
                `Cloud sync: loaded ${cloudChats.length} chats, merged ${newChats.length} new, filtered ${deletedChatIds.size} deleted`
              );
            }
          } catch (error) {
            console.error('Failed to initialize cloud sync:', error);
            set({ syncError: 'Failed to sync with cloud' });
          } finally {
            set({ isSyncing: false });
          }
        },

        syncChatToCloud: async (chatId: string) => {
          const chatPrivacyMode = useSettingsStore.getState().chatPrivacyMode;
          if (chatPrivacyMode !== 'cloud') return;

          if (!chatSyncService.isAuthenticated()) return;

          const chat = get().chats.find(c => c.id === chatId);
          if (!chat) return;

          // Use debounced sync to prevent excessive API calls
          chatSyncService.debouncedSyncChat(
            chat,
            syncedChat => {
              // Don't overwrite during streaming
              const currentState = get();
              if (currentState.streamingMessageId) {
                // Version is already updated by apiToChatFormat in the service
                return;
              }

              // Compare timestamps before overwriting - local changes may have happened
              // since the sync was initiated
              const currentChat = currentState.chats.find(c => c.id === syncedChat.id);
              if (currentChat) {
                const localTime = new Date(currentChat.updatedAt).getTime();
                const syncedTime = new Date(syncedChat.updatedAt).getTime();

                // Only update if synced version is newer or same time
                // If local is newer, it means changes happened while sync was in flight
                if (localTime > syncedTime) {
                  console.log(
                    `Chat ${syncedChat.id}: local changes during sync, keeping local and re-syncing`
                  );
                  // Version is already updated by the service, just trigger re-sync
                  setTimeout(() => {
                    get().syncChatToCloud(syncedChat.id);
                  }, 100);
                  return;
                }
              }

              // Update the chat with the synced version (includes new version number)
              set(state => ({
                chats: state.chats.map(c => (c.id === syncedChat.id ? { ...c, ...syncedChat } : c)),
                lastSyncAt: new Date(),
              }));
            },
            async error => {
              // Handle sync errors
              if (error instanceof chatSyncService.ChatTooLargeError) {
                // Show toast notification with download option
                const { useToastStore } = await import('./useToastStore');
                useToastStore.getState().addToast({
                  type: 'warning',
                  title: 'Chat Too Large to Sync',
                  message: `"${error.chatTitle}" exceeds the 16MB cloud sync limit. It will remain stored locally only.`,
                  duration: 10000, // 10 seconds
                  action: {
                    label: 'Download Backup',
                    onClick: () => {
                      const chatToDownload = get().chats.find(c => c.id === error.chatId);
                      if (chatToDownload) {
                        chatSyncService.downloadChatAsJSON(chatToDownload);
                      }
                    },
                  },
                });
                console.warn(`Chat ${error.chatId} is too large to sync to cloud`);
              } else {
                // Show generic error toast for other sync failures
                const { useToastStore } = await import('./useToastStore');
                const errorMsg =
                  error instanceof Error ? error.message : 'Failed to sync chat to cloud';
                useToastStore.getState().addToast({
                  type: 'error',
                  title: 'Sync Failed',
                  message: errorMsg,
                  duration: 5000,
                });
                console.error(`Failed to sync chat ${chatId}:`, error);
              }
            }
          );
        },

        syncFolderToCloud: async (folderId: string) => {
          const chatPrivacyMode = useSettingsStore.getState().chatPrivacyMode;
          if (chatPrivacyMode !== 'cloud') return;
          if (!chatSyncService.isAuthenticated()) return;

          const folder = get().folders.find(f => f.id === folderId);
          if (!folder) return;

          try {
            await chatSyncService.syncFolderToCloud(folder);
            set({ lastSyncAt: new Date() });
          } catch (error) {
            console.error(`Failed to sync folder ${folderId}:`, error);
          }
        },

        syncAllToCloud: async () => {
          const chatPrivacyMode = useSettingsStore.getState().chatPrivacyMode;
          if (chatPrivacyMode !== 'cloud') return;

          if (!chatSyncService.isAuthenticated()) {
            set({ syncError: 'Please sign in to sync chats' });
            return;
          }

          const chats = get().chats;
          if (chats.length === 0) return;

          set({ isSyncing: true, syncError: null });

          try {
            const result = await chatSyncService.bulkSyncToCloud(chats);

            if (result.failed > 0) {
              console.warn(`Bulk sync: ${result.synced} succeeded, ${result.failed} failed`);
              set({ syncError: `${result.failed} chats failed to sync` });
            } else {
              console.log(`Bulk sync: ${result.synced} chats synced successfully`);
            }

            set({ lastSyncAt: new Date() });
          } catch (error) {
            console.error('Failed to bulk sync:', error);
            set({ syncError: 'Failed to sync chats to cloud' });
          } finally {
            set({ isSyncing: false });
          }
        },

        handlePrivacyModeSwitch: async (newMode: 'local' | 'cloud') => {
          if (newMode === 'cloud') {
            // Switching to cloud: upload all local chats
            if (chatSyncService.isAuthenticated()) {
              await get().syncAllToCloud();
              // Then fetch any existing cloud chats
              await get().initializeCloudSync();
            }
          } else {
            // Switching to local: clear sync state, keep local chats
            chatSyncService.clearChatVersions();
            set({
              isSyncing: false,
              syncError: null,
              lastSyncAt: null,
              pendingSyncIds: new Set(),
            });
          }
        },

        clearSyncError: () => set({ syncError: null }),

        retryPendingDeletes: async () => {
          const { deletedChatIds } = get();
          if (deletedChatIds.size === 0) return;

          const chatPrivacyMode = useSettingsStore.getState().chatPrivacyMode;
          if (chatPrivacyMode !== 'cloud' || !chatSyncService.isAuthenticated()) return;

          console.log(`Retrying ${deletedChatIds.size} pending cloud deletes...`);

          // Try to delete each pending chat
          const deletePromises = Array.from(deletedChatIds).map(async chatId => {
            try {
              await chatSyncService.deleteCloudChat(chatId);
              // Remove from deletedChatIds on success
              set(state => {
                const newDeletedIds = new Set(state.deletedChatIds);
                newDeletedIds.delete(chatId);
                return { deletedChatIds: newDeletedIds };
              });
              console.log(`Successfully deleted chat ${chatId} from cloud`);
            } catch (error) {
              console.error(`Failed to delete chat ${chatId} from cloud:`, error);
              // Keep in deletedChatIds for next retry
            }
          });

          await Promise.allSettled(deletePromises);

          const remainingDeletes = get().deletedChatIds.size;
          if (remainingDeletes > 0) {
            console.log(`${remainingDeletes} cloud deletes still pending`);
            set({ syncError: `${remainingDeletes} chat(s) pending deletion from cloud` });
          }
        },

        // Reset store to initial state (call on logout)
        resetStore: () => {
          set({
            chats: [],
            folders: [],
            activeNav: 'chats',
            selectedChatId: null,
            isNewChat: true,
            searchQuery: '',
            isLoading: false,
            error: null,
            isHistoryOpen: false,
            streamingMessageId: null,
            conversationId: null,
            isSyncing: false,
            syncError: null,
            lastSyncAt: null,
            pendingSyncIds: new Set(),
            deletedChatIds: new Set(),
            deletedFolderIds: new Set(),
          });
          console.log('[ChatStore] Store reset for user switch');
        },
      }),
      {
        name: 'chat-storage', // Name is handled by IDB storage adapter
        partialize: (state): Pick<ChatState, 'chats' | 'folders' | 'activeNav' | 'deletedChatIds' | 'deletedFolderIds'> => ({
          chats: state.chats,
          folders: state.folders,
          activeNav: state.activeNav,
          deletedChatIds: state.deletedChatIds,
          deletedFolderIds: state.deletedFolderIds,
        }),
        // IndexedDB storage with throttling (replaces localStorage for unlimited storage)
        storage: createJSONStorage(() => idbStorage as StateStorage),
        // Custom merge to handle Set deserialization (JSON serializes Set as array)
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<ChatState>;
          // Convert deletedChatIds from array back to Set
          let deletedChatIds = currentState.deletedChatIds;
          if (persisted.deletedChatIds) {
            if (persisted.deletedChatIds instanceof Set) {
              deletedChatIds = persisted.deletedChatIds;
            } else if (Array.isArray(persisted.deletedChatIds)) {
              deletedChatIds = new Set(persisted.deletedChatIds as unknown as string[]);
            }
          }
          // Convert deletedFolderIds from array back to Set
          let deletedFolderIds = currentState.deletedFolderIds;
          if (persisted.deletedFolderIds) {
            if (persisted.deletedFolderIds instanceof Set) {
              deletedFolderIds = persisted.deletedFolderIds;
            } else if (Array.isArray(persisted.deletedFolderIds)) {
              deletedFolderIds = new Set(persisted.deletedFolderIds as unknown as string[]);
            }
          }
          return {
            ...currentState,
            ...persisted,
            deletedChatIds,
            deletedFolderIds,
          };
        },
      }
    )
  )
);
