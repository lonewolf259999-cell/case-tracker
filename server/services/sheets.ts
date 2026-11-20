/* Google Sheets storage — one tab, one row per suspect.
   Case fields repeat on every suspect row; the app regroups by case number. */

import { google } from 'googleapis';
import { config } from '@/server/config';
import type { Case, Clip, Status, Suspect } from '@/lib/shared/types';

export type CaseInput = Omit<Case, 'id' | 'no' | 'createdAt' | 'updatedAt'> & {
  id?: string;
  no?: number;
};

const TAB = 'Cases';
const RANGE = `${TAB}!A2:Q`;

const HEADERS = [
  'เลขเคส', 'วันที่ลงเคส', 'ID DC ผู้แจ้ง',
  'กลุ่มผู้แจ้ง', 'กลุ่มผู้ต้องสงสัย', 'รายละเอียดผู้แจ้ง',
  'ชื่อผู้ต้องสงสัย', 'ID DC ผู้ต้องสงสัย', 'Steam',
  'รายละเอียดผู้ต้องสงสัย', 'คลิป', 'ผลตรวจ', 'ผู้ตรวจ',
  'พบอะไร', 'หมายเหตุ', 'embedId', 'embedUrl',
];

function client() {
  const creds = config.googleCredentials() as { client_email?: string; private_key?: string } | null;
  if (!creds?.client_email || !creds?.private_key) throw new Error('missing Google credentials');
  if (!config.sheetId) throw new Error('missing SHEET_ID');

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

let _sheets: ReturnType<typeof google.sheets> | null = null;
function db() {
  if (!_sheets) _sheets = client();
  return _sheets;
}

export function sheetHeaders(): string[] {
  return HEADERS;
}

export function clipCell(clips: Clip[]): string {
  return clips
    .map(c => `${c.url} | ${c.mark == null ? '-' : clock(c.mark)}`)
    .join('\n');
}

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function parseMark(text: string): number | undefined {
  const m = text.trim().match(/^(\d+):(\d{1,2})$/);
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseClipCell(cell: string): Clip[] {
  return (cell || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [url, mark] = line.split('|').map(s => (s || '').trim());
      return { url, mark: mark && mark !== '-' ? parseMark(mark) : undefined };
    })
    .filter(c => c.url);
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseDate(text: string): number {
  const m = (text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return Date.now();
  return new Date(
    Number(m[3]), Number(m[2]) - 1, Number(m[1]),
    Number(m[4] || 0), Number(m[5] || 0),
  ).getTime();
}

const STATUS_LABEL: Record<Status, string> = {
  collect: 'รอตรวจ', todo: 'รอตรวจ', new: 'กำลังตรวจ', bad: 'พบปัญหา', ok: 'ปกติ',
};

export function statusFromLabel(text: string): Status {
  const s = (text || '').trim();
  if (s === 'ปกติ') return 'ok';
  if (s === 'พบปัญหา') return 'bad';
  if (s === 'กำลังตรวจ') return 'new';
  return 'todo';
}

/* ---------- Google Sheets call plumbing (single process) ----------
   ทุกคำสั่งยิงชีตทีละคำสั่ง + retry เมื่อโดนลิมิต/เซิร์ฟเวอร์สะดุด
   เพื่อไม่ให้ข้อมูลหายตอนคนใช้พร้อมกันเยอะ ๆ */

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

let sheetChain: Promise<unknown> = Promise.resolve();

/** serialize ทุก API call ของชีต (กันยิงพร้อมกันจนโดน 429) */
function sheetCall<T>(fn: () => Promise<T>): Promise<T> {
  const run = sheetChain.then(fn, fn);
  sheetChain = run.catch(() => undefined);
  return run;
}

function errStatus(err: unknown): number {
  const e = err as { code?: number; response?: { status?: number } };
  return Number(e?.code || e?.response?.status || 0);
}

function isRateLimit(err: unknown): boolean {
  const status = errStatus(err);
  if (status === 429) return true;
  if (status === 403) {
    const msg = err instanceof Error ? err.message : String(err);
    return /quota|rate|limit/i.test(msg);
  }
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/** retry แบบ exponential backoff + jitter (สูงสุด ~30 วิ/ครั้ง) */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimit(err) || attempt === 5) throw err;
      const wait = Math.min(30_000, 700 * 2 ** attempt) + Math.round(Math.random() * 300);
      console.warn(`[sheets] ${label} retry ${attempt + 1} in ${wait}ms`, errStatus(err));
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function readFromSheet(): Promise<{ all: Case[]; rowCount: number }> {
  const res = await sheetCall(() => withRetry('read', () => db().spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: RANGE,
  })));
  const rows = (res.data.values || []) as string[][];
  return { all: build(rows), rowCount: rows.length };
}

function build(rows: string[][]): Case[] {
  const byNo = new Map<number, Case>();

  for (const row of rows) {
    // "1041-2" → เคส 1041 ผู้ต้องสงสัยคนที่ 2 · "1041" → คนที่ 1
    const label = String(row[0] || '').trim();
    const [baseText, orderText] = label.split('-');
    const baseNo = Number((baseText || '').trim());
    if (!baseNo) continue;
    const order = Number((orderText || '1').trim()) || 1;

    let c = byNo.get(baseNo);
    if (!c) {
      c = {
        id: `c_${baseNo}`,
        no: baseNo,
        reporterDcId: (row[2] || '').trim(),
        reporterGang: (row[3] || '').trim(),
        accusedGang: (row[4] || '').trim(),
        reporterDetail: (row[5] || '').trim(),
        clips: [],
        suspects: [],
        createdAt: parseDate(row[1] || ''),
        updatedAt: parseDate(row[1] || ''),
      };
      byNo.set(baseNo, c);
    }

    const s: Suspect = {
      id: `s_${baseNo}_${order}`,
      name: (row[6] || '').trim(),
      dcId: (row[7] || '').trim(),
      identifier: (row[8] || '').trim(),
      detail: (row[9] || '').trim(),
      clips: parseClipCell(row[10] || ''),
      status: statusFromLabel(row[11] || ''),
      inspector: (row[12] || '').trim(),
      findings: (row[13] || '').trim(),
      note: (row[14] || '').trim(),
      embedId: (row[15] || '').trim() || undefined,
      embedUrl: (row[16] || '').trim() || undefined,
    };
    c.suspects.push(s);
  }

  for (const c of byNo.values()) {
    c.suspects.sort((a, b) => Number((a.id || '').split('_').pop()) - Number((b.id || '').split('_').pop()));
  }

  return [...byNo.values()].sort((a, b) => b.no - a.no);
}

function buildRows(cases: Case[]): string[][] {
  const rows: string[][] = [];

  for (const c of cases) {
    const head = [
      fmtDate(c.createdAt),
      c.reporterDcId,
      c.reporterGang || '',
      c.accusedGang || '',
      c.reporterDetail || '',
    ];
    const multi = c.suspects.length > 1;

    if (!c.suspects.length) {
      rows.push([String(c.no), ...head, ...Array(11).fill('')]);
      continue;
    }

    c.suspects.forEach((s, i) => {
      rows.push([
        multi ? `${c.no}-${i + 1}` : String(c.no),
        ...head,
        s.name || '',
        s.dcId || '',
        s.identifier || '',
        s.detail || '',
        clipCell(s.clips),
        STATUS_LABEL[s.status || 'todo'],
        s.inspector || '',
        s.findings || '',
        s.note || '',
        s.embedId || '',
        s.embedUrl || '',
      ]);
    });
  }

  return rows;
}

/** เขียนทับข้อมูลใหม่ก่อน แล้วค่อยล้างแถวที่เหลือ (ถ้าจำนวนแถวลดลง) */
async function writeRows(cases: Case[], prevRowCount: number): Promise<number> {
  const rows = buildRows(cases);

  if (rows.length) {
    await sheetCall(() => withRetry('write', () => db().spreadsheets.values.update({
      spreadsheetId: config.sheetId,
      range: `${TAB}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    })));
  }

  if (!rows.length || rows.length < prevRowCount) {
    const firstStale = rows.length + 2;
    await sheetCall(() => withRetry('clear', () => db().spreadsheets.values.clear({
      spreadsheetId: config.sheetId,
      range: `${TAB}!A${firstStale}:Q`,
    })));
  }

  return rows.length;
}

/* ---------- coalesced writer ----------
   ถ้ามีหลายคนบันทึกพร้อมกัน งานทั้งหมดจะถูกรวมเป็น "ชุดเดียว"
   → อ่านชีต 1 ครั้ง + เขียน 1 ครั้ง ต่อชุด (ประหยัดโควตา ไม่โดนลิมิต) */

type Pending = {
  run: (all: Case[]) => { all: Case[]; result: unknown };
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

let pending: Pending[] = [];
let flushing = false;
let flushPromise: Promise<void> | null = null;
let cache: Case[] | null = null;
let cacheAt = 0;

function scheduleFlush() {
  if (flushing) return;
  flushing = true;

  flushPromise = (async () => {
    // รวมงานที่มาถี่ ๆ ให้เป็นชุดเดียวกัน
    await sleep(150);

    while (pending.length) {
      const batch = pending;
      pending = [];

      let fresh: { all: Case[]; rowCount: number };
      try {
        fresh = await readFromSheet();
      } catch (err) {
        batch.forEach(item => item.reject(err));
        continue;
      }

      let all = fresh.all;
      const outcomes: ({ ok: true; value: unknown } | { ok: false; error: unknown })[] = [];

      for (const item of batch) {
        try {
          const out = item.run(all);
          all = out.all;
          outcomes.push({ ok: true, value: out.result });
        } catch (err) {
          outcomes.push({ ok: false, error: err });
        }
      }

      try {
        const rowCount = await writeRows(all, fresh.rowCount);
        cache = all;
        cacheAt = Date.now();
        void rowCount;
      } catch (err) {
        batch.forEach(item => item.reject(err));
        continue;
      }

      batch.forEach((item, i) => {
        const out = outcomes[i];
        if (out.ok) item.resolve(out.value);
        else item.reject(out.error);
      });
    }

    flushing = false;
    flushPromise = null;
    if (pending.length) scheduleFlush();
  })();
}

function enqueue<T>(run: (all: Case[]) => { all: Case[]; result: T }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push({
      run: run as (all: Case[]) => { all: Case[]; result: unknown },
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    scheduleFlush();
  });
}

export async function listCases(force = false): Promise<Case[]> {
  if (flushPromise) await flushPromise;

  if (!force && cache && Date.now() - cacheAt < 15_000) return cache;

  const fresh = await readFromSheet();
  cache = fresh.all;
  cacheAt = Date.now();
  return fresh.all;
}

export async function getCase(id: string): Promise<Case | null> {
  const no = Number(id.replace(/^c_/, ''));
  return (await listCases()).find(c => c.no === no) || null;
}

export async function createCase(input: CaseInput): Promise<Case> {
  return enqueue(all => {
    const no = input.no && Number(input.no) || all.reduce((m, c) => Math.max(m, c.no), 1040) + 1;
    const now = Date.now();

    const c: Case = {
      id: `c_${no}`,
      no,
      reporterDcId: input.reporterDcId,
      reporterDetail: input.reporterDetail || '',
      reporterGang: input.reporterGang || '',
      accusedGang: input.accusedGang || '',
      clips: input.clips || [],
      suspects: (input.suspects || []).map((s, i) => ({
        ...s, id: `s_${no}_${i + 1}`, status: s.status || 'todo',
      })),
      createdAt: now,
      updatedAt: now,
      source: input.source,
      ref: input.ref,
    };

    return { all: [...all, c], result: c };
  });
}

export async function updateCase(id: string, input: CaseInput): Promise<Case> {
  return enqueue(all => {
    const no = Number(id.replace(/^c_/, ''));
    const idx = all.findIndex(c => c.no === no);
    if (idx < 0) throw new Error('case not found');

    const prev = all[idx];
    const prevById = new Map(prev.suspects.map(s => [s.id, s]));

    const next: Case = {
      ...prev,
      reporterDcId: input.reporterDcId ?? prev.reporterDcId,
      reporterDetail: input.reporterDetail ?? prev.reporterDetail,
      reporterGang: input.reporterGang ?? prev.reporterGang,
      accusedGang: input.accusedGang ?? prev.accusedGang,
      clips: input.clips ?? prev.clips,
      suspects: (input.suspects ?? prev.suspects).map((s, i) => {
        const p = prevById.get(s.id) || prev.suspects[i] || ({} as Suspect);
        return {
          ...p,
          ...s,
          id: `s_${no}_${i + 1}`,
          status: s.status || p.status || 'todo',
          inspector: s.inspector ?? p.inspector ?? '',
          findings: s.findings ?? p.findings ?? '',
          note: s.note ?? p.note ?? '',
          embedId: s.embedId ?? p.embedId,
          embedUrl: s.embedUrl ?? p.embedUrl,
        };
      }),
      updatedAt: Date.now(),
      source: input.source ?? prev.source,
      ref: input.ref ?? prev.ref,
    };

    const nextAll = [...all];
    nextAll[idx] = next;
    return { all: nextAll, result: next };
  });
}

export async function deleteCase(id: string): Promise<void> {
  const no = Number(id.replace(/^c_/, ''));
  await enqueue(all => ({
    all: all.filter(c => c.no !== no),
    result: undefined,
  }));
}
