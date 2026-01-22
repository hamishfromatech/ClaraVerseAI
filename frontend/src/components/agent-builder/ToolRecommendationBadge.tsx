import * as LucideIcons from 'lucide-react';
import type { ToolRecommendation } from '@/services/toolsService';

interface ToolRecommendationBadgeProps {
  recommendation: ToolRecommendation;
  isSelected: boolean;
  onToggle: () => void;
}

export function ToolRecommendationBadge({
  recommendation,
  isSelected,
  onToggle,
}: ToolRecommendationBadgeProps) {
  const ToolIcon =
    (LucideIcons as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[
      recommendation.icon
    ] || LucideIcons.Sparkles;

  return (
    <button
      onClick={onToggle}
      className={`
        inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
        ${
          isSelected
            ? 'bg-[var(--color-accent)] text-black border border-[var(--color-accent)]'
            : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/10'
        }
      `}
      title={`${recommendation.description} (Score: ${recommendation.score})`}
    >
      <ToolIcon size={14} className={isSelected ? 'text-white' : 'text-[var(--color-accent)]'} />
      <span>{recommendation.display_name}</span>
      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
    </button>
  );
}
