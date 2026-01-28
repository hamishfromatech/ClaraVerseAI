import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Info, Upload, Trash2, Music, Loader2, Check } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ttsService, type Voice } from '@/services/ttsService';

export interface VoiceSectionProps {
  /** Callback when settings change */
  onSave?: () => void;
}

const BUILTIN_VOICES = [
  { id: 'alba', label: 'Alba', description: 'Female voice, natural tone' },
  { id: 'marius', label: 'Marius', description: 'Male voice, calm tone' },
  { id: 'javert', label: 'Javert', description: 'Male voice, authoritative tone' },
  { id: 'jean', label: 'Jean', description: 'Male voice, warm tone' },
  { id: 'fantine', label: 'Fantine', description: 'Female voice, gentle tone' },
  { id: 'cosette', label: 'Cosette', description: 'Female voice, youthful tone' },
  { id: 'eponine', label: 'Eponine', description: 'Female voice, expressive tone' },
  { id: 'azelma', label: 'Azelma', description: 'Female voice, soft tone' },
];

/**
 * Voice/TTS Settings section component.
 * Manages built-in voice selection, custom voice upload, and TTS toggle.
 */
export const VoiceSection: React.FC<VoiceSectionProps> = ({ onSave }) => {
  const {
    ttsEnabled,
    ttsVoice,
    ttsCustomVoiceId,
    ttsHuggingFaceToken,
    setTTSEnabled,
    setTTSVoice,
    setTTSCustomVoiceId,
    setTTSHuggingFaceToken,
  } = useSettingsStore();

  const [customVoices, setCustomVoices] = useState<Voice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isServiceAvailable, setIsServiceAvailable] = useState(false);
  const [checkingService, setCheckingService] = useState(true);

  // Load custom voices on mount and check service availability
  useEffect(() => {
    loadVoices();
    checkServiceAvailability();
  }, []);

  const checkServiceAvailability = async () => {
    setCheckingService(true);
    try {
      const available = await ttsService.isAvailable();
      setIsServiceAvailable(available);
    } catch {
      setIsServiceAvailable(false);
    } finally {
      setCheckingService(false);
    }
  };

  const loadVoices = async () => {
    setIsLoadingVoices(true);
    try {
      const response = await ttsService.getVoices();
      setCustomVoices(response.custom);
    } catch (error) {
      console.error('Failed to load voices:', error);
    } finally {
      setIsLoadingVoices(false);
    }
  };

  const handleToggleTTS = () => {
    setTTSEnabled(!ttsEnabled);
    onSave?.();
  };

  const handleVoiceSelect = (voice: string) => {
    setTTSVoice(voice);
    setTTSCustomVoiceId(null); // Clear custom voice when built-in is selected
    onSave?.();
  };

  const handleCustomVoiceSelect = (voiceId: string) => {
    setTTSVoice('custom');
    setTTSCustomVoiceId(voiceId);
    onSave?.();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setIsUploading(true);

    try {
      const voice = await ttsService.uploadCustomVoice(file);
      setCustomVoices(prev => [...prev, voice]);
      // Auto-select the newly uploaded voice
      handleCustomVoiceSelect(voice.id);
    } catch (error: any) {
      setUploadError(error.message || 'Failed to upload voice');
    } finally {
      setIsUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleDeleteVoice = async (voiceId: string) => {
    setIsDeleting(voiceId);
    try {
      await ttsService.deleteCustomVoice(voiceId);
      setCustomVoices(prev => prev.filter(v => v.id !== voiceId));
      // Clear selection if the deleted voice was selected
      if (ttsCustomVoiceId === voiceId) {
        setTTSVoice('alba');
        setTTSCustomVoiceId(null);
        onSave?.();
      }
    } catch (error) {
      console.error('Failed to delete voice:', error);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleTestVoice = async (voice?: string, customVoiceId?: string) => {
    try {
      await ttsService.speak('This is a test of the text to speech feature.', voice, customVoiceId, ttsHuggingFaceToken);
    } catch (error: any) {
      console.error('Failed to test voice:', error);
      setUploadError(error.message || 'Failed to play test audio');
    }
  };

  const isCustomSelected = ttsVoice === 'custom' && ttsCustomVoiceId !== null;
  const selectedCustomVoice = customVoices.find(v => v.id === ttsCustomVoiceId);

  return (
    <div className="space-y-6 mt-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2 text-[var(--color-text-primary)]">
          <Volume2 className="w-6 h-6 text-[var(--color-accent)]" />
          Voice Settings
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
          Configure text-to-speech voice for hearing AI responses
        </p>
      </div>

      {/* Service Status */}
      {!checkingService && !isServiceAvailable && (
        <div className="rounded-lg p-4 border border-[var(--color-error)] bg-[var(--color-error-light)]">
          <div className="flex items-start gap-3">
            <VolumeX className="w-5 h-5 text-[var(--color-error)] mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-[var(--color-error)] mb-1">TTS Service Unavailable</h3>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                The text-to-speech service is not responding. Please check that the tts-service container is running.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Enable TTS Toggle */}
      <div className="rounded-lg p-6 border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {ttsEnabled ? (
              <Volume2 className="w-5 h-5 text-[var(--color-success)]" />
            ) : (
              <VolumeX className="w-5 h-5 text-[var(--color-text-tertiary)]" />
            )}
            <div>
              <h3 className="font-semibold text-[var(--color-text-primary)]">Enable Text-to-Speech</h3>
              <p className="text-sm text-[var(--color-text-tertiary)]">
                Play AI responses aloud when you click the speaker icon
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleTTS}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              ttsEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
            }`}
            disabled={!isServiceAvailable}
          >
            <div
              className={`absolute top-1 w-5 h-5 rounded-full bg-[var(--color-text-primary)] transition-transform ${
                ttsEnabled ? 'translate-x-7' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* HuggingFace Token */}
      <div className="rounded-lg p-4 border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="space-y-3">
          <div>
            <h3 className="font-medium text-sm text-[var(--color-text-primary)]">HuggingFace Token</h3>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              Required for gated models. Get your token at{' '}
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-accent)] hover:underline"
              >
                huggingface.co/settings/tokens
              </a>
            </p>
          </div>
          <input
            type="password"
            value={ttsHuggingFaceToken}
            onChange={(e) => setTTSHuggingFaceToken(e.target.value)}
            placeholder="hf_..."
            className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-disabled)] focus:outline-none focus:border-[var(--color-accent)]"
            disabled={!isServiceAvailable}
          />
          {ttsHuggingFaceToken && (
            <p className="text-xs text-[var(--color-success)]">
              <Check className="w-3 h-3 inline mr-1" />
              Token configured (won't be saved)
            </p>
          )}
        </div>
      </div>

      {/* Voice Selection */}
      {ttsEnabled && (
        <>
          {/* Built-in Voices */}
          <div className="rounded-lg p-6 border border-[var(--color-accent)] bg-[var(--color-bg-secondary)]">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-2 text-[var(--color-text-primary)]">
              <Music className="w-5 h-5 text-[var(--color-accent)]" />
              Built-in Voices
            </h3>
            <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
              Select a voice for text-to-speech. All voices run locally.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {BUILTIN_VOICES.map((voice) => (
                <button
                  key={voice.id}
                  onClick={() => handleVoiceSelect(voice.id)}
                  className={`flex flex-col items-start p-3 rounded border transition-all ${
                    ttsVoice === voice.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-accent)]/50'
                  }`}
                >
                  <div className="flex items-center gap-2 w-full justify-between">
                    <span className="font-medium text-sm text-[var(--color-text-primary)]">{voice.label}</span>
                    {ttsVoice === voice.id && <Check className="w-4 h-4 text-[var(--color-accent)]" />}
                  </div>
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">{voice.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Voices */}
          <div className="rounded-lg p-6 border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-2 text-[var(--color-text-primary)]">
              <Upload className="w-5 h-5 text-[var(--color-accent)]" />
              Custom Voices
            </h3>
            <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
              Upload your own voice sample for cloning. Supports WAV, MP3, FLAC, and M4A formats.
            </p>

            {/* Upload Button */}
            <div className="mb-4">
              <label
                htmlFor="voice-upload"
                className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-lg cursor-pointer transition-all ${
                  isUploading
                    ? 'border-[var(--color-border)] bg-[var(--color-bg-primary)] cursor-not-allowed'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-light)]'
                }`}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 text-[var(--color-text-tertiary)] animate-spin" />
                    <span className="text-sm text-[var(--color-text-tertiary)]">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-[var(--color-text-tertiary)]" />
                    <span className="text-sm text-[var(--color-text-tertiary)]">Click to upload voice file</span>
                  </>
                )}
              </label>
              <input
                id="voice-upload"
                type="file"
                accept=".wav,.mp3,.flac,.m4a"
                onChange={handleFileUpload}
                disabled={isUploading || !isServiceAvailable}
                className="hidden"
              />
            </div>

            {/* Upload Error */}
            {uploadError && (
              <div className="mb-4 p-3 bg-[var(--color-error-light)] rounded-lg border border-[var(--color-error-border)]">
                <p className="text-sm text-[var(--color-error)]">{uploadError}</p>
              </div>
            )}

            {/* Custom Voices List */}
            {customVoices.length > 0 && (
              <div className="space-y-2">
                {isLoadingVoices ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-[var(--color-text-tertiary)] animate-spin" />
                  </div>
                ) : (
                  customVoices.map((voice) => {
                    const isSelected = isCustomSelected && ttsCustomVoiceId === voice.id;
                    const isDeletingThis = isDeleting === voice.id;

                    return (
                      <div
                        key={voice.id}
                        className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                          isSelected
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                            : 'border-[var(--color-border)] bg-[var(--color-bg-primary)]'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1">
                          {isSelected ? (
                            <Check className="w-4 h-4 text-[var(--color-accent)] flex-shrink-0" />
                          ) : (
                            <Music className="w-4 h-4 text-[var(--color-text-tertiary)] flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate text-[var(--color-text-primary)]">{voice.name}</p>
                            {voice.description && (
                              <p className="text-xs text-[var(--color-text-tertiary)] truncate">{voice.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isSelected && (
                            <button
                              onClick={() => handleCustomVoiceSelect(voice.id)}
                              className="px-3 py-1 text-xs rounded border border-[var(--color-border)] hover:bg-[var(--color-accent-light)] hover:border-[var(--color-accent)] transition-colors"
                              disabled={isDeletingThis}
                            >
                              Select
                            </button>
                          )}
                          {isSelected && (
                            <button
                              onClick={() => handleTestVoice(undefined, voice.id)}
                              className="px-3 py-1 text-xs rounded border border-[var(--color-accent)] hover:bg-[var(--color-accent-light)] hover:text-[var(--color-accent)] transition-colors flex items-center gap-1"
                              disabled={isDeletingThis}
                            >
                              <Volume2 className="w-3 h-3" />
                              Test
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteVoice(voice.id)}
                            disabled={isDeletingThis}
                            className="p-1.5 rounded hover:bg-[var(--color-error-light)] hover:text-[var(--color-error)] transition-colors"
                            title="Delete voice"
                          >
                            {isDeletingThis ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Empty State */}
            {customVoices.length === 0 && !isLoadingVoices && (
              <div className="flex items-center justify-center py-8 text-[var(--color-text-tertiary)]">
                <p className="text-sm">No custom voices uploaded yet</p>
              </div>
            )}
          </div>

          {/* Test Selected Voice */}
          {(ttsVoice !== 'custom' || isCustomSelected) && (
            <div className="rounded-lg p-4 border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Music className="w-5 h-5 text-[var(--color-accent)]" />
                  <div>
                    <h4 className="font-medium text-sm text-[var(--color-text-primary)]">Test Current Voice</h4>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {ttsVoice === 'custom' && selectedCustomVoice
                        ? `Using: ${selectedCustomVoice.name}`
                        : `Using: ${BUILTIN_VOICES.find(v => v.id === ttsVoice)?.label || 'Unknown'}`
                      }
                    </p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    ttsVoice === 'custom'
                      ? handleTestVoice(undefined, ttsCustomVoiceId || undefined)
                      : handleTestVoice(ttsVoice)
                  }
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] transition-colors"
                >
                  <Volume2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Test</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Info Box */}
      <div className="flex items-start gap-2 p-3 bg-[var(--color-bg-primary)] rounded-lg border border-[var(--color-border)]">
        <Info className="w-4 h-4 text-[var(--color-accent)] mt-0.5 flex-shrink-0" />
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Text-to-speech uses the Pocket TTS service. Built-in voices are lightweight and run locally. Custom voices
          are generated from uploaded audio samples and require more processing time.
        </p>
      </div>
    </div>
  );
};