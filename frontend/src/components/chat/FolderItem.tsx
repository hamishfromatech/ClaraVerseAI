import { useState, useRef, useEffect } from 'react';
import { ChevronRight, Folder, MoreVertical } from 'lucide-react';
import type { ChatFolder } from '@/types/chat';
import { FolderMenu } from './FolderMenu';

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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const handleToggleExpand = () => {
    onToggleExpand(folder.id);
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
  };

  const handleRename = (newName: string) => {
    onRename(folder.id, newName);
    setIsMenuOpen(false);
  };

  const handleDelete = () => {
    onDelete(folder.id);
    setIsMenuOpen(false);
  };

  return (
    <div className="folder-item" ref={menuRef}>
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
        <div
          onClick={handleMenuClick}
          className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-white/10 rounded ${
            isMenuOpen ? 'opacity-100' : ''
          }`}
        >
          <MoreVertical size={14} />
        </div>
      </button>

      {isMenuOpen && (
        <FolderMenu
          folderName={folder.name}
          onRename={handleRename}
          onDelete={handleDelete}
          onClose={() => setIsMenuOpen(false)}
        />
      )}
    </div>
  );
};