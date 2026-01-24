import { useState } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { api } from '@/services/api';
import { useToastStore } from '@/store/useToastStore';

export interface FolderMenuProps {
  folderName: string;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onClose?: () => void;
}

export const FolderMenu: React.FC<FolderMenuProps> = ({
  folderName,
  onRename,
  onDelete,
  onClose,
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(folderName);
  const [isDeleting, setIsDeleting] = useState(false);
  const { addToast } = useToastStore;

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

    onRename(newName.trim());
    setIsRenaming(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${folderName}"? This will also delete all chats in this folder.`)) {
      return;
    }

    setIsDeleting(true);

    try {
      // The delete is handled by the parent component via onDelete callback
      // This will call the deleteFolder action from the store
      onDelete();
    } finally {
      setIsDeleting(false);
      if (onClose) onClose();
    }
  };

  if (isRenaming) {
    return (
      <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-50 p-2">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleRename();
            if (e.key === 'Escape') {
              setIsRenaming(false);
              setNewName(folderName);
            }
          }}
          autoFocus
          className="w-full px-2 py-1 text-sm bg-zinc-700 border border-zinc-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Folder name"
          maxLength={50}
        />
        <div className="flex justify-end gap-1 mt-2">
          <button
            onClick={() => {
              setIsRenaming(false);
              setNewName(folderName);
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
    );
  }

  return (
    <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-50 py-1">
      <button
        onClick={() => setIsRenaming(true)}
        className="w-full px-3 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-white/10 flex items-center gap-2 transition-colors"
        type="button"
      >
        <Edit2 size={14} />
        <span>Rename</span>
      </button>
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        className="w-full px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        type="button"
      >
        <Trash2 size={14} />
        <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
      </button>
    </div>
  );
};