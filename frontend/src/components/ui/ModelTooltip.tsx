import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Info, Zap, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { Model } from '@/types/websocket';

interface ModelTooltipProps {
  model: Model;
  children: React.ReactNode;
}

export function ModelTooltip({ model, children }: ModelTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isPositioned, setIsPositioned] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Format speed: convert to seconds if >= 1000ms
  const formatSpeed = (ms: number) => {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${ms}ms`;
  };

  // Get speed tier based on milliseconds
  const getSpeedTier = (ms: number): { label: string; color: string } => {
    if (ms < 2000) return { label: 'Fastest', color: 'text-green-400' };
    if (ms < 5000) return { label: 'Fast', color: 'text-blue-400' };
    return { label: 'Medium', color: 'text-yellow-400' };
  };

  useEffect(() => {
    if (!isVisible || !triggerRef.current || !tooltipRef.current) {
      setIsPositioned(false);
      return;
    }

    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    // Position tooltip to the right of the trigger
    let top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
    let left = triggerRect.right + 12;

    // Check if tooltip goes off-screen on the right
    if (left + tooltipRect.width > window.innerWidth - 16) {
      // Position to the left instead
      left = triggerRect.left - tooltipRect.width - 12;
    }

    // Keep tooltip within viewport vertically
    if (top < 16) top = 16;
    if (top + tooltipRect.height > window.innerHeight - 16) {
      top = window.innerHeight - tooltipRect.height - 16;
    }

    setPosition({ top, left });
    setIsPositioned(true);
  }, [isVisible]);

  // Don't show tooltip if there's no additional info
  const hasInfo =
    model.description ||
    model.structured_output_support ||
    model.structured_output_compliance !== undefined ||
    model.structured_output_speed_ms ||
    model.structured_output_warning;

  if (!hasInfo) {
    return <>{children}</>;
  }

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        className="relative"
      >
        {children}
      </div>

      {isVisible &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`fixed z-[9999] transition-opacity duration-200 ${
              isPositioned ? 'opacity-100 animate-in fade-in zoom-in-95' : 'opacity-0'
            }`}
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
            }}
          >
            <div className="w-[320px] bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border)]">
                <div className="flex items-start gap-3">
                  {model.provider_favicon ? (
                    <img
                      src={model.provider_favicon}
                      alt={model.provider_name}
                      className="w-6 h-6 rounded flex-shrink-0 mt-0.5"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded bg-[var(--color-accent)]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Info size={14} className="text-[var(--color-accent)]" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[var(--color-text-primary)] text-sm flex items-center gap-2">
                      {model.name}
                      {model.structured_output_badge && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-bold">
                          {model.structured_output_badge}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5 flex items-center gap-1.5">
                      <span>{model.provider_name}</span>
                      {model.provider_secure && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 text-[10px] font-semibold">
                          <ShieldCheck size={10} />
                          DATA SAFE
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="px-4 py-3 space-y-3">
                {/* Description */}
                {model.description && (
                  <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                    {model.description}
                  </p>
                )}

                {/* Structured Output Info */}
                {(model.structured_output_support ||
                  model.structured_output_speed_ms ||
                  model.structured_output_compliance !== undefined) && (
                  <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      <CheckCircle2 size={12} />
                      Structured Output
                    </div>

                    <div className="space-y-1.5">
                      {/* Quality */}
                      {model.structured_output_support && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--color-text-tertiary)]">Quality</span>
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded ${
                              model.structured_output_support === 'excellent'
                                ? 'bg-green-500/20 text-green-400'
                                : model.structured_output_support === 'good'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : model.structured_output_support === 'fair'
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : 'bg-gray-500/20 text-gray-400'
                            }`}
                          >
                            {model.structured_output_support}
                          </span>
                        </div>
                      )}

                      {/* Compliance */}
                      {model.structured_output_compliance !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--color-text-tertiary)]">
                            Compliance
                          </span>
                          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                            {model.structured_output_compliance}%
                          </span>
                        </div>
                      )}

                      {/* Speed */}
                      {model.structured_output_speed_ms && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-[var(--color-text-tertiary)] flex items-center gap-1">
                              <Zap size={10} />
                              Avg Response
                            </span>
                            <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                              {formatSpeed(model.structured_output_speed_ms)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-[var(--color-text-tertiary)]">
                              Speed Tier
                            </span>
                            <span
                              className={`text-xs font-semibold ${getSpeedTier(model.structured_output_speed_ms).color}`}
                            >
                              {getSpeedTier(model.structured_output_speed_ms).label}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Warning or Unknown Notice */}
                {model.structured_output_warning && (
                  <div className="flex gap-2 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <AlertTriangle size={14} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-200/90 leading-relaxed">
                      {model.structured_output_warning}
                    </p>
                  </div>
                )}
                {!model.structured_output_warning &&
                  model.structured_output_support === 'unknown' && (
                    <div className="flex gap-2 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <Info size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-blue-200/90 leading-relaxed">
                        Structured outputs work but may have degraded performance. Full testing
                        pending.
                      </p>
                    </div>
                  )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
