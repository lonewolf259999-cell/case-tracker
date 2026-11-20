'use client';

import { useEffect, useState } from 'react';
import type { QueueInfo } from '@/lib/client/api';

const LABEL: Record<QueueInfo['status'], string> = {
  uploading: 'กำลังส่งข้อมูลขึ้นเซิร์ฟเวอร์',
  queued: 'รอคิวประมวลผล',
  processing: 'กำลังตัดต่อคลิป',
  discord: 'กำลังส่งเข้า Discord',
  done: 'เสร็จแล้ว',
  error: 'เกิดข้อผิดพลาด',
};

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** แสดงคิว/ตำแหน่งระหว่างส่งข้อมูล เพื่อให้รู้ว่าระบบยังทำงานอยู่ */
export function QueueOverlay({
  info,
  startedAt = 0,
  message = '',
}: {
  info: QueueInfo | null;
  startedAt?: number;
  message?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!info) return null;

  const total = Math.max(info.total, info.position, 1);
  const waiting = Math.max(0, info.position - 1);
  const pct = info.position > 0
    ? Math.min(100, Math.max(6, Math.round(((total - info.position) / total) * 100)))
    : 0;
  const elapsed = Math.max(info.elapsedMs || 0, startedAt ? now - startedAt : 0);
  const indeterminate = info.position === 0 && info.status === 'uploading';

  return (
    <div className="qov" role="status" aria-live="polite">
      <div className="qov-card">
        <div className="qspin" aria-hidden="true" />

        <h3>มีผู้ใช้งานจำนวนมาก</h3>
        <p className="qsub">กรุณารอตามคิว</p>

        {info.position > 0 ? (
          <div className="qpos">
            <span>คุณอยู่ที่</span>
            <strong>{info.position}</strong>
            <span className="qof">/ {total}</span>
          </div>
        ) : (
          <div className="qpos qpos-now">
            <strong>{info.status === 'uploading' ? 'กำลังดำเนินการ…' : 'ถึงคิวคุณแล้ว'}</strong>
          </div>
        )}

        <div className={`qbar${indeterminate ? ' indet' : ''}`}>
          {indeterminate ? <i /> : <i style={{ width: `${pct}%` }} />}
        </div>

        <p className="qhint">
          {info.position > 1
            ? `เหลืออีก ${waiting} คิว · ${LABEL[info.status]}`
            : (message || LABEL[info.status])}
        </p>
        <p className="qtime">ใช้เวลา {clock(elapsed)}</p>
      </div>
    </div>
  );
}
