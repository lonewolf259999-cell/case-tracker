import type { Case, Clip, Suspect } from '@/lib/shared/types';
import { suspectLabel } from '@/lib/shared/types';
import { createCase, refreshEmbed, updateCase, uploadClip } from '@/lib/client/api';
import type { QueueInfo } from '@/lib/client/api';

export type Staged = { file: File; trimStart: number; mark: number };
export type DraftClip = { url: string; staged: Staged | null; mark?: number };
export type DraftSuspect = {
  name: string;
  dcId: string;
  identifier: string;
  detail: string;
  clips: DraftClip[];
};

function toLinks(clips: DraftClip[]): Clip[] {
  return clips
    .filter(c => !c.staged && c.url.trim())
    .map(c => ({ url: c.url.trim(), mark: c.mark }));
}

/** สร้างเคสใหม่ + อัปโหลดคลิปที่เตรียมไว้ + โพสต์ embed */
export async function submitCase(opts: {
  reporterDcId: string;
  reporterDetail: string;
  reporterGang?: string;
  accusedGang?: string;
  suspects: DraftSuspect[];
  reporterClips?: DraftClip[];
  source?: string;
  ref?: string;
  onProgress?: (msg: string, pct?: number) => void;
  onQueue?: (info: QueueInfo) => void;
}): Promise<Case> {
  const { reporterDcId, reporterDetail, reporterGang, accusedGang, suspects, reporterClips = [], source, ref, onProgress, onQueue } = opts;

  onProgress?.('กำลังสร้างเคส...', 2);
  let current = await createCase({
    reporterDcId,
    reporterDetail,
    reporterGang: reporterGang || '',
    accusedGang: accusedGang || '',
    source,
    ref,
    clips: toLinks(reporterClips),
    suspects: suspects.map(s => ({
      name: s.name,
      dcId: s.dcId,
      identifier: s.identifier,
      detail: s.detail,
      clips: toLinks(s.clips),
      status: 'todo' as const,
    })),
  });

  // จัดกลุ่มข้อความ Discord ของเคสนี้ให้ออกติดกัน
  const batch = `case_${current.id}_${Date.now().toString(36)}`;

  const total = suspects.reduce((n, s) => n + s.clips.filter(c => c.staged).length, 0);
  let done = 0;

  for (let i = 0; i < suspects.length; i++) {
    const staged = suspects[i].clips.filter(c => c.staged);
    const lastSuspect = i === suspects.length - 1;

    // สร้าง embed ทุกคนเสมอ เพื่อให้ข้อมูลกลุ่ม/ผู้แจ้งขึ้นใน Discord แม้ไม่มีคลิป
    onProgress?.(`กำลังส่ง embed · ผู้ต้องสงสัย ${i + 1}`);
    const em = await refreshEmbed(current.id, i, { batch, end: lastSuspect && !staged.length });
    if (!staged.length) continue;

    const label = suspectLabel(current.no, current.suspects.length, i);
    const added: Clip[] = [];

    for (const c of staged) {
      const p = c.staged!;
      onProgress?.(`กำลังอัปโหลด ${done + 1}/${total}`, 5 + (done / Math.max(1, total)) * 85);
      const up = await uploadClip(
        p.file,
        {
          trimStart: p.trimStart,
          mark: p.mark,
          content: `-# ↩︎ ตอบกลับ [เคส #${label}](${em.link})`,
          batch,
        },
        f => onProgress?.(
          `กำลังอัปโหลด ${done + 1}/${total} · ${Math.round(f * 100)}%`,
          5 + ((done + f) / Math.max(1, total)) * 85,
        ),
        onQueue,
      );
      added.push({ url: up.link, mark: p.mark });
      done += 1;
    }

    const s = current.suspects[i];
    s.clips = [...s.clips, ...added];

    onProgress?.(`กำลังอัปเดตลิงก์ · ผู้ต้องสงสัย ${i + 1}`, 92);
    current = await updateCase(current.id, { ...current, suspects: current.suspects });
    await refreshEmbed(current.id, i, { batch, end: lastSuspect });
  }

  return current;
}

/** บันทึกการแก้ไขเคสเดิม (ข้อมูล + คลิปที่เพิ่งอัปโหลด) แล้วอัปเดต embed */
export async function saveCaseEdits(
  caseId: string,
  opts: {
    reporterDcId: string;
    reporterDetail: string;
    reporterGang?: string;
    accusedGang?: string;
    suspects: DraftSuspect[];
    original: Case;
    onProgress?: (msg: string, pct?: number) => void;
    onQueue?: (info: QueueInfo) => void;
  },
): Promise<Case> {
  const { reporterDcId, reporterDetail, reporterGang, accusedGang, suspects, original, onProgress, onQueue } = opts;

  const baseSuspects = suspects.map((s, i) => {
    const prev = original.suspects[i] || ({} as Suspect);
    return {
      ...prev,
      name: s.name,
      dcId: s.dcId,
      identifier: s.identifier,
      detail: s.detail,
      clips: toLinks(s.clips),
      status: prev.status || 'todo',
    };
  });

  onProgress?.('กำลังบันทึกข้อมูล...', 3);
  let current = await updateCase(caseId, {
    reporterDcId,
    reporterDetail,
    reporterGang: reporterGang ?? original.reporterGang,
    accusedGang: accusedGang ?? original.accusedGang,
    clips: original.clips,
    suspects: baseSuspects,
  });

  const batch = `case_${current.id}_${Date.now().toString(36)}`;

  const total = suspects.reduce((n, s) => n + s.clips.filter(c => c.staged).length, 0);
  let done = 0;

  const withClips: number[] = [];
  const withoutClips: number[] = [];
  for (let i = 0; i < suspects.length; i++) {
    if (suspects[i].clips.some(c => c.staged)) withClips.push(i);
    else withoutClips.push(i);
  }
  const lastIndex = withoutClips.length
    ? withoutClips[withoutClips.length - 1]
    : (withClips.length ? withClips[withClips.length - 1] : -1);

  for (const i of withClips) {
    const staged = suspects[i].clips.filter(c => c.staged);

    // ถ้ามี embed อยู่แล้ว ใช้ลิงก์เดิมได้เลย ไม่ต้อง patch ก่อนอัปโหลด
    const prev = current.suspects[i];
    let embedLink = prev?.embedUrl || '';
    if (!prev?.embedId || !embedLink) {
      onProgress?.(`กำลังส่ง embed · ผู้ต้องสงสัย ${i + 1}`);
      const em = await refreshEmbed(current.id, i, { batch });
      embedLink = em.link;
    }

    const label = suspectLabel(current.no, current.suspects.length, i);
    const added: Clip[] = [];

    for (const c of staged) {
      const p = c.staged!;
      onProgress?.(`กำลังอัปโหลด ${done + 1}/${total}`, 5 + (done / Math.max(1, total)) * 85);
      const up = await uploadClip(
        p.file,
        {
          trimStart: p.trimStart,
          mark: p.mark,
          content: `-# ↩︎ ตอบกลับ [เคส #${label}](${embedLink})`,
          batch,
        },
        f => onProgress?.(
          `กำลังอัปโหลด ${done + 1}/${total} · ${Math.round(f * 100)}%`,
          5 + ((done + f) / Math.max(1, total)) * 85,
        ),
        onQueue,
      );
      added.push({ url: up.link, mark: p.mark });
      done += 1;
    }

    current.suspects[i].clips = [...current.suspects[i].clips, ...added];
    current = await updateCase(current.id, { ...current, suspects: current.suspects });
    await refreshEmbed(current.id, i, {
      batch,
      end: withoutClips.length === 0 && i === lastIndex,
    });
  }

  // patch เฉพาะคนที่ยังไม่ได้ patch (ไม่มีคลิปใหม่) — กันการแก้ embed ซ้ำซ้อน
  for (const i of withoutClips) {
    try {
      await refreshEmbed(current.id, i, { batch, end: i === lastIndex });
    } catch { /* ignore */ }
  }

  return current;
}
