ffmpeg.wasm, used only by cinema/hevc.js (HEVC / H.265 videos from Google Drive that the browser cannot play as they are).
Files: ffmpeg.js + 814.ffmpeg.js (worker)  = npm package @ffmpeg/ffmpeg 0.12.10 (MIT), dist/umd
       ffmpeg-core.js + ffmpeg-core.wasm   = npm package @ffmpeg/core   0.12.6  (single-thread build), dist/umd
The core contains FFmpeg (LGPL/GPL) and x264 (GPL v2). Source: https://github.com/ffmpegwasm/ffmpeg.wasm and https://ffmpeg.org
To refresh: npm install @ffmpeg/ffmpeg@0.12.10 @ffmpeg/core@0.12.6 and copy the four files above from node_modules/@ffmpeg/*/dist/umd/.
These files are only downloaded by a player's browser when an HEVC video actually needs converting.
