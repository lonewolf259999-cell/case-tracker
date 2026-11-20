import type { Case, Clip, Suspect } from '@/lib/shared/types';
import { suspectLabel } from '@/lib/shared/types';

const STATUS_COLOR = { collect: 0x9b7bff, todo: 0x6a8dff, new: 0x6a8dff, bad: 0xff5d73, ok: 0x39c07a } as const;
const STATUS_ICON = { collect: '🟣', todo: '🔵', new: '🔵', bad: '🔴', ok: '🟢' } as const;
const STATUS_LABEL = { collect: 'รวบรวมข้อมูล', todo: 'รอตรวจ', new: 'กำลังตรวจ', bad: 'พบปัญหา', ok: 'ปกติ' } as const;

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function dateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dc(id?: string): string {
  return id ? `<@${id}> · ${id}` : '-';
}

function clipLine(c: Clip, i: number): string {
  if (c.mark == null) return `**คลิปที่ ${i + 1}:** ${c.url}`;
  return `**คลิปที่ ${i + 1}:** [${clock(c.mark)}](${c.url})`;
}

export function buildSuspectEmbed(c: Case, suspect: Suspect, index: number) {
  const st = suspect.status || 'todo';
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  const rep = [`**ID DC:** ${dc(c.reporterDcId)}`];
  if (c.reporterGang) rep.push(`**กลุ่มผู้แจ้ง:** ${c.reporterGang}`);
  if (c.accusedGang) rep.push(`**กลุ่มผู้ต้องสงสัย:** ${c.accusedGang}`);
  if (c.reporterDetail) rep.push(`**รายละเอียด:** ${c.reporterDetail.slice(0, 900)}`);
  fields.push({ name: '👤 ผู้แจ้ง', value: rep.join('\n'), inline: false });

  const s = [];
  if (suspect.name) s.push(`**ชื่อ:** ${suspect.name}`);
  if (suspect.dcId) s.push(`**ID DC:** ${dc(suspect.dcId)}`);
  if (suspect.identifier) s.push(`**Identifier:** ${suspect.identifier}`);
  if (suspect.detail) s.push(`**รายละเอียด:** ${suspect.detail.slice(0, 900)}`);
  fields.push({ name: `🕵️ ผู้ต้องสงสัย ${index + 1}`, value: s.join('\n') || '-', inline: false });

  if (suspect.clips.length) {
    fields.push({
      name: '🎯 จุดที่ตรวจสอบ',
      value: suspect.clips.map(clipLine).join('\n').slice(0, 1024),
      inline: false,
    });
  }

  if (st === 'ok' || st === 'bad') {
    fields.push({ name: '✅ ผลตรวจ', value: STATUS_LABEL[st], inline: true });
    fields.push({ name: '🧾 ผู้ตรวจ', value: (suspect.inspector || '-').slice(0, 200), inline: true });
    if (suspect.findings) {
      fields.push({ name: '📝 พบอะไร', value: suspect.findings.slice(0, 1024), inline: false });
    }
  }

  return {
    title: `${STATUS_ICON[st]} เคส #${suspectLabel(c.no, c.suspects.length, index)}`,
    color: STATUS_COLOR[st],
    fields,
    footer: { text: `📅 ลงเคสเมื่อ ${dateTime(c.createdAt)}` },
  };
}
