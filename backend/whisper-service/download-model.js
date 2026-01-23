import shelljs from 'shelljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  try {
    const model = process.argv[2] || 'base.en';
    console.log(`📥 Downloading ${model} model...`);

    // The download script is located in node_modules/whisper-node/lib/whisper.cpp/models/download-ggml-model.sh
    const scriptPath = path.join(__dirname, 'node_modules/whisper-node/lib/whisper.cpp/models/download-ggml-model.sh');
    const modelsDir = path.dirname(scriptPath);

    console.log(`Checking for download script at: ${scriptPath}`);

    if (!shelljs.test('-f', scriptPath)) {
        throw new Error(`Download script not found at ${scriptPath}`);
    }

    shelljs.chmod('+x', scriptPath);
    shelljs.cd(modelsDir);

    console.log(`Running: ./download-ggml-model.sh ${model}`);
    const result = shelljs.exec(`./download-ggml-model.sh ${model}`);

    if (result.code !== 0) {
        throw new Error(`Download failed with exit code ${result.code}`);
    }

    console.log('✅ Model downloaded successfully');

    // Also run make to ensure whisper.cpp is compiled with the model support if needed
    const whisperDir = path.join(modelsDir, '..');
    shelljs.cd(whisperDir);
    console.log('Compiling whisper.cpp...');
    shelljs.exec('make');

  } catch (error) {
    console.error('❌ Failed to download model:', error);
    process.exit(1);
  }
}

main();
