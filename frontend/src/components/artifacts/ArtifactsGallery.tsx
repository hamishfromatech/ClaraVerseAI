/**
 * ArtifactsGallery Component
 *
 * Displays all user artifacts in a grid gallery view.
 * Shows artifacts from all chats with preview cards and thumbnails.
 * Features tabs for filtering by artifact type (All, Images, HTML, SVG, Mermaid).
 * Clicking an artifact opens a preview modal with download and navigation options.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  FileCode,
  Image as ImageIcon,
  GitBranch,
  Plus,
  ImageIcon as PhotoIcon,
  Layers,
  LayoutGrid,
} from 'lucide-react';
import type { Artifact, ArtifactType } from '@/types/artifact';
import type { Chat } from '@/types/chat';
import { getCachedThumbnail } from '@/utils/thumbnailGenerator';
import { ArtifactPreviewModal } from './ArtifactPreviewModal';
import styles from './ArtifactsGallery.module.css';

// Tab filter types
type FilterTab = 'all' | ArtifactType;

interface TabConfig {
  id: FilterTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const FILTER_TABS: TabConfig[] = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'image', label: 'Images', icon: PhotoIcon },
  { id: 'html', label: 'HTML', icon: FileCode },
  { id: 'svg', label: 'SVG', icon: ImageIcon },
  { id: 'mermaid', label: 'Diagrams', icon: GitBranch },
];

interface ArtifactWithContext extends Artifact {
  chatId: string;
  chatTitle: string;
  messageId: string;
  createdAt: Date;
}

interface ArtifactsGalleryProps {
  chats: Chat[];
  onNewArtifact: () => void;
  onNavigateToChat?: (chatId: string) => void;
}

const ARTIFACT_ICONS: Record<
  ArtifactType,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  html: FileCode,
  svg: ImageIcon,
  mermaid: GitBranch,
  image: PhotoIcon,
};

interface ArtifactGroup {
  chatId: string;
  chatTitle: string;
  artifacts: ArtifactWithContext[];
  latestDate: Date;
}

/**
 * Formats a date as relative time (e.g., "12 days ago", "1 month ago")
 */
function formatRelativeDate(date: Date | undefined | null): string {
  if (!date) return 'Unknown';

  try {
    const now = new Date();
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) return 'Unknown';

    const diffMs = now.getTime() - dateObj.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffSeconds < 60) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    } else if (diffWeeks < 4) {
      return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
    } else if (diffMonths < 12) {
      return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
    } else {
      return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
    }
  } catch {
    return 'Unknown';
  }
}

/**
 * Aggregates all artifacts from all chats
 */
function getAllArtifacts(chats: Chat[]): ArtifactWithContext[] {
  const artifacts: ArtifactWithContext[] = [];

  for (const chat of chats) {
    for (const message of chat.messages) {
      if (message.artifacts && message.role === 'assistant') {
        for (const artifact of message.artifacts) {
          artifacts.push({
            ...artifact,
            chatId: chat.id,
            chatTitle: chat.title,
            messageId: message.id,
            createdAt: message.timestamp,
          });
        }
      }
    }
  }

  // Sort by creation date (newest first)
  // Handle both Date objects and strings (IndexedDB doesn't preserve Date objects)
  return artifacts.sort((a, b) => {
    const timeA =
      a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
    const timeB =
      b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
    return timeB - timeA;
  });
}

/**
 * Groups artifacts by chat
 */
function groupArtifactsByChat(artifacts: ArtifactWithContext[]): ArtifactGroup[] {
  const groupMap = new Map<string, ArtifactGroup>();

  for (const artifact of artifacts) {
    if (!groupMap.has(artifact.chatId)) {
      groupMap.set(artifact.chatId, {
        chatId: artifact.chatId,
        chatTitle: artifact.chatTitle,
        artifacts: [],
        latestDate: artifact.createdAt,
      });
    }

    const group = groupMap.get(artifact.chatId)!;
    group.artifacts.push(artifact);
    // Update latest date if this artifact is newer
    // Handle both Date objects and strings (IndexedDB doesn't preserve Date objects)
    const artifactTime =
      artifact.createdAt instanceof Date
        ? artifact.createdAt.getTime()
        : new Date(artifact.createdAt).getTime();
    const groupTime =
      group.latestDate instanceof Date
        ? group.latestDate.getTime()
        : new Date(group.latestDate).getTime();
    if (artifactTime > groupTime) {
      group.latestDate = artifact.createdAt;
    }
  }

  // Sort groups by latest artifact date (newest first)
  // Handle both Date objects and strings
  return Array.from(groupMap.values()).sort((a, b) => {
    const timeA =
      a.latestDate instanceof Date ? a.latestDate.getTime() : new Date(a.latestDate).getTime();
    const timeB =
      b.latestDate instanceof Date ? b.latestDate.getTime() : new Date(b.latestDate).getTime();
    return timeB - timeA;
  });
}

export function ArtifactsGallery({
  chats,
  onNewArtifact,
  onNavigateToChat,
}: ArtifactsGalleryProps) {
  const allArtifactsRaw = getAllArtifacts(chats);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [failedArtifacts, setFailedArtifacts] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  // Modal state
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactWithContext | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Filter out failed artifacts (broken mermaid, invalid content, etc.)
  const allArtifacts = useMemo(() => {
    return allArtifactsRaw.filter(artifact => !failedArtifacts.has(artifact.id));
  }, [allArtifactsRaw, failedArtifacts]);

  // Filter artifacts by selected tab
  const artifacts = useMemo(() => {
    if (activeTab === 'all') return allArtifacts;
    return allArtifacts.filter(artifact => artifact.type === activeTab);
  }, [allArtifacts, activeTab]);

  // Group filtered artifacts by chat
  const artifactGroups = useMemo(() => groupArtifactsByChat(artifacts), [artifacts]);

  // Count artifacts by type for tab badges
  const typeCounts = useMemo(() => {
    const counts: Record<FilterTab, number> = {
      all: allArtifacts.length,
      image: 0,
      html: 0,
      svg: 0,
      mermaid: 0,
    };
    for (const artifact of allArtifacts) {
      counts[artifact.type]++;
    }
    return counts;
  }, [allArtifacts]);

  const handleArtifactClick = (artifact: ArtifactWithContext) => {
    // Open the artifact in the preview modal
    setSelectedArtifact(artifact);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedArtifact(null);
  };

  const handleGroupClick = (groupId: string, artifactsInGroup: ArtifactWithContext[]) => {
    if (artifactsInGroup.length === 1) {
      // If only one artifact, open it directly
      handleArtifactClick(artifactsInGroup[0]);
    } else {
      // If multiple artifacts, toggle expansion
      setExpandedGroup(expandedGroup === groupId ? null : groupId);
    }
  };

  // Generate thumbnails for all artifacts (use allArtifactsRaw to process all)
  useEffect(() => {
    // Prevent running if already generating
    if (isGenerating) return;

    const generateThumbnails = async () => {
      setIsGenerating(true);
      const newThumbnails = new Map<string, string>();
      const newFailedArtifacts = new Set<string>();

      // Generate thumbnails one at a time with a small delay to avoid overwhelming the browser
      for (const artifact of allArtifactsRaw) {
        try {
          // Check for pre-generated thumbnail in metadata (for image artifacts)
          const preGeneratedThumbnail = (artifact.metadata?.thumbnail as string) || '';
          const thumbnail = await getCachedThumbnail(
            artifact.id,
            artifact.content,
            artifact.type,
            300,
            200,
            artifact.images,
            preGeneratedThumbnail
          );
          if (thumbnail) {
            newThumbnails.set(artifact.id, thumbnail);
            // Update state incrementally so users see thumbnails as they're generated
            setThumbnails(new Map(newThumbnails));
          } else {
            // Empty thumbnail means content is invalid (e.g., broken mermaid syntax)
            // Only mark as failed for types that should always have thumbnails
            if (artifact.type === 'mermaid' || artifact.type === 'svg') {
              newFailedArtifacts.add(artifact.id);
            }
          }

          // Small delay between generations to prevent blocking
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          console.error(`Failed to generate thumbnail for ${artifact.id}:`, error);
          // Mark as failed for mermaid/svg (they should always work if valid)
          if (artifact.type === 'mermaid' || artifact.type === 'svg') {
            newFailedArtifacts.add(artifact.id);
          }
        }
      }

      // Update failed artifacts state
      if (newFailedArtifacts.size > 0) {
        setFailedArtifacts(prev => new Set([...prev, ...newFailedArtifacts]));
      }

      setIsGenerating(false);
    };

    if (allArtifactsRaw.length > 0) {
      generateThumbnails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats.length]); // Only regenerate when number of chats changes

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Artifacts</h1>
        <button className={styles.newButton} onClick={onNewArtifact}>
          <Plus size={18} />
          <span>New artifact</span>
        </button>
      </div>

      {/* Type Filter Tabs */}
      <div className={styles.tabs}>
        {FILTER_TABS.map(tab => {
          const count = typeCounts[tab.id];
          const isActive = activeTab === tab.id;
          const TabIcon = tab.icon;

          // Hide tabs with 0 items (except "All")
          if (count === 0 && tab.id !== 'all') return null;

          return (
            <button
              key={tab.id}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <TabIcon size={16} className={styles.tabIcon} />
              <span>{tab.label}</span>
              {count > 0 && <span className={styles.tabCount}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Gallery Grid */}
      {artifacts.length === 0 ? (
        <div className={styles.empty}>
          {allArtifacts.length === 0 ? (
            <>
              <FileCode size={48} className={styles.emptyIcon} />
              <h2 className={styles.emptyTitle}>No artifacts yet</h2>
              <p className={styles.emptyText}>
                Create HTML pages, SVG graphics, and Mermaid diagrams in your chats
              </p>
              <button className={styles.emptyButton} onClick={onNewArtifact}>
                <Plus size={18} />
                <span>Start a new chat</span>
              </button>
            </>
          ) : (
            <>
              {(() => {
                const ActiveTabIcon = FILTER_TABS.find(t => t.id === activeTab)?.icon || FileCode;
                return <ActiveTabIcon size={48} className={styles.emptyIcon} />;
              })()}
              <h2 className={styles.emptyTitle}>
                No {FILTER_TABS.find(t => t.id === activeTab)?.label.toLowerCase() || 'artifacts'}
              </h2>
              <p className={styles.emptyText}>
                You don't have any{' '}
                {activeTab === 'image' ? 'generated images' : `${activeTab} artifacts`} yet. Try
                creating one in your chats!
              </p>
              <button className={styles.emptyButton} onClick={() => setActiveTab('all')}>
                <LayoutGrid size={18} />
                <span>View all artifacts</span>
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {artifactGroups.map(group => {
            const isExpanded = expandedGroup === group.chatId;
            const firstArtifact = group.artifacts[0];
            const hasMultiple = group.artifacts.length > 1;

            // Show expanded list or stacked card
            if (isExpanded) {
              return group.artifacts
                .filter(artifact => thumbnails.has(artifact.id))
                .map(artifact => {
                  const IconComponent = ARTIFACT_ICONS[artifact.type];
                  const thumbnail = thumbnails.get(artifact.id);

                  return (
                    <div
                      key={`${artifact.chatId}-${artifact.messageId}-${artifact.id}`}
                      className={styles.cardStack}
                    >
                      <button className={styles.card} onClick={() => handleArtifactClick(artifact)}>
                        <div className={styles.cardPreview}>
                          {thumbnail ? (
                            <img
                              src={thumbnail}
                              alt={artifact.title}
                              className={styles.cardThumbnail}
                            />
                          ) : (
                            <IconComponent size={32} className={styles.cardIcon} />
                          )}
                          <div className={styles.typeIcon}>
                            <IconComponent size={16} />
                          </div>
                        </div>
                        <div className={styles.cardContent}>
                          <h3 className={styles.cardTitle}>{artifact.title}</h3>
                          <p className={styles.cardDate}>
                            Last edited {formatRelativeDate(artifact.createdAt)}
                          </p>
                        </div>
                      </button>
                    </div>
                  );
                });
            }

            // Show stacked card
            const IconComponent = ARTIFACT_ICONS[firstArtifact.type];
            const thumbnail = thumbnails.get(firstArtifact.id);

            return (
              <div
                key={group.chatId}
                className={`${styles.cardStack} ${hasMultiple ? styles.hasStack : ''}`}
              >
                <button
                  className={styles.card}
                  onClick={() => handleGroupClick(group.chatId, group.artifacts)}
                >
                  <div className={styles.cardPreview}>
                    {thumbnail ? (
                      <img src={thumbnail} alt={group.chatTitle} className={styles.cardThumbnail} />
                    ) : (
                      <IconComponent size={32} className={styles.cardIcon} />
                    )}
                    <div className={styles.typeIcon}>
                      <IconComponent size={16} />
                    </div>
                    {hasMultiple && (
                      <div className={styles.stackBadge}>
                        <Layers size={12} />
                        <span className={styles.stackCount}>{group.artifacts.length}</span>
                      </div>
                    )}
                  </div>
                  <div className={styles.cardContent}>
                    <h3 className={styles.cardTitle}>{group.chatTitle}</h3>
                    <p className={styles.cardDate}>
                      Last edited {formatRelativeDate(group.latestDate)}
                    </p>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      <ArtifactPreviewModal
        artifact={selectedArtifact}
        chatId={selectedArtifact?.chatId}
        chatTitle={selectedArtifact?.chatTitle}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onNavigateToChat={onNavigateToChat}
      />
    </div>
  );
}
