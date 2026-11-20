export type Status = 'collect' | 'todo' | 'new' | 'bad' | 'ok';

export interface Clip {
  url: string;
  /** จุดที่พบปัญหา (วินาทีในช่วง 30 วิ) */
  mark?: number;
}

export interface Suspect {
  id?: string;
  name?: string;
  dcId?: string;
  identifier?: string;
  detail?: string;
  clips: Clip[];
  status: Status;
  inspector?: string;
  findings?: string;
  note?: string;
  embedUrl?: string;
  embedId?: string;
}

export interface Case {
  id: string;
  no: number;
  reporterDcId: string;
  reporterDetail?: string;
  reporterGang?: string;
  accusedGang?: string;
  clips: Clip[];
  suspects: Suspect[];
  createdAt: number;
  updatedAt: number;
  source?: string;
  ref?: string;
}

export const STATUS: Record<Status, { label: string; color: string; bg: string; bd: string }> = {
  collect: { label: 'รวบรวมข้อมูล', color: '#c4a6ff', bg: 'rgba(167,139,250,.14)', bd: 'rgba(167,139,250,.4)' },
  todo: { label: 'รอตรวจ', color: '#8fb0ff', bg: 'rgba(106,141,255,.15)', bd: 'rgba(106,141,255,.4)' },
  new:  { label: 'กำลังตรวจ', color: '#f6b73c', bg: 'rgba(246,183,60,.14)', bd: 'rgba(246,183,60,.38)' },
  bad:  { label: 'พบปัญหา', color: '#ff8d9c', bg: 'rgba(255,93,115,.14)', bd: 'rgba(255,93,115,.4)' },
  ok:   { label: 'ปกติ', color: '#6de3a4', bg: 'rgba(57,192,122,.14)', bd: 'rgba(57,192,122,.38)' },
};

export function hasIdentity(s: Suspect): boolean {
  return !!(s.name || '').trim() || !!(s.dcId || '').trim() || !!(s.identifier || '').trim();
}

export function caseStatus(c: Case): Status {
  const list = (c.suspects || []).map(s => s.status);
  if (list.includes('bad')) return 'bad';
  if (list.includes('new')) return 'new';

  // ยังไม่มีข้อมูลผู้ต้องสงสัยเลย (ชื่อ / ID DC / Identifier)
  if (!(c.suspects || []).some(hasIdentity)) return 'collect';

  if (list.includes('todo') || !list.length) return 'todo';
  return 'ok';
}

/** เลขเคสของผู้ต้องสงสัย: 1041-1, 1041-2 … (ถ้ามีคนเดียวใช้ 1041) */
export function suspectLabel(baseNo: number, total: number, index: number): string {
  return total > 1 ? `${baseNo}-${index + 1}` : String(baseNo);
}

export function caseInspector(c: Case): string {
  const names = (c.suspects || []).map(s => (s.inspector || '').trim()).filter(Boolean);
  return names[0] || '';
}

export function clipCount(c: Case): number {
  const rep = (c.clips || []).length;
  const sus = (c.suspects || []).reduce((n, s) => n + (s.clips || []).length, 0);
  return rep + sus;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, sec || 0);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "5 นาที", "3 ชม.", "2 วัน" — อ่านเร็ว ไม่ต้องมีคำเยอะ */
export function ago(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'เมื่อกี้';
  if (min < 60) return `${min} นาที`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} วัน`;
  return fmtDateTime(ms);
}
