import { useState } from 'react';
import { Mic, Play, Pause, ChevronDown, ChevronUp, Copy, Check, Download } from 'lucide-react';
import type { AudioAttachment } from '@/types/websocket';
import { formatFileSize } from '@/services/uploadService';

interface AudioAttachmentProps {
  attachment: AudioAttachment;
}

export const AudioAttachment = ({ attachment }: AudioAttachmentProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTranscriptionExpanded, setIsTranscriptionExpanded] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const audioRef = useState<HTMLAudioElement | null>(null)[0];

  const handlePlayPause = () => {
    if (!audioRef) return;

    if (isPlaying) {
      audioRef.pause();
    } else {
      audioRef.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleCopyTranscription = () => {
    if (attachment.preview) {
      navigator.clipboard.writeText(attachment.preview);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = attachment.url;
    link.download = attachment.filename || 'audio.mp3';
    link.click();
  };

  const getFileExtension = () => {
    const filename = attachment.filename || '';
    const ext = filename.split('.').pop()?.toLowerCase();
    return ext || 'mp3';
  };

  return (
    <div
      style={{
        padding: 'var(--space-3)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {/* Audio Player Card */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        {/* Play Button */}
        <button
          onClick={handlePlayPause}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-full)',
            background: isPlaying ? 'var(--color-accent)' : 'var(--color-surface-elevated)',
            border: `1px solid ${isPlaying ? 'var(--color-accent)' : 'var(--color-border)'}`,
            color: isPlaying ? 'white' : 'var(--color-text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
          }}
          onMouseEnter={e => {
            if (!isPlaying) {
              e.currentTarget.style.background = 'var(--color-surface-hover)';
            }
          }}
          onMouseLeave={e => {
            if (!isPlaying) {
              e.currentTarget.style.background = 'var(--color-surface-elevated)';
            }
          }}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>

        {/* Audio Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--font-medium)',
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {attachment.filename || 'Audio Recording'}
          </div>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-secondary)',
              marginTop: '2px',
            }}
          >
            {getFileExtension().toUpperCase()} • {formatFileSize(attachment.size)}
          </div>
        </div>

        {/* Download Button */}
        <button
          onClick={handleDownload}
          style={{
            padding: '8px',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            borderRadius: 'var(--radius-sm)',
            transition: 'all var(--transition-fast)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-surface-hover)';
            e.currentTarget.style.color = 'var(--color-text-primary)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
          title="Download audio"
        >
          <Download size={18} />
        </button>
      </div>

      {/* Hidden Audio Element */}
      <audio
        ref={el => {
          if (el && audioRef !== el) {
            el.src = attachment.url;
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        style={{ display: 'none' }}
      />

      {/* Transcription Section */}
      {attachment.preview && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          {/* Transcription Header */}
          <button
            onClick={() => setIsTranscriptionExpanded(!isTranscriptionExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: '0',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--font-medium)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-secondary)';
            }}
          >
            <Mic size={14} />
            <span>Transcription</span>
            {isTranscriptionExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {/* Transcription Content */}
          {isTranscriptionExpanded && (
            <div
              style={{
                marginTop: 'var(--space-2)',
                position: 'relative',
                background: 'var(--color-surface-elevated)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-2)',
              }}
            >
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-primary)',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {attachment.preview}
              </div>

              {/* Copy Button */}
              <button
                onClick={handleCopyTranscription}
                style={{
                  position: 'absolute',
                  top: 'var(--space-2)',
                  right: 'var(--space-2)',
                  padding: '6px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-surface-hover)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'var(--color-surface)';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
                title={isCopied ? 'Copied!' : 'Copy transcription'}
              >
                {isCopied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Expired State */}
      {attachment.expired === true && (
        <div
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-danger)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
          }}
        >
          Audio file expired and no longer available
        </div>
      )}
    </div>
  );
};