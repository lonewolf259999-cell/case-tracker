import { Elysia } from 'elysia';
import { createCase, deleteCase, getCase, listCases, updateCase } from '@/server/services/sheets';
import type { CaseInput } from '@/server/services/sheets';
import type { Case } from '@/lib/shared/types';
import { buildSuspectEmbed } from '@/server/services/embed';
import { deleteMessage, patchEmbed, sendEmbed, webhookChannel } from '@/server/services/discord';

/** ดึง message id ของ embed/คลิปที่เป็นลิงก์ Discord ของช่องนี้ */
function messageIdFromUrl(url: string, channel: string): string | null {
  const m = String(url || '').match(/\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  if (channel && m[2] !== channel) return null;
  return m[3];
}

function collectMessageIds(c: Case, channel: string): string[] {
  const clips = new Set<string>();
  const embeds = new Set<string>();

  for (const s of c.suspects || []) {
    if (s.embedId) embeds.add(s.embedId);
    for (const clip of s.clips || []) {
      const id = messageIdFromUrl(clip.url, channel);
      if (id) clips.add(id);
    }
  }
  for (const clip of c.clips || []) {
    const id = messageIdFromUrl(clip.url, channel);
    if (id) clips.add(id);
  }

  for (const id of embeds) clips.delete(id);
  return [...clips, ...embeds]; // ลบคลิปก่อน แล้วค่อยลบ embed
}

export const caseRoutes = new Elysia({ prefix: '/cases' })
  .get('/', () => listCases())

  .get('/:id', async ({ params, set }) => {
    const c = await getCase(params.id);
    if (!c) { set.status = 404; return { error: 'case not found' }; }
    return c;
  })

  .post('/', async ({ body }) => createCase(body as CaseInput))

  .patch('/:id', async ({ params, body }) => updateCase(params.id, body as CaseInput))

  .delete('/:id', async ({ params, set }) => {
    const c = await getCase(params.id);
    if (!c) { set.status = 404; return { error: 'case not found' }; }

    const { channel } = await webhookChannel();
    const ids = collectMessageIds(c, channel);
    const batch = `del_${c.id}_${Date.now().toString(36)}`;

    let deleted = 0;
    const failed: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      try {
        await deleteMessage(ids[i], { batch, end: i === ids.length - 1 });
        deleted += 1;
      } catch {
        failed.push(ids[i]);
      }
    }

    await deleteCase(c.id);

    return { ok: true, messages: ids.length, deleted, failed: failed.length };
  })

  /* Post or update the Discord embed of one suspect. */
  .post('/:id/embed', async ({ params, query, set }) => {
    const c = await getCase(params.id);
    if (!c) { set.status = 404; return { error: 'case not found' }; }

    const idx = Number(query.index ?? 0);
    const suspect = c.suspects[idx];
    if (!suspect) { set.status = 400; return { error: 'suspect not found' }; }

    const batch = typeof query.batch === 'string' ? query.batch : '';
    const group = batch ? { batch, end: query.end === '1' } : undefined;

    const embed = buildSuspectEmbed(c, suspect, idx);
    const isNew = !suspect.embedId;
    const sent = suspect.embedId
      ? await patchEmbed(suspect.embedId, embed, group)
      : await sendEmbed(embed, group);

    // เก็บลิงก์เฉพาะตอนสร้างใหม่ — patch ไม่ต้องเขียนชีตซ้ำ
    if (isNew) {
      suspect.embedId = sent.id;
      suspect.embedUrl = sent.link;
      await updateCase(c.id, { ...c, suspects: c.suspects });
    }

    return { ok: true, messageId: sent.id, link: sent.link };
  });
