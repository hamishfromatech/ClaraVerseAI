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
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Mic className="w-6 h-6" />
          Transcription Settings
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Configure how voice messages and audio files are converted to text
        </p>
      </div>

      {/* Provider Selection */}
      <div style={{ backgroundColor: '#0d0d0d' }} className="rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Headphones className="w-5 h-5" />
          Transcription Engine
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => handleProviderChange('local')}
            className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
              transcriptionProvider === 'local'
                ? 'border-gray-400 bg-gray-800/50'
                : 'border-gray-800 bg-black hover:border-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full ${transcriptionProvider === 'local' ? 'bg-green-500' : 'bg-gray-600'}`} />
              <span className="font-medium">Local Whisper</span>
            </div>
            <p className="text-xs text-gray-500 text-left">
              Runs on your local machine using whisper-node. Private and free.
            </p>
          </button>

          <button
            onClick={() => handleProviderChange('remote')}
            className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
              transcriptionProvider === 'remote'
                ? 'border-gray-400 bg-gray-800/50'
                : 'border-gray-800 bg-black hover:border-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full ${transcriptionProvider === 'remote' ? 'bg-blue-500' : 'bg-gray-600'}`} />
              <span className="font-medium">Cloud API (Groq/OpenAI)</span>
            </div>
            <p className="text-xs text-gray-500 text-left">
              Uses high-performance cloud providers. Requires API keys.
            </p>
          </button>
        </div>
      </div>

      {/* Model Selection (Only for Local) */}
      {transcriptionProvider === 'local' && (
        <div
          style={{ backgroundColor: '#0d0d0d', borderColor: '#e91e63' }}
          className="rounded-lg p-6 border"
        >
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-2">
            <Settings2 className="w-5 h-5" />
            Local Model Size
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Select the Whisper model to use. Larger models are more accurate but use more RAM and are slower.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {WHISPER_MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => handleModelChange(model.id)}
                className={`flex flex-col items-start p-3 rounded border transition-all ${
                  transcriptionModel === model.id
                    ? 'border-pink-500 bg-pink-500/5'
                    : 'border-gray-800 bg-black hover:border-gray-700'
                }`}
              >
                <span className="font-medium text-sm">{model.label}</span>
                <span className="text-[10px] text-gray-500">{model.description}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-start gap-2 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
            <Info className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-gray-400">
              Note: The first time you select a new model, it will be downloaded automatically (150MB - 3GB depending on size).
            </p>
          </div>
        </div>
      )}

      {/* Cloud Info */}
      {transcriptionProvider === 'remote' && (
        <div
          style={{ backgroundColor: '#0d0d0d' }}
          className="rounded-lg p-6 border border-gray-700"
        >
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-400 mt-0.5" />
            <div>
              <h3 className="font-semibold mb-1">Cloud Transcription</h3>
              <p className="text-sm text-gray-400">
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
