import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/server/config';

const TARGET_MB = 19;
const HARD_LIMIT = 20 * 1024 * 1024;

let lastSweep = 0;

export function workDir(): string {
  const dir = path.isAbsolute(config.workDir) ? config.workDir : path.join(process.cwd(), config.workDir);
  fs.mkdirSync(dir, { recursive: true });

  // ลบไฟล์ค้างเก่ากว่า 24 ชม. (ตรวจไม่เกินชั่วโมงละครั้ง)
  if (Date.now() - lastSweep > 3_600_000) {
    lastSweep = Date.now();
    try {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        try {
          if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3_600_000) fs.unlinkSync(p);
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  return dir;
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(config.ffmpegPath, args);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(err.slice(-2000)))));
  });
}

export function probeDuration(file: string): Promise<number> {
  return new Promise(resolve => {
    const p = spawn(config.ffmpegPath, ['-i', file]);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return resolve(0);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]));
    });
    p.on('error', () => resolve(0));
  });
}

export async function compress(
  input: string,
  output: string,
  duration: number,
  trimStart: number,
  trimDuration: number,
): Promise<void> {
  const totalKbps = (TARGET_MB * 8192) / Math.max(duration, 1);
  const audioKbps = duration > 600 ? 48 : duration > 300 ? 64 : 96;
  let videoKbps = Math.max(120, Math.floor(totalKbps - audioKbps));
  let width = videoKbps >= 1800 ? 1280 : videoKbps >= 800 ? 960 : 640;

  for (let attempt = 0; attempt < 4; attempt++) {
    const args = ['-y'];
    if (trimStart > 0) args.push('-ss', String(trimStart));
    if (trimDuration > 0) args.push('-t', String(trimDuration));
    args.push(
      '-i', input,
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps + 200}k`, '-bufsize', `${videoKbps * 2}k`,
      '-vf', `scale=min(${width}\\,iw):-2`,
      '-c:a', 'aac', '-b:a', `${audioKbps}k`,
      '-movflags', '+faststart',
      output,
    );

    await run(args);
    const size = fs.statSync(output).size;
    if (size <= HARD_LIMIT) return;
    videoKbps = Math.floor(videoKbps * 0.8);
    if (attempt >= 1) width = Math.max(480, Math.floor(width * 0.8));
  }
}
