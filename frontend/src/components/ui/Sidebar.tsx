import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Home,
  PanelLeftClose,
  PanelLeft,
  Star,
  X,
  MessageSquare,
  FolderPlus,
  type LucideIcon,
} from 'lucide-react';
import styles from './Sidebar.module.css';
import logoIcon from '/logo.png';
import { ChatItemMenu } from './ChatItemMenu';
import { Skeleton } from '@/components/design-system/Skeleton/Skeleton';
import { FolderItem } from '@/components/chat/FolderItem';
import { CreateFolderModal } from '@/components/chat/CreateFolderModal';
import type { ChatFolder } from '@/types/chat';

/** Footer link configuration */
export interface FooterLink {
  href: string;
  label: string;
  icon: LucideIcon;
  ariaLabel?: string;
}

const MOBILE_BREAKPOINT = 768;

/** Check if we're on mobile */
const isMobileDevice = () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
  tooltip?: string;
}

export interface RecentChat {
  id: string;
  title: string;
  onClick?: () => void;
  status?: 'local-only' | 'active' | 'stale' | 'expired';
  lastActivityAt?: Date;
  isStarred?: boolean;
  folderId?: string | null;
  onStar?: (chatId: string) => void;
  onRename?: (chatId: string) => void;
  onDelete?: (chatId: string) => void;
  onMoveToFolder?: (chatId: string, folderId: string | null) => void;
}

export interface UserInfo {
  name: string;
  plan?: string;
  avatar?: string;
  initials?: string;
  onClick?: () => void;
}

export interface SidebarProps {
  /** Brand name displayed at the top */
  brandName?: string;
  /** Navigation items to display */
  navItems?: NavItem[];
  /** Recent chats to display */
  recentChats?: RecentChat[];
  /** Callback when "New Chat" is clicked */
  onNewChat?: () => void;
  /** Custom width for the sidebar */
  width?: string;
  /** Additional CSS class name */
  className?: string;
  /** External control: is sidebar open (for mobile) */
  isOpen?: boolean;
  /** External control: callback when sidebar should open/close */
  onOpenChange?: (open: boolean) => void;
  /** Footer links configuration - defaults to Home and Chats */
  footerLinks?: FooterLink[];
  /** Loading state for chat list */
  isLoadingChats?: boolean;
  /** Folders to display */
  folders?: ChatFolder[];
  /** Callback when creating a folder */
  onCreateFolder?: () => void;
  /** Callback when renaming a folder */
  onRenameFolder?: (folderId: string, newName: string) => void;
  /** Callback when deleting a folder */
  onDeleteFolder?: (folderId: string) => void;
  /** Callback when toggling folder expansion */
  onToggleFolder?: (folderId: string) => void;
  /** Set of expanded folder IDs */
  expandedFolders?: Set<string>;
  /** Callback when folder chat count should be updated */
  onRefreshFolders?: () => void;
}

/**
 * Sidebar component with proper accessibility and type safety
 */
/** Default footer links */
const DEFAULT_FOOTER_LINKS: FooterLink[] = [
  { href: '/', label: 'Home', icon: Home, ariaLabel: 'Navigate to home' },
  { href: '/chat', label: 'Chats', icon: MessageSquare, ariaLabel: 'Navigate to chats' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  brandName = '',
  navItems = [],
  recentChats = [],
  onNewChat,
  width,
  className = '',
  isOpen: externalIsOpen,
  onOpenChange,
  footerLinks = DEFAULT_FOOTER_LINKS,
  isLoadingChats = false,
  folders = [],
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  expandedFolders = new Set(),
  onRefreshFolders,
}) => {
  // Internal state for when not externally controlled
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(() => isMobileDevice());
  const [isMobile, setIsMobile] = useState(() => isMobileDevice());
  const [showSkeleton, setShowSkeleton] = useState(isLoadingChats);
  const loadingStartTimeRef = useRef<number>(Date.now());
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false);

  // Use external control if provided, otherwise use internal state
  const isExternallyControlled = externalIsOpen !== undefined;
  const isCollapsed = isExternallyControlled ? !externalIsOpen : internalIsCollapsed;

  const setIsCollapsed = (collapsed: boolean) => {
    if (isExternallyControlled && onOpenChange) {
      onOpenChange(!collapsed);
    } else {
      setInternalIsCollapsed(collapsed);
    }
  };

  // Show skeleton immediately and keep it visible for at least 1 second
  useEffect(() => {
    let minDisplayTimer: NodeJS.Timeout;

    if (isLoadingChats) {
      // Show skeleton immediately when loading starts and record the time
      loadingStartTimeRef.current = Date.now();
      setShowSkeleton(true);
    } else {
      // When loading stops, ensure skeleton stays visible for at least 1 second total
      const elapsedTime = Date.now() - loadingStartTimeRef.current;
      const remainingTime = Math.max(0, 1000 - elapsedTime);

      if (remainingTime > 0) {
        minDisplayTimer = setTimeout(() => {
          setShowSkeleton(false);
        }, remainingTime);
      } else {
        setShowSkeleton(false);
      }
    }

    return () => {
      if (minDisplayTimer) {
        clearTimeout(minDisplayTimer);
      }
    };
  }, [isLoadingChats]);

  // Listen for window resize and update mobile state
  useEffect(() => {
    const handleResize = () => {
      const mobile = isMobileDevice();
      setIsMobile(mobile);
      if (mobile && !isExternallyControlled) {
        setInternalIsCollapsed(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isExternallyControlled]);

  // Close sidebar when clicking outside on mobile
  const handleBackdropClick = () => {
    if (isMobile && !isCollapsed) {
      setIsCollapsed(true);
    }
  };

  // Close sidebar on mobile after navigation
  const closeSidebarOnMobile = () => {
    if (isMobile) {
      setIsCollapsed(true);
    }
  };

  const handleRecentChatClick = (_chatId: string, onClick?: () => void) => {
    if (onClick) {
      onClick();
    }
    closeSidebarOnMobile();
  };

  const handleNavItemClick = (item: NavItem) => {
    if (!item.disabled && item.onClick) {
      item.onClick();
    }
    closeSidebarOnMobile();
  };

  const handleNewChat = () => {
    if (onNewChat) {
      onNewChat();
    }
    closeSidebarOnMobile();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, callback?: () => void) => {
    if ((e.key === 'Enter' || e.key === ' ') && callback) {
      e.preventDefault();
      callback();
    }
  };

  // Folder handlers
  const handleToggleFolderExpand = (folderId: string) => {
    if (onToggleFolder) {
      onToggleFolder(folderId);
    }
  };

  const handleRenameFolder = (folderId: string, newName: string) => {
    if (onRenameFolder) {
      onRenameFolder(folderId, newName);
    }
  };

  const handleDeleteFolder = (folderId: string) => {
    if (onDeleteFolder) {
      onDeleteFolder(folderId);
    }
  };

  const handleCreateFolder = () => {
    setIsCreateFolderModalOpen(true);
  };

  const handleFolderCreated = async () => {
    setIsCreateFolderModalOpen(false);
    if (onRefreshFolders) {
      onRefreshFolders();
    }
  };

  // Get chat count for a folder
  const getFolderChatCount = (folderId: string) => {
    return recentChats.filter(chat => chat.folderId === folderId).length;
  };

  // Get chats in a specific folder
  const getFolderChats = (folderId: string) => {
    return recentChats.filter(chat => chat.folderId === folderId);
  };

  // Get ungrouped chats
  const getUngroupedChats = () => {
    return recentChats.filter(chat => !chat.folderId);
  };

  return (
    <>
      {/* Backdrop overlay for mobile - CSS controls visibility via media query */}
      <div
        className={`${styles.backdrop} ${!isCollapsed ? styles.visible : ''}`}
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      <aside
        className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''} ${className}`}
        style={width && !isCollapsed ? { width } : undefined}
        role="complementary"
        aria-label="Sidebar navigation"
      >
        {/* Header - Brand and Toggle */}
        <header className={styles.header}>
          {!isCollapsed && (
            <div className={styles.brandContainer}>
              <img src={logoIcon} alt="Clara logo" className={styles.brandIcon} />
              <span className={styles.brandName}>{brandName}</span>
            </div>
          )}
          {/* Desktop toggle button */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={styles.toggleButton}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            type="button"
          >
            {isCollapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
          </button>
          {/* Mobile close button */}
          {isMobile && !isCollapsed && (
            <button
              onClick={() => setIsCollapsed(true)}
              className={styles.mobileCloseButton}
              aria-label="Close sidebar"
              type="button"
            >
              <X size={20} />
            </button>
          )}
        </header>

        {/* New Chat Button */}
        {onNewChat && (
          <div className={styles.newChatSection}>
            <div className={styles.navItemWrapper}>
              <button
                onClick={handleNewChat}
                onKeyDown={e => handleKeyDown(e, handleNewChat)}
                className={styles.newChatButton}
                aria-label="Start new chat"
                type="button"
              >
                <Plus size={20} strokeWidth={2} />
                {!isCollapsed && <span className={styles.newChatLabel}>New chat</span>}
              </button>
              {isCollapsed && !isMobile && (
                <span className={styles.tooltip} role="tooltip">
                  New chat
                </span>
              )}
            </div>
          </div>
        )}

        {/* Navigation Items */}
        {navItems.length > 0 && (
          <nav className={styles.nav} role="navigation" aria-label="Main navigation">
            {navItems.map(item => {
              const Icon = item.icon;

              // Defensive check for icon
              if (!Icon) {
                console.warn(`NavItem "${item.label}" is missing an icon component`);
                return null;
              }

              return (
                <div key={item.id} className={styles.navItemWrapper}>
                  <button
                    onClick={() => handleNavItemClick(item)}
                    onKeyDown={e => handleKeyDown(e, item.onClick)}
                    disabled={item.disabled}
                    className={`${styles.navButton} ${item.isActive ? styles.active : ''} ${item.disabled ? styles.disabled : ''}`}
                    aria-label={item.label}
                    aria-current={item.isActive ? 'page' : undefined}
                    aria-disabled={item.disabled}
                    type="button"
                  >
                    <Icon size={18} strokeWidth={2} aria-hidden="true" />
                    {!isCollapsed && <span>{item.label}</span>}
                  </button>
                  {/* Show tooltip when collapsed on desktop (for all items) or when disabled with custom tooltip */}
                  {!isMobile &&
                    ((isCollapsed && !item.disabled) || (item.disabled && item.tooltip)) && (
                      <span className={styles.tooltip} role="tooltip">
                        {item.disabled && item.tooltip ? item.tooltip : item.label}
                      </span>
                    )}
                </div>
              );
            })}
          </nav>
        )}

        {/* Recents Section with Folders */}
        {!isCollapsed && (showSkeleton || recentChats.length > 0 || folders.length > 0) && (
          <section className={styles.recentsSection} aria-label="Recent chats">
            {/* Recents Header with Create Folder button */}
            <div className="flex items-center justify-between mb-3">
              <h2 className={styles.recentsHeader}>Recents</h2>
              {onCreateFolder && (
                <button
                  onClick={handleCreateFolder}
                  className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                  title="Create folder"
                  type="button"
                >
                  <FolderPlus size={16} />
                </button>
              )}
            </div>
            <div className={styles.recentsList} role="list">
              {showSkeleton ? (
                // Show skeleton loaders (minimum 1 second display)
                <div className={styles.skeletonWrapper}>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className={styles.skeletonItem}>
                      <Skeleton variant="rectangular" height={40} />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {/* Render folders */}
                  {folders.length > 0 && (
                    <>
                      {folders.map(folder => {
                        const isExpanded = expandedFolders.has(folder.id);
                        const folderChats = getFolderChats(folder.id);
                        const chatCount = folder.chatCount ?? folderChats.length;

                        return (
                          <div key={folder.id} className="mb-1">
                            <FolderItem
                              folder={folder}
                              isExpanded={isExpanded}
                              chatCount={chatCount}
                              onToggleExpand={handleToggleFolderExpand}
                              onRename={handleRenameFolder}
                              onDelete={handleDeleteFolder}
                            />
                            {/* Render chats inside expanded folder */}
                            {isExpanded && folderChats.length > 0 && (
                              <div className="ml-6 mt-1 space-y-0.5" role="list">
                                {folderChats.map(chat => (
                                  <div
                                    key={chat.id}
                                    className={styles.recentChatItem}
                                    role="listitem"
                                  >
                                    <button
                                      onClick={() => handleRecentChatClick(chat.id, chat.onClick)}
                                      onKeyDown={e => handleKeyDown(e, chat.onClick)}
                                      className={styles.recentChatButton}
                                      aria-label={`Open chat: ${chat.title}`}
                                      type="button"
                                    >
                                      {chat.isStarred && (
                                        <Star size={14} className={styles.starIcon} aria-hidden="true" />
                                      )}
                                      <span className={styles.chatTitle}>{chat.title}</span>
                                    </button>
                                    {chat.onStar && chat.onRename && chat.onDelete && (
                                      <div className={styles.chatMenu}>
                                        <ChatItemMenu
                                          chatId={chat.id}
                                          isStarred={chat.isStarred || false}
                                          onStar={chat.onStar}
                                          onRename={chat.onRename}
                                          onDelete={chat.onDelete}
                                          folders={folders}
                                          currentFolderId={chat.folderId}
                                          onMoveToFolder={chat.onMoveToFolder}
                                        />
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}

                  {/* Render ungrouped chats */}
                  {getUngroupedChats().length > 0 && (
                    <>
                      {folders.length > 0 && (
                        <div className="px-2 py-1 text-xs font-semibold text-gray-500 mt-4 mb-2">
                          UNGROUPED
                        </div>
                      )}
                      {getUngroupedChats().map(chat => (
                        <div key={chat.id} className={styles.recentChatItem} role="listitem">
                          <button
                            onClick={() => handleRecentChatClick(chat.id, chat.onClick)}
                            onKeyDown={e => handleKeyDown(e, chat.onClick)}
                            className={styles.recentChatButton}
                            aria-label={`Open chat: ${chat.title}`}
                            type="button"
                          >
                            {chat.isStarred && (
                              <Star size={14} className={styles.starIcon} aria-hidden="true" />
                            )}
                            <span className={styles.chatTitle}>{chat.title}</span>
                          </button>
                          {chat.onStar && chat.onRename && chat.onDelete && (
                            <div className={styles.chatMenu}>
                              <ChatItemMenu
                                chatId={chat.id}
                                isStarred={chat.isStarred || false}
                                onStar={chat.onStar}
                                onRename={chat.onRename}
                                onDelete={chat.onDelete}
                                folders={folders}
                                currentFolderId={chat.folderId}
                                onMoveToFolder={chat.onMoveToFolder}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* Navigation Footer */}
        <footer className={styles.footer}>
          <div className={styles.footerNav}>
            {footerLinks.map((link, index) => {
              const Icon = link.icon;
              return (
                <a
                  key={index}
                  href={link.href}
                  className={styles.footerNavLink}
                  aria-label={link.ariaLabel || `Navigate to ${link.label}`}
                >
                  <Icon size={18} strokeWidth={2} aria-hidden="true" />
                  {!isCollapsed && <span>{link.label}</span>}
                </a>
              );
            })}
          </div>
        </footer>
      </aside>

      {/* Create Folder Modal */}
      {onCreateFolder && (
        <CreateFolderModal
          isOpen={isCreateFolderModalOpen}
          onClose={() => setIsCreateFolderModalOpen(false)}
          onCreate={handleFolderCreated}
        />
      )}
    </>
  );
};
