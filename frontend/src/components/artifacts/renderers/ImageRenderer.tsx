/**
 * ImageRenderer Component
 *
 * Renders image artifacts (tool-generated plots) with slide navigation.
 * Supports multiple images with thumbnails and prev/next navigation.
 */

import { useState, memo } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import type { Artifact } from '@/types/artifact';
import { Tooltip } from '@/components/design-system/Tooltip/Tooltip';
import styles from './ImageRenderer.module.css';

interface ImageRendererProps {
  artifact: Artifact;
  /** Whether to hide zoom controls (not used in ImageRenderer, but kept for consistency) */
  hideControls?: boolean;
}

export const ImageRenderer = memo(function ImageRenderer({ artifact }: ImageRendererProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const images = artifact?.images || [];

  // No images to display
  if (!artifact || images.length === 0) {
    return (
      <div className={styles.error}>
        <AlertCircle size={24} />
        <p>No images to display</p>
        <span>This artifact doesn't contain any images.</span>
      </div>
    );
  }

  // Ensure currentIndex is within bounds
  const safeIndex = Math.min(currentIndex, images.length - 1);
  const currentImage = images[safeIndex];

  // Safety check for currentImage
  if (!currentImage || !currentImage.format) {
    return (
      <div className={styles.error}>
        <AlertCircle size={24} />
        <p>Invalid image data</p>
        <span>The image data is corrupted or incomplete.</span>
      </div>
    );
  }

  // Determine image source: if data looks like a file_id (UUID format), use URL, otherwise use base64
  const isFileId = currentImage.data.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const imageSrc = isFileId
    ? `/uploads/${currentImage.data}.${currentImage.format === 'jpg' ? 'jpg' : 'png'}`
    : currentImage.data
      ? `data:image/${currentImage.format};base64,${currentImage.data}`
      : '';

  if (!imageSrc) {
    return (
      <div className={styles.error}>
        <AlertCircle size={24} />
        <p>Invalid image data</p>
        <span>The image data is corrupted or incomplete.</span>
      </div>
    );
  }

  const goToPrevious = () => {
    setCurrentIndex(prev => Math.max(0, prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex(prev => Math.min(images.length - 1, prev + 1));
  };

  return (
    <div className={styles.imageContainer}>
      {/* Main Image Display */}
      <div className={styles.mainImageArea}>
        <img
          src={imageSrc}
          alt={currentImage.caption || `Image ${safeIndex + 1}`}
          className={styles.mainImage}
        />
      </div>

      {/* Caption */}
      {currentImage.caption && <div className={styles.caption}>{currentImage.caption}</div>}

      {/* Navigation - only show if multiple images */}
      {images.length > 1 && (
        <div className={styles.imageNav}>
          <Tooltip content="Previous image" position="top">
            <button onClick={goToPrevious} disabled={safeIndex === 0} className={styles.navButton}>
              <ChevronLeft size={20} />
            </button>
          </Tooltip>

          <span className={styles.imageCounter}>
            {safeIndex + 1} / {images.length}
          </span>

          <Tooltip content="Next image" position="top">
            <button
              onClick={goToNext}
              disabled={safeIndex === images.length - 1}
              className={styles.navButton}
            >
              <ChevronRight size={20} />
            </button>
          </Tooltip>
        </div>
      )}

      {/* Thumbnail strip - only show if multiple images */}
      {images.length > 1 && (
        <div className={styles.thumbnailStrip}>
          {images.map((img, idx) => {
            // Skip invalid images in thumbnails
            if (!img || !img.format) return null;

            // Determine image source: if data looks like a file_id (UUID format), use URL, otherwise use base64
            const isFileId = img.data?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
            const src = isFileId
              ? `/uploads/${img.data}.${img.format === 'jpg' ? 'jpg' : 'png'}`
              : img.data
                ? `data:image/${img.format};base64,${img.data}`
                : '';

            if (!src) return null;

            return (
              <img
                key={idx}
                src={src}
                alt={img.caption || `Thumbnail ${idx + 1}`}
                className={`${styles.thumbnail} ${idx === safeIndex ? styles.thumbnailActive : ''}`}
                onClick={() => setCurrentIndex(idx)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
