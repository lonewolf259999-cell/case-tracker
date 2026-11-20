/* Environment configuration — server only.
   Secrets never leave this side of the app. */

import fs from 'node:fs';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

function optional(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

function googleCredentials(): Record<string, unknown> | null {
  const inline = process.env.GOOGLE_JSON_KEY;
  if (inline) {
    try { return JSON.parse(inline); } catch { return null; }
  }
  const file = process.env.GOOGLE_CREDENTIALS_FILE;
  if (file && fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }
  return null;
}

function ffmpegBinary(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const local = path.join(
    process.cwd(),
    'node_modules',
    'ffmpeg-static',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  );
  if (fs.existsSync(local)) return local;
  if (ffmpegStatic) return ffmpegStatic;
  return 'ffmpeg';
}

export const config = {
  appUrl: optional('APP_URL', 'http://localhost:3000'),
  discordWebhook: optional('DISCORD_WEBHOOK_URL'),
  sheetId: optional('SHEET_ID'),
  googleCredentials,
  ffmpegPath: ffmpegBinary(),
  workDir: optional('WORK_DIR', 'data/work'),
  uploadTargetMb: Number(optional('UPLOAD_TARGET_MB', '19')) || 19,
  maxUploadBytes: 1024 * 1024 * 1024,
} as const;
