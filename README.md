# Case Tracker

ระบบตรวจเคส + รับแจ้งเหตุ — Next.js 15 + TypeScript + Tailwind 4 + Elysia
ข้อมูลเก็บใน **Google Sheets**, ไฟล์คลิปส่งเข้า **Discord** ผ่าน webhook

## โครงสร้าง

```
case-tracker/
├─ .env                     ← ความลับจริง (ไม่ commit)
├─ .env.example
├─ app/
│  ├─ cases/page.tsx        ← รายการเคส + เพิ่ม + ตรวจ + ลบ
│  ├─ report/page.tsx       ← ผู้เล่นแจ้งเหตุ (ตัด 30 วิ)
│  ├─ api/[[...slugs]]/     ← Elysia (cases CRUD, embed)
│  └─ api/upload/           ← รับไฟล์ → ffmpeg → Discord
├─ components/
│  ├─ Icon.tsx
│  └─ ClipEditor.tsx        ← ไทม์ไลน์ 30 วิ + จุดที่ตรวจสอบ
├─ lib/
│  ├─ shared/types.ts       ← ชนิดข้อมูล + สถานะ
│  └─ client/ (api, workflow)
├─ server/
│  ├─ config.ts
│  ├─ routes/ (health, cases)
│  └─ services/ (sheets, embed, discord, video)
├─ scripts/setup-sheet.mjs
└─ secrets/                 ← service account (gitignored)
```

## Google Sheets

สร้าง/ซ่อมแท็บ:
```powershell
npm run sheet:setup
```
แท็บ: `Cases`, `Suspects`, `Clips`, `Embeds`
- ต้องแชร์ชีตให้ service account เป็น **Editor**

## รัน

```powershell
npm install
npm run dev
```
- เว็บ: http://localhost:3000
- health: http://localhost:3000/api/health

## .env

```env
APP_URL=http://localhost:3000
DISCORD_WEBHOOK_URL=...
GOOGLE_JSON_KEY={"type":"service_account",...}   # บรรทัดเดียว
# หรือ GOOGLE_CREDENTIALS_FILE=C:\...\secrets\google-service-account.json
SHEET_ID=...
# FFMPEG_PATH=... (ถ้าไม่ใช้ ffmpeg-static)
```

## ฟีเจอร์ที่ทำงานแล้ว

- **ผู้เล่น** `/report`: กรอกข้อมูล → เลือกคลิป ≥30 วิ → ตัด 30 วิ + วางจุดที่ตรวจสอบ → ส่ง
  - สร้างเคสใน Sheets, โพสต์ embed, อัปโหลดคลิปเข้า Discord, patch ลิงก์กลับเข้า embed
- **เจ้าหน้าที่** `/cases`: รายการ/ค้นหา/กรอง/เรียง/แบ่งหน้า, เพิ่มเคส (หลายผู้ต้องสงสัย/หลายคลิป/อัปโหลด 30 วิ)
- **ตรวจเคส**: ผลตรวจ/พบอะไร/ผู้ตรวจ/หมายเหตุ → บันทึกลง Sheets + patch embed เดิม
- **ลบเคส** (ปุ่มถังขยะในการ์ดเคส)
- embed ใช้ fields + สีตามสถานะ + `<@id> · id` + ปิด mention ping

## ยังไม่ได้ทำ

- แก้ไขข้อมูลเคสย้อนหลัง (ชื่อ/DC/Identifier/คลิป) หลังสร้างแล้ว
- เพิ่ม/ลบ "หลักฐานการตรวจ" และปุ่มคัดลอก ID
- ลบข้อความ Discord เมื่อลบคลิป/เคส
- ระบบล็อกอิน/สิทธิ์เจ้าหน้าที่
- rate limit / CSRF / audit log
- คิวงาน ffmpeg (ตอนนี้ประมวลผลใน request)

## หมายเหตุ production

- `ffmpeg-static` ไม่ถูก trace เข้า `.next/standalone` — ต้องคัดลอกไบนารีและตั้ง `FFMPEG_PATH`
- Google Sheets จำกัด ~60 คำขอ/นาที/ผู้ใช้ — เหมาะกับทีมเล็ก
- ควร regenerate webhook ที่เคยหลุดในแชท
