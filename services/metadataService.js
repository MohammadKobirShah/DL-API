/**
 * Metadata + thumbnail embedding service.
 *
 * Adds title / artist / uploader / description / tags / cover art / etc. to
 * downloaded files using ffmpeg's -metadata flags. The whole process is
 * lossless: ffmpeg remuxes the container with `-c copy`, never re-encoding
 * the audio or video streams.
 *
 * On by default for every download endpoint (audio + video). Disable with
 * `?embed=false` on any download endpoint.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const DEV_CREDIT      = process.env.DEVELOPER_CREDIT      || 'Mohammad Kobir Shah';
const DEV_CREDIT_URL  = process.env.DEVELOPER_CREDIT_URL  || 'https://github.com/MohammadKobirShah';
const API_NAME        = process.env.API_NAME              || 'YT-DLP API Server';
const API_VERSION     = process.env.API_VERSION           || '2.2.0';
const EMBED_ENABLED   = (process.env.EMBED_METADATA ?? 'true').toLowerCase() !== 'false';

function sanitize(s, maxLen = 2000) {
  if (s === null || s === undefined) return null;
  s = String(s).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.substring(0, maxLen).trim();
  return s || null;
}

function buildFfmpegMetadataArgs(info = {}) {
  const args = [];
  const set = (k, v) => { const c = sanitize(v, k === 'description' || k === 'lyrics' ? 2000 : 500); if (c) args.push('-metadata', `${k}=${c}`); };

  set('title',       info.title);
  set('artist',      info.uploader || info.channel);
  set('album',       info.uploader || info.channel);
  set('album_artist', info.uploader || info.channel);
  set('composer',    info.uploader || info.channel);
  set('performer',   info.uploader || info.channel);

  let year = null;
  let date = null;
  if (info.upload_date && /^\d{8}$/.test(info.upload_date)) {
    date = `${info.upload_date.slice(0,4)}-${info.upload_date.slice(4,6)}-${info.upload_date.slice(6,8)}`;
    year = info.upload_date.slice(0, 4);
  } else if (info.release_date) {
    date = info.release_date;
    year = info.release_date.slice(0, 4);
  } else if (info.timestamp) {
    year = String(new Date(info.timestamp * 1000).getFullYear());
  }
  if (date) set('date', date);
  if (year) set('year', year);

  if (info.description) {
    const desc = sanitize(info.description, 2000);
    set('description', desc);
    set('comment',     desc);
    set('synopsis',    desc);
    set('lyrics',      desc);
  }

  if (Array.isArray(info.tags) && info.tags.length) {
    set('genre',    info.tags.slice(0, 3).join('; '));
    set('keywords', info.tags.slice(0, 20).join('; '));
    set('show',     info.tags[0]);
  } else if (info.categories && info.categories.length) {
    set('genre', info.categories.slice(0, 3).join('; '));
  }

  if (info.uploader_id)    set('artist_id',  info.uploader_id);
  if (info.uploader_url)   set('source',     info.uploader_url);
  if (info.webpage_url)    set('source',     info.webpage_url);
  if (info.channel_url)    set('source',     info.channel_url);
  if (info.channel_follower_count != null) set('grouping', `${info.channel_follower_count} subscribers`);

  set('network',   'YouTube');
  set('language',  info.language || 'eng');

  const holder  = info.uploader || info.channel || '';
  const copyYear = year || '';
  if (holder) set('copyright', copyYear ? `© ${copyYear} ${holder}` : `© ${holder}`);

  // ---- Developer credit (multiple locations so it shows up in any tag viewer) ----
  set('publisher',   `${API_NAME} by ${DEV_CREDIT}`);
  set('encoded_by',  `${DEV_CREDIT} <${DEV_CREDIT_URL}>`);
  set('author',      DEV_CREDIT);
  set('tool',        `yt-dlp + ffmpeg via ${API_NAME} v${API_VERSION}`);
  set('software',    `${API_NAME} v${API_VERSION} — crafted by ${DEV_CREDIT}`);
  set('comment',     `Downloaded via ${API_NAME} v${API_VERSION} — by ${DEV_CREDIT} (${DEV_CREDIT_URL})`);

  return args;
}

async function downloadThumbnail(thumbnailUrl) {
  if (!thumbnailUrl) return null;
  const tmpName = `thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = path.join(config.dataDir, tmpName);
  try {
    const res = await axios.get(thumbnailUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 10 * 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    });
    fs.writeFileSync(tmpPath, res.data);
    return tmpPath;
  } catch (e) {
    logger.warn(`[metadata] thumbnail download failed: ${e.message}`);
    return null;
  }
}

function rm(p) { if (p) { try { fs.unlinkSync(p); } catch {} } }

/**
 * Embed metadata (+ optional thumbnail as cover art) into a downloaded
 * file in place. Uses ffmpeg -c copy so the audio/video streams are not
 * re-encoded. Returns { success, error?, embedded: bool }.
 *
 * info: yt-dlp dump-json object (or a subset). Pass {} to skip metadata
 * and just embed the thumbnail.
 */
async function embedMetadataInPlace(inputPath, info = {}, options = {}) {
  const { includeThumbnail = true } = options;

  if (!fs.existsSync(inputPath)) {
    return { success: false, error: `input file not found: ${inputPath}` };
  }

  let thumbPath = null;
  if (includeThumbnail && info && info.thumbnail) {
    thumbPath = await downloadThumbnail(info.thumbnail);
  }

  const ext = path.extname(inputPath);
  // ffmpeg auto-detects the output container from the file extension, so
  // the temp file must keep the original extension (`.tmp` is not a known
  // format). The .meta segment lets the original / final files coexist.
  const tempOutput = inputPath.slice(0, inputPath.length - ext.length) + '.meta' + ext;
  const ffmpegBin = config.ffmpegPath && config.ffmpegPath.length ? config.ffmpegPath : 'ffmpeg';
  const args = ['-y', '-i', inputPath];
  if (thumbPath) args.push('-i', thumbPath);

  args.push('-map', '0');
  if (thumbPath) {
    args.push('-map', '1:v:0');
    args.push('-c:v:1', 'copy');
    args.push('-disposition:v:1', 'attached_pic');
    args.push('-metadata:s:v:1', 'title=Album cover');
    args.push('-metadata:s:v:1', 'comment=Cover (front)');
  }

  args.push('-c', 'copy');
  args.push('-map_metadata', '-1'); // strip any metadata yt-dlp wrote, replace with ours

  // Add all the metadata from buildFfmpegMetadataArgs()
  args.push(...buildFfmpegMetadataArgs(info));

  // Container-specific tweaks
  const extLower = ext.toLowerCase();
  if (extLower === '.mp4' || extLower === '.m4a' || extLower === '.mov') {
    args.push('-movflags', '+faststart');
  }
  if (extLower === '.mp3') {
    args.push('-id3v2_version', '3');
    args.push('-write_id3v1', '1');
  }

  args.push(tempOutput);

  return new Promise((resolve) => {
    let stderr = '';
    let child;
    try {
      child = spawn(ffmpegBin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      rm(thumbPath); rm(tempOutput);
      return resolve({ success: false, error: `failed to spawn ffmpeg: ${err.message}` });
    }
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      rm(thumbPath); rm(tempOutput);
      resolve({ success: false, error: err.message });
    });
    child.on('close', (code) => {
      rm(thumbPath);
      if (code !== 0) {
        rm(tempOutput);
        logger.warn(`[metadata] embed failed (code ${code}): ${stderr.slice(-300)}`);
        return resolve({ success: false, error: stderr.slice(-300) || `ffmpeg exited ${code}` });
      }
      if (!fs.existsSync(tempOutput)) {
        return resolve({ success: false, error: 'ffmpeg produced no output file' });
      }
      try {
        fs.renameSync(tempOutput, inputPath);
        logger.info(`[metadata] embedded thumbnail+tags into ${path.basename(inputPath)}`);
        resolve({ success: true, embedded: true });
      } catch (e) {
        rm(tempOutput);
        resolve({ success: false, error: `rename failed: ${e.message}` });
      }
    });
  });
}

module.exports = {
  embedMetadataInPlace,
  downloadThumbnail,
  buildFfmpegMetadataArgs,
  EMBED_ENABLED,
  DEV_CREDIT,
  DEV_CREDIT_URL,
  API_NAME,
  API_VERSION,
};
