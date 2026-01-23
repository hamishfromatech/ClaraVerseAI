import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Home,
  PanelLeftClose,
  PanelLeft,
  Star,
  X,
  MessageSquare,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  type LucideIcon,
} from 'lucide-react';
import styles from './Sidebar.module.css';
import faviconIcon from '@/assets/favicon-32x32.png';
import { ChatItemMenu } from './ChatItemMenu';
import { Skeleton } from '@/components/design-system/Skeleton/Skeleton';

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
  folderId?: string;
  onStar?: (chatId: string) => void;
  onRename?: (chatId: string) => void;
  onDelete?: (chatId: string) => void;
  onMoveToFolder?: (chatId: string) => void;
}

export interface SidebarFolder {
  id: string;
  name: string;
  isExpanded?: boolean;
  onToggle?: (id: string) => void;
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
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
  /** Folders to display */
  folders?: SidebarFolder[];
  /** Callback when "New Chat" is clicked */
  onNewChat?: () => void;
  /** Callback when "Add Folder" is clicked */
  onAddFolder?: () => void;
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
  folders = [],
  onNewChat,
  onAddFolder,
  width,
  className = '',
  isOpen: externalIsOpen,
  onOpenChange,
  footerLinks = DEFAULT_FOOTER_LINKS,
  isLoadingChats = false,
}) => {
  // Internal state for when not externally controlled
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(() => isMobileDevice());
  const [isMobile, setIsMobile] = useState(() => isMobileDevice());
  const [showSkeleton, setShowSkeleton] = useState(isLoadingChats);
  const loadingStartTimeRef = useRef<number>(Date.now());

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
              <img src={faviconIcon} alt="Clara logo" className={styles.brandIcon} />
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

        {/* Recents Section */}
        {!isCollapsed && (showSkeleton || recentChats.length > 0 || folders.length > 0) && (
          <section className={styles.recentsSection} aria-label="Recent chats">
            <div className={styles.foldersHeader}>
              <h2 className={styles.recentsHeader}>Recents</h2>
              {onAddFolder && (
                <button
                  onClick={onAddFolder}
                  className={styles.addFolderButton}
                  title="Create folder"
                  aria-label="Create folder"
                >
                  <FolderPlus size={14} />
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
                  {/* Folders */}
                  {folders.map(folder => {
                    const folderChats = recentChats.filter(chat => chat.folderId === folder.id);
                    return (
                      <div key={folder.id} className={styles.folderItem}>
                        <div
                          className={styles.folderHeader}
                          onClick={() => folder.onToggle?.(folder.id)}
                        >
                          <ChevronRight
                            size={14}
                            className={`${styles.folderChevron} ${folder.isExpanded ? styles.expanded : ''}`}
                          />
                          <FolderIcon size={14} className={styles.folderIcon} />
                          <span className={styles.folderName}>{folder.name}</span>
                          <div className={styles.folderMenu} onClick={e => e.stopPropagation()}>
                            <ChatItemMenu
                              chatId={folder.id}
                              isStarred={false}
                              onStar={() => {}}
                              onRename={() => folder.onRename?.(folder.id)}
                              onDelete={() => folder.onDelete?.(folder.id)}
                            />
                          </div>
                        </div>
                        {folder.isExpanded && (
                          <div className={styles.folderContent}>
                            {folderChats.length > 0 ? (
                              folderChats.map(chat => (
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
                                  <div className={styles.chatMenu}>
                                    <ChatItemMenu
                                      chatId={chat.id}
                                      isStarred={chat.isStarred || false}
                                      onStar={chat.onStar || (() => {})}
                                      onRename={chat.onRename || (() => {})}
                                      onDelete={chat.onDelete || (() => {})}
                                      onMoveToFolder={chat.onMoveToFolder}
                                    />
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className={styles.folderEmpty}>No chats</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Uncategorized Chats */}
                  {recentChats
                    .filter(chat => !chat.folderId)
                    .map(chat => (
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
                        <div className={styles.chatMenu}>
                          <ChatItemMenu
                            chatId={chat.id}
                            isStarred={chat.isStarred || false}
                            onStar={chat.onStar || (() => {})}
                            onRename={chat.onRename || (() => {})}
                            onDelete={chat.onDelete || (() => {})}
                            onMoveToFolder={chat.onMoveToFolder}
                          />
                        </div>
                      </div>
                    ))}
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
    </>
  );
};
