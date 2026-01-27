/**
 * AssistantMessage Component
 *
 * Memoized component for rendering assistant messages in the chat.
 * Uses custom comparison to prevent re-renders of completed messages during streaming.
 */

import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy,
  Check,
  ChevronDown,
  Loader2,
  Download,
  FileText,
  Image as ImageIcon,
  Lightbulb,
  ExternalLink,
  X,
  ZoomIn,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Message, ToolCall, Artifact, RetryType } from '@/types/chat';
import { MarkdownRenderer } from '@/components/design-system/content/MarkdownRenderer';
import { MessageAttachment } from './MessageAttachment';
import { ArtifactCard } from './ArtifactCard';
import { ImageSearchStrip } from './ImageSearchStrip';
import { ImageGalleryModal, type GalleryImage } from './ImageGalleryModal';
import { RetryDropdown } from './RetryDropdown';
import { VersionNavigator } from './VersionNavigator';
import { ArtifactRenderer } from './ArtifactRenderer';
import { getIconByName } from '@/utils/iconMapper';
import { api } from '@/services/api';
import { ttsService } from '@/services/ttsService';
import { useSettingsStore } from '@/store/useSettingsStore';
import { CustomSpinner } from '@/components/ui';
import styles from '@/pages/Chat.module.css';

/**
 * Get user-friendly action text for tool name
 */
function getToolActionText(toolName: string): string {
  const toolActions: Record<string, string> = {
    search_web: 'Checking online',
    search_images: 'Finding images',
    fetch_webpage: 'Fetching webpage',
    read_file: 'Reading file',
    write_file: 'Writing file',
    execute_code: 'Running code',
    list_files: 'Listing files',
    search_files: 'Searching files',
  };
  return toolActions[toolName] || `Using ${toolName}`;
}

/**
 * Get result count or summary from result text
 */
function getResultCount(result: string | unknown, query?: string): string {
  if (result === null || result === undefined) {
    return query || 'Details';
  }

  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

  // For math results
  if (resultStr.includes('Result:') && resultStr.includes('Expression:')) {
    const resultMatch = resultStr.match(/Result:\s*([^\n]+)/);
    if (resultMatch) return resultMatch[1].trim();
  }

  // Count numbered items
  const numberedItems = resultStr.match(/^\d+\.\s/gm);
  if (numberedItems && numberedItems.length > 0) {
    return `${numberedItems.length} results`;
  }

  // Common patterns
  const patterns = [/found (\d+) results?/i, /(\d+) results?/i, /returned (\d+)/i];
  for (const pattern of patterns) {
    const match = resultStr.match(pattern);
    if (match) return `${match[1]} results`;
  }

  return query || 'Details';
}

interface ToolResultData {
  download_url?: string;
  filename?: string;
  size?: number;
  message?: string;
  success?: boolean;
  files?: { filename: string; data: string; size: number }[];
  stdout?: string;
  images?: Array<{
    title: string;
    url: string;
    thumbnail_url: string;
    source_url: string;
    resolution?: string;
  }>;
  query?: string;
  slide_count?: number;
  file_type?: string;
  extension?: string;
}

function parseToolResult(result: string): ToolResultData | null {
  try {
    return JSON.parse(result) as ToolResultData;
  } catch {
    return null;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

async function handleDocumentDownload(downloadUrl: string, filename?: string): Promise<void> {
  try {
    await api.downloadFile(downloadUrl, filename);
  } catch (error) {
    console.error('Failed to download document:', error);
    alert('Failed to download document. Please try again.');
  }
}

/**
 * Source extracted from search results
 */
interface Source {
  title: string;
  url: string;
}

/**
 * Extract sources from search_web tool results
 * Parses the formatted search results to extract title and URL pairs
 */
function extractSourcesFromToolCalls(toolCalls: ToolCall[] | undefined): Source[] {
  if (!toolCalls) return [];

  const sources: Source[] = [];
  const seenUrls = new Set<string>();

  for (const tool of toolCalls) {
    if (tool.name === 'search_web' && tool.status === 'completed' && tool.result) {
      const resultStr = typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result);

      // Parse the SOURCES FOR CITATION section (new format)
      // Format: [1]: [Title](url)
      const citationMatches = resultStr.matchAll(/\[\d+\]:\s*\[([^\]]+)\]\(([^)]+)\)/g);
      for (const match of citationMatches) {
        const [, title, url] = match;
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          sources.push({ title: title || new URL(url).hostname, url });
        }
      }

      // Fallback: Parse the numbered results (old format)
      // Format: [1] Title\n    URL: url
      if (sources.length === 0) {
        const oldFormatMatches = resultStr.matchAll(/\[?\d+\]?\.\s*([^\n]+)\n\s*URL:\s*(\S+)/g);
        for (const match of oldFormatMatches) {
          const [, title, url] = match;
          if (url && !seenUrls.has(url)) {
            seenUrls.add(url);
            sources.push({ title: title.trim(), url: url.trim() });
          }
        }
      }
    }
  }

  return sources;
}

function downloadBase64File(file: { filename: string; data: string; size: number }): void {
  try {
    const binaryString = atob(file.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const ext = file.filename.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      txt: 'text/plain',
      json: 'application/json',
      csv: 'text/csv',
      py: 'text/x-python',
      js: 'text/javascript',
      html: 'text/html',
      xml: 'application/xml',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      zip: 'application/zip',
      pt: 'application/octet-stream',
      pkl: 'application/octet-stream',
      h5: 'application/octet-stream',
      npy: 'application/octet-stream',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to download file:', error);
    alert('Failed to download file. Please try again.');
  }
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    py: 'FileCode',
    js: 'FileCode',
    ts: 'FileCode',
    json: 'FileJson',
    csv: 'FileSpreadsheet',
    txt: 'FileText',
    html: 'FileCode',
    xml: 'FileCode',
    pdf: 'FileText',
    png: 'Image',
    jpg: 'Image',
    jpeg: 'Image',
    gif: 'Image',
    svg: 'Image',
    pt: 'Package',
    pkl: 'Package',
    h5: 'Package',
    npy: 'Package',
    zip: 'Archive',
  };
  return iconMap[ext] || 'File';
}

function getFileTypeLabel(extension?: string, fileType?: string): string {
  if (fileType === 'text' && extension) return extension.toUpperCase();
  if (fileType === 'html') return 'Presentation';
  if (fileType === 'pdf' && extension === 'pdf') return 'PDF';
  return 'PDF';
}

export interface AssistantMessageProps {
  message: Message;
  chatId: string;
  index: number;
  isThinkingExpanded: boolean;
  thinkingVerb: string;
  copiedMessageId: string | null;
  isLoading: boolean;
  // Version info for navigation
  currentVersion?: number;
  totalVersions?: number;
  // Stable callbacks (useCallback in parent)
  onToggleThinking: (id: string) => void;
  onToggleToolExpansion: (messageId: string, toolId: string) => void;
  onToggleAllTools: (messageId: string, toolCalls: ToolCall[], expand: boolean) => void;
  onCopy: (content: string, id: string) => void;
  onRetry: (index: number, retryType?: RetryType) => void;
  onVersionNavigate?: (messageId: string, direction: 'prev' | 'next') => void;
  onOpenArtifacts: (artifacts: Artifact[]) => void;
}

function AssistantMessageComponent({
  message,
  chatId,
  index,
  isThinkingExpanded,
  thinkingVerb,
  copiedMessageId,
  isLoading,
  currentVersion = 1,
  totalVersions = 1,
  onToggleThinking,
  onToggleToolExpansion,
  onToggleAllTools,
  onCopy,
  onRetry,
  onVersionNavigate,
  onOpenArtifacts,
}: AssistantMessageProps) {
  const backendUrl = window.location.origin;

  // Sources modal state
  const [showSources, setShowSources] = useState(false);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const sources = extractSourcesFromToolCalls(message.toolCalls);

  // Image gallery modal state for generated images
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // TTS state
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [currentTTSMessageId, setCurrentTTSMessageId] = useState<string | null>(null);

  // Get TTS settings
  const { ttsHuggingFaceToken, ttsVoice, ttsCustomVoiceId } = useSettingsStore();

  // Open gallery with images
  const openImageGallery = useCallback((images: GalleryImage[], startIndex = 0) => {
    setGalleryImages(images);
    setGalleryIndex(startIndex);
    setGalleryOpen(true);
  }, []);

  // Get all generated images from generate_image/edit_image tool calls
  const getGeneratedImages = useCallback((): {
    images: GalleryImage[];
    toolName: string;
  } | null => {
    if (!message.toolCalls) return null;

    const imageTools = message.toolCalls.filter(
      tool =>
        (tool.name === 'generate_image' || tool.name === 'edit_image') &&
        tool.status === 'completed' &&
        tool.plots &&
        tool.plots.length > 0
    );

    if (imageTools.length === 0) return null;

    // Collect all images from all generate_image tools
    const allImages: GalleryImage[] = [];
    imageTools.forEach(tool => {
      tool.plots?.forEach(plot => {
        allImages.push({
          src: `data:image/${plot.format || 'png'};base64,${plot.data}`,
          title: `Generated Image ${allImages.length + 1}`,
          format: plot.format || 'png',
        });
      });
    });

    return { images: allImages, toolName: imageTools[0].displayName || 'Generated Image' };
  }, [message.toolCalls]);

  // Render inline generated images (ChatGPT-style prominent display)
  const renderInlineGeneratedImages = () => {
    const result = getGeneratedImages();
    if (!result) return null;

    const { images } = result;

    // Get the prompt from the tool call for the header
    const imageToolCall = message.toolCalls?.find(
      tc => (tc.name === 'generate_image' || tc.name === 'edit_image') && tc.status === 'completed'
    );
    const prompt = imageToolCall?.query || '';

    return (
      <div style={{ marginBottom: 'var(--space-4)' }}>
        {/* Header like ChatGPT - "Image created • prompt" */}
        {prompt && (
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <span style={{ color: 'var(--color-text-tertiary)' }}>Image created</span>
            <span style={{ margin: '0 6px', color: 'var(--color-text-tertiary)' }}>•</span>
            <span>{prompt.length > 60 ? prompt.slice(0, 60) + '...' : prompt}</span>
          </div>
        )}

        {/* Image display - natural aspect ratio */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
          }}
        >
          {images.map((image, idx) => (
            <div
              key={idx}
              onClick={() => openImageGallery(images, idx)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openImageGallery(images, idx);
                }
              }}
              role="button"
              tabIndex={0}
              style={{
                position: 'relative',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                cursor: 'pointer',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                transition: 'all var(--transition-fast)',
                maxWidth: '100%',
                display: 'inline-block',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-accent)';
                e.currentTarget.style.transform = 'scale(1.01)';
                e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                const overlay = e.currentTarget.querySelector('.image-overlay') as HTMLElement;
                if (overlay) overlay.style.opacity = '1';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = 'none';
                const overlay = e.currentTarget.querySelector('.image-overlay') as HTMLElement;
                if (overlay) overlay.style.opacity = '0';
              }}
            >
              <img
                src={image.src}
                alt={image.title || `Generated Image ${idx + 1}`}
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: '500px',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                }}
              />
              {/* Zoom overlay */}
              <div
                className="image-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0, 0, 0, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'opacity var(--transition-fast)',
                }}
              >
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.2)',
                    borderRadius: '50%',
                    padding: '12px',
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  <ZoomIn size={24} color="white" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Action buttons row - ChatGPT style */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginTop: 'var(--space-3)',
          }}
        >
          {/* Download button */}
          <button
            onClick={e => {
              e.stopPropagation();
              const image = images[0];
              const base64Data = image.src.split(',')[1];
              if (base64Data) {
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: `image/${image.format || 'png'}` });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `generated_image.${image.format || 'png'}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--color-surface)';
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--color-text-tertiary)';
            }}
            title="Download image"
          >
            <Download size={18} />
          </button>
        </div>
      </div>
    );
  };

  // Check if toolCalls contain only generate_image tools (to hide the collapsed tool card)
  const hasOnlyImageGeneration = useCallback(() => {
    if (!message.toolCalls || message.toolCalls.length === 0) return false;
    return message.toolCalls.every(
      tool =>
        (tool.name === 'generate_image' || tool.name === 'edit_image') &&
        tool.status === 'completed' &&
        tool.plots &&
        tool.plots.length > 0
    );
  }, [message.toolCalls]);

  // Filter out tool call JSON/action text from message content when there's a generated image
  // This removes ReAct-style agent output like { "action": "dalle.text2im", "action_input": ... }
  const getFilteredMessageContent = useCallback(() => {
    const hasGeneratedImages = getGeneratedImages() !== null;
    if (!hasGeneratedImages) return message.content;

    let content = message.content;

    // Remove JSON-like tool call blocks that look like { "action": ... } or { "thought": ... }
    // These are ReAct/agent-style outputs that shouldn't be shown to users
    content = content.replace(
      /\{\s*"action"\s*:\s*"[^"]*"[\s\S]*?"action_input"\s*:\s*"[\s\S]*?"\s*\}/g,
      ''
    );
    content = content.replace(
      /\{\s*"action"\s*:\s*"[^"]*"[\s\S]*?"thought"\s*:\s*"[\s\S]*?"\s*\}/g,
      ''
    );

    // Also remove standalone thought blocks
    content = content.replace(/\{\s*"thought"\s*:\s*"[^"]*"\s*\}/g, '');

    // Remove any remaining JSON blocks that contain prompt/size/model (image gen params)
    content = content.replace(
      /\{\s*"prompt"\s*:\s*"[\s\S]*?"[,\s]*("size"\s*:\s*"[^"]*")?[,\s]*("model"\s*:\s*"[^"]*")?\s*\}/g,
      ''
    );

    // Clean up excessive whitespace/newlines left behind
    content = content.replace(/\n{3,}/g, '\n\n').trim();

    return content;
  }, [message.content, getGeneratedImages]);

  // Close sources modal on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowSources(false);
      }
    }
    if (showSources) {
      document.addEventListener('keydown', handleKeyDown);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [showSources]);

  // Stop TTS when component unmounts or message changes
  useEffect(() => {
    return () => {
      // Only stop TTS if this message was the one playing
      // We check currentTTSMessageId to determine if we should stop
      if (currentTTSMessageId === message.id) {
        ttsService.stop();
        setIsPlayingTTS(false);
        setIsLoadingTTS(false);
        setCurrentTTSMessageId(null);
      }
    };
  }, [message.id, currentTTSMessageId]);

  // Handle TTS playback
  const handleTTSPlay = useCallback(async () => {
    // Prevent multiple clicks while loading or playing
    if (isLoadingTTS) {
      return;
    }

    // If already playing this message, stop it
    if (isPlayingTTS && currentTTSMessageId === message.id) {
      ttsService.stop();
      setIsPlayingTTS(false);
      setCurrentTTSMessageId(null);
      return;
    }

    // Stop any currently playing TTS from other messages
    if (isPlayingTTS && currentTTSMessageId !== message.id) {
      ttsService.stop();
    }

    // Set current message ID and loading state immediately
    setCurrentTTSMessageId(message.id);
    setIsLoadingTTS(true);

    try {
      await ttsService.speak(
        message.content,
        ttsVoice === 'custom' ? undefined : ttsVoice,
        ttsVoice === 'custom' ? ttsCustomVoiceId : undefined,
        ttsHuggingFaceToken,
        // Callback when audio actually starts playing
        () => {
          setIsLoadingTTS(false);
          setIsPlayingTTS(true);
        },
        // Callback when audio ends or errors
        () => {
          setIsLoadingTTS(false);
          setIsPlayingTTS(false);
          setCurrentTTSMessageId(null);
        }
      );
    } catch (error) {
      console.error('TTS error:', error);
      setIsLoadingTTS(false);
      setIsPlayingTTS(false);
      setCurrentTTSMessageId(null);
    }
  }, [message.content, message.id, isPlayingTTS, currentTTSMessageId, ttsHuggingFaceToken, ttsVoice, ttsCustomVoiceId, isLoadingTTS]);

  // Render download tile or artifact viewer for document/file creation results
  const renderDownloadTile = () => {
    const downloadTool = message.toolCalls?.find(
      tool =>
        (tool.name === 'create_document' ||
          tool.name === 'create_text_file' ||
          tool.name === 'create_presentation') &&
        tool.status === 'completed' &&
        tool.result
    );

    if (!downloadTool || !downloadTool.result) return null;

    const parsedResult = parseToolResult(downloadTool.result);
    if (!parsedResult || !parsedResult.download_url) return null;

    // Try to render as artifact first (PDF/HTML)
    const artifactRenderer = (
      <ArtifactRenderer toolResult={downloadTool.result} backendUrl={backendUrl} />
    );
    if (artifactRenderer) {
      return <div style={{ marginTop: 'var(--space-3)' }}>{artifactRenderer}</div>;
    }

    // Fall back to download tile for other file types
    // Check if URL is already absolute (from backend tools)
    const isAbsoluteUrl =
      parsedResult.download_url.startsWith('http://') ||
      parsedResult.download_url.startsWith('https://');
    const downloadUrl = isAbsoluteUrl
      ? parsedResult.download_url
      : `${backendUrl}${parsedResult.download_url}`;
    const isPresentation = downloadTool.name === 'create_presentation';
    const fileTypeLabel = isPresentation
      ? `${parsedResult.slide_count || ''} Slides`
      : getFileTypeLabel(parsedResult.extension, parsedResult.file_type);
    const isTextFile = parsedResult.file_type === 'text';

    return (
      <div style={{ marginTop: 'var(--space-3)' }}>
        <button
          onClick={() => handleDocumentDownload(downloadUrl, parsedResult.filename)}
          style={{
            padding: 'var(--space-3)',
            background: 'var(--color-surface)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            minHeight: '120px',
            textDecoration: 'none',
            maxWidth: '200px',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            textAlign: 'left',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.02)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
            <FileText
              size={24}
              color={
                isPresentation
                  ? 'var(--color-warning)'
                  : isTextFile
                    ? 'var(--color-success)'
                    : 'var(--color-accent)'
              }
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--font-medium)',
                  color: 'var(--color-text-primary)',
                  wordBreak: 'break-word',
                }}
              >
                {parsedResult.filename || 'Document'}
              </div>
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-secondary)',
                  marginTop: 'var(--space-1)',
                }}
              >
                {fileTypeLabel}
                {parsedResult.size && ` • ${formatFileSize(parsedResult.size)}`}
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              fontSize: 'var(--text-xs)',
              color: isPresentation
                ? 'var(--color-warning)'
                : isTextFile
                  ? 'var(--color-success)'
                  : 'var(--color-accent)',
              fontWeight: 'var(--font-medium)',
            }}
          >
            <Download size={12} />
            <span>Download</span>
          </div>
        </button>
      </div>
    );
  };

  // Render file tiles for tools that generate files (run_python, html_to_pdf, etc.)
  const renderFileTiles = () => {
    // Find any tool that has files in its result
    const toolsWithFiles = ['run_python', 'html_to_pdf', 'analyze_data'];
    const fileTool = message.toolCalls?.find(
      tool => toolsWithFiles.includes(tool.name) && tool.result
    );
    if (!fileTool || !fileTool.result) return null;

    const parsedResult = parseToolResult(fileTool.result);
    if (!parsedResult || !parsedResult.files || parsedResult.files.length === 0) return null;

    // Handle file download - check for secure download URL or base64 data
    const handleFileDownload = (file: {
      filename: string;
      download_url?: string;
      data?: string;
      size?: number;
      expires_in?: string;
    }) => {
      if (file.download_url) {
        // Use secure download URL - check if already absolute
        const isAbsoluteUrl =
          file.download_url.startsWith('http://') || file.download_url.startsWith('https://');
        const downloadUrl = isAbsoluteUrl ? file.download_url : `${backendUrl}${file.download_url}`;
        window.open(downloadUrl, '_blank');
      } else if (file.data) {
        // Fall back to base64 download
        downloadBase64File(file as { filename: string; data: string; size: number });
      }
    };

    return (
      <div style={{ marginTop: 'var(--space-3)' }}>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
            fontWeight: 'var(--font-medium)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Generated Files ({parsedResult.files.length})
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {parsedResult.files.map((file, fileIdx) => {
            const IconComponent = getIconByName(getFileIcon(file.filename));
            const ext = file.filename.split('.').pop()?.toUpperCase() || 'FILE';
            const hasSecureUrl = !!file.download_url;
            return (
              <button
                key={fileIdx}
                onClick={() => handleFileDownload(file)}
                style={{
                  padding: 'var(--space-3)',
                  background: 'var(--color-surface)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                  minHeight: '120px',
                  minWidth: '160px',
                  maxWidth: '200px',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                  textAlign: 'left',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'scale(1.02)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                  <IconComponent size={24} color="var(--color-accent)" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--font-medium)',
                        color: 'var(--color-text-primary)',
                        wordBreak: 'break-word',
                      }}
                    >
                      {file.filename}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-secondary)',
                        marginTop: 'var(--space-1)',
                      }}
                    >
                      {ext} • {formatFileSize(file.size)}
                    </div>
                    {hasSecureUrl && file.expires_in && (
                      <div
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--color-text-tertiary)',
                          marginTop: 'var(--space-1)',
                        }}
                      >
                        Expires in {file.expires_in}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-accent)',
                    fontWeight: 'var(--font-medium)',
                  }}
                >
                  <Download size={12} />
                  <span>Download</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Render tool content (expanded)
  const renderToolContent = (tool: ToolCall) => {
    const parsedResult = parseToolResult(tool.result || '');

    // Handle download_url - check if already absolute
    if (parsedResult && parsedResult.download_url) {
      const isAbsoluteUrl =
        parsedResult.download_url.startsWith('http://') ||
        parsedResult.download_url.startsWith('https://');
      const downloadUrl = isAbsoluteUrl
        ? parsedResult.download_url
        : `${backendUrl}${parsedResult.download_url}`;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {parsedResult.message && (
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-primary)',
                marginBottom: 'var(--space-2)',
              }}
            >
              {parsedResult.message.split('Click the link to download')[0].trim()}
            </div>
          )}
          <button
            onClick={() => handleDocumentDownload(downloadUrl, parsedResult.filename)}
            className={styles.downloadTile}
            style={{ width: '100%', textAlign: 'left' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
              <FileText size={24} color="var(--color-accent)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--font-medium)',
                    color: 'var(--color-text-primary)',
                    wordBreak: 'break-word',
                  }}
                >
                  {parsedResult.filename || 'Document'}
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-secondary)',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  PDF{parsedResult.size && ` • ${formatFileSize(parsedResult.size)}`}
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-accent)',
                fontWeight: 'var(--font-medium)',
              }}
            >
              <Download size={12} />
              <span>Download</span>
            </div>
          </button>
        </div>
      );
    }

    // Handle search_images
    if (tool.name === 'search_images' && parsedResult?.images) {
      return (
        <ImageSearchStrip
          images={parsedResult.images}
          query={parsedResult.query || tool.query || ''}
        />
      );
    }

    // Handle generate_image - display inline with large preview during streaming
    if (
      (tool.name === 'generate_image' || tool.name === 'edit_image') &&
      tool.plots &&
      tool.plots.length > 0
    ) {
      const generatedImages: GalleryImage[] = tool.plots.map((plot, idx) => ({
        src: `data:image/${plot.format || 'png'};base64,${plot.data}`,
        title: `Generated Image ${idx + 1}`,
        format: plot.format || 'png',
      }));

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                tool.plots.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--space-3)',
              maxWidth: tool.plots.length === 1 ? '400px' : '100%',
            }}
          >
            {tool.plots.map((plot, plotIdx) => (
              <div
                key={plotIdx}
                onClick={() => openImageGallery(generatedImages, plotIdx)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openImageGallery(generatedImages, plotIdx);
                  }
                }}
                role="button"
                tabIndex={0}
                style={{
                  position: 'relative',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  transition: 'all var(--transition-fast)',
                  aspectRatio: '1',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-accent)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                  const overlay = e.currentTarget.querySelector('.image-overlay') as HTMLElement;
                  if (overlay) overlay.style.opacity = '1';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                  const overlay = e.currentTarget.querySelector('.image-overlay') as HTMLElement;
                  if (overlay) overlay.style.opacity = '0';
                }}
              >
                <img
                  src={`data:image/${plot.format || 'png'};base64,${plot.data}`}
                  alt={`Generated Image ${plotIdx + 1}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
                <div
                  className="image-overlay"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0, 0, 0, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0,
                    transition: 'opacity var(--transition-fast)',
                  }}
                >
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.2)',
                      borderRadius: '50%',
                      padding: '12px',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <ZoomIn size={24} color="white" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Handle stdout
    if (parsedResult && parsedResult.stdout) {
      return (
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-primary)',
            whiteSpace: 'pre-wrap',
            fontFamily: 'monospace',
            background: 'var(--color-surface)',
            padding: 'var(--space-2)',
            borderRadius: 'var(--radius-sm)',
            maxHeight: '300px',
            overflow: 'auto',
          }}
        >
          {parsedResult.stdout}
        </div>
      );
    }

    return tool.result || 'No result available';
  };

  // Render expanded tool content for completed messages (includes plots)
  const renderCompletedToolContent = (tool: ToolCall) => {
    const parsedResult = parseToolResult(tool.result || '');

    // Handle download_url - check if already absolute
    if (parsedResult && parsedResult.download_url) {
      const isAbsoluteUrl =
        parsedResult.download_url.startsWith('http://') ||
        parsedResult.download_url.startsWith('https://');
      const downloadUrl = isAbsoluteUrl
        ? parsedResult.download_url
        : `${backendUrl}${parsedResult.download_url}`;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {parsedResult.message && (
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-primary)',
                marginBottom: 'var(--space-2)',
              }}
            >
              {parsedResult.message.split('Click the link to download')[0].trim()}
            </div>
          )}
          <button
            onClick={() => handleDocumentDownload(downloadUrl, parsedResult.filename)}
            style={{
              padding: 'var(--space-3)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              minHeight: '120px',
              textDecoration: 'none',
              maxWidth: '200px',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
              textAlign: 'left',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'scale(1.02)';
              e.currentTarget.style.boxShadow = 'var(--shadow-md)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
              <FileText size={24} color="var(--color-accent)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--font-medium)',
                    color: 'var(--color-text-primary)',
                    wordBreak: 'break-word',
                  }}
                >
                  {parsedResult.filename || 'Document'}
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-secondary)',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  PDF{parsedResult.size && ` • ${formatFileSize(parsedResult.size)}`}
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-accent)',
                fontWeight: 'var(--font-medium)',
              }}
            >
              <Download size={12} />
              <span>Download</span>
            </div>
          </button>
        </div>
      );
    }

    // Handle search_images
    if (tool.name === 'search_images' && parsedResult?.images) {
      return (
        <ImageSearchStrip
          images={parsedResult.images}
          query={parsedResult.query || tool.query || ''}
        />
      );
    }

    // Handle generate_image - display inline with large preview
    if (
      (tool.name === 'generate_image' || tool.name === 'edit_image') &&
      tool.plots &&
      tool.plots.length > 0
    ) {
      const generatedImages: GalleryImage[] = tool.plots.map((plot, idx) => ({
        src: `data:image/${plot.format || 'png'};base64,${plot.data}`,
        title: `Generated Image ${idx + 1}`,
        format: plot.format || 'png',
      }));

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Inline Image Grid for Generated Images */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                tool.plots.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 'var(--space-3)',
              maxWidth: tool.plots.length === 1 ? '400px' : '100%',
            }}
          >
            {tool.plots.map((plot, plotIdx) => (
              <div
                key={plotIdx}
                onClick={() => openImageGallery(generatedImages, plotIdx)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openImageGallery(generatedImages, plotIdx);
                  }
                }}
                role="button"
                tabIndex={0}
                style={{
                  position: 'relative',
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  transition: 'all var(--transition-fast)',
                  aspectRatio: '1',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-accent)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                  const overlay = e.currentTarget.querySelector('.image-overlay') as HTMLElement;
                  if (overlay) overlay.style.opacity = '1';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                  const overlay = e.currentTarget.querySelector('.image-overlay') as HTMLElement;
                  if (overlay) overlay.style.opacity = '0';
                }}
              >
                <img
                  src={`data:image/${plot.format || 'png'};base64,${plot.data}`}
                  alt={`Generated Image ${plotIdx + 1}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
                {/* Zoom overlay */}
                <div
                  className="image-overlay"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0, 0, 0, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0,
                    transition: 'opacity var(--transition-fast)',
                  }}
                >
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.2)',
                      borderRadius: '50%',
                      padding: '12px',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <ZoomIn size={24} color="white" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Download button */}
          <button
            onClick={e => {
              e.stopPropagation();
              // Download first image
              const plot = tool.plots![0];
              const byteCharacters = atob(plot.data);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: `image/${plot.format || 'png'}` });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `generated_image.${plot.format || 'png'}`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
              alignSelf: 'flex-start',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--color-surface-elevated)';
              e.currentTarget.style.color = 'var(--color-text-primary)';
              e.currentTarget.style.borderColor = 'var(--color-accent)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--color-surface)';
              e.currentTarget.style.color = 'var(--color-text-secondary)';
              e.currentTarget.style.borderColor = 'var(--color-border)';
            }}
          >
            <Download size={14} />
            <span>Download</span>
          </button>
        </div>
      );
    }

    // Render plots (for other tools like analyze_data, run_python)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {tool.plots && tool.plots.length > 0 && (
          <button
            onClick={() => {
              const imageArtifact: Artifact = {
                id: `tool-images-${tool.id}`,
                type: 'image',
                title: `${tool.displayName || tool.name} Results`,
                content: '',
                images: tool.plots!.map((plot, plotIdx) => ({
                  data: plot.data,
                  format: plot.format,
                  caption: `Visualization ${plotIdx + 1}`,
                })),
                metadata: { toolName: tool.name },
              };
              onOpenArtifacts([imageArtifact]);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
              textAlign: 'left',
              width: '100%',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-accent)';
              e.currentTarget.style.background = 'var(--color-surface-elevated)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.background = 'var(--color-surface)';
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                flexShrink: 0,
                background: 'var(--color-background)',
              }}
            >
              <img
                src={`data:image/${tool.plots[0].format};base64,${tool.plots[0].data}`}
                alt="Preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  color: 'var(--color-text-primary)',
                  fontWeight: 'var(--font-medium)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                <ImageIcon size={16} />
                <span>
                  {tool.plots.length} visualization{tool.plots.length > 1 ? 's' : ''}
                </span>
              </div>
              <div
                style={{
                  color: 'var(--color-text-tertiary)',
                  fontSize: 'var(--text-xs)',
                  marginTop: 'var(--space-1)',
                }}
              >
                Click to view in artifact pane
              </div>
            </div>
          </button>
        )}
        {parsedResult && parsedResult.stdout && (
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-primary)',
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
              background: 'var(--color-surface)',
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              maxHeight: '300px',
              overflow: 'auto',
            }}
          >
            {parsedResult.stdout}
          </div>
        )}
        {(!parsedResult || (!parsedResult.files && !parsedResult.stdout && !tool.plots)) && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {tool.result || 'No result available'}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.assistantMessageContainer}>
      {/* File Attachments - shown above main content */}
      {message.attachments && message.attachments.length > 0 && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <MessageAttachment attachments={message.attachments} />
        </div>
      )}

      {/* Thinking Pane */}
      {message.reasoning && (message.isStreaming || isThinkingExpanded) && (
        <div
          data-thinking-id={message.id}
          className={`${styles.thinkingPane} ${message.isStreaming ? styles.active : ''}`}
        >
          <button onClick={() => onToggleThinking(message.id)} className={styles.thinkingHeader}>
            <div className={styles.thinkingTitle}>
              {message.isStreaming ? (
                <Loader2
                  size={14}
                  className="animate-spin"
                  style={{ color: 'var(--color-accent)' }}
                />
              ) : (
                <div style={{ color: 'var(--color-accent)' }}>✨</div>
              )}
              <span>{message.isStreaming ? thinkingVerb : 'Thought process'}</span>
            </div>
            <ChevronDown
              size={14}
              style={{
                color: 'var(--color-text-tertiary)',
                transform: isThinkingExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform var(--transition-fast)',
              }}
            />
          </button>
          {isThinkingExpanded && (
            <div
              className={styles.thinkingContent}
              data-thinking-content={message.id}
              style={{ maxHeight: '200px', overflowY: 'auto' }}
            >
              {message.reasoning}
            </div>
          )}
        </div>
      )}

      <div className={styles.assistantMessage} aria-label="Assistant message">
        {message.error ? (
          <span style={{ color: 'var(--color-error)' }}>Error: {message.error}</span>
        ) : message.isStreaming ? (
          <div className={styles.streamingMessage}>
            {/* Tool execution status during streaming */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div
                className={`${styles.toolTimelineContainer} ${
                  message.reasoning && (message.isStreaming || isThinkingExpanded)
                    ? styles.connectedToThinking
                    : ''
                }`}
              >
                {message.toolCalls.map((tool, toolIndex) => (
                  <div key={tool.id} className={styles.toolTimelineItem}>
                    {toolIndex < message.toolCalls!.length - 1 && (
                      <div
                        className={`${styles.toolTimelineLine} ${tool.status === 'completed' ? styles.active : ''}`}
                      />
                    )}
                    <div
                      className={`${styles.toolTimelineIcon} ${tool.status === 'completed' ? styles.completed : tool.status === 'executing' ? styles.active : ''}`}
                    >
                      {tool.status === 'executing' ? (
                        <Loader2 size={14} className="animate-spin" style={{ color: 'inherit' }} />
                      ) : (
                        (() => {
                          const ToolIcon = getIconByName(tool.icon);
                          return <ToolIcon size={14} />;
                        })()
                      )}
                    </div>
                    <div className={styles.toolCard}>
                      <button
                        onClick={() => onToggleToolExpansion(message.id, tool.id)}
                        className={styles.toolHeader}
                        title={tool.isExpanded ? 'Hide details' : 'Show details'}
                      >
                        <div className={styles.toolInfo}>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-start',
                              flex: 1,
                            }}
                          >
                            <span className={styles.toolName}>
                              {tool.status === 'executing'
                                ? tool.displayName || getToolActionText(tool.name)
                                : tool.displayName || 'Tool'}
                            </span>
                            {tool.status === 'executing' && tool.query && (
                              <span className={styles.toolQuery} title={tool.query}>
                                {tool.query}
                              </span>
                            )}
                          </div>
                          {tool.status === 'completed' && tool.result && (
                            <span
                              style={{
                                fontSize: 'var(--text-xs)',
                                color: 'var(--color-text-tertiary)',
                                marginRight: 'var(--space-2)',
                              }}
                            >
                              {getResultCount(tool.result, tool.query)}
                            </span>
                          )}
                        </div>
                        <ChevronDown
                          size={14}
                          style={{
                            color: 'var(--color-text-tertiary)',
                            transform: tool.isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform var(--transition-fast)',
                            flexShrink: 0,
                          }}
                        />
                      </button>
                      {tool.isExpanded && tool.status === 'completed' && (
                        <div className={styles.toolContent}>{renderToolContent(tool)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <MarkdownRenderer content={message.content} isStreaming={true} />
            {renderDownloadTile()}
            {renderFileTiles()}
          </div>
        ) : (
          <>
            {/* Inline generated images - shown prominently at top like ChatGPT */}
            {renderInlineGeneratedImages()}

            {/* Combined tool calls for completed messages - hide if only image generation */}
            {message.toolCalls && message.toolCalls.length > 0 && !hasOnlyImageGeneration() && (
              <div className={styles.toolCard}>
                <button
                  onClick={() => {
                    const anyExpanded = message.toolCalls!.some(t => t.isExpanded);
                    onToggleAllTools(message.id, message.toolCalls!, !anyExpanded);
                  }}
                  className={styles.toolHeader}
                  title={
                    message.toolCalls!.some(t => t.isExpanded) ? 'Hide details' : 'Show details'
                  }
                >
                  <div className={styles.toolInfo}>
                    {(() => {
                      const ToolIcon = getIconByName(message.toolCalls[0].icon);
                      return (
                        <ToolIcon
                          size={16}
                          style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }}
                        />
                      );
                    })()}
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                      }}
                    >
                      <span className={styles.toolName}>
                        {message.toolCalls[0].displayName ||
                          message.toolCalls[0].query ||
                          'Tool results'}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-tertiary)',
                        marginRight: 'var(--space-2)',
                      }}
                    >
                      {(() => {
                        if (message.toolCalls.length === 1) {
                          return getResultCount(
                            message.toolCalls[0].result || '',
                            message.toolCalls[0].query
                          );
                        }
                        const totalResults = message.toolCalls.reduce((total, tool) => {
                          const count = tool.result ? getResultCount(tool.result, tool.query) : '';
                          const countStr = typeof count === 'string' ? count : String(count || '');
                          const num = parseInt(countStr.match(/\d+/)?.[0] || '0');
                          return total + num;
                        }, 0);
                        return totalResults > 0 ? `${totalResults} results` : 'Details';
                      })()}
                    </span>
                  </div>
                  <ChevronDown
                    size={14}
                    style={{
                      color: 'var(--color-text-tertiary)',
                      transform: message.toolCalls.some(t => t.isExpanded)
                        ? 'rotate(180deg)'
                        : 'rotate(0deg)',
                      transition: 'transform var(--transition-fast)',
                      flexShrink: 0,
                    }}
                  />
                </button>
                {message.toolCalls.some(t => t.isExpanded) && (
                  <div className={styles.toolContent}>
                    {message.toolCalls.map((tool, idx) => (
                      <div
                        key={tool.id}
                        style={{
                          marginBottom: idx < message.toolCalls!.length - 1 ? 'var(--space-4)' : 0,
                        }}
                      >
                        {renderCompletedToolContent(tool)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <MarkdownRenderer content={getFilteredMessageContent()} isStreaming={false} />
            {renderDownloadTile()}
            {renderFileTiles()}
          </>
        )}
      </div>

      {/* Artifact Card - hide for generate_image/edit_image tools since we show inline images */}
      {message.artifacts && message.artifacts.length > 0 && chatId && !hasOnlyImageGeneration() && (
        <ArtifactCard artifacts={message.artifacts} chatId={chatId} />
      )}

      {/* Action Buttons */}
      {message.isStreaming ? (
        <div
          className={`${styles.messageActions} ${styles.streamingActions}`}
          style={{ justifyContent: 'flex-start' }}
        >
          <CustomSpinner size={32} />
        </div>
      ) : (
        !message.error && (
          <div className={styles.messageActions} role="group" aria-label="Message actions">
            {message.reasoning && (
              <button
                onClick={() => onToggleThinking(message.id)}
                className={styles.iconButton}
                aria-label="Show thought process"
                title={isThinkingExpanded ? 'Hide thought process' : 'Show thought process'}
                style={{ color: isThinkingExpanded ? 'var(--color-accent)' : undefined }}
              >
                <Lightbulb size={16} aria-hidden="true" />
              </button>
            )}
            <button
              onClick={() => onCopy(message.content, message.id)}
              className={styles.iconButton}
              aria-label={copiedMessageId === message.id ? 'Copied' : 'Copy message'}
            >
              {copiedMessageId === message.id ? (
                <Check size={16} aria-hidden="true" style={{ color: 'var(--color-success)' }} />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
            </button>
            <button
              onClick={handleTTSPlay}
              className={styles.iconButton}
              aria-label={isLoadingTTS ? 'Loading...' : isPlayingTTS ? 'Stop speaking' : 'Read aloud'}
              title={isLoadingTTS ? 'Loading...' : isPlayingTTS ? 'Stop speaking' : 'Read aloud'}
              style={{ color: isPlayingTTS ? 'var(--color-accent)' : undefined }}
              disabled={isLoadingTTS}
            >
              {isLoadingTTS ? (
                <Loader2 size={16} aria-hidden="true" className={styles.spinner} />
              ) : isPlayingTTS ? (
                <VolumeX size={16} aria-hidden="true" />
              ) : (
                <Volume2 size={16} aria-hidden="true" />
              )}
            </button>
            <RetryDropdown onRetry={type => onRetry(index, type)} disabled={isLoading} />
            {/* Version Navigator - only shows when multiple versions exist */}
            {totalVersions > 1 && onVersionNavigate && (
              <VersionNavigator
                currentVersion={currentVersion}
                totalVersions={totalVersions}
                onNavigate={direction => onVersionNavigate(message.id, direction)}
              />
            )}
            {/* Sources Button - ChatGPT style with stacked favicons */}
            {sources.length > 0 && (
              <>
                <button
                  onClick={() => setShowSources(true)}
                  className={styles.retryButton}
                  aria-label={`${sources.length} sources`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: 'var(--radius-full)',
                    padding: '4px 12px 4px 6px',
                    height: '28px',
                  }}
                >
                  {/* Stacked Favicons */}
                  <div style={{ display: 'flex', alignItems: 'center', marginLeft: '2px' }}>
                    {sources.slice(0, 3).map((source, idx) => {
                      const hostname = (() => {
                        try {
                          return new URL(source.url).hostname.replace('www.', '');
                        } catch {
                          return 'link';
                        }
                      })();
                      const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
                      return (
                        <img
                          key={idx}
                          src={faviconUrl}
                          alt=""
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            border: '1.5px solid rgba(32, 32, 32, 1)',
                            marginLeft: idx === 0 ? 0 : '-6px',
                            zIndex: 3 - idx,
                            background: 'rgba(255, 255, 255, 0.1)',
                            objectFit: 'cover',
                          }}
                          onError={e => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      );
                    })}
                  </div>
                  <span style={{ fontSize: '13px' }}>Sources</span>
                </button>
                {/* Sources Modal - Rendered via Portal to escape stacking context */}
                {showSources &&
                  createPortal(
                    <div
                      ref={sourcesRef}
                      className="sources-modal-overlay"
                      style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 1050, // --z-modal from design tokens
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '16px',
                      }}
                      onClick={e => {
                        if (e.target === e.currentTarget) setShowSources(false);
                      }}
                    >
                      {/* Backdrop */}
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(0, 0, 0, 0.7)',
                          backdropFilter: 'blur(12px)',
                          WebkitBackdropFilter: 'blur(12px)',
                          zIndex: -1,
                        }}
                        onClick={() => setShowSources(false)}
                      />
                      {/* Modal */}
                      <div
                        style={{
                          position: 'relative',
                          width: '100%',
                          maxWidth: '720px',
                          maxHeight: '70vh',
                          background: 'rgba(32, 32, 32, 0.98)',
                          backdropFilter: 'blur(20px)',
                          WebkitBackdropFilter: 'blur(20px)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '16px',
                          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Header */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '14px 16px',
                            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                          }}
                        >
                          <h3
                            style={{
                              margin: 0,
                              fontSize: '16px',
                              fontWeight: 600,
                              color: 'var(--color-text-primary)',
                            }}
                          >
                            Links
                          </h3>
                          <button
                            onClick={() => setShowSources(false)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              padding: '6px',
                              cursor: 'pointer',
                              color: 'var(--color-text-secondary)',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                              e.currentTarget.style.color = 'var(--color-text-primary)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'transparent';
                              e.currentTarget.style.color = 'var(--color-text-secondary)';
                            }}
                            aria-label="Close"
                          >
                            <X size={18} />
                          </button>
                        </div>
                        {/* Content */}
                        <div
                          style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '8px',
                          }}
                        >
                          {/* Citations Section */}
                          <div
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: 'var(--color-text-tertiary)',
                              padding: '8px 10px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            Citations
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {sources.slice(0, 5).map((source, idx) => {
                              const hostname = (() => {
                                try {
                                  return new URL(source.url).hostname.replace('www.', '');
                                } catch {
                                  return 'link';
                                }
                              })();
                              const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;

                              return (
                                <a
                                  key={idx}
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '12px',
                                    padding: '10px 12px',
                                    borderRadius: '8px',
                                    textDecoration: 'none',
                                    color: 'var(--color-text-primary)',
                                    transition: 'all 0.15s',
                                    background: 'transparent',
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.background = 'transparent';
                                  }}
                                >
                                  <img
                                    src={faviconUrl}
                                    alt=""
                                    style={{
                                      width: '20px',
                                      height: '20px',
                                      borderRadius: '4px',
                                      flexShrink: 0,
                                      marginTop: '1px',
                                      background: 'rgba(255, 255, 255, 0.1)',
                                    }}
                                    onError={e => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                      style={{
                                        fontSize: '13px',
                                        color: 'var(--color-text-secondary)',
                                        marginBottom: '2px',
                                      }}
                                    >
                                      {hostname}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: '14px',
                                        fontWeight: 500,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {source.title}
                                    </div>
                                  </div>
                                  <ExternalLink
                                    size={14}
                                    style={{
                                      flexShrink: 0,
                                      color: 'var(--color-text-tertiary)',
                                      opacity: 0.5,
                                      marginTop: '4px',
                                    }}
                                  />
                                </a>
                              );
                            })}
                          </div>
                          {/* More Section */}
                          {sources.length > 5 && (
                            <>
                              <div
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: 'var(--color-text-tertiary)',
                                  padding: '12px 10px 8px',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                }}
                              >
                                More
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {sources.slice(5).map((source, idx) => {
                                  const hostname = (() => {
                                    try {
                                      return new URL(source.url).hostname.replace('www.', '');
                                    } catch {
                                      return 'link';
                                    }
                                  })();
                                  const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;

                                  return (
                                    <a
                                      key={idx + 5}
                                      href={source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '12px',
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        textDecoration: 'none',
                                        color: 'var(--color-text-primary)',
                                        transition: 'all 0.15s',
                                        background: 'transparent',
                                      }}
                                      onMouseEnter={e => {
                                        e.currentTarget.style.background =
                                          'rgba(255, 255, 255, 0.06)';
                                      }}
                                      onMouseLeave={e => {
                                        e.currentTarget.style.background = 'transparent';
                                      }}
                                    >
                                      <img
                                        src={faviconUrl}
                                        alt=""
                                        style={{
                                          width: '20px',
                                          height: '20px',
                                          borderRadius: '4px',
                                          flexShrink: 0,
                                          marginTop: '1px',
                                          background: 'rgba(255, 255, 255, 0.1)',
                                        }}
                                        onError={e => {
                                          e.currentTarget.style.display = 'none';
                                        }}
                                      />
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                          style={{
                                            fontSize: '13px',
                                            color: 'var(--color-text-secondary)',
                                            marginBottom: '2px',
                                          }}
                                        >
                                          {hostname}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {source.title}
                                        </div>
                                      </div>
                                      <ExternalLink
                                        size={14}
                                        style={{
                                          flexShrink: 0,
                                          color: 'var(--color-text-tertiary)',
                                          opacity: 0.5,
                                          marginTop: '4px',
                                        }}
                                      />
                                    </a>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
              </>
            )}
          </div>
        )
      )}

      {/* Image Gallery Modal for generated images */}
      <ImageGalleryModal
        images={galleryImages}
        initialIndex={galleryIndex}
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
      />
    </div>
  );
}

/**
 * Memoized AssistantMessage - only re-renders when:
 * - isStreaming is true (streaming messages always re-render)
 * - message.id changes (new message)
 * - message.content changes (content updated)
 * - isThinkingExpanded changes
 * - copiedMessageId changes to/from this message's ID
 * - toolCalls expansion state changes
 */
export const AssistantMessage = memo(AssistantMessageComponent, (prevProps, nextProps) => {
  // ALWAYS re-render streaming messages
  if (nextProps.message.isStreaming) return false;

  // Re-render if streaming state just changed
  if (prevProps.message.isStreaming !== nextProps.message.isStreaming) return false;

  // Re-render if message identity changed
  if (prevProps.message.id !== nextProps.message.id) return false;

  // Re-render if content changed
  if (prevProps.message.content !== nextProps.message.content) return false;

  // Re-render if thinking expansion changed for THIS message
  if (prevProps.isThinkingExpanded !== nextProps.isThinkingExpanded) return false;

  // Re-render if copy state changed for THIS message
  const prevIsCopied = prevProps.copiedMessageId === prevProps.message.id;
  const nextIsCopied = nextProps.copiedMessageId === nextProps.message.id;
  if (prevIsCopied !== nextIsCopied) return false;

  // Re-render if tool expansion changed
  const prevExpandedCount = prevProps.message.toolCalls?.filter(t => t.isExpanded).length || 0;
  const nextExpandedCount = nextProps.message.toolCalls?.filter(t => t.isExpanded).length || 0;
  if (prevExpandedCount !== nextExpandedCount) return false;

  // Re-render if attachments changed
  if (prevProps.message.attachments?.length !== nextProps.message.attachments?.length) return false;

  // Re-render if artifacts changed
  if (prevProps.message.artifacts?.length !== nextProps.message.artifacts?.length) return false;

  // Re-render if loading state changed
  if (prevProps.isLoading !== nextProps.isLoading) return false;

  // No changes that affect this component
  return true;
});

AssistantMessage.displayName = 'AssistantMessage';
