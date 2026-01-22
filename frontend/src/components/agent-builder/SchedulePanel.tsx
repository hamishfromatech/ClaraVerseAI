import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clock,
  Play,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Check,
  Sparkles,
  FileWarning,
  Info,
} from 'lucide-react';
import {
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  triggerScheduleNow,
  COMMON_TIMEZONES,
  formatNextRun,
  type Schedule,
  type CreateScheduleRequest,
} from '@/services/scheduleService';
import { CronBuilder } from './CronBuilder';

interface SchedulePanelProps {
  agentId: string;
  className?: string;
  defaultExpanded?: boolean;
  /** Default input from the workflow's Start block */
  startBlockInput?: Record<string, unknown> | null;
  /** Whether the workflow has file inputs (from Start block inputType='file') */
  hasFileInput?: boolean;
  /** Current agent status - used to auto-deploy when scheduling */
  agentStatus?: 'draft' | 'deployed' | 'paused';
  /** Callback to deploy the agent */
  onDeployAgent?: () => Promise<void>;
}

export function SchedulePanel({
  agentId,
  className,
  defaultExpanded = false,
  startBlockInput,
  hasFileInput = false,
  agentStatus,
  onDeployAgent,
}: SchedulePanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(true);
  const [cronExpression, setCronExpression] = useState<string>('0 9 * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [inputTemplate, setInputTemplate] = useState('{}');

  // Track if we've loaded a schedule to avoid overwriting user's saved input
  const [hasLoadedSchedule, setHasLoadedSchedule] = useState(false);

  // Live countdown state
  const [countdown, setCountdown] = useState<string>('');
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-populate input template from workflow's Start block when available
  // Only do this if no schedule exists yet (don't override saved schedule's input)
  useEffect(() => {
    if (startBlockInput && Object.keys(startBlockInput).length > 0 && !hasLoadedSchedule) {
      setInputTemplate(JSON.stringify(startBlockInput, null, 2));
    }
  }, [startBlockInput, hasLoadedSchedule]);

  // Calculate live countdown string
  const calculateCountdown = useCallback((nextRunAt: string | null): string => {
    if (!nextRunAt) return '';

    const now = new Date().getTime();
    const target = new Date(nextRunAt).getTime();
    const diff = target - now;

    if (diff <= 0) return 'Running soon...';

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }
    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  }, []);

  // Live countdown timer effect
  useEffect(() => {
    // Clear any existing interval
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    // Only run countdown if schedule exists, is enabled, and has a next run time
    if (schedule?.enabled && schedule.nextRunAt) {
      // Update immediately
      setCountdown(calculateCountdown(schedule.nextRunAt));

      // Update every second
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(calculateCountdown(schedule.nextRunAt));
      }, 1000);
    } else {
      setCountdown('');
    }

    // Cleanup on unmount or when schedule changes
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [schedule?.enabled, schedule?.nextRunAt, calculateCountdown]);

  const loadSchedule = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getSchedule(agentId);
      setSchedule(data);
      if (data) {
        setHasLoadedSchedule(true); // Mark that we loaded a schedule
        setEnabled(data.enabled);
        setTimezone(data.timezone || 'UTC');
        setInputTemplate(JSON.stringify(data.inputTemplate || {}, null, 2));
        setCronExpression(data.cronExpression || '0 9 * * *');
      }
    } catch (err) {
      console.error('Failed to load schedule:', err);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  // Load schedule on mount and when agentId changes
  useEffect(() => {
    if (agentId) {
      // Reset state when agent changes
      setHasLoadedSchedule(false);
      setSchedule(null);
      setInputTemplate('{}');
      loadSchedule();
    }
  }, [agentId, loadSchedule]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Validate input template JSON
      let parsedInput = {};
      if (inputTemplate.trim()) {
        try {
          parsedInput = JSON.parse(inputTemplate);
        } catch {
          setError('Invalid JSON in input template');
          setIsSaving(false);
          return;
        }
      }

      if (!cronExpression) {
        setError('Please configure a schedule');
        setIsSaving(false);
        return;
      }

      const data: CreateScheduleRequest = {
        cron_expression: cronExpression,
        timezone,
        input_template: parsedInput,
        enabled,
      };

      let result: Schedule;
      if (schedule) {
        result = await updateSchedule(agentId, data);
      } else {
        result = await createSchedule(agentId, data);
      }

      setSchedule(result);

      // Auto-deploy agent if schedule is enabled and agent is not deployed
      if (enabled && agentStatus !== 'deployed' && onDeployAgent) {
        try {
          await onDeployAgent();
          setSuccessMessage('Schedule saved & agent deployed');
        } catch {
          setSuccessMessage('Schedule saved (deploy agent to activate)');
        }
      } else if (enabled && agentStatus !== 'deployed') {
        setSuccessMessage('Schedule saved (deploy agent to activate)');
      } else {
        setSuccessMessage('Schedule saved successfully');
      }
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save schedule';
      setError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!schedule) return;
    if (!confirm('Are you sure you want to delete this schedule?')) return;

    setIsSaving(true);
    setError(null);
    try {
      await deleteSchedule(agentId);
      setSchedule(null);
      setSuccessMessage('Schedule deleted');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete schedule';
      setError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTriggerNow = async () => {
    setIsTriggering(true);
    setError(null);
    try {
      const result = await triggerScheduleNow(agentId);
      // Backend may return execution_id or just a message
      if (result.execution_id) {
        setSuccessMessage(`Execution started: ${result.execution_id.slice(0, 8)}...`);
      } else {
        setSuccessMessage('Execution triggered successfully');
      }
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to trigger execution';
      setError(errorMessage);
    } finally {
      setIsTriggering(false);
    }
  };

  // Handler to use the start block's input template
  const handleUseWorkflowInput = () => {
    if (startBlockInput) {
      setInputTemplate(JSON.stringify(startBlockInput, null, 2));
    }
  };

  return (
    <div className={`border-b border-[var(--color-border)] ${className || ''}`}>
      {/* Header - Clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-[var(--color-accent)]" />
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Schedule</span>
          {!isLoading && schedule !== null && schedule.enabled && (
            <>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
                Active
              </span>
              {countdown && (
                <span className="text-[10px] text-[var(--color-text-secondary)] font-mono">
                  {countdown}
                </span>
              )}
            </>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp size={16} className="text-[var(--color-text-tertiary)]" />
        ) : (
          <ChevronDown size={16} className="text-[var(--color-text-tertiary)]" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* File Input Warning - Show instead of schedule form */}
          {hasFileInput ? (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-center gap-2 text-amber-500 mb-2">
                  <FileWarning size={16} />
                  <span className="text-sm font-medium">Scheduling Not Available</span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  This workflow uses file inputs which expire after 30 minutes. Schedules cannot
                  provide fresh files at execution time.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-[var(--color-surface)]">
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Use the <strong className="text-[var(--color-text-primary)]">API Docs</strong> tab
                  to learn how to trigger this agent programmatically with file uploads.
                </p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={20} className="animate-spin text-[var(--color-text-tertiary)]" />
            </div>
          ) : (
            <>
              {/* Error/Success messages */}
              {error && (
                <div
                  className={`flex items-center gap-2 p-2 rounded text-xs ${
                    error.toLowerCase().includes('limit')
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {error.toLowerCase().includes('limit') ? (
                    <Info size={14} />
                  ) : (
                    <AlertCircle size={14} />
                  )}
                  {error}
                </div>
              )}
              {successMessage && (
                <div className="flex items-center gap-2 p-2 rounded bg-green-500/10 text-green-400 text-xs">
                  <Check size={14} />
                  {successMessage}
                </div>
              )}

              {/* Schedule Status / Enable Toggle */}
              {schedule === null ? (
                // No schedule exists yet - show informational message
                <div className="flex items-center gap-2 p-2 rounded bg-[var(--color-surface)] text-xs text-[var(--color-text-tertiary)]">
                  <Clock size={14} />
                  <span>No schedule configured. Create one below.</span>
                </div>
              ) : (
                // Schedule exists - show enable/disable toggle
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={e => setEnabled(e.target.checked)}
                        className="sr-only"
                      />
                      <div
                        className={`w-9 h-5 rounded-full transition-colors ${
                          enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
                        }`}
                      />
                      <div
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </div>
                    <span className="text-sm text-[var(--color-text-secondary)]">
                      {enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                  {schedule.enabled && countdown && (
                    <span className="text-xs text-[var(--color-accent)] font-mono flex items-center gap-1">
                      <Clock size={12} />
                      Next: {countdown}
                    </span>
                  )}
                </div>
              )}

              {/* Visual Cron Builder */}
              <CronBuilder value={cronExpression} onChange={setCronExpression} />

              {/* Timezone */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                  Timezone
                </label>
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent [color-scheme:dark]"
                >
                  {COMMON_TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value} className="bg-[#1a1a1a] text-white">
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Input Template */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                    Input Template (JSON)
                  </label>
                  {startBlockInput && Object.keys(startBlockInput).length > 0 && (
                    <button
                      onClick={handleUseWorkflowInput}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors"
                      title="Use the test input from your workflow's Start block"
                    >
                      <Sparkles size={12} />
                      Use workflow input
                    </button>
                  )}
                </div>
                <textarea
                  value={inputTemplate}
                  onChange={e => setInputTemplate(e.target.value)}
                  rows={3}
                  placeholder='{ "topic": "news" }'
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
                />
                {startBlockInput && Object.keys(startBlockInput).length > 0 && (
                  <p className="text-[10px] text-[var(--color-text-tertiary)]">
                    Your workflow has a test input saved. Click "Use workflow input" to apply it.
                  </p>
                )}
              </div>

              {/* Stats - only show if schedule exists */}
              {schedule && (
                <div className="flex items-center gap-4 text-xs text-[var(--color-text-tertiary)]">
                  <span>
                    Next:{' '}
                    <span className="text-[var(--color-text-secondary)]">
                      {formatNextRun(schedule.nextRunAt)}
                    </span>
                  </span>
                  <span>
                    Runs:{' '}
                    <span className="text-[var(--color-text-secondary)]">{schedule.totalRuns}</span>
                  </span>
                  {schedule.failedRuns > 0 && (
                    <span className="text-red-400">Failed: {schedule.failedRuns}</span>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-[var(--color-accent)] text-black text-sm font-medium hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {schedule ? 'Update' : 'Create'} Schedule
                </button>

                {schedule && (
                  <>
                    <button
                      onClick={handleTriggerNow}
                      disabled={isTriggering || !schedule.enabled}
                      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface)] text-[var(--color-text-primary)] text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
                      title="Run now"
                    >
                      {isTriggering ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={isSaving}
                      className="px-3 py-2 rounded-lg text-red-400 text-sm hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
