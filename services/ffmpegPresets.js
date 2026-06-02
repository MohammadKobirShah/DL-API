const AUDIO_PRESETS = {
  '8k':  { bitrate: '8k',  codec: 'libmp3lame', sampleRate: 22050, channels: 1, suffix: 'mp3' },
  '16k': { bitrate: '16k', codec: 'libmp3lame', sampleRate: 22050, channels: 1, suffix: 'mp3' },
  '24k': { bitrate: '24k', codec: 'libmp3lame', sampleRate: 22050, channels: 1, suffix: 'mp3' },
  '32k': { bitrate: '32k', codec: 'libmp3lame', sampleRate: 22050, channels: 1, suffix: 'mp3' },
  '48k': { bitrate: '48k', codec: 'libmp3lame', sampleRate: 44100, channels: 1, suffix: 'mp3' },
  '64k': { bitrate: '64k', codec: 'libmp3lame', sampleRate: 44100, channels: 2, suffix: 'mp3' },
  '96k': { bitrate: '96k', codec: 'libmp3lame', sampleRate: 44100, channels: 2, suffix: 'mp3' },
  '128k':{ bitrate: '128k',codec: 'libmp3lame', sampleRate: 44100, channels: 2, suffix: 'mp3' },
  '160k':{ bitrate: '160k',codec: 'libmp3lame', sampleRate: 44100, channels: 2, suffix: 'mp3' },
  '192k':{ bitrate: '192k',codec: 'libmp3lame', sampleRate: 44100, channels: 2, suffix: 'mp3' },
  '256k':{ bitrate: '256k',codec: 'libmp3lame', sampleRate: 44100, channels: 2, suffix: 'mp3' },
  '320k':{ bitrate: '320k',codec: 'libmp3lame', sampleRate: 48000, channels: 2, suffix: 'mp3' },
  'opus-low':    { bitrate: '32k',  codec: 'libopus',   sampleRate: 48000, channels: 2, suffix: 'opus' },
  'opus-medium': { bitrate: '96k',  codec: 'libopus',   sampleRate: 48000, channels: 2, suffix: 'opus' },
  'opus-high':   { bitrate: '192k', codec: 'libopus',   sampleRate: 48000, channels: 2, suffix: 'opus' },
  'aac-low':     { bitrate: '96k',  codec: 'aac',       sampleRate: 44100, channels: 2, suffix: 'm4a' },
  'aac-high':    { bitrate: '256k', codec: 'aac',       sampleRate: 48000, channels: 2, suffix: 'm4a' },
  'flac':        { bitrate: null,   codec: 'flac',      sampleRate: 48000, channels: 2, suffix: 'flac' },
  'wav':         { bitrate: null,   codec: 'pcm_s16le', sampleRate: 48000, channels: 2, suffix: 'wav' },
};

const VIDEO_PRESETS = {
  '144p':  { width: 256,  height: 144,  videoBitrate: '100k',  suffix: 'mp4', codec: 'libx264' },
  '240p':  { width: 426,  height: 240,  videoBitrate: '400k',  suffix: 'mp4', codec: 'libx264' },
  '360p':  { width: 640,  height: 360,  videoBitrate: '800k',  suffix: 'mp4', codec: 'libx264' },
  '480p':  { width: 854,  height: 480,  videoBitrate: '1400k', suffix: 'mp4', codec: 'libx264' },
  '720p':  { width: 1280, height: 720,  videoBitrate: '2800k', suffix: 'mp4', codec: 'libx264' },
  '1080p': { width: 1920, height: 1080, videoBitrate: '5000k', suffix: 'mp4', codec: 'libx264' },
  '1440p': { width: 2560, height: 1440, videoBitrate: '10000k',suffix: 'mp4', codec: 'libx264' },
  '2160p': { width: 3840, height: 2160, videoBitrate: '20000k',suffix: 'mp4', codec: 'libx265' },
  '160x120': { width: 160, height: 120, videoBitrate: '100k', suffix: 'mp4', codec: 'libx264' },
  '320x240': { width: 320, height: 240, videoBitrate: '300k', suffix: 'mp4', codec: 'libx264' },
  '640x480': { width: 640, height: 480, videoBitrate: '800k', suffix: 'mp4', codec: 'libx264' },
  'crf-18':  { crf: 18, suffix: 'mp4', codec: 'libx264' },
  'crf-23':  { crf: 23, suffix: 'mp4', codec: 'libx264' },
  'crf-28':  { crf: 28, suffix: 'mp4', codec: 'libx264' },
  'gif':     { width: 480, height: -1, videoBitrate: null, suffix: 'gif', codec: 'gif',
               customArgs: ['-vf', 'fps=15,scale=480:-1:flags=lanczos', '-loop', '0'] },
  'webm-720p':  { width: 1280, height: 720,  videoBitrate: '2000k', suffix: 'webm', codec: 'libvpx-vp9', audioCodec: 'libopus' },
  'webm-1080p': { width: 1920, height: 1080, videoBitrate: '4000k', suffix: 'webm', codec: 'libvpx-vp9', audioCodec: 'libopus' },
};

function buildAudioArgs(preset, input, output) {
  const p = AUDIO_PRESETS[preset];
  if (!p) throw new Error(`Unknown audio preset: ${preset}`);
  const args = ['-y', '-i', input, '-vn', '-c:a', p.codec];
  if (p.bitrate) args.push('-b:a', p.bitrate);
  if (p.sampleRate) args.push('-ar', p.sampleRate.toString());
  if (p.channels) args.push('-ac', p.channels.toString());
  args.push(output);
  return args;
}

function buildVideoArgs(preset, input, output, options = {}) {
  const p = VIDEO_PRESETS[preset];
  if (!p) throw new Error(`Unknown video preset: ${preset}`);
  const args = ['-y', '-i', input];
  args.push('-c:v', p.codec);
  if (p.width && p.height) {
    if (p.height === -1) {
      args.push('-vf', `scale=${p.width}:-2`);
    } else {
      args.push('-vf', `scale=${p.width}:${p.height}:force_original_aspect_ratio=decrease,pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2`);
    }
  }
  if (p.crf !== undefined) {
    args.push('-crf', p.crf.toString());
    args.push('-preset', 'medium');
  } else if (p.videoBitrate) {
    args.push('-b:v', p.videoBitrate);
  }
  const audioCodec = p.audioCodec || 'aac';
  args.push('-c:a', audioCodec);
  args.push('-b:a', options.audioBitrate || '128k');
  if (p.customArgs) args.push(...p.customArgs);
  args.push(output);
  return args;
}

function buildCustomArgs(options, input, output) {
  const {
    videoCodec, videoBitrate, crf, width, height, fps,
    audioCodec, audioBitrate, audioSampleRate, audioChannels,
    startTime, endTime, extraArgs = [],
  } = options;
  const args = ['-y', '-i', input];
  if (startTime) args.push('-ss', startTime);
  if (endTime) args.push('-to', endTime);
  if (videoCodec || videoBitrate || crf !== undefined || width || height || fps) {
    if (videoCodec) args.push('-c:v', videoCodec);
    if (crf !== undefined && crf !== null) {
      args.push('-crf', crf.toString());
      args.push('-preset', 'medium');
    } else if (videoBitrate) {
      args.push('-b:v', videoBitrate);
    }
    const filters = [];
    if (width || height) {
      const w = width || -1;
      const h = height || -1;
      filters.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease`);
      if (width && height) filters.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`);
    }
    if (fps) filters.push(`fps=${fps}`);
    if (filters.length > 0) args.push('-vf', filters.join(','));
  } else {
    args.push('-vn');
  }
  if (audioCodec || audioBitrate) {
    if (audioCodec) args.push('-c:a', audioCodec);
    if (audioBitrate) args.push('-b:a', audioBitrate);
    if (audioSampleRate) args.push('-ar', audioSampleRate.toString());
    if (audioChannels) args.push('-ac', audioChannels.toString());
  } else {
    args.push('-an');
  }
  args.push(...extraArgs, output);
  return args;
}

function listPresets() {
  return {
    audio: Object.entries(AUDIO_PRESETS).map(([name, p]) => ({
      name, bitrate: p.bitrate, codec: p.codec, sampleRate: p.sampleRate, channels: p.channels, format: p.suffix,
    })),
    video: Object.entries(VIDEO_PRESETS).map(([name, p]) => ({
      name, width: p.width, height: p.height, videoBitrate: p.videoBitrate, crf: p.crf, codec: p.codec, format: p.suffix,
    })),
  };
}

module.exports = {
  AUDIO_PRESETS, VIDEO_PRESETS,
  buildAudioArgs, buildVideoArgs, buildCustomArgs, listPresets,
};
