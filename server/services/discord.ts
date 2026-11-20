/* Discord webhook helpers. Server-only: the webhook URL is a bearer credential.
   All sends go through a single queue and retry 429 using Discord's retry_after. */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/server/config';
import { enqueueDiscord, sleep } from '@/server/services/queue';

export interface SentMessage {
  id: string;
  link: string;
}

/** ใช้จัดกลุ่มข้อความของเคสเดียวกันให้ออกติดกัน */
export type DiscordGroup = { batch?: string; end?: boolean };

function groupOf(group?: DiscordGroup): { batch: string; end: boolean } {
  if (group?.batch) return { batch: group.batch.slice(0, 80), end: !!group.end };
  return {
    batch: `one_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    end: true,
  };
}

function hook(): string {
  const url = config.discordWebhook;
  if (!url) throw new Error('DISCORD_WEBHOOK_URL is not configured');
  return url + (url.includes('?') ? '&' : '?') + 'wait=true';
}

const cache = { guild: '', channel: '', at: 0 };

export async function webhookChannel(): Promise<{ guild: string; channel: string }> {
  if (cache.channel && Date.now() - cache.at < 10 * 60_000) {
    return { guild: cache.guild, channel: cache.channel };
  }
  try {
    const res = await fetch(config.discordWebhook);
    if (res.ok) {
      const data = await res.json() as { guild_id?: string; channel_id?: string };
      cache.guild = data.guild_id || '';
      cache.channel = data.channel_id || '';
      cache.at = Date.now();
    }
  } catch { /* ignore */ }
  return { guild: cache.guild, channel: cache.channel };
}

export async function linkOf(messageId: string): Promise<string> {
  const { guild, channel } = await webhookChannel();
  return guild && channel && messageId
    ? `https://discord.com/channels/${guild}/${channel}/${messageId}`
    : '';
}

function errorText(data: { message?: string }, status: number, text: string): string {
  return data.message || text.slice(0, 300) || `Discord ${status}`;
}

/** fetch + retry เมื่อ Discord ตอบ 429 หรือเซิร์ฟเวอร์สะดุด */
async function fetchRetry(url: string, makeInit: () => RequestInit): Promise<{ res: Response; text: string }> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < 6; attempt++) {
    let res: Response;
    let text: string;

    try {
      res = await fetch(url, makeInit());
      text = await res.text();
    } catch (err) {
      // เน็ตหลุด/เชื่อมต่อไม่ได้ → ลองใหม่
      lastErr = err;
      await sleep(Math.min(20_000, 600 * 2 ** attempt) + Math.round(Math.random() * 250));
      continue;
    }

    if (res.status === 429) {
      let wait = 1500;
      try {
        const data = JSON.parse(text) as { retry_after?: number };
        if (typeof data.retry_after === 'number') wait = Math.min(30_000, data.retry_after * 1000 + 250);
      } catch {
        const header = Number(res.headers.get('retry-after') || 0);
        if (header > 0) wait = Math.min(30_000, header * 1000 + 250);
      }
      await sleep(wait);
      continue;
    }

    if (res.status >= 500) {
      lastErr = new Error(`Discord ${res.status}`);
      await sleep(Math.min(20_000, 800 * 2 ** attempt) + Math.round(Math.random() * 250));
      continue;
    }

    return { res, text };
  }

  throw lastErr instanceof Error ? lastErr : new Error('Discord ไม่ตอบสนอง — ลองใหม่แล้วยังไม่สำเร็จ');
}

export async function sendEmbed(embed: unknown, group?: DiscordGroup): Promise<SentMessage> {
  const g = groupOf(group);
  return enqueueDiscord(g.batch, async () => {
    const body = JSON.stringify({
      username: 'Case Tracker',
      embeds: [embed],
      allowed_mentions: { parse: [] },
    });

    const { res, text } = await fetchRetry(hook(), () => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }));

    let data: { id?: string; message?: string } = {};
    try { data = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok) throw new Error(errorText(data, res.status, text));
    return { id: data.id || '', link: await linkOf(data.id || '') };
  }, g.end);
}

export async function patchEmbed(messageId: string, embed: unknown, group?: DiscordGroup): Promise<SentMessage> {
  const base = config.discordWebhook.replace(/\?.*$/, '');
  const body = JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } });
  const g = groupOf(group);

  return enqueueDiscord(g.batch, async () => {
    const { res, text } = await fetchRetry(`${base}/messages/${messageId}`, () => ({
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body,
    }));

    let data: { id?: string; message?: string } = {};
    try { data = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok) throw new Error(errorText(data, res.status, text));
    return { id: data.id || messageId, link: await linkOf(data.id || messageId) };
  }, g.end);
}

export async function uploadFile(file: string, filename: string, content?: string, group?: DiscordGroup): Promise<SentMessage> {
  const g = groupOf(group);
  return enqueueDiscord(g.batch, async () => {
    // ใช้ Blob ที่ผูกกับไฟล์ (ไม่อ่านทั้งไฟล์เข้า RAM)
    const blob = await fs.openAsBlob(file, { type: 'video/mp4' });

    const { res, text } = await fetchRetry(hook(), () => {
      const fd = new FormData();
      const payload: Record<string, unknown> = {
        username: 'Case Tracker',
        attachments: [{ id: 0, filename }],
      };
      if (content) payload.content = content.slice(0, 1900);
      fd.append('payload_json', JSON.stringify(payload));
      fd.append('files[0]', blob, filename);
      return { method: 'POST', body: fd };
    });

    let data: { id?: string; message?: string } = {};
    try { data = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok) throw new Error(errorText(data, res.status, text));
    return { id: data.id || '', link: await linkOf(data.id || '') };
  }, g.end);
}

/** ลบข้อความที่ webhook สร้าง (embed หรือไฟล์คลิป) — 404 ถือว่าลบแล้ว */
export async function deleteMessage(messageId: string, group?: DiscordGroup): Promise<void> {
  if (!messageId) return;
  const base = config.discordWebhook.replace(/\?.*$/, '');
  const g = groupOf(group);

  await enqueueDiscord(g.batch, async () => {
    const { res, text } = await fetchRetry(`${base}/messages/${messageId}`, () => ({ method: 'DELETE' }));

    if (res.status === 404 || res.status === 204 || res.ok) return;

    let data: { message?: string } = {};
    try { data = JSON.parse(text); } catch { /* ignore */ }
    throw new Error(errorText(data, res.status, text));
  }, g.end);
}

export function safeName(name: string): string {
  return (path.basename(name || 'clip.mp4').replace(/[^\w.\-]+/g, '_') || 'clip.mp4');
}
