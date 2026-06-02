# YT-DLP API Server v2.2.0

24/7 YT-DLP API with PO Token bypass + custom quality/conversion via FFmpeg.

## Quick Install (Ubuntu/Debian)

```bash
# 1. Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. FFmpeg
sudo apt install -y ffmpeg
ffmpeg -version

# 3. yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version

# 4. PO Token provider
sudo npm install -g bgutil-ytdlp-pot-provider

# 5. App
git clone <your-repo> ytdlp-api-server
cd ytdlp-api-server
npm install
cp .env.example .env
nano .env

# 6. Run
npm start
# or for 24/7
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

## FFmpeg Install

| OS | Command |
|----|---------|
| Ubuntu/Debian | `sudo apt install ffmpeg` |
| macOS | `brew install ffmpeg` |
| Windows (winget) | `winget install Gyan.FFmpeg` |
| Windows (choco) | `choco install ffmpeg` |

## API Examples

```bash
# Get video info
curl "http://localhost:3000/api/info?url=https://youtu.be/dQw4w9WgXcQ"

# Stream download
curl -o video.mp4 "http://localhost:3000/api/download?url=https://youtu.be/dQw4w9WgXcQ"

# Custom quality audio
curl -o audio.mp3 "http://localhost:3000/api/download/quality?url=https://youtu.be/dQw4w9WgXcQ&quality=48k"

# Custom resolution video
curl -o video.mp4 "http://localhost:3000/api/download/resolution?url=https://youtu.be/dQw4w9WgXcQ&resolution=320x240"

# List presets
curl "http://localhost:3000/api/presets"

# Status
curl "http://localhost:3000/api/status"
```

## Endpoints

**Public (15):** info, embed, formats, search, playlist, thumbnail, subtitles, download, download/save, presets, download/quality, download/resolution, convert, transcode, probe, status

**Admin (4):** potoken, cookies, status, restart-provider
