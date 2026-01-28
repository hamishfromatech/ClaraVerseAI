import React from 'react';
import { Mic, Info, Headphones, Settings2 } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';

export interface TranscriptionSectionProps {
  /** Callback when settings change */
  onSave?: () => void;
}

const WHISPER_MODELS = [
  { id: 'tiny.en', label: 'Tiny (English)', description: 'Fastest, lowest accuracy' },
  { id: 'base.en', label: 'Base (English)', description: 'Balanced speed/accuracy' },
  { id: 'small.en', label: 'Small (English)', description: 'Better accuracy, slower' },
  { id: 'medium.en', label: 'Medium (English)', description: 'High accuracy, slow' },
  { id: 'large-v3', label: 'Large V3', description: 'Best accuracy, very slow' },
];

/**
 * Transcription Settings section component.
 * Manages local vs remote Whisper and model selection.
 */
export const TranscriptionSection: React.FC<TranscriptionSectionProps> = ({ onSave }) => {
  const {
    transcriptionProvider,
    transcriptionModel,
    setTranscriptionProvider,
    setTranscriptionModel,
  } = useSettingsStore();

  const handleProviderChange = (provider: 'local' | 'remote') => {
    setTranscriptionProvider(provider);
    onSave?.();
  };

  const handleModelChange = (model: string) => {
    setTranscriptionModel(model);
    onSave?.();
  };

  return (
    <div className="space-y-6 mt-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2 text-[var(--color-text-primary)]">
          <Mic className="w-6 h-6 text-[var(--color-accent)]" />
          Transcription Settings
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
          Configure how voice messages and audio files are converted to text
        </p>
      </div>

      {/* Provider Selection */}
      <div className="rounded-lg p-6 border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4 text-[var(--color-text-primary)]">
          <Headphones className="w-5 h-5 text-[var(--color-accent)]" />
          Transcription Engine
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => handleProviderChange('local')}
            className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
              transcriptionProvider === 'local'
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/50'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full ${transcriptionProvider === 'local' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-tertiary)]'}`} />
              <span className="font-medium text-[var(--color-text-primary)]">Local Whisper</span>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] text-left">
              Runs on your local machine using whisper-node. Private and free.
            </p>
          </button>

          <button
            onClick={() => handleProviderChange('remote')}
            className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
              transcriptionProvider === 'remote'
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/50'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full ${transcriptionProvider === 'remote' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-tertiary)]'}`} />
              <span className="font-medium text-[var(--color-text-primary)]">Cloud API (Groq/OpenAI)</span>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] text-left">
              Uses high-performance cloud providers. Requires API keys.
            </p>
          </button>
        </div>
      </div>

      {/* Model Selection (Only for Local) */}
      {transcriptionProvider === 'local' && (
        <div className="rounded-lg p-6 border border-[var(--color-accent)] bg-[var(--color-bg-secondary)]">
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-2 text-[var(--color-text-primary)]">
            <Settings2 className="w-5 h-5 text-[var(--color-accent)]" />
            Local Model Size
          </h3>
          <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
            Select the Whisper model to use. Larger models are more accurate but use more RAM and are slower.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {WHISPER_MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => handleModelChange(model.id)}
                className={`flex flex-col items-start p-3 rounded border transition-all ${
                  transcriptionModel === model.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/50'
                }`}
              >
                <span className="font-medium text-sm text-[var(--color-text-primary)]">{model.label}</span>
                <span className="text-[10px] text-[var(--color-text-tertiary)]">{model.description}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-start gap-2 p-3 bg-[var(--color-bg-primary)] rounded-lg border border-[var(--color-border)]">
            <Info className="w-4 h-4 text-[var(--color-accent)] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Note: The first time you select a new model, it will be downloaded automatically (150MB - 3GB depending on size).
            </p>
          </div>
        </div>
      )}

      {/* Cloud Info */}
      {transcriptionProvider === 'remote' && (
        <div className="rounded-lg p-6 border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-[var(--color-accent)] mt-0.5" />
            <div>
              <h3 className="font-semibold mb-1 text-[var(--color-text-primary)]">Cloud Transcription</h3>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                Cloud transcription uses Groq (whisper-large-v3) as primary and OpenAI (whisper-1) as fallback.
                Make sure you have valid API keys configured in the <strong>Manage Providers</strong> section above.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};