const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const router = express.Router();
const ytdlp = require('../services/ytdlpService');
const potoken = require('../services/potokenService');
const ffmpeg = require('../services/ffmpegService');
const presets = require('../services/ffmpegPresets');
const config = require('../config');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

function validateUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (['169.254.169.254','metadata.google.internal','localhost','127.0.0.1'].includes(host) || host.startsWith('::1')) {
      return false;
    }
    return true;
  } catch { return false; }
}

// ============ Basic info endpoints ============

router.get('/info', async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
    const info = await ytdlp.getInfo(url);
    res.json({ success: true, data: info });
  } catch (err) { next(err); }
});

router.get('/embed', async (req, res, next) => {
  try {
    const { url, maxwidth = 640, maxheight = 360 } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
    const maxW = Math.min(parseInt(maxwidth, 10) || 640, 1920);
    const maxH = Math.min(parseInt(maxheight, 10) || 360, 1080);
    const info = await ytdlp.getInfo(url);
    res.json({ ...info.embed, width: maxW, height: maxH });
  } catch (err) { next(err); }
});

router.get('/formats', async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
    const output = await ytdlp.getFormats(url);
    res.json({ success: true, data: output });
  } catch (err) { next(err); }
});

router.get('/search', async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q) return res.status(400).json({ success: false, error: 'Missing q parameter' });
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    const results = await ytdlp.search(q, limitNum);
    res.json({ success: true, count: results.length, data: results });
  } catch (err) { next(err); }
});

router.get('/playlist', async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
    const data = await ytdlp.getPlaylist(url);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/thumbnail', async (req, res, next) => {
  try {
    const { url, quality = 'maxres' } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
    const info = await ytdlp.getInfo(url);
    let thumb = info.thumbnail;
    if (info.thumbnails && info.thumbnails.length > 0) {
      const qualityMap = { maxres: 0, high: 1, medium: 2, default: 3 };
      const idx = qualityMap[quality] ?? 0;
      const sorted = [...info.thumbnails].filter((t) => t && t.width).sort((a, b) => (b.width || 0) - (a.width || 0));
      thumb = sorted[Math.min(idx, sorted.length - 1)]?.url || info.thumbnail;
    }
    res.json({ success: true, thumbnail: thumb, all: info.thumbnails });
  } catch (err) { next(err); }
});

router.get('/subtitles', async (req, res, next) => {
  try {
    const { url, lang = 'en' } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
    const subs = await ytdlp.getSubtitles(url, lang);
    res.json({ success: true, subtitles: subs });
  } catch (err) { next(err); }
});

// ============ Download endpoints ============

router.get('/download', async (req, res, next) => {
  try {
    const { url, type = 'video', format, audioFormat = 'mp3' } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });

    if (type === 'audio' && !ffmpeg.isAvailable()) {
      return res.status(503).json({ success: false, error: 'Audio extraction requires ffmpeg', hint: 'Install ffmpeg' });
    }

    let ext;
    if (type === 'audio') ext = audioFormat;
    else if (format && format !== 'best') ext = (format.match(/ext=([a-z0-9]+)/i)?.[1]) || 'mp4';
    else ext = 'mp4';

    const filename = `download-${uuidv4()}.${ext}`;
    const mimeMap = { mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska', mp3:'audio/mpeg', m4a:'audio/mp4', opus:'audio/opus', wav:'audio/wav', flac:'audio/flac' };
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeMap[ext] || (type === 'audio' ? 'audio/mpeg' : 'video/mp4'));
    await ytdlp.streamDownload(url, res, { type, format, audioFormat });
  } catch (err) { next(err); }
});

router.get('/download/save', async (req, res, next) => {
  try {
    const { url, type = 'video', format, audioFormat = 'mp3' } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
    if (type === 'audio' && !ffmpeg.isAvailable()) {
      return res.status(503).json({ success: false, error: 'Audio extraction requires ffmpeg' });
    }
    const result = await ytdlp.downloadToDisk(url, { type, format, audioFormat });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ============ Custom quality/resolution (FFmpeg) ============

// GET /api/presets - list all presets
router.get('/presets', (req, res) => {
  res.json({ success: true, data: presets.listPresets() });
});

// GET /api/download/quality?url=...&quality=48k
router.get('/download/quality', async (req, res, next) => {
  try {
    if (!ffmpeg.isAvailable()) {
      return res.status(503).json({ success: false, error: 'FFmpeg is not available' });
    }
    const { url, quality = '192k' } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
    if (!presets.AUDIO_PRESETS[quality]) {
      return res.status(400).json({
        success: false, error: `Unknown quality preset: ${quality}`,
        available: Object.keys(presets.AUDIO_PRESETS),
      });
    }

    const preset = presets.AUDIO_PRESETS[quality];
    const tempId = uuidv4();
    const tempInput = path.join(config.downloadDir, `${tempId}-src.%(ext)s`);
    const tempOutput = path.join(config.downloadDir, `${tempId}-${quality}.${preset.suffix}`);

    logger.info(`[quality] Downloading source for ${quality} audio conversion...`);
    const dl = await new Promise((resolve, reject) => {
      const args = [
        ...ytdlp.buildBaseArgs(), '-f', 'bestaudio/best',
        '-o', tempInput, '--no-warnings', '--no-playlist', url,
      ];
      const child = spawn(config.ytdlpPath, args, { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) => {
        if (code === 0) {
          const files = fs.readdirSync(config.downloadDir).filter((f) => f.startsWith(`${tempId}-src`));
          if (files.length) resolve(path.join(config.downloadDir, files[0]));
          else reject(new Error('Downloaded audio file not found'));
        } else {
          reject(new Error(stderr.slice(-300) || `yt-dlp exited ${code}`));
        }
      });
      child.on('error', reject);
    });

    logger.info(`[quality] Converting to ${quality} (${preset.suffix}, ${preset.bitrate})...`);
    const ffmpegArgs = presets.buildAudioArgs(quality, dl, tempOutput);
    const result = await ffmpeg.runWithArgs(ffmpegArgs);

    try { fs.unlinkSync(dl); } catch {}

    if (!result.success) {
      try { fs.unlinkSync(tempOutput); } catch {}
      return res.status(500).json({ success: false, error: 'Conversion failed', details: result.error });
    }

    const stats = fs.statSync(tempOutput);
    const mimeMap = { mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/opus', wav: 'audio/wav', flac: 'audio/flac' };
    res.setHeader('Content-Disposition', `attachment; filename="audio-${quality}-${uuidv4()}.${preset.suffix}"`);
    res.setHeader('Content-Type', mimeMap[preset.suffix] || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);

    const stream = fs.createReadStream(tempOutput);
    stream.pipe(res);
    stream.on('close', () => { try { fs.unlinkSync(tempOutput); } catch {} });
    stream.on('error', (err) => {
      logger.error('Stream error:', err.message);
      try { fs.unlinkSync(tempOutput); } catch {}
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    });
  } catch (err) { next(err); }
});

// GET /api/download/resolution?url=...&resolution=480p
router.get('/download/resolution', async (req, res, next) => {
  try {
    if (!ffmpeg.isAvailable()) {
      return res.status(503).json({ success: false, error: 'FFmpeg is not available' });
    }
    const { url, resolution = '480p', audioBitrate = '128k' } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
    if (!validateUrl(url)) return res.status(400).json({ success: false, error: 'Invalid URL' });
    if (!presets.VIDEO_PRESETS[resolution]) {
      return res.status(400).json({
        success: false, error: `Unknown resolution preset: ${resolution}`,
        available: Object.keys(presets.VIDEO_PRESETS),
      });
    }

    const preset = presets.VIDEO_PRESETS[resolution];
    const tempId = uuidv4();
    const tempInput = path.join(config.downloadDir, `${tempId}-src.%(ext)s`);
    const tempOutput = path.join(config.downloadDir, `${tempId}-${resolution}.${preset.suffix}`);

    logger.info(`[resolution] Downloading source for ${resolution}...`);
    const dl = await new Promise((resolve, reject) => {
      const args = [
        ...ytdlp.buildBaseArgs(), '-f', 'bestvideo+bestaudio/best',
        '--merge-output-format', 'mp4', '-o', tempInput,
        '--no-warnings', '--no-playlist', url,
      ];
      const child = spawn(config.ytdlpPath, args, { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) => {
        if (code === 0) {
          const files = fs.readdirSync(config.downloadDir).filter((f) => f.startsWith(`${tempId}-src`));
          const merged = files.find((f) => f.endsWith('.mp4')) || files[0];
          if (merged) {
            resolve(path.join(config.downloadDir, merged));
            for (const f of files) {
              if (f !== merged) try { fs.unlinkSync(path.join(config.downloadDir, f)); } catch {}
            }
          } else reject(new Error('Downloaded file not found'));
        } else {
          reject(new Error(stderr.slice(-300) || `yt-dlp exited ${code}`));
        }
      });
      child.on('error', reject);
    });

    logger.info(`[resolution] Transcoding to ${resolution} (${preset.width}x${preset.height})...`);
    const ffmpegArgs = presets.buildVideoArgs(resolution, dl, tempOutput, { audioBitrate });
    const result = await ffmpeg.runWithArgs(ffmpegArgs);

    try { fs.unlinkSync(dl); } catch {}

    if (!result.success) {
      try { fs.unlinkSync(tempOutput); } catch {}
      return res.status(500).json({ success: false, error: 'Transcode failed', details: result.error });
    }

    const stats = fs.statSync(tempOutput);
    const mimeMap = { mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', gif: 'image/gif' };
    res.setHeader('Content-Disposition', `attachment; filename="video-${resolution}-${uuidv4()}.${preset.suffix}"`);
    res.setHeader('Content-Type', mimeMap[preset.suffix] || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);

    const stream = fs.createReadStream(tempOutput);
    stream.pipe(res);
    stream.on('close', () => { try { fs.unlinkSync(tempOutput); } catch {} });
    stream.on('error', (err) => {
      logger.error('Stream error:', err.message);
      try { fs.unlinkSync(tempOutput); } catch {}
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    });
  } catch (err) { next(err); }
});

// POST /api/transcode
router.post('/transcode', async (req, res, next) => {
  try {
    if (!ffmpeg.isAvailable()) {
      return res.status(503).json({ success: false, error: 'FFmpeg is not available' });
    }
    const params = { ...req.query, ...req.body };
    const { filename } = params;
    if (!filename) return res.status(400).json({ success: false, error: 'Missing filename' });
    const safeName = path.basename(filename);
    if (safeName !== filename) return res.status(400).json({ success: false, error: 'Invalid filename' });
    const inputPath = path.join(config.downloadDir, safeName);
    if (!fs.existsSync(inputPath)) return res.status(404).json({ success: false, error: 'File not found' });

    const format = params.format || 'mp4';
    const outputFilename = `${path.parse(safeName).name}-transcoded-${Date.now()}.${format}`;
    const outputPath = path.join(config.downloadDir, outputFilename);

    const ffmpegArgs = presets.buildCustomArgs({
      format,
      videoCodec: params.videoCodec,
      videoBitrate: params.videoBitrate,
      crf: params.crf !== undefined ? parseFloat(params.crf) : undefined,
      width: params.width ? parseInt(params.width, 10) : undefined,
      height: params.height ? parseInt(params.height, 10) : undefined,
      fps: params.fps ? parseInt(params.fps, 10) : undefined,
      audioCodec: params.audioCodec,
      audioBitrate: params.audioBitrate,
      audioSampleRate: params.audioSampleRate ? parseInt(params.audioSampleRate, 10) : undefined,
      audioChannels: params.audioChannels ? parseInt(params.audioChannels, 10) : undefined,
      startTime: params.startTime,
      endTime: params.endTime,
      extraArgs: params.extraArgs ? (Array.isArray(params.extraArgs) ? params.extraArgs : [params.extraArgs]) : [],
    }, inputPath, outputPath);

    const result = await ffmpeg.runWithArgs(ffmpegArgs);

    if (!result.success) {
      try { fs.unlinkSync(outputPath); } catch {}
      return res.status(500).json({ success: false, error: 'Transcode failed', details: result.error });
    }

    const stats = fs.statSync(outputPath);
    res.json({
      success: true,
      data: { filename: outputFilename, url: `/downloads/${outputFilename}`, size: stats.size, format },
    });
  } catch (err) { next(err); }
});

router.post('/convert', async (req, res, next) => {
  try {
    if (!ffmpeg.isAvailable()) {
      return res.status(503).json({ success: false, error: 'FFmpeg is not available' });
    }
    const { filename, format = 'mp3', bitrate = '192k' } = req.query;
    if (!filename) return res.status(400).json({ success: false, error: 'Missing filename parameter' });
    const safeName = path.basename(filename);
    if (safeName !== filename) return res.status(400).json({ success: false, error: 'Invalid filename' });
    const result = await ytdlp.convertFile(safeName, { outputFormat: format, audioBitrate: bitrate });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/probe', async (req, res, next) => {
  try {
    if (!ffmpeg.isAvailable()) {
      return res.status(503).json({ success: false, error: 'FFmpeg is not available' });
    }
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ success: false, error: 'Missing filename' });
    const safeName = path.basename(filename);
    if (safeName !== filename) return res.status(400).json({ success: false, error: 'Invalid filename' });
    const filePath = path.join(config.downloadDir, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found' });
    const info = await ffmpeg.probe(filePath);
    res.json({ success: true, data: info });
  } catch (err) { next(err); }
});

router.get('/status', (req, res) => {
  res.json({ success: true, data: { ...potoken.getStatus(), ffmpeg: ffmpeg.getStatus() } });
});

module.exports = router;
