/**
 * UserMessage Component
 *
 * Memoized component for rendering user messages in the chat.
 * Prevents re-renders during streaming since user messages don't change.
 */

import { useState, memo, useRef, useEffect } from 'react';
import { Copy, Check, Pencil, X } from 'lucide-react';
import type { Message } from '@/types/chat';
import { MarkdownRenderer } from '@/components/design-system/content/MarkdownRenderer';
import { MessageAttachment } from './MessageAttachment';
import styles from '@/pages/Chat.module.css';

export interface UserMessageProps {
  message: Message;
  userInitials: string;
  copiedMessageId: string | null;
  onCopy: (content: string, id: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
}

function UserMessageComponent({
  message,
  userInitials,
  copiedMessageId,
  onCopy,
  onEdit,
}: UserMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      textareaRef.current.focus();
    }
  }, [isEditing, editValue]);

  const handleStartEdit = () => {
    setEditValue(message.content);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue(message.content);
  };

  const handleSaveEdit = () => {
    if (editValue.trim() && editValue !== message.content && onEdit) {
      onEdit(message.id, editValue.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <>
      {/* File Attachments - shown above chat bubble */}
      {message.attachments && message.attachments.length > 0 && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <MessageAttachment attachments={message.attachments} />
        </div>
      )}
      <div className={styles.userMessageRow}>
        <div className={styles.userMessage}>
          <div className={styles.userBadge} aria-label="User message">
            {userInitials}
          </div>
          <div className={styles.messageText}>
            {isEditing ? (
              <div className={styles.editContainer}>
                <textarea
                  ref={textareaRef}
                  className={styles.editTextarea}
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Edit message..."
                />
                <div className={styles.editActions}>
                  <button
                    onClick={handleSaveEdit}
                    className={styles.saveButton}
                    title="Save & Send (Ctrl+Enter)"
                  >
                    <Check size={14} />
                    <span>Save & Send</span>
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className={styles.cancelButton}
                    title="Cancel (Esc)"
                  >
                    <X size={14} />
                    <span>Cancel</span>
                  </button>
                </div>
              </div>
            ) : (
              <MarkdownRenderer content={message.content} />
            )}
          </div>
        </div>
        {!isEditing && (
          <div className={styles.messageActions}>
            <button
              onClick={handleStartEdit}
              className={styles.userActionButton}
              aria-label="Edit message"
              title="Edit message"
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
            <button
              onClick={() => onCopy(message.content, message.id)}
              className={styles.userActionButton}
              aria-label={copiedMessageId === message.id ? 'Copied' : 'Copy message'}
              title="Copy message"
            >
              {copiedMessageId === message.id ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Memoized UserMessage - only re-renders when:
 * - message.id changes (new message)
 * - message.content changes (edited)
 * - copiedMessageId changes to/from this message's ID
 */
export const UserMessage = memo(UserMessageComponent, (prevProps, nextProps) => {
  // Re-render if message identity or content changed
  if (prevProps.message.id !== nextProps.message.id) return false;
  if (prevProps.message.content !== nextProps.message.content) return false;

  // Re-render if copy state changed for THIS message
  const prevIsCopied = prevProps.copiedMessageId === prevProps.message.id;
  const nextIsCopied = nextProps.copiedMessageId === nextProps.message.id;
  if (prevIsCopied !== nextIsCopied) return false;

  // Re-render if attachments changed
  if (prevProps.message.attachments?.length !== nextProps.message.attachments?.length) return false;

  // No changes that affect this component
  return true;
});

UserMessage.displayName = 'UserMessage';
