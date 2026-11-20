/* One-off migration: old 4-tab layout → single Cases tab.
 *
 *   $env:SHEET_ID=... $env:GOOGLE_CREDENTIALS_FILE=...
 *   node scripts/migrate-single-tab.mjs
 */

import fs from 'node:fs';
import { google } from 'googleapis';

const SHEET_ID = process.env.SHEET_ID;
if (!SHEET_ID) throw new Error('missing SHEET_ID');

function credentials() {
  if (process.env.GOOGLE_JSON_KEY) return JSON.parse(process.env.GOOGLE_JSON_KEY);
  return JSON.parse(fs.readFileSync(process.env.GOOGLE_CREDENTIALS_FILE, 'utf8'));
}

const auth = new google.auth.JWT({
  email: credentials().client_email,
  key: credentials().private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const HEADERS = [
  'เลขเคส', 'วันที่ลงเคส', 'ID DC ผู้แจ้ง', 'รายละเอียดผู้แจ้ง',
  'ลำดับ', 'ชื่อผู้ต้องสงสัย', 'ID DC ผู้ต้องสงสัย', 'Steam',
  'รายละเอียดผู้ต้องสงสัย', 'คลิป', 'ผลตรวจ', 'ผู้ตรวจ',
  'พบอะไร', 'หมายเหตุ', 'embedId', 'embedUrl',
];

const clock = sec => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
};
const date = ms => {
  const d = new Date(Number(ms) || Date.now());
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const statusLabel = s => ({ ok: 'ปกติ', bad: 'พบปัญหา', new: 'กำลังตรวจ' }[s] || 'รอตรวจ');
const clipCell = clips => clips.map(c => `${c.url} | ${c.mark == null || c.mark === '' ? '-' : clock(c.mark)}`).join('\n');

async function values(range) {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
    return r.data.values || [];
  } catch {
    return [];
  }
}

async function main() {
  const oldCases = await values('Cases!A2:G');
  const suspects = await values('Suspects!A2:J');
  const clips = await values('Clips!A2:E');
  const embeds = await values('Embeds!A2:D');

  // Guild id is not stored per row; ask the webhook once.
  let guild = '';
  try {
    const wh = process.env.DISCORD_WEBHOOK_URL;
    if (wh) {
      const res = await fetch(wh);
      if (res.ok) guild = (await res.json()).guild_id || '';
    }
  } catch { /* ignore */ }

  const rows = [];

  for (const c of oldCases) {
    const no = Number(c[1]);
    if (!no) continue;
    const caseId = c[0];
    const base = [String(no), date(c[5]), c[2] || '', c[3] || ''];

    const repClips = clips.filter(x => x[1] === `rep:${caseId}`).map(x => ({ url: x[2], mark: x[3] }));
    if (repClips.length) {
      rows.push([...base, '0', 'ผู้แจ้ง', '', '', '', clipCell(repClips), '', '', '', '', '', '', '']);
    }

    const list = suspects.filter(s => s[1] === caseId);
    list.forEach((s, i) => {
      const sid = s[0];
      const sc = clips.filter(x => x[1] === sid).map(x => ({ url: x[2], mark: x[3] }));
      const em = embeds.find(e => e[0] === sid);
      const link = em && em[1] && guild && em[2] ? `https://discord.com/channels/${guild}/${em[2]}/${em[1]}` : '';
      rows.push([
        ...base,
        String(i + 1),
        s[2] || '', s[3] || '', s[4] || '', s[5] || '',
        clipCell(sc),
        statusLabel(s[6]),
        s[7] || '', s[8] || '', s[9] || '',
        em ? em[1] : '',
        link,
      ]);
    });
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: 'Cases!A2:P' });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Cases!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS, ...rows] },
  });
  console.log(`migrated ${oldCases.length} case(s), ${rows.length} row(s)`);

  // Drop the old tabs now that everything is in Cases.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const requests = (meta.data.sheets || [])
    .filter(s => ['Suspects', 'Clips', 'Embeds'].includes(s.properties.title))
    .map(s => ({ deleteSheet: { sheetId: s.properties.sheetId } }));
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests },
    });
    console.log('removed old tabs');
  }
}

main().catch(err => {
  console.error('failed:', err.message);
  process.exit(1);
});
