import { useState, useRef, useEffect } from 'react';
import { X, FolderPlus } from 'lucide-react';
import { api } from '@/services/api';
import { useToastStore } from '@/store/useToastStore';

export interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (folder: { id: string; name: string }) => void;
}

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastStore();

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setName('');
      setIsCreating(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      addToast({
        type: 'error',
        title: 'Folder name required',
        message: 'Please enter a folder name',
        duration: 3000,
      });
      return;
    }

    setIsCreating(true);

    try {
      // Get max order from existing folders
      const response = await api.get<{ folders: Array<{ id: string; name: string; order: number }> }>(
        '/api/conversations/folders'
      );

      const maxOrder = (response.folders || []).reduce((max, f) => Math.max(max, f.order), 0);

      // Create folder
      const result = await api.post<{
        id: string;
        name: string;
        order: number;
      }>('/api/conversations/folders', {
        name: name.trim(),
        order: maxOrder + 1,
      });

      onCreate(result);
      addToast({
        type: 'success',
        title: 'Folder created',
        message: `"${name.trim()}" has been created`,
        duration: 3000,
      });
      onClose();
    } catch (error: any) {
      addToast({
        type: 'error',
        title: 'Failed to create folder',
        message: error.message || 'Please try again',
        duration: 3000,
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <FolderPlus size={20} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Create Folder</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4">
          <div className="mb-4">
            <label
              htmlFor="folder-name"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Folder Name
            </label>
            <input
              ref={inputRef}
              id="folder-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Work, Personal, Projects"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={50}
              autoFocus
            />
            <p className="mt-1 text-xs text-gray-500">
              {name.length} / 50 characters
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/10 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isCreating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Folder'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};