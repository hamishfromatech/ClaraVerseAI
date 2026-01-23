import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Star, Edit2, Trash2, FolderInput } from 'lucide-react';
import styles from './ChatItemMenu.module.css';

export interface ChatItemMenuProps {
  chatId: string;
  isStarred: boolean;
  onStar: (chatId: string) => void;
  onRename: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onMoveToFolder?: (chatId: string) => void;
}

export const ChatItemMenu: React.FC<ChatItemMenuProps> = ({
  chatId,
  isStarred,
  onStar,
  onRename,
  onDelete,
  onMoveToFolder,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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

  const handleMoveToFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onMoveToFolder) {
      onMoveToFolder(chatId);
    }
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
            <button className={styles.menuItem} onClick={handleMoveToFolder} type="button">
              <FolderInput size={16} />
              <span>Move to Folder</span>
            </button>
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
