import { useState, useRef, useEffect } from 'react';
import { ChevronRight, Folder, MoreVertical, Edit2, Trash2 } from 'lucide-react';
import type { ChatFolder } from '@/types/chat';
import styles from '@/components/ui/ChatItemMenu.module.css';
import { useToastStore } from '@/store/useToastStore';

export interface FolderItemProps {
  folder: ChatFolder;
  isExpanded: boolean;
  chatCount?: number;
  onToggleExpand: (folderId: string) => void;
  onRename: (folderId: string, newName: string) => void;
  onDelete: (folderId: string) => void;
}

export const FolderItem: React.FC<FolderItemProps> = ({
  folder,
  isExpanded,
  chatCount = 0,
  onToggleExpand,
  onRename,
  onDelete,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(folder.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToastStore();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setIsRenaming(false);
        setNewName(folder.name);
      }
    };

    if (isMenuOpen || isRenaming) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen, isRenaming, folder.name]);

  const handleToggleExpand = () => {
    onToggleExpand(folder.id);
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
  };

  const handleRename = () => {
    if (!newName.trim()) {
      addToast({
        type: 'error',
        title: 'Folder name required',
        message: 'Please enter a folder name',
        duration: 3000,
      });
      return;
    }
    onRename(folder.id, newName.trim());
    setIsMenuOpen(false);
    setIsRenaming(false);
  };

  const handleDelete = () => {
    onDelete(folder.id);
    setIsMenuOpen(false);
  };

  const handleRenameStart = () => {
    setIsRenaming(true);
    setNewName(folder.name);
    setIsMenuOpen(false);
  };

  return (
    <div className={styles.menuContainer} ref={menuRef}>
      <button
        onClick={handleToggleExpand}
        className="flex items-center w-full px-2 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-md transition-colors group"
        type="button"
      >
        <ChevronRight
          size={16}
          className={`mr-1 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <Folder size={16} className="mr-2 text-blue-400" />
        <span className="flex-1 text-left truncate">{folder.name}</span>
        {chatCount > 0 && (
          <span className="text-xs text-gray-500 mr-2">{chatCount}</span>
        )}
        <button
          onClick={handleMenuClick}
          className={styles.menuButton}
          aria-label="Folder options"
          type="button"
        >
          <MoreVertical size={14} />
        </button>
      </button>

      {isRenaming && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-50 p-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') {
                setIsRenaming(false);
                setNewName(folder.name);
              }
            }}
            autoFocus
            className="w-full px-2 py-1 text-sm bg-zinc-700 border border-zinc-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Folder name"
            maxLength={50}
            onClick={e => e.stopPropagation()}
          />
          <div className="flex justify-end gap-1 mt-2">
            <button
              onClick={() => {
                setIsRenaming(false);
                setNewName(folder.name);
              }}
              className="px-2 py-1 text-xs text-gray-300 hover:text-white hover:bg-white/10 rounded transition-colors"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={handleRename}
              disabled={!newName.trim()}
              className="px-2 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {isMenuOpen && !isRenaming && (
        <div className={styles.menu}>
          <button className={styles.menuItem} onClick={handleRenameStart} type="button">
            <Edit2 size={16} />
            <span>Rename</span>
          </button>
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