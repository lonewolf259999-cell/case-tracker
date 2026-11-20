/* In-memory queue status for clip uploads.
   Single Node process only — the queue itself lives in this process. */

export type JobStatus = 'uploading' | 'queued' | 'processing' | 'discord' | 'done' | 'error';

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  /** 1 = ถึงคิว/กำลังทำ, 0 = จบแล้ว */
  position: number;
  total: number;
  elapsedMs: number;
  link?: string;
  error?: string;
}

type Entry = {
  id: string;
  status: JobStatus;
  createdAt: number;
  finishedAt?: number;
  link?: string;
  error?: string;
};

const KEEP_DONE_MS = 60_000;
const KEEP_MAX_MS = 15 * 60_000;

/* เก็บสถานะคิวบน globalThis — Next แยกโมดูลต่อ route
   ทำให้ /api/upload กับ /api/upload/job เห็นคิวเดียวกัน */
type JobStore = { jobs: Map<string, Entry>; line: string[] };
const store = ((globalThis as unknown as { __ctUploadJobs?: JobStore }).__ctUploadJobs ??= {
  jobs: new Map<string, Entry>(),
  line: [],
});

const jobs = store.jobs;
/** ลำดับคิวตามเวลาที่อัปโหลดไฟล์เสร็จ (FIFO) */
const line = store.line;

function prune(now = Date.now()) {
  for (const [id, job] of jobs) {
    const age = now - job.createdAt;
    if (age > KEEP_MAX_MS || (job.finishedAt && now - job.finishedAt > KEEP_DONE_MS)) {
      jobs.delete(id);
    }
  }
  // กันคิวค้าง: id ที่ไม่มีงานแล้วต้องหลุดออกจากลำดับด้วย
  for (let i = line.length - 1; i >= 0; i--) {
    if (!jobs.has(line[i])) line.splice(i, 1);
  }
}

export function createUploadJob(id: string) {
  prune();
  jobs.set(id, { id, status: 'uploading', createdAt: Date.now() });
}

/** เรียกหลังไฟล์อัปโหลดขึ้นเซิร์ฟเวอร์ครบแล้ว */
export function enterQueue(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  if (!line.includes(id)) line.push(id);
  job.status = 'queued';
}

export function setJobStatus(id: string, status: JobStatus) {
  const job = jobs.get(id);
  if (job) job.status = status;
}

export function finishJob(id: string, link: string) {
  const job = jobs.get(id);
  if (job) {
    job.status = 'done';
    job.link = link;
    job.finishedAt = Date.now();
  }
  remove(id);
}

export function failJob(id: string, error: string) {
  const job = jobs.get(id);
  if (job) {
    job.status = 'error';
    job.error = error.slice(0, 300);
    job.finishedAt = Date.now();
  }
  remove(id);
}

function remove(id: string) {
  const i = line.indexOf(id);
  if (i >= 0) line.splice(i, 1);
}

export function jobSnapshot(id: string): JobSnapshot | null {
  const job = jobs.get(id);
  if (!job) return null;
  const i = line.indexOf(id);
  return {
    id: job.id,
    status: job.status,
    position: i >= 0 ? i + 1 : 0,
    total: line.length,
    elapsedMs: Date.now() - job.createdAt,
    link: job.link,
    error: job.error,
  };
}
