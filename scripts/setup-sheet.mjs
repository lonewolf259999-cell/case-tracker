/* Creates the single Cases tab used by the app and keeps its columns tidy.
 *
 *   $env:SHEET_ID="..."
 *   $env:GOOGLE_CREDENTIALS_FILE="C:\path\to\service-account.json"
 *   node scripts/setup-sheet.mjs
 *
 * One row = one suspect. The suspect order comes from the case label
 * (1041, 1041-2, 1041-3 …), so there is no separate "ลำดับ" column.
 */

import fs from 'node:fs';
import { google } from 'googleapis';

const SHEET_ID = process.env.SHEET_ID || '';
if (!SHEET_ID) {
  console.error('missing SHEET_ID');
  process.exit(1);
}

function credentials() {
  if (process.env.GOOGLE_JSON_KEY) return JSON.parse(process.env.GOOGLE_JSON_KEY);
  const file = process.env.GOOGLE_CREDENTIALS_FILE;
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error('set GOOGLE_JSON_KEY or GOOGLE_CREDENTIALS_FILE');
}

const HEADERS = [
  'เลขเคส', 'วันที่ลงเคส', 'ID DC ผู้แจ้ง',
  'กลุ่มผู้แจ้ง', 'กลุ่มผู้ต้องสงสัย', 'รายละเอียดผู้แจ้ง',
  'ชื่อผู้ต้องสงสัย', 'ID DC ผู้ต้องสงสัย', 'Steam',
  'รายละเอียดผู้ต้องสงสัย', 'คลิป', 'ผลตรวจ', 'ผู้ตรวจ',
  'พบอะไร', 'หมายเหตุ', 'embedId', 'embedUrl',
];

/* เดิมมีคอลัมน์ "ลำดับ" (E) และกลุ่มอยู่ท้ายตาราง (Q/R) */
const LEGACY_HEADERS = [
  'เลขเคส', 'วันที่ลงเคส', 'ID DC ผู้แจ้ง', 'รายละเอียดผู้แจ้ง',
  'ลำดับ', 'ชื่อผู้ต้องสงสัย', 'ID DC ผู้ต้องสงสัย', 'Steam',
  'รายละเอียดผู้ต้องสงสัย', 'คลิป', 'ผลตรวจ', 'ผู้ตรวจ',
  'พบอะไร', 'หมายเหตุ', 'embedId', 'embedUrl',
  'กลุ่มผู้แจ้ง', 'กลุ่มผู้ต้องสงสัย',
];

const auth = new google.auth.JWT({
  email: credentials().client_email,
  key: credentials().private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

function sameRow(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** แปลงแถวรูปแบบเดิม → รูปแบบใหม่ (ตัด "ลำดับ" ออก, ย้ายกลุ่มมาไว้ต้นตาราง) */
function migrateLegacyRow(r) {
  const order = Number((r[4] || '0').trim());
  if (order === 0) return null; // แถวคลิปของผู้แจ้งแบบเดิม
  return [
    r[0] || '', r[1] || '', r[2] || '',
    r[16] || '', r[17] || '', r[3] || '',
    r[5] || '', r[6] || '', r[7] || '', r[8] || '',
    r[9] || '', r[10] || '', r[11] || '', r[12] || '', r[13] || '',
    r[14] || '', r[15] || '',
  ];
}

async function main() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const tabs = meta.data.sheets || [];
  const byName = new Map(tabs.map(s => [s.properties?.title, s]));

  if (!byName.has('Cases')) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Cases' } } }] },
    });
    console.log('created tab: Cases');
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Cases!A1:Z',
  });
  const all = res.data.values || [];
  const header = (all[0] || []).map(v => String(v ?? ''));
  const dataRows = all.slice(1).filter(r => r.some(v => String(v ?? '').trim()));

  const headersOk = sameRow(header.slice(0, HEADERS.length), HEADERS) && !header.slice(HEADERS.length).some(Boolean);
  const isLegacy = sameRow(header.slice(0, LEGACY_HEADERS.length), LEGACY_HEADERS);

  if (headersOk) {
    console.log('headers already match');
  } else {
    let rows = [];

    if (dataRows.length) {
      if (isLegacy) {
        rows = dataRows.map(migrateLegacyRow).filter(Boolean);
        console.log(`migrated ${rows.length}/${dataRows.length} rows`);
      } else {
        rows = dataRows.map(r => Array.from({ length: HEADERS.length }, (_, i) => r[i] || ''));
        console.log(`rewrote ${rows.length} rows`);
      }
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'Cases!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });

    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: 'Cases!A2',
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
    }

    // ล้างคอลัมน์เกิน (R ขึ้นไป) ทั้งแถวหัวตารางและข้อมูลเดิม
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: 'Cases!R1:Z',
    });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `Cases!A${rows.length + 2}:Q`,
    });

    console.log('headers written:', HEADERS.length, 'columns (A–Q)');
  }

  const meta2 = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const cases = meta2.data.sheets?.find(s => s.properties?.title === 'Cases');
  if (cases) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: cases.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true },
                  backgroundColor: { red: 0.9, green: 0.93, blue: 1 },
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId: cases.properties.sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
        ],
      },
    });
  }

  console.log('done:', `https://docs.google.com/spreadsheets/d/${SHEET_ID}`);
}

main().catch(err => {
  console.error('failed:', err.message);
  if (err.code === 403) console.error('share the spreadsheet with the service account (Editor)');
  process.exit(1);
});
