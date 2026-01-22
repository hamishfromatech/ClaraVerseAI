import { useState, useEffect, useMemo } from 'react';
import { Clock, Calendar, CalendarDays, Timer, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CronBuilderProps {
  value: string;
  onChange: (cron: string) => void;
}

type FrequencyType = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly';

const FREQUENCY_OPTIONS: {
  type: FrequencyType;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    type: 'minutes',
    label: 'Every X Minutes',
    icon: <Timer size={16} />,
    description: 'Run multiple times per hour',
  },
  {
    type: 'hourly',
    label: 'Hourly',
    icon: <Clock size={16} />,
    description: 'Run once every hour',
  },
  { type: 'daily', label: 'Daily', icon: <Calendar size={16} />, description: 'Run once per day' },
  {
    type: 'weekly',
    label: 'Weekly',
    icon: <CalendarDays size={16} />,
    description: 'Run on specific days',
  },
  {
    type: 'monthly',
    label: 'Monthly',
    icon: <Repeat size={16} />,
    description: 'Run once per month',
  },
];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun', fullLabel: 'Sunday' },
  { value: 1, label: 'Mon', fullLabel: 'Monday' },
  { value: 2, label: 'Tue', fullLabel: 'Tuesday' },
  { value: 3, label: 'Wed', fullLabel: 'Wednesday' },
  { value: 4, label: 'Thu', fullLabel: 'Thursday' },
  { value: 5, label: 'Fri', fullLabel: 'Friday' },
  { value: 6, label: 'Sat', fullLabel: 'Saturday' },
];

const MINUTE_INTERVALS = [1, 5, 10, 15, 30, 60];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

// Parse a cron expression to extract settings
function parseCronToSettings(cron: string): {
  frequency: FrequencyType;
  minuteInterval: number;
  hour: number;
  minute: number;
  daysOfWeek: number[];
  dayOfMonth: number;
} {
  const defaults = {
    frequency: 'daily' as FrequencyType,
    minuteInterval: 15,
    hour: 9,
    minute: 0,
    daysOfWeek: [1], // Monday
    dayOfMonth: 1,
  };

  if (!cron) return defaults;

  const parts = cron.split(' ');
  if (parts.length !== 5) return defaults;

  const [min, hour, dom, , dow] = parts;

  // Every X minutes: */X * * * *
  if (min.startsWith('*/') && hour === '*') {
    return {
      ...defaults,
      frequency: 'minutes',
      minuteInterval: parseInt(min.slice(2)) || 15,
    };
  }

  // Hourly: X * * * *
  if (hour === '*' && dom === '*' && dow === '*') {
    return {
      ...defaults,
      frequency: 'hourly',
      minute: parseInt(min) || 0,
    };
  }

  // Weekly: X X * * X or X X * * X,Y,Z
  if (dom === '*' && dow !== '*') {
    const days = dow.split(',').map(d => parseInt(d));
    return {
      ...defaults,
      frequency: 'weekly',
      hour: parseInt(hour) || 9,
      minute: parseInt(min) || 0,
      daysOfWeek: days,
    };
  }

  // Monthly: X X X * *
  if (dom !== '*' && dow === '*') {
    return {
      ...defaults,
      frequency: 'monthly',
      hour: parseInt(hour) || 9,
      minute: parseInt(min) || 0,
      dayOfMonth: parseInt(dom) || 1,
    };
  }

  // Daily: X X * * *
  return {
    ...defaults,
    frequency: 'daily',
    hour: parseInt(hour) || 9,
    minute: parseInt(min) || 0,
  };
}

export function CronBuilder({ value, onChange }: CronBuilderProps) {
  const parsed = useMemo(() => parseCronToSettings(value), [value]);

  const [frequency, setFrequency] = useState<FrequencyType>(parsed.frequency);
  const [minuteInterval, setMinuteInterval] = useState(parsed.minuteInterval);
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(parsed.daysOfWeek);
  const [dayOfMonth, setDayOfMonth] = useState(parsed.dayOfMonth);

  // Generate cron expression from current settings
  useEffect(() => {
    let cron = '';

    switch (frequency) {
      case 'minutes':
        // 60 minutes = hourly at :00
        cron = minuteInterval === 60 ? '0 * * * *' : `*/${minuteInterval} * * * *`;
        break;
      case 'hourly':
        cron = `${minute} * * * *`;
        break;
      case 'daily':
        cron = `${minute} ${hour} * * *`;
        break;
      case 'weekly':
        cron = `${minute} ${hour} * * ${daysOfWeek.sort().join(',')}`;
        break;
      case 'monthly':
        cron = `${minute} ${hour} ${dayOfMonth} * *`;
        break;
    }

    if (cron && cron !== value) {
      onChange(cron);
    }
  }, [frequency, minuteInterval, hour, minute, daysOfWeek, dayOfMonth, onChange, value]);

  const toggleDayOfWeek = (day: number) => {
    if (daysOfWeek.includes(day)) {
      if (daysOfWeek.length > 1) {
        setDaysOfWeek(daysOfWeek.filter(d => d !== day));
      }
    } else {
      setDaysOfWeek([...daysOfWeek, day]);
    }
  };

  const formatTime = (h: number, m: number) => {
    const hour12 = h % 12 || 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  const getHumanReadable = () => {
    switch (frequency) {
      case 'minutes':
        return minuteInterval === 60 ? 'Every hour' : `Every ${minuteInterval} minutes`;
      case 'hourly':
        return `Hourly at :${minute.toString().padStart(2, '0')}`;
      case 'daily':
        return `Daily at ${formatTime(hour, minute)}`;
      case 'weekly':
        const dayNames = daysOfWeek
          .map(d => DAYS_OF_WEEK.find(dw => dw.value === d)?.label)
          .join(', ');
        return `${dayNames} at ${formatTime(hour, minute)}`;
      case 'monthly':
        const suffix =
          dayOfMonth === 1 ? 'st' : dayOfMonth === 2 ? 'nd' : dayOfMonth === 3 ? 'rd' : 'th';
        return `${dayOfMonth}${suffix} of each month at ${formatTime(hour, minute)}`;
    }
  };

  return (
    <div className="space-y-3">
      {/* Frequency Type Selection */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">
          How often should this run?
        </label>
        <div className="flex flex-wrap gap-2">
          {FREQUENCY_OPTIONS.map(opt => (
            <button
              key={opt.type}
              type="button"
              onClick={() => setFrequency(opt.type)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                frequency === opt.type
                  ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-primary)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)]'
              )}
            >
              {opt.icon}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Frequency-specific options */}
      <div className="p-3 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
        {/* Minutes interval */}
        {frequency === 'minutes' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Run every
            </label>
            <div className="flex flex-wrap gap-1.5">
              {MINUTE_INTERVALS.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMinuteInterval(m)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    minuteInterval === m
                      ? 'bg-[var(--color-accent)] text-black'
                      : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  )}
                >
                  {m === 60 ? '1 hr' : `${m} min`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hourly - minute selection */}
        {frequency === 'hourly' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              At minute
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[0, 15, 30, 45].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMinute(m)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    minute === m
                      ? 'bg-[var(--color-accent)] text-black'
                      : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  )}
                >
                  :{m.toString().padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Daily/Weekly/Monthly - time selection */}
        {(frequency === 'daily' || frequency === 'weekly' || frequency === 'monthly') && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              At time
            </label>
            <div className="flex items-center gap-2">
              <select
                value={hour}
                onChange={e => setHour(parseInt(e.target.value))}
                className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              >
                {HOURS.map(h => (
                  <option key={h} value={h}>
                    {(h % 12 || 12).toString().padStart(2, '0')} {h < 12 ? 'AM' : 'PM'}
                  </option>
                ))}
              </select>
              <span className="text-sm text-[var(--color-text-tertiary)]">:</span>
              <select
                value={minute}
                onChange={e => setMinute(parseInt(e.target.value))}
                className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              >
                {[0, 15, 30, 45].map(m => (
                  <option key={m} value={m}>
                    {m.toString().padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Weekly - day selection */}
        {frequency === 'weekly' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              On days
            </label>
            <div className="flex gap-1">
              {DAYS_OF_WEEK.map(day => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDayOfWeek(day.value)}
                  className={cn(
                    'w-9 h-9 rounded-lg text-xs font-medium transition-all',
                    daysOfWeek.includes(day.value)
                      ? 'bg-[var(--color-accent)] text-black'
                      : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  )}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Monthly - day of month selection */}
        {frequency === 'monthly' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">On day</label>
            <select
              value={dayOfMonth}
              onChange={e => setDayOfMonth(parseInt(e.target.value))}
              className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            >
              {DAYS_OF_MONTH.map(d => (
                <option key={d} value={d}>
                  {d}
                  {d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Human-readable summary + cron toggle */}
      <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-[var(--color-surface)]">
        <div className="flex items-center gap-2 text-xs">
          <Clock size={12} className="text-[var(--color-accent)]" />
          <span className="text-[var(--color-text-primary)] font-medium">{getHumanReadable()}</span>
        </div>
        <div className="relative">
          <details className="text-[10px]">
            <summary className="text-[var(--color-text-tertiary)] cursor-pointer hover:text-[var(--color-text-secondary)] select-none">
              cron
            </summary>
            <code className="absolute right-0 mt-1 p-1.5 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] font-mono text-[var(--color-text-secondary)] text-[10px] z-10 whitespace-nowrap">
              {value}
            </code>
          </details>
        </div>
      </div>
    </div>
  );
}
