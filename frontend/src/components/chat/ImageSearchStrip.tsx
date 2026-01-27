import { useState } from 'react';
import { ExternalLink, ZoomIn, X } from 'lucide-react';

const API_BASE_URL = window.location.origin;

interface ImageSearchResult {
  title: string;
  url: string;
  thumbnail_url: string;
  source_url: string;
  resolution?: string;
}

interface ImageSearchStripProps {
  images: ImageSearchResult[];
  query: string;
}

/**
 * Constructs a proxy URL for loading images through the backend
 * This bypasses CORS issues and keeps the SearXNG instance internal
 */
const getProxyUrl = (url: string): string => {
  if (!url) return '';
  return `${API_BASE_URL}/api/proxy/image?url=${encodeURIComponent(url)}`;
};

export const ImageSearchStrip = ({ images, query }: ImageSearchStripProps) => {
  const [selectedImage, setSelectedImage] = useState<ImageSearchResult | null>(null);
  const [loadErrors, setLoadErrors] = useState<Set<number>>(new Set());
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());

  const handleImageError = (index: number) => {
    setLoadErrors(prev => new Set(prev).add(index));
  };

  const handleImageLoad = (index: number) => {
    setLoadedImages(prev => new Set(prev).add(index));
  };

  // Filter out errored images
  const validImages = images.filter((_, index) => !loadErrors.has(index));

  if (validImages.length === 0 && loadErrors.size === images.length) {
    return null; // All images failed to load
  }

  return (
    <>
      {/* Horizontal scrollable image strip */}
      <div
        style={{
          position: 'relative',
          margin: 'var(--space-3) 0',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            overflowX: 'auto',
            padding: 'var(--space-2) 0',
            scrollSnapType: 'x mandatory',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--color-border) transparent',
          }}
        >
          {images.map((image, index) =>
            !loadErrors.has(index) ? (
              <button
                key={index}
                onClick={() => setSelectedImage(image)}
                title={image.title}
                style={{
                  flexShrink: 0,
                  width: '140px',
                  height: '100px',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  scrollSnapAlign: 'start',
                  background: 'var(--color-surface)',
                  transition: 'transform var(--transition-fast), box-shadow var(--transition-fast)',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'scale(1.03)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                  }}
                >
                  {/* Loading placeholder */}
                  {!loadedImages.has(index) && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'var(--color-surface)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-text-tertiary)',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      Loading...
                    </div>
                  )}
                  <img
                    src={getProxyUrl(image.thumbnail_url || image.url)}
                    alt={image.title}
                    onError={() => handleImageError(index)}
                    onLoad={() => handleImageLoad(index)}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      opacity: loadedImages.has(index) ? 1 : 0,
                      transition: 'opacity var(--transition-fast)',
                    }}
                  />
                  {/* Hover overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(0, 0, 0, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      transition: 'opacity var(--transition-fast)',
                      color: 'white',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.opacity = '1';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.opacity = '0';
                    }}
                  >
                    <ZoomIn size={20} />
                  </div>
                </div>
              </button>
            ) : null
          )}
        </div>

        {/* Scroll hint gradient - show if more than 4 images */}
        {validImages.length > 4 && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: '40px',
              background: 'linear-gradient(to right, transparent, var(--color-background))',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Lightbox modal */}
      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 'var(--space-6)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Image */}
            <img
              src={getProxyUrl(selectedImage.url)}
              alt={selectedImage.title}
              style={{
                maxWidth: '100%',
                maxHeight: '70vh',
                objectFit: 'contain',
              }}
            />

            {/* Info footer */}
            <div
              style={{
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                borderTop: '1px solid var(--color-border)',
              }}
            >
              <h4
                style={{
                  fontSize: 'var(--text-base)',
                  color: 'var(--color-text-primary)',
                  margin: 0,
                  lineHeight: 1.4,
                }}
              >
                {selectedImage.title || 'Image'}
              </h4>
              {selectedImage.resolution && (
                <span
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-tertiary)',
                  }}
                >
                  {selectedImage.resolution}
                </span>
              )}
              <a
                href={selectedImage.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  color: 'var(--color-accent)',
                  fontSize: 'var(--text-sm)',
                  textDecoration: 'none',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.textDecoration = 'underline';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.textDecoration = 'none';
                }}
              >
                <ExternalLink size={14} />
                View source
              </a>
            </div>

            {/* Close button */}
            <button
              onClick={() => setSelectedImage(null)}
              style={{
                position: 'absolute',
                top: 'var(--space-2)',
                right: 'var(--space-2)',
                width: '32px',
                height: '32px',
                border: 'none',
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.5)',
                color: 'white',
                fontSize: '24px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background var(--transition-fast)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(0, 0, 0, 0.7)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(0, 0, 0, 0.5)';
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
