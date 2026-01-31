/**
 * ArtifactCard Component
 *
 * Displays artifact information in chat message with option to view in artifact pane.
 * Shown below assistant messages to allow users to access artifacts from chat history.
 * On mobile, image artifacts open in a fullscreen gallery modal instead.
 */

import { FileCode2, Download, ImageIcon, Layers } from 'lucide-react';
import type { Artifact } from '@/types/artifact';
import { useArtifactStore } from '@/store/useArtifactStore';
import { useChatStore } from '@/store/useChatStore';
import { useImageGalleryStore } from '@/store/useImageGalleryStore';
import { Tooltip } from '@/components/design-system/Tooltip/Tooltip';
import type { GalleryImage } from './ImageGalleryModal';
import styles from './ArtifactCard.module.css';

/** Check if we're on a mobile device (screen width <= 768px) */
const isMobileView = (): boolean => {
  return window.innerWidth <= 768;
};

interface ArtifactCardProps {
  artifacts: Artifact[];
  chatId?: string;
}

/**
 * Returns a user-friendly display name for artifact type
 */
const getArtifactTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    html: 'HTML',
    svg: 'SVG',
    mermaid: 'Mermaid Diagram',
    image: 'Image',
  };
  return labels[type] || type.toUpperCase();
};

/**
 * Downloads artifact content as a file
 */
const downloadArtifact = (artifact: Artifact): void => {
  // For image artifacts, download the first image
  if (artifact.type === 'image') {
    let imageUrl = '';
    let format = 'png';

    // Case 1: Tool-generated images with base64 data in images array
    if (artifact.images && artifact.images.length > 0) {
      const firstImage = artifact.images[0];
      const isFileId = firstImage.data?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      format = firstImage.format || 'png';
      imageUrl = isFileId && firstImage.data
        ? `/uploads/${firstImage.data}.${format === 'jpg' ? 'jpg' : 'png'}`
        : `data:image/${format};base64,${firstImage.data}`;
    }
    // Case 2: Uploaded images with file_id (UUID) in content
    else if (artifact.content) {
      const isFileId = artifact.content.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      imageUrl = isFileId ? `/uploads/${artifact.content}.png` : artifact.content;
    }

    if (imageUrl) {
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = `${artifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
  }

  const extensions: Record<string, string> = {
    html: 'html',
    svg: 'svg',
    mermaid: 'mmd',
  };

  const extension = extensions[artifact.type] || 'txt';
  const filename = `${artifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${extension}`;

  const blob = new Blob([artifact.content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export function ArtifactCard({ artifacts, chatId }: ArtifactCardProps) {
  const { openArtifacts } = useArtifactStore();
  const { selectChat, selectedChat } = useChatStore();
  const { openGallery } = useImageGalleryStore();

  if (!artifacts || artifacts.length === 0) {
    return null;
  }

  // For now, display card for first artifact if multiple exist
  // Future enhancement: show all artifacts or a count
  const artifact = artifacts[0];
  const multipleArtifacts = artifacts.length > 1;

  /**
   * Collect all images from all artifacts for the gallery
   */
  const collectGalleryImages = (): GalleryImage[] => {
    const images: GalleryImage[] = [];

    for (const art of artifacts) {
      if (art.type === 'image' && art.images) {
        for (const img of art.images) {
          // Check if data is a file_id (UUID) or base64
          const isFileId = img.data?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
          const format = img.format || 'png';
          const src = isFileId && img.data
            ? `/uploads/${img.data}.${format === 'jpg' ? 'jpg' : 'png'}`
            : `data:image/${format};base64,${img.data}`;
          images.push({
            src,
            title: art.title || img.caption,
            format,
          });
        }
      }
    }

    return images;
  };

  const handleViewArtifact = () => {
    // On mobile, for image artifacts, open the gallery modal instead
    if (isMobileView() && artifact.type === 'image') {
      const galleryImages = collectGalleryImages();
      if (galleryImages.length > 0) {
        openGallery(galleryImages, 0);
        return;
      }
    }

    // If chatId is provided and we're not already in that chat, navigate to it
    if (chatId && selectedChat()?.id !== chatId) {
      selectChat(chatId);
    }
    // Open the artifact pane
    openArtifacts(artifacts);
  };

  // Get thumbnail for image artifacts
  const getImageThumbnail = () => {
    // Case 1: Tool-generated images with base64 data in images array
    if (artifact.type === 'image' && artifact.images && artifact.images.length > 0) {
      const firstImage = artifact.images[0];
      // Check if data is a file_id (UUID) or base64
      const isFileId = firstImage.data?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      const format = firstImage.format || 'png';
      return isFileId && firstImage.data
        ? `/uploads/${firstImage.data}.${format === 'jpg' ? 'jpg' : 'png'}`
        : `data:image/${format};base64,${firstImage.data}`;
    }
    // Case 2: Uploaded images with file_id (UUID) in content
    if (artifact.type === 'image' && artifact.content) {
      const isFileId = artifact.content.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      if (isFileId) {
        return `/uploads/${artifact.content}.png`;
      }
      // If content is already a URL, use it directly
      if (artifact.content.startsWith('/uploads/') || artifact.content.startsWith('http')) {
        return artifact.content;
      }
    }
    return null;
  };

  const thumbnail = getImageThumbnail();
  const imageCount = artifact.type === 'image' && artifact.images ? artifact.images.length : 0;

  return (
    <button className={styles.card} onClick={handleViewArtifact}>
      <div className={styles.iconSection}>
        {thumbnail ? (
          <img src={thumbnail} alt={artifact.title} className={styles.thumbnail} />
        ) : artifact.type === 'image' ? (
          <ImageIcon size={20} className={styles.icon} />
        ) : (
          <FileCode2 size={20} className={styles.icon} />
        )}
      </div>

      <div className={styles.contentSection}>
        <div className={styles.title}>{artifact.title}</div>
        <div className={styles.metadata}>
          <span className={styles.type}>
            {artifact.type === 'image' && imageCount > 0
              ? `${imageCount} Image${imageCount > 1 ? 's' : ''}`
              : getArtifactTypeLabel(artifact.type)}
          </span>
          {multipleArtifacts && (
            <Tooltip content={`${artifacts.length} artifacts`} position="top">
              <span className={styles.stackedIcon}>
                <Layers size={12} />
                <span className={styles.stackedCount}>{artifacts.length}</span>
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <Tooltip content="Download artifact" position="top">
          <button
            className={styles.downloadButton}
            onClick={e => {
              e.stopPropagation();
              downloadArtifact(artifact);
            }}
            aria-label="Download artifact"
          >
            <Download size={16} />
          </button>
        </Tooltip>
      </div>
    </button>
  );
}
