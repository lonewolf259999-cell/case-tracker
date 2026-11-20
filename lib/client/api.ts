import type { Case, Clip, Suspect } from '@/lib/shared/types';

export type CaseInput = {
  reporterDcId: string;
  reporterDetail?: string;
  reporterGang?: string;
  accusedGang?: string;
  clips?: Clip[];
  suspects: Suspect[];
  source?: string;
  ref?: string;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let data: unknown = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = data as { error?: string } | null;
    throw new Error(err?.error || `request failed (${res.status})`);
  }
  return data as T;
}

export function listCases(): Promise<Case[]> {
  return json<Case[]>('/api/cases', { cache: 'no-store' });
}

export function createCase(input: CaseInput): Promise<Case> {
  return json<Case>('/api/cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateCase(id: string, input: CaseInput): Promise<Case> {
  return json<Case>(`/api/cases/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteCase(id: string): Promise<{ ok: true; messages?: number; deleted?: number; failed?: number }> {
  return json<{ ok: true; messages?: number; deleted?: number; failed?: number }>(`/api/cases/${id}`, { method: 'DELETE' });
}

export function refreshEmbed(
  caseId: string,
  index: number,
  opts?: { batch?: string; end?: boolean },
): Promise<{ ok: true; link: string }> {
  const params = new URLSearchParams({ index: String(index) });
  if (opts?.batch) params.set('batch', opts.batch);
  if (opts?.end) params.set('end', '1');
  return json<{ ok: true; link: string }>(`/api/cases/${caseId}/embed?${params.toString()}`, { method: 'POST' });
}

export type QueueInfo = {
  status: 'uploading' | 'queued' | 'processing' | 'discord' | 'done' | 'error';
  position: number;
  total: number;
  elapsedMs: number;
};

export function uploadClip(
  file: File,
  opts: { trimStart: number; mark: number; content: string; batch?: string },
  onProgress?: (fraction: number) => void,
  onQueue?: (info: QueueInfo) => void,
): Promise<{ link: string; messageId: string }> {
  const jobId = `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-trim-start', String(opts.trimStart));
    xhr.setRequestHeader('x-trim-duration', '30');
    xhr.setRequestHeader('x-problem-at', String(opts.mark));
    xhr.setRequestHeader('x-content', encodeURIComponent(opts.content));
    xhr.setRequestHeader('x-job-id', jobId);
    if (opts.batch) xhr.setRequestHeader('x-batch-id', opts.batch);

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let polling = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/upload/job?id=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json() as { status?: QueueInfo['status']; position?: number; total?: number; elapsedMs?: number };
          if (data.status) {
            onQueue?.({
              status: data.status,
              position: data.position || 0,
              total: data.total || 0,
              elapsedMs: data.elapsedMs || 0,
            });
          }
        }
      } catch { /* network hiccup — try again next tick */ }
      if (!stopped) timer = setTimeout(poll, 1000);
    };

    const startPolling = () => {
      if (stopped || polling) return;
      polling = true;
      void poll();
    };

    const cleanup = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };

    xhr.upload.onprogress = ev => {
      if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
      if (ev.lengthComputable && ev.loaded >= ev.total) startPolling();
    };
    xhr.upload.onload = startPolling;

    xhr.onload = () => {
      cleanup();
      let data: { ok?: boolean; link?: string; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status < 200 || xhr.status >= 300 || !data.ok || !data.link) {
        reject(new Error(data.error || 'อัปโหลดไม่สำเร็จ'));
        return;
      }
      // งานอัปโหลดจบแล้ว — ให้หน้าจอเปลี่ยนจาก "คุณอยู่ที่ …" เป็นขั้นตอนถัดไป
      onQueue?.({ status: 'done', position: 0, total: 0, elapsedMs: 0 });
      resolve({ link: data.link, messageId: '' });
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('เชื่อมต่อเซิร์ฟเวอร์อัปโหลดไม่ได้'));
    };
    xhr.send(file);
  });
}
