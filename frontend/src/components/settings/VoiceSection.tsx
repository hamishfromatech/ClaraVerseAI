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
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Volume2 className="w-6 h-6" />
          Voice Settings
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Configure text-to-speech voice for hearing AI responses
        </p>
      </div>

      {/* Service Status */}
      {!checkingService && !isServiceAvailable && (
        <div
          style={{ backgroundColor: '#1a0a0a' }}
          className="rounded-lg p-4 border border-red-900"
        >
          <div className="flex items-start gap-3">
            <VolumeX className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-red-400 mb-1">TTS Service Unavailable</h3>
              <p className="text-sm text-gray-400">
                The text-to-speech service is not responding. Please check that the tts-service container is running.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Enable TTS Toggle */}
      <div style={{ backgroundColor: '#0d0d0d' }} className="rounded-lg p-6 border border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {ttsEnabled ? (
              <Volume2 className="w-5 h-5 text-green-500" />
            ) : (
              <VolumeX className="w-5 h-5 text-gray-600" />
            )}
            <div>
              <h3 className="font-semibold">Enable Text-to-Speech</h3>
              <p className="text-sm text-gray-500">
                Play AI responses aloud when you click the speaker icon
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleTTS}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              ttsEnabled ? 'bg-green-600' : 'bg-gray-700'
            }`}
            disabled={!isServiceAvailable}
          >
            <div
              className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                ttsEnabled ? 'translate-x-7' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* HuggingFace Token */}
      <div style={{ backgroundColor: '#0d0d0d' }} className="rounded-lg p-4 border border-gray-700">
        <div className="space-y-3">
          <div>
            <h3 className="font-medium text-sm">HuggingFace Token</h3>
            <p className="text-xs text-gray-500 mt-1">
              Required for gated models. Get your token at{' '}
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
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
            className="w-full px-3 py-2 bg-black border border-gray-700 rounded text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
            disabled={!isServiceAvailable}
          />
          {ttsHuggingFaceToken && (
            <p className="text-xs text-green-500">
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
          <div style={{ backgroundColor: '#0d0d0d', borderColor: '#9c27b0' }} className="rounded-lg p-6 border">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-2">
              <Music className="w-5 h-5 text-purple-500" />
              Built-in Voices
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Select a voice for text-to-speech. All voices run locally.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {BUILTIN_VOICES.map((voice) => (
                <button
                  key={voice.id}
                  onClick={() => handleVoiceSelect(voice.id)}
                  className={`flex flex-col items-start p-3 rounded border transition-all ${
                    ttsVoice === voice.id
                      ? 'border-purple-500 bg-purple-500/5'
                      : 'border-gray-800 bg-black hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2 w-full justify-between">
                    <span className="font-medium text-sm">{voice.label}</span>
                    {ttsVoice === voice.id && <Check className="w-4 h-4 text-purple-500" />}
                  </div>
                  <span className="text-[10px] text-gray-500">{voice.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Voices */}
          <div style={{ backgroundColor: '#0d0d0d' }} className="rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-2">
              <Upload className="w-5 h-5 text-blue-500" />
              Custom Voices
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Upload your own voice sample for cloning. Supports WAV, MP3, FLAC, and M4A formats.
            </p>

            {/* Upload Button */}
            <div className="mb-4">
              <label
                htmlFor="voice-upload"
                className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-lg cursor-pointer transition-all ${
                  isUploading
                    ? 'border-gray-700 bg-gray-900 cursor-not-allowed'
                    : 'border-gray-700 hover:border-blue-500 hover:bg-blue-500/5'
                }`}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                    <span className="text-sm text-gray-400">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-gray-400" />
                    <span className="text-sm text-gray-400">Click to upload voice file</span>
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
              <div className="mb-4 p-3 bg-red-900/20 rounded-lg border border-red-900">
                <p className="text-sm text-red-400">{uploadError}</p>
              </div>
            )}

            {/* Custom Voices List */}
            {customVoices.length > 0 && (
              <div className="space-y-2">
                {isLoadingVoices ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
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
                            ? 'border-blue-500 bg-blue-500/5'
                            : 'border-gray-800 bg-black'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1">
                          {isSelected ? (
                            <Check className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          ) : (
                            <Music className="w-4 h-4 text-gray-600 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{voice.name}</p>
                            {voice.description && (
                              <p className="text-xs text-gray-500 truncate">{voice.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isSelected && (
                            <button
                              onClick={() => handleCustomVoiceSelect(voice.id)}
                              className="px-3 py-1 text-xs rounded border border-gray-700 hover:bg-gray-800 transition-colors"
                              disabled={isDeletingThis}
                            >
                              Select
                            </button>
                          )}
                          {isSelected && (
                            <button
                              onClick={() => handleTestVoice(undefined, voice.id)}
                              className="px-3 py-1 text-xs rounded border border-purple-700 hover:bg-purple-500/10 transition-colors flex items-center gap-1"
                              disabled={isDeletingThis}
                            >
                              <Volume2 className="w-3 h-3" />
                              Test
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteVoice(voice.id)}
                            disabled={isDeletingThis}
                            className="p-1.5 rounded hover:bg-red-900/20 hover:text-red-400 transition-colors"
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
              <div className="flex items-center justify-center py-8 text-gray-500">
                <p className="text-sm">No custom voices uploaded yet</p>
              </div>
            )}
          </div>

          {/* Test Selected Voice */}
          {(ttsVoice !== 'custom' || isCustomSelected) && (
            <div style={{ backgroundColor: '#0d0d0d' }} className="rounded-lg p-4 border border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Music className="w-5 h-5 text-gray-400" />
                  <div>
                    <h4 className="font-medium text-sm">Test Current Voice</h4>
                    <p className="text-xs text-gray-500">
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
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition-colors"
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
      <div className="flex items-start gap-2 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
        <Info className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-gray-400">
          Text-to-speech uses the Pocket TTS service. Built-in voices are lightweight and run locally. Custom voices
          are generated from uploaded audio samples and require more processing time.
        </p>
      </div>
    </div>
  );
};