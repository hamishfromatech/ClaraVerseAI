import { useState } from 'react';
import { FileText, FileSpreadsheet, FileJson, X, ZoomIn, AlertCircle } from 'lucide-react';
import type {
  Attachment,
  ImageAttachment,
  DocumentAttachment,
  DataAttachment,
} from '@/types/websocket';
import { formatFileSize } from '@/services/uploadService';
import { useCachedImage } from '@/hooks/useCachedImage';
import { DataTablePreview } from './DataTablePreview';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Sub-component for individual image to use the hook
interface CachedImageProps {
  imageAttachment: ImageAttachment;
  onClickLightbox: (url: string) => void;
}

const CachedImage = ({ imageAttachment, onClickLightbox }: CachedImageProps) => {
  // Check if URL is already absolute (from backend tools)
  const isAbsoluteUrl =
    imageAttachment.url.startsWith('http://') || imageAttachment.url.startsWith('https://');
  const fallbackUrl = isAbsoluteUrl ? imageAttachment.url : `${API_BASE_URL}${imageAttachment.url}`;
  const { imageUrl, loading } = useCachedImage(imageAttachment.file_id, fallbackUrl);
  const [loadError, setLoadError] = useState(false);

  // Image is expired if explicitly marked OR if it failed to load
  const isExpired = imageAttachment.expired === true || loadError;

  // Handle image load error - treat as expired
  const handleImageError = () => {
    console.log(`[MessageAttachment] Image failed to load: ${imageAttachment.filename}`);
    setLoadError(true);
  };

  return (
    <div
      key={imageAttachment.file_id}
      style={{
        position: 'relative',
        aspectRatio: '16/9',
        background: isExpired ? 'var(--color-danger-bg)' : 'var(--color-surface)',
        border: `1px solid ${isExpired ? 'var(--color-danger)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        cursor: isExpired ? 'default' : 'pointer',
        transition: 'all var(--transition-fast)',
        opacity: isExpired ? 0.7 : 1,
      }}
      onClick={() => !isExpired && imageUrl && onClickLightbox(imageUrl)}
      onMouseEnter={e => {
        if (!isExpired) {
          e.currentTarget.style.transform = 'scale(1.02)';
          e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        }
      }}
      onMouseLeave={e => {
        if (!isExpired) {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = 'none';
        }
      }}
    >
      {isExpired ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-danger)',
            gap: 'var(--space-2)',
            padding: 'var(--space-4)',
            textAlign: 'center',
          }}
        >
          <AlertCircle size={32} />
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>
            Image Expired
          </div>
          <div style={{ fontSize: 'var(--text-xs)', opacity: 0.8 }}>
            {imageAttachment.filename || 'File no longer available'}
          </div>
        </div>
      ) : loading ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-secondary)',
          }}
        >
          Loading...
        </div>
      ) : imageUrl ? (
        <>
          <img
            src={imageUrl}
            alt={imageAttachment.filename || 'Uploaded image'}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
            onError={handleImageError}
          />
          {/* Zoom overlay */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0,
              transition: 'opacity var(--transition-fast)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.opacity = '1';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.opacity = '0';
            }}
          >
            <ZoomIn size={32} color="white" />
          </div>
        </>
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-danger)',
            gap: 'var(--space-2)',
            padding: 'var(--space-4)',
            textAlign: 'center',
          }}
        >
          <AlertCircle size={32} />
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>
            Image Unavailable
          </div>
          <div style={{ fontSize: 'var(--text-xs)', opacity: 0.8 }}>
            {imageAttachment.filename || 'File no longer available'}
          </div>
        </div>
      )}
    </div>
  );
};

interface MessageAttachmentProps {
  attachments: Attachment[];
}

export const MessageAttachment = ({ attachments }: MessageAttachmentProps) => {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {attachments.map((attachment, index) => {
          if (attachment.type === 'image') {
            const imageAttachment = attachment as ImageAttachment;
            return (
              <CachedImage
                key={`${imageAttachment.file_id}-${index}`}
                imageAttachment={imageAttachment}
                onClickLightbox={setLightboxImage}
              />
            );
          }

          if (attachment.type === 'document') {
            const docAttachment = attachment as DocumentAttachment;
            const isExpired = docAttachment.expired === true;

            return (
              <div
                key={`${docAttachment.file_id}-${index}`}
                style={{
                  padding: 'var(--space-3)',
                  background: isExpired ? 'var(--color-danger-bg)' : 'var(--color-surface)',
                  border: `1px solid ${isExpired ? 'var(--color-danger)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                  minHeight: '120px',
                  opacity: isExpired ? 0.7 : 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                  }}
                >
                  {isExpired ? (
                    <AlertCircle size={24} color="var(--color-danger)" />
                  ) : (
                    <FileText size={24} color="var(--color-accent)" />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--font-medium)',
                        color: isExpired ? 'var(--color-danger)' : 'var(--color-text-primary)',
                        wordBreak: 'break-word',
                      }}
                    >
                      {docAttachment.filename || 'Document'}
                      {isExpired && ' (Expired)'}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: isExpired ? 'var(--color-danger)' : 'var(--color-text-secondary)',
                        marginTop: 'var(--space-1)',
                      }}
                    >
                      {isExpired
                        ? 'File expired and no longer available'
                        : `PDF • ${formatFileSize(docAttachment.size)}`}
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          if (attachment.type === 'data') {
            const dataAttachment = attachment as DataAttachment;
            const isExpired = dataAttachment.expired === true;

            // If we have a CSV preview, show the table
            if (dataAttachment.data_preview && !isExpired) {
              return (
                <div key={`${dataAttachment.file_id}-${index}`} style={{ gridColumn: '1 / -1' }}>
                  <DataTablePreview
                    filename={dataAttachment.filename || 'data.csv'}
                    preview={dataAttachment.data_preview}
                    onDownload={() => {
                      // Download the file - check if URL is already absolute
                      const link = document.createElement('a');
                      const isAbsoluteUrl =
                        dataAttachment.url.startsWith('http://') ||
                        dataAttachment.url.startsWith('https://');
                      link.href = isAbsoluteUrl
                        ? dataAttachment.url
                        : `${API_BASE_URL}${dataAttachment.url}`;
                      link.download = dataAttachment.filename || 'data.csv';
                      link.click();
                    }}
                  />
                </div>
              );
            }

            // Fallback to simple card for non-CSV files or expired files
            // Determine icon based on MIME type
            const getDataFileIcon = () => {
              const mimeType = dataAttachment.mime_type.split(';')[0].trim();
              const filename = dataAttachment.filename?.toLowerCase() || '';

              if (mimeType === 'application/json' || filename.endsWith('.json')) {
                return <FileJson size={24} color="var(--color-accent)" />;
              }
              if (
                mimeType === 'text/csv' ||
                filename.endsWith('.csv') ||
                mimeType.includes('spreadsheet') ||
                mimeType.includes('excel') ||
                filename.endsWith('.xlsx') ||
                filename.endsWith('.xls')
              ) {
                return <FileSpreadsheet size={24} color="var(--color-accent)" />;
              }
              return <FileText size={24} color="var(--color-accent)" />;
            };

            // Get file type label
            const getFileTypeLabel = () => {
              const mimeType = dataAttachment.mime_type.split(';')[0].trim();
              const filename = dataAttachment.filename?.toLowerCase() || '';

              if (mimeType === 'application/json' || filename.endsWith('.json')) return 'JSON';
              if (mimeType === 'text/csv' || filename.endsWith('.csv')) return 'CSV';
              if (mimeType.includes('spreadsheet') || filename.endsWith('.xlsx')) return 'Excel';
              if (mimeType === 'application/vnd.ms-excel' || filename.endsWith('.xls'))
                return 'Excel';
              if (mimeType === 'text/plain' || filename.endsWith('.txt')) return 'Text';
              return 'Data';
            };

            return (
              <div
                key={`${dataAttachment.file_id}-${index}`}
                style={{
                  padding: 'var(--space-3)',
                  background: isExpired ? 'var(--color-danger-bg)' : 'var(--color-surface)',
                  border: `1px solid ${isExpired ? 'var(--color-danger)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                  minHeight: '100px',
                  opacity: isExpired ? 0.7 : 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                  }}
                >
                  {isExpired ? (
                    <AlertCircle size={24} color="var(--color-danger)" />
                  ) : (
                    getDataFileIcon()
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--font-medium)',
                        color: isExpired ? 'var(--color-danger)' : 'var(--color-text-primary)',
                        wordBreak: 'break-word',
                      }}
                    >
                      {dataAttachment.filename || 'Data File'}
                      {isExpired && ' (Expired)'}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: isExpired ? 'var(--color-danger)' : 'var(--color-text-secondary)',
                        marginTop: 'var(--space-1)',
                      }}
                    >
                      {isExpired
                        ? 'File expired and no longer available'
                        : `${getFileTypeLabel()} • ${formatFileSize(dataAttachment.size)}`}
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Lightbox for image preview */}
      {lightboxImage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 'var(--space-6)',
          }}
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            style={{
              position: 'absolute',
              top: 'var(--space-4)',
              right: 'var(--space-4)',
              width: '40px',
              height: '40px',
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 'var(--radius-full)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            }}
          >
            <X size={24} />
          </button>
          <img
            src={lightboxImage}
            alt="Full size preview"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 'var(--radius-lg)',
            }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
};
