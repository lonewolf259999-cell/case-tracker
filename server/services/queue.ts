/* Tiny in-process queues.
   - Discord: จัดคิวเป็น "ชุดต่อเคส" (batch) เพื่อให้ข้อความของเคสเดียวกัน
     ออกติดกัน (embed → คลิป → patch) และไม่ปนกับเคสอื่น
   - ffmpeg: ทำทีละไฟล์ (CPU-bound) */

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function createQueue(concurrency = 1, gapMs = 0) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>(resolve => waiting.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      if (gapMs > 0) await sleep(gapMs);
      active -= 1;
      const next = waiting.shift();
      if (next) next();
    }
  };
}

/* เก็บสถานะ ffmpeg queue บน globalThis เพื่อให้ทุก route ใช้คิวเดียวกัน */
type Runner = ReturnType<typeof createQueue>;
const queueStore = ((globalThis as unknown as { __ctQueues?: { ffmpeg?: Runner } }).__ctQueues ??= {});

/** One ffmpeg transcode at a time (keeps the host responsive). */
const ffmpegConcurrency = Math.max(1, Math.min(4, Number(process.env.FFMPEG_CONCURRENCY || 1) || 1));
export const ffmpegQueue: Runner = queueStore.ffmpeg ?? (queueStore.ffmpeg = createQueue(ffmpegConcurrency, 0));

/* ---------- Discord batch scheduler ---------- */

const GAP_MS = 2200;              // ~27 ข้อความ/นาที (webhook รับ ~30)
const IDLE_RELEASE_MS = 20_000;   // ถ้าไม่มีคำสั่งใหม่นานเกินนี้ ปล่อยชุดเพื่อไม่ให้คิวค้าง

type DiscordJob = {
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  end: boolean;
};

type Batch = {
  id: string;
  jobs: DiscordJob[];
  ended: boolean;
  lastAt: number;
  wake: (() => void) | null;
};

type SchedulerState = {
  batches: Map<string, Batch>;
  order: string[];
  lastCallAt: number;
  running: boolean;
};

const state = ((globalThis as unknown as { __ctDiscordScheduler?: SchedulerState }).__ctDiscordScheduler ??= {
  batches: new Map<string, Batch>(),
  order: [],
  lastCallAt: 0,
  running: false,
});

async function runWorker() {
  if (state.running) return;
  state.running = true;

  try {
    while (state.order.length) {
      const id = state.order[0];
      const batch = state.batches.get(id);
      if (!batch) { state.order.shift(); continue; }

      if (!batch.jobs.length) {
        if (batch.ended) {
          state.order.shift();
          state.batches.delete(id);
          continue;
        }

        const idle = Date.now() - batch.lastAt;
        if (idle >= IDLE_RELEASE_MS) {
          console.warn('[discord] batch idle timeout:', id);
          state.order.shift();
          state.batches.delete(id);
          continue;
        }

        await new Promise<void>(resolve => {
          batch.wake = resolve;
          setTimeout(resolve, IDLE_RELEASE_MS - idle);
        });
        batch.wake = null;
        continue;
      }

      const job = batch.jobs.shift()!;
      const since = Date.now() - state.lastCallAt;
      if (since < GAP_MS) await sleep(GAP_MS - since);

      try {
        job.resolve(await job.fn());
      } catch (err) {
        job.reject(err);
      }
      state.lastCallAt = Date.now();

      if (job.end) batch.ended = true;
      if (batch.ended && !batch.jobs.length) {
        state.order.shift();
        state.batches.delete(id);
      }
    }
  } finally {
    state.running = false;
    if (state.order.length) void runWorker();
  }
}

/** เพิ่มงาน Discord เข้าชุด `batchId` — งานของชุดเดียวกันจะออกติดกัน */
export function enqueueDiscord<T>(batchId: string, fn: () => Promise<T>, end = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let batch = state.batches.get(batchId);
    if (!batch) {
      batch = { id: batchId, jobs: [], ended: false, lastAt: Date.now(), wake: null };
      state.batches.set(batchId, batch);
      state.order.push(batchId);
    }

    batch.jobs.push({
      fn: fn as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
      end,
    });
    batch.lastAt = Date.now();
    if (end) batch.ended = true;

    const wake = batch.wake;
    batch.wake = null;
    wake?.();

    void runWorker();
  });
}

/** ต่ออายุชุดระหว่างอัปโหลด/ตัดต่อคลิป เพื่อไม่ให้คิวปล่อยชุดก่อนเวลา */
export function touchBatch(batchId: string) {
  const batch = state.batches.get(batchId);
  if (!batch) return;
  batch.lastAt = Date.now();
  const wake = batch.wake;
  batch.wake = null;
  wake?.();
}
