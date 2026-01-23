import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import whisper from 'whisper-node';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3005;

// Helper to check if a model exists
const checkModelExists = (modelName) => {
  const modelPath = path.join(__dirname, `node_modules/whisper-node/lib/whisper.cpp/models/ggml-${modelName}.bin`);
  return fs.existsSync(modelPath);
};

// Helper to download a model
const downloadModel = (modelName) => {
  console.log(`📥 [WHISPER] Automatically downloading missing model: ${modelName}`);
  try {
    const scriptPath = path.join(__dirname, 'node_modules/whisper-node/lib/whisper.cpp/models/download-ggml-model.sh');
    const modelsDir = path.dirname(scriptPath);

    // Use shelljs-like logic but with sync child_process for simplicity in this endpoint
    execSync(`chmod +x "${scriptPath}"`);
    execSync(`cd "${modelsDir}" && ./download-ggml-model.sh ${modelName}`);
    console.log(`✅ [WHISPER] Model ${modelName} downloaded successfully`);
    return true;
  } catch (error) {
    console.error(`❌ [WHISPER] Failed to download model ${modelName}:`, error.message);
    return false;
  }
};

// Configure multer for audio uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'whisper-stt' });
});

// Transcription endpoint
app.post('/transcribe', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  const inputPath = req.file.path;
  const wavPath = inputPath + '.wav';
  const language = req.body.language || 'en';
  let modelName = req.body.model || process.env.WHISPER_MODEL || "small.en";

  // whisper-node expects names like 'base.en', 'tiny', 'small'
  // If the frontend sends just 'small', 'tiny', etc., we keep it.
  // We should normalize 'large-v3' to 'large' if needed, though whisper.cpp download script supports specific ones.

  console.log(`🎵 [WHISPER] Transcribing: ${req.file.originalname} (${req.file.size} bytes) using model: ${modelName}`);

  try {
    // 0. Ensure model exists
    if (!checkModelExists(modelName)) {
        const success = downloadModel(modelName);
        if (!success) {
            throw new Error(`Model ${modelName} not found and auto-download failed`);
        }
    }

    // 1. Convert to 16kHz mono WAV (required by whisper.cpp)
    try {
      console.log(`🔄 [WHISPER] Converting to 16kHz mono WAV (with enhanced normalization)...`);
      // Enhanced FFmpeg parameters for better transcription accuracy:
      // -ar 16000: Set sample rate to 16kHz (required by whisper.cpp)
      // -ac 1: Convert to mono (required by whisper.cpp)
      // -af highpass=f=200,lowpass=f=3000,loudnorm: Filter noise and normalize volume
      execSync(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le -af "highpass=f=200,lowpass=f=3000,loudnorm" "${wavPath}" -y`);

      const stats = fs.statSync(wavPath);
      console.log(`📊 [WHISPER] Converted WAV size: ${stats.size} bytes`);
      if (stats.size < 100) {
          throw new Error("FFmpeg produced an empty or invalid WAV file");
      }
    } catch (ffmpegErr) {
      console.error('❌ [WHISPER] FFmpeg conversion failed:', ffmpegErr.stderr?.toString() || ffmpegErr.message);
      throw new Error('Failed to process audio format');
    }

    const options = {
      modelName: modelName,
      whisperOptions: {
        language: language,
        gen_file_txt: false,
        gen_file_subtitle: false,
        gen_file_vtt: false,
        word_timestamps: false
      }
    };

    // Since whisper-node can be flaky with ESM and pathing,
    // we use the direct binary call which is more reliable in Docker.
    const whisperCppPath = path.join(__dirname, 'node_modules/whisper-node/lib/whisper.cpp/main');
    const modelPath = path.join(__dirname, `node_modules/whisper-node/lib/whisper.cpp/models/ggml-${modelName}.bin`);

    console.log(`🚀 [WHISPER] Running whisper.cpp: ${modelName} (${language})`);

    // We use -nt (no timestamps) to get cleaner output if needed, but the current parser expects timestamps.
    // Adding 2>&1 to capture stderr which contains the whisper.cpp initialization logs.
    const command = `"${whisperCppPath}" -m "${modelPath}" -f "${wavPath}" -l ${language}`;
    let output = "";
    try {
        output = execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    } catch (err) {
        console.error("❌ [WHISPER] Binary execution failed:", err.stderr?.toString());
        output = err.stdout?.toString() || "";
        if (!output) throw err;
    }

    console.log(`DEBUG: Raw whisper.cpp output length: ${output.length}`);
    if (output.length < 500) {
        console.log(`DEBUG: Raw output content: "${output}"`);
    }

    // Parse the output: whisper.cpp outputs segments in format [00:00:00.000 --> 00:00:02.000]  text
    const lines = output.match(/\[[0-9:.]+\s-->\s[0-9:.]+\].*/g) || [];
    const transcript = lines.map(line => {
        const parts = line.split(']  ');
        return { speech: parts.length > 1 ? parts[1].trim() : "" };
    });

    console.log(`DEBUG: Parsed segments: ${transcript.length}`);

    // Clean up files
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);

    if (!transcript) {
        return res.json({ text: "", language: language });
    }

    // Combine transcript array into a single string if it's an array
    let text = "";
    if (Array.isArray(transcript)) {
      text = transcript
        .map(t => t.speech)
        .filter(s => s && !s.includes('[BLANK_AUDIO]') && !s.includes('(beeping)'))
        .join(" ")
        .trim();
    } else {
      text = String(transcript);
    }

    console.log(`✅ [WHISPER] Success: ${text.length} characters`);

    res.json({
      text: text,
      language: language
    });
  } catch (error) {
    console.error('❌ [WHISPER] Error:', error);

    // Clean up on error
    if (inputPath && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }
    if (wavPath && fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }

    res.status(500).json({
      error: 'Transcription failed',
      details: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`🚀 Whisper STT service listening at http://localhost:${port}`);
});
