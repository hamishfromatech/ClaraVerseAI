/**
 * TTS Service
 * Handles text-to-speech functionality using the Pocket TTS backend service
 * Routes through the backend API to avoid CORS/mixed content issues on production
 */

const TTS_SERVICE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3003';

export interface Voice {
  id: string;
  name: string;
  description?: string;
  is_custom?: boolean;
}

export interface VoicesResponse {
  built_in: Voice[];
  custom: Voice[];
}

class TTSService {
  private currentAudio: HTMLAudioElement | null = null;
  private isPlaying: boolean = false;
  private selectedVoice: string | null = null;
  private selectedCustomVoice: string | null = null;
  private onPlayStartCallback: (() => void) | null = null;
  private onPlayEndCallback: (() => void) | null = null;

  /**
   * Convert text to speech and play it
   * @param text - The text to convert to speech
   * @param voice - Built-in voice name (alba, marius, etc.)
   * @param customVoiceId - ID of custom uploaded voice
   * @param hfToken - Optional HuggingFace token for gated models
   * @param onPlayStart - Callback when audio starts playing
   * @param onPlayEnd - Callback when audio ends or errors
   * @returns Promise that resolves when audio starts playing
   */
  async speak(
    text: string,
    voice?: string,
    customVoiceId?: string,
    hfToken?: string,
    onPlayStart?: () => void,
    onPlayEnd?: () => void
  ): Promise<void> {
    // Stop any currently playing audio
    this.stop();

    try {
      const response = await fetch(`${TTS_SERVICE_URL}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice: voice || this.selectedVoice,
          custom_voice_id: customVoiceId || this.selectedCustomVoice,
          hf_token: hfToken,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `TTS service error: ${response.statusText}`);
      }

      const audioBlob = await response.blob();

      // Validate the blob
      if (!audioBlob || audioBlob.size === 0) {
        throw new Error('TTS service returned empty audio data');
      }

      if (audioBlob.size < 44) {
        throw new Error('Audio data too small (WAV header requires at least 44 bytes)');
      }

      console.log('TTS: Received audio blob', {
        size: audioBlob.size,
        type: audioBlob.type,
        contentType: response.headers.get('Content-Type'),
      });

      const audioUrl = URL.createObjectURL(audioBlob);
      console.log('TTS: Created audio URL', audioUrl);

      this.currentAudio = new Audio(audioUrl);
      this.isPlaying = true;

      // Store audio element reference for error handler
      const audioElement = this.currentAudio;

      // Call callback when audio actually starts playing
      this.currentAudio.addEventListener('play', () => {
        console.log('TTS: Audio started playing');
        if (onPlayStart) {
          onPlayStart();
        }
      });

      // Clean up blob URL when audio ends
      this.currentAudio.addEventListener('ended', () => {
        console.log('TTS: Audio ended');
        if (onPlayEnd) {
          onPlayEnd();
        }
        this.cleanup();
      });

      // Handle errors - capture details from event target
      this.currentAudio.addEventListener('error', (e) => {
        const error = (e.target as HTMLAudioElement).error;
        console.error('Audio playback error details:', {
          code: error?.code,
          message: error?.message,
          src: audioElement.src,
          networkState: audioElement.networkState,
          readyState: audioElement.readyState,
          currentSrc: audioElement.currentSrc,
          blobUrl: audioUrl,
        });

        if (onPlayEnd) {
          onPlayEnd();
        }
        this.cleanup();
        throw new Error(`Audio playback error: ${error?.message || 'Unknown error'}`);
      });

      console.log('TTS: Calling audio.play()');
      await this.currentAudio.play();
    } catch (error) {
      console.error('TTS: Error during speak()', error);
      if (onPlayEnd) {
        onPlayEnd();
      }
      this.cleanup();
      throw error;
    }
  }

  /**
   * Stop currently playing audio
   */
  stop(): void {
    console.log('TTS: stop() called');
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
    }
    this.cleanup();
  }

  /**
   * Check if audio is currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying && this.currentAudio !== null && !this.currentAudio.paused;
  }

  /**
   * Set the selected built-in voice
   */
  setVoice(voice: string): void {
    this.selectedVoice = voice;
    this.selectedCustomVoice = null; // Clear custom voice when built-in is set
  }

  /**
   * Set the selected custom voice
   */
  setCustomVoice(customVoiceId: string): void {
    this.selectedCustomVoice = customVoiceId;
    this.selectedVoice = null; // Clear built-in voice when custom is set
  }

  /**
   * Get the current selected voice
   */
  getSelectedVoice(): { voice: string | null; customVoiceId: string | null } {
    return {
      voice: this.selectedVoice,
      customVoiceId: this.selectedCustomVoice,
    };
  }

  /**
   * Clean up audio resources
   */
  private cleanup(): void {
    if (this.currentAudio) {
      const url = this.currentAudio.src;
      this.currentAudio.src = '';
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
      this.currentAudio = null;
    }
    this.isPlaying = false;
  }

  /**
   * Get list of available voices
   */
  async getVoices(): Promise<VoicesResponse> {
    try {
      const response = await fetch(`${TTS_SERVICE_URL}/api/tts/voices`);
      if (!response.ok) {
        throw new Error(`Failed to fetch voices: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch voices:', error);
      return { built_in: [], custom: [] };
    }
  }

  /**
   * Upload a custom voice file
   * @param file - Audio file to upload (WAV, MP3, FLAC, M4A)
   * @returns Promise that resolves to the uploaded voice info
   */
  async uploadCustomVoice(file: File): Promise<Voice> {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${TTS_SERVICE_URL}/api/tts/voices/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `Failed to upload voice: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to upload custom voice:', error);
      throw error;
    }
  }

  /**
   * Delete a custom voice
   * @param voiceId - ID of the custom voice to delete
   */
  async deleteCustomVoice(voiceId: string): Promise<void> {
    try {
      const response = await fetch(`${TTS_SERVICE_URL}/api/tts/voices/${voiceId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `Failed to delete voice: ${response.statusText}`);
      }

      // Clear the selected custom voice if it was deleted
      if (this.selectedCustomVoice === voiceId) {
        this.selectedCustomVoice = null;
      }
    } catch (error) {
      console.error('Failed to delete custom voice:', error);
      throw error;
    }
  }

  /**
   * Check if the TTS service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${TTS_SERVICE_URL}/api/tts/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const ttsService = new TTSService();