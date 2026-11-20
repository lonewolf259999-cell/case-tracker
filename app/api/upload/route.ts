import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '@/server/config';
import { compress, probeDuration, workDir } from '@/server/services/video';
import { ffmpegQueue, touchBatch } from '@/server/services/queue';
import { safeName, uploadFile } from '@/server/services/discord';
import { createUploadJob, enterQueue, failJob, finishJob, setJobStatus } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const jobId = (request.headers.get('x-job-id') || id).slice(0, 64);
  const batchId = (request.headers.get('x-batch-id') || '').slice(0, 80);
  createUploadJob(jobId);

  // ระหว่างอัปโหลด/ตัดต่อ อาจใช้เวลาหลายวินาที — ต่ออายุชุดไว้ไม่ให้คิวปล่อย
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  if (batchId) {
    touchBatch(batchId);
    keepAlive = setInterval(() => touchBatch(batchId), 5000);
  }

  const dir = workDir();

  const original = decodeURIComponent(request.headers.get('x-filename') || 'clip.mp4');
  const ext = (path.extname(original) || '.mp4').toLowerCase();
  const input = path.join(dir, `in_${id}${ext}`);
  let outputFile = '';

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > config.maxUploadBytes) {
    failJob(jobId, 'ไฟล์ใหญ่เกิน 1 GB');
    return Response.json({ ok: false, error: 'ไฟล์ใหญ่เกิน 1 GB' }, { status: 413 });
  }

  try {
    let size = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (size > config.maxUploadBytes) cb(new Error('ไฟล์ใหญ่เกิน 1 GB'));
        else cb(null, chunk);
      },
    });

    if (!request.body) {
      failJob(jobId, 'ไม่พบไฟล์');
      return Response.json({ ok: false, error: 'ไม่พบไฟล์' }, { status: 400 });
    }
    await pipeline(Readable.fromWeb(request.body as never), counter, fs.createWriteStream(input));
    if (!size) {
      failJob(jobId, 'ไม่พบไฟล์');
      return Response.json({ ok: false, error: 'ไม่พบไฟล์' }, { status: 400 });
    }

    enterQueue(jobId);

    const trimStart = Math.max(0, parseFloat(request.headers.get('x-trim-start') || '0') || 0);
    const trimDur = Math.max(0, parseFloat(request.headers.get('x-trim-duration') || '0') || 0);
    const content = decodeURIComponent(request.headers.get('x-content') || '');

    const sourceDuration = await probeDuration(input);
    if (!sourceDuration) {
      failJob(jobId, 'อ่านความยาวคลิปไม่ได้');
      return Response.json({ ok: false, error: 'อ่านความยาวคลิปไม่ได้' }, { status: 400 });
    }
    if (trimDur > 0 && trimStart >= sourceDuration) {
      failJob(jobId, 'จุดเริ่มเกินความยาวคลิป');
      return Response.json({ ok: false, error: 'จุดเริ่มเกินความยาวคลิป' }, { status: 400 });
    }

    const duration = trimDur > 0 ? Math.min(trimDur, Math.max(0, sourceDuration - trimStart)) : sourceDuration;
    const force = trimDur > 0;

    let file = input;
    if (size > 20 * 1024 * 1024 || force) {
      outputFile = path.join(dir, `out_${id}.mp4`);
      setJobStatus(jobId, 'processing');
      await ffmpegQueue(() => compress(input, outputFile, duration, trimStart, trimDur));
      file = outputFile;
    }

    const outSize = fs.statSync(file).size;
    if (outSize > 20 * 1024 * 1024) {
      failJob(jobId, 'ไฟล์หลังบีบอัดยังเกิน 20 MB');
      return Response.json({ ok: false, error: 'ไฟล์หลังบีบอัดยังเกิน 20 MB' }, { status: 413 });
    }

    setJobStatus(jobId, 'discord');
    const sent = await uploadFile(file, safeName(original), content, batchId ? { batch: batchId } : undefined);
    finishJob(jobId, sent.link);

    return Response.json({
      ok: true,
      jobId,
      messageId: sent.id,
      link: sent.link,
      duration: Math.round(duration * 10) / 10,
      sizeMB: Math.round(outSize / 1024 / 1024 * 100) / 100,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upload failed';
    failJob(jobId, message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    try { fs.unlinkSync(input); } catch { /* ignore */ }
    if (outputFile) { try { fs.unlinkSync(outputFile); } catch { /* ignore */ } }
  }
}
