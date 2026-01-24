import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Star, Edit2, Trash2, Folder, FolderOpen } from 'lucide-react';
import styles from './ChatItemMenu.module.css';
import type { ChatFolder } from '@/types/chat';

export interface ChatItemMenuProps {
  chatId: string;
  isStarred: boolean;
  onStar: (chatId: string) => void;
  onRename: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  folders?: ChatFolder[];
  currentFolderId?: string | null;
  onMoveToFolder?: (chatId: string, folderId: string | null) => void;
}

export const ChatItemMenu: React.FC<ChatItemMenuProps> = ({
  chatId,
  isStarred,
  onStar,
  onRename,
  onDelete,
  folders = [],
  currentFolderId,
  onMoveToFolder,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
      if (folderMenuRef.current && !folderMenuRef.current.contains(event.target as Node)) {
        setShowFolderMenu(false);
      }
    };

    if (isOpen || showFolderMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, showFolderMenu]);

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleStar = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStar(chatId);
    setIsOpen(false);
  };

  const handleRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRename(chatId);
    setIsOpen(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(chatId);
    setIsOpen(false);
  };

  const handleFolderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowFolderMenu(!showFolderMenu);
  };

  const handleMoveToFolder = (e: React.MouseEvent, folderId: string | null) => {
    e.stopPropagation();
    if (onMoveToFolder) {
      onMoveToFolder(chatId, folderId);
    }
    setShowFolderMenu(false);
    setIsOpen(false);
  };

  return (
    <div className={styles.menuContainer} ref={menuRef}>
      <button
        className={styles.menuButton}
        onClick={handleMenuClick}
        aria-label="Chat options"
        type="button"
      >
        <MoreVertical size={16} />
      </button>

      {isOpen && (
        <div className={styles.menu}>
          <button className={styles.menuItem} onClick={handleStar} type="button">
            <Star size={16} className={isStarred ? styles.starFilled : ''} />
            <span>{isStarred ? 'Unstar' : 'Star'}</span>
          </button>
          <button className={styles.menuItem} onClick={handleRename} type="button">
            <Edit2 size={16} />
            <span>Rename</span>
          </button>
          {onMoveToFolder && (
            <div className="relative" ref={folderMenuRef}>
              <button
                className={styles.menuItem}
                onClick={handleFolderClick}
                type="button"
              >
                <Folder size={16} />
                <span>Move to Folder</span>
              </button>
              {showFolderMenu && (
                <div className="absolute bottom-full right-0 mb-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg py-1 z-50">
                  {folders.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-400">
                      No folders yet
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={e => handleMoveToFolder(e, null)}
                        className={`w-full px-3 py-1.5 text-sm text-left hover:bg-white/10 flex items-center gap-2 transition-colors ${
                          currentFolderId === null ? 'bg-white/10' : ''
                        }`}
                        type="button"
                      >
                        <FolderOpen size={14} />
                        <span>Ungrouped</span>
                      </button>
                      {folders.map(folder => (
                        <button
                          key={folder.id}
                          onClick={e => handleMoveToFolder(e, folder.id)}
                          className={`w-full px-3 py-1.5 text-sm text-left hover:bg-white/10 flex items-center gap-2 transition-colors ${
                            currentFolderId === folder.id ? 'bg-white/10' : ''
                          }`}
                          type="button"
                        >
                          <Folder size={14} className="text-blue-400" />
                          <span className="truncate">{folder.name}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            className={`${styles.menuItem} ${styles.danger}`}
            onClick={handleDelete}
            type="button"
          >
            <Trash2 size={16} />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
};
