const { execFile, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');
const logger = require('../utils/logger');

class FFmpegService {
  constructor() {
    this.binaryPath = null;
    this.version = null;
    this.detected = false;
  }

  async detect() {
    if (config.ffmpegPath && fs.existsSync(config.ffmpegPath)) {
      this.binaryPath = config.ffmpegPath;
      this.detected = true;
      logger.info(`FFmpeg: using custom path ${this.binaryPath}`);
      await this.getVersion();
      return this.binaryPath;
    }

    const inPath = await this.findInPath();
    if (inPath) {
      this.binaryPath = inPath;
      this.detected = true;
      logger.info(`FFmpeg: found in PATH at ${this.binaryPath}`);
      await this.getVersion();
      return this.binaryPath;
    }

    const candidates = this.commonPaths();
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        this.binaryPath = p;
        this.detected = true;
        logger.info(`FFmpeg: found at ${this.binaryPath}`);
        await this.getVersion();
        return this.binaryPath;
      }
    }

    this.detected = false;
    this.binaryPath = null;
    logger.warn('FFmpeg: NOT FOUND. Audio extraction and format merging will fail.');
    logger.warn('Install ffmpeg:');
    if (process.platform === 'win32') {
      logger.warn('  - winget install Gyan.FFmpeg');
      logger.warn('  - choco install ffmpeg');
      logger.warn('  - or download from https://www.gyan.dev/ffmpeg/builds/');
    } else if (process.platform === 'darwin') {
      logger.warn('  - macOS: brew install ffmpeg');
    } else {
      logger.warn('  - Ubuntu/Debian: sudo apt install ffmpeg');
    }
    return null;
  }

  findInPath() {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      execFile(cmd, ['ffmpeg'], (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const lines = stdout.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (fs.existsSync(line)) return resolve(line);
        }
        resolve(null);
      });
    });
  }

  commonPaths() {
    const p = process.platform;
    const home = os.homedir();

    if (p === 'win32') {
      return [
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
        path.join(home, 'ffmpeg', 'bin', 'ffmpeg.exe'),
        path.join(home, 'scoop', 'shims', 'ffmpeg.exe'),
        'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe',
      ];
    }
    if (p === 'darwin') {
      return [
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        path.join(home, '.brew', 'bin', 'ffmpeg'),
      ];
    }
    return [
      '/usr/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/snap/bin/ffmpeg',
      '/opt/ffmpeg/bin/ffmpeg',
      path.join(home, '.local', 'bin', 'ffmpeg'),
      path.join(home, 'bin', 'ffmpeg'),
    ];
  }

  async getVersion() {
    if (!this.binaryPath) return null;
    try {
      const out = execFileSync(this.binaryPath, ['-version'], { encoding: 'utf8', timeout: 5000 });
      const m = out.match(/ffmpeg version ([^\s]+)/i);
      this.version = m ? m[1] : 'unknown';
      logger.success(`FFmpeg ready: version ${this.version}`);
      return this.version;
    } catch (err) {
      logger.error(`FFmpeg version check failed: ${err.message}`);
      this.detected = false;
      this.binaryPath = null;
      return null;
    }
  }

  isAvailable() {
    return this.detected && this.binaryPath !== null;
  }

  getPath() {
    return this.binaryPath;
  }

  getStatus() {
    return {
      available: this.isAvailable(),
      path: this.binaryPath,
      version: this.version,
    };
  }

  async probeDuration(filePath) {
    if (!this.isAvailable()) return null;
    const ffprobePath = this.binaryPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
    if (!fs.existsSync(ffprobePath)) {
      return this.probeDurationViaFFmpeg(filePath);
    }
    return new Promise((resolve) => {
      execFile(ffprobePath, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ], { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve(null);
        const dur = parseFloat(stdout.trim());
        return resolve(isNaN(dur) ? null : dur);
      });
    });
  }

  async probeDurationViaFFmpeg(filePath) {
    if (!this.isAvailable()) return null;
    return new Promise((resolve) => {
      execFile(this.binaryPath, ['-i', filePath], { timeout: 10000 }, (err, stdout, stderr) => {
        const out = stderr || stdout || '';
        const m = out.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (!m) return resolve(null);
        const [, h, mn, s, ms] = m;
        resolve((+h) * 3600 + (+mn) * 60 + (+s) + (+ms) / 100);
      });
    });
  }

  async convert(input, output, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('FFmpeg is not available. Cannot convert media.');
    }
    if (!fs.existsSync(input)) {
      throw new Error(`Input file does not exist: ${input}`);
    }
    const { codec, audioBitrate = '192k', videoCodec, extraArgs = [] } = options;
    const args = ['-y', '-i', input];
    if (videoCodec) args.push('-c:v', videoCodec);
    if (codec) args.push('-c:a', codec);
    if (audioBitrate) args.push('-b:a', audioBitrate);
    args.push(...extraArgs, output);

    return new Promise((resolve) => {
      const child = spawn(this.binaryPath, args, { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => resolve({ success: false, output: '', error: err.message }));
      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(output)) {
          resolve({ success: true, output, size: fs.statSync(output).size });
        } else {
          const truncated = stderr.length > 500 ? stderr.slice(-500) : stderr;
          resolve({ success: false, output: '', error: truncated });
        }
      });
    });
  }

  async extractAudio(input, output, format = 'mp3', bitrate = '192k') {
    const codecMap = { mp3: 'libmp3lame', m4a: 'aac', opus: 'libopus', wav: 'pcm_s16le', flac: 'flac' };
    return this.convert(input, output, {
      codec: codecMap[format] || 'libmp3lame',
      audioBitrate: bitrate,
      videoCodec: 'none',
      extraArgs: ['-vn'],
    });
  }

  async merge(videoPath, audioPath, outputPath, container = 'mp4') {
    if (!this.isAvailable()) {
      throw new Error('FFmpeg is not available. Cannot merge media.');
    }
    const codecArgs = container === 'mp4'
      ? ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k']
      : ['-c:v', 'copy', '-c:a', 'copy'];
    return new Promise((resolve) => {
      const child = spawn(this.binaryPath, [
        '-y', '-i', videoPath, '-i', audioPath, ...codecArgs, outputPath,
      ], { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => resolve({ success: false, error: err.message }));
      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          resolve({ success: true, output: outputPath, size: fs.statSync(outputPath).size });
        } else {
          const truncated = stderr.length > 500 ? stderr.slice(-500) : stderr;
          resolve({ success: false, error: truncated });
        }
      });
    });
  }

  runWithArgs(args, options = {}) {
    if (!this.isAvailable()) {
      return Promise.resolve({ success: false, error: 'FFmpeg is not available' });
    }
    const { onProgress, timeoutMs = config.download.timeoutMs } = options;
    return new Promise((resolve) => {
      const child = spawn(this.binaryPath, args, { windowsHide: true });
      let stderr = '';
      let durationSec = null;
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        try { child.kill('SIGTERM'); } catch {}
        resolve({ success: false, error: `FFmpeg timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      child.stderr.on('data', (d) => {
        const chunk = d.toString();
        stderr += chunk;
        if (durationSec === null) {
          const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
          if (durMatch) {
            durationSec = (+durMatch[1]) * 3600 + (+durMatch[2]) * 60 + (+durMatch[3]) + (+durMatch[4]) / 100;
          }
        }
        if (onProgress && durationSec) {
          const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
          if (timeMatch) {
            const cur = (+timeMatch[1]) * 3600 + (+timeMatch[2]) * 60 + (+timeMatch[3]) + (+timeMatch[4]) / 100;
            onProgress(Math.min(100, (cur / durationSec) * 100));
          }
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (!killed) resolve({ success: false, error: err.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) return;
        if (code === 0) {
          resolve({ success: true, duration: durationSec });
        } else {
          const truncated = stderr.length > 800 ? stderr.slice(-800) : stderr;
          resolve({ success: false, error: truncated, duration: durationSec });
        }
      });
    });
  }

  async probe(filePath) {
    if (!this.isAvailable()) return null;
    const ffprobePath = this.binaryPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

    if (!fs.existsSync(ffprobePath)) {
      return new Promise((resolve) => {
        execFile(this.binaryPath, ['-i', filePath], { timeout: 10000 }, (err, stdout, stderr) => {
          if (err && !stderr) return resolve(null);
          const out = stderr || stdout || '';
          const info = {};
          const durMatch = out.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
          if (durMatch) info.duration = (+durMatch[1]) * 3600 + (+durMatch[2]) * 60 + (+durMatch[3]) + (+durMatch[4]) / 100;
          const videoMatch = out.match(/Video:\s*([^\s,]+)/);
          if (videoMatch) info.videoCodec = videoMatch[1];
          const audioMatch = out.match(/Audio:\s*([^\s,]+)/);
          if (audioMatch) info.audioCodec = audioMatch[1];
          const resMatch = out.match(/(\d{2,4})x(\d{2,4})/);
          if (resMatch) { info.width = +resMatch[1]; info.height = +resMatch[2]; }
          resolve(info);
        });
      });
    }

    return new Promise((resolve) => {
      execFile(ffprobePath, [
        '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath,
      ], { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve(null);
        try {
          const data = JSON.parse(stdout);
          const videoStream = (data.streams || []).find((s) => s.codec_type === 'video');
          const audioStream = (data.streams || []).find((s) => s.codec_type === 'audio');
          resolve({
            duration: parseFloat(data.format?.duration) || null,
            size: parseInt(data.format?.size) || null,
            bitrate: parseInt(data.format?.bit_rate) || null,
            format: data.format?.format_name,
            width: videoStream?.width,
            height: videoStream?.height,
            fps: videoStream?.r_frame_rate ? eval(videoStream.r_frame_rate) : null,
            videoCodec: videoStream?.codec_name,
            audioCodec: audioStream?.codec_name,
            sampleRate: audioStream?.sample_rate,
            channels: audioStream?.channels,
          });
        } catch {
          resolve(null);
        }
      });
    });
  }
}

module.exports = new FFmpegService();
