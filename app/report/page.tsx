'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { QueueOverlay } from '@/components/QueueOverlay';
import { ClipEditor, CLIP_SEC } from '@/components/ClipEditor';
import type { ClipChoice } from '@/components/ClipEditor';
import { fmtClock } from '@/lib/shared/types';
import { submitCase } from '@/lib/client/workflow';
import type { DraftClip, DraftSuspect } from '@/lib/client/workflow';
import type { QueueInfo } from '@/lib/client/api';

type Picked = { si: number; ci: number; file: File; url: string; duration: number };

function emptySuspect(): DraftSuspect {
  return { name: '', dcId: '', identifier: '', detail: '', clips: [{ url: '', staged: null }] };
}

export default function ReportPage() {
  const [repDc, setRepDc] = useState('');
  const [repDetail, setRepDetail] = useState('');
  const [repGang, setRepGang] = useState('');
  const [accusedGang, setAccusedGang] = useState('');
  const [suspects, setSuspects] = useState<DraftSuspect[]>([emptySuspect()]);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [queueMsg, setQueueMsg] = useState('');
  const [queueAt, setQueueAt] = useState(0);
  const [sent, setSent] = useState<{ no: number } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<{ si: number; ci: number } | null>(null);

  const s = suspects[active];

  function notify(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3000);
  }

  function patchSuspect(p: Partial<DraftSuspect>) {
    setSuspects(list => list.map((x, i) => (i === active ? { ...x, ...p } : x)));
  }

  function patchClip(ci: number, p: Partial<DraftClip>) {
    patchSuspect({ clips: s.clips.map((c, i) => (i === ci ? { ...c, ...p } : c)) });
  }

  function addSuspect() {
    setSuspects(list => [...list, emptySuspect()]);
    setActive(suspects.length);
  }

  function removeSuspect(i: number) {
    if (suspects.length <= 1) return;
    setSuspects(list => list.filter((_, idx) => idx !== i));
    setActive(Math.max(0, Math.min(active > i ? active - 1 : active, suspects.length - 2)));
  }

  function pickFile(si: number, ci: number) {
    targetRef.current = { si, ci };
    fileRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = targetRef.current;
    if (!file || !target) return;

    if (!file.type.startsWith('video/')) { notify('เลือกไฟล์วิดีโอเท่านั้น'); return; }
    if (file.size > 1024 * 1024 * 1024) { notify('ไฟล์ใหญ่เกิน 1 GB'); return; }

    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = url;
    probe.onloadedmetadata = () => {
      const duration = probe.duration || 0;
      if (!duration) { notify('อ่านความยาวคลิปไม่ได้'); URL.revokeObjectURL(url); return; }
      if (duration < CLIP_SEC - 0.05) {
        URL.revokeObjectURL(url);
        notify(`คลิปต้องยาวอย่างน้อย 30 วินาที (ไฟล์นี้ ${fmtClock(duration)})`);
        return;
      }
      setPicked({ ...target, file, url, duration });
    };
    probe.onerror = () => { URL.revokeObjectURL(url); notify('เปิดไฟล์วิดีโอไม่ได้'); };
  }

  function stage(v: ClipChoice) {
    if (!picked) return;
    const { si, ci, file, url } = picked;
    setSuspects(list => list.map((sp, i) => (i !== si ? sp : {
      ...sp,
      clips: sp.clips.map((c, j) => (j === ci ? { ...c, staged: { file, trimStart: v.start, mark: v.rel } } : c)),
    })));
    URL.revokeObjectURL(url);
    setPicked(null);
    notify(`เตรียมคลิปแล้ว · จุดที่ตรวจสอบ ${fmtClock(v.rel)}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!/^\d{5,25}$/.test(repDc.trim())) { notify('ใส่ ID DC ผู้แจ้ง'); return; }

    const staged = suspects.reduce((n, sp) => n + sp.clips.filter(c => c.staged).length, 0);
    if (!staged) { notify('ต้องมีคลิปที่ตัด 30 วินาทีขึ้นไปอย่างน้อย 1 คลิป'); return; }

    setSaving(true);
    setQueue({ status: 'uploading', position: 0, total: 0, elapsedMs: 0 });
    setQueueMsg('กำลังสร้างเคส…');
    setQueueAt(Date.now());
    try {
      const c = await submitCase({
        reporterDcId: repDc.trim(),
        reporterDetail: repDetail,
        reporterGang: repGang,
        accusedGang,
        suspects,
        onProgress: msg => { setQueueMsg(msg); notify(msg); },
        onQueue: setQueue,
      });
      setSent({ no: c.no });
    } catch (err) {
      notify('ส่งไม่สำเร็จ: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setQueue(null);
      setQueueMsg('');
      setSaving(false);
    }
  }

  if (sent) {
    return (
      <div className="report-wrap">
        <div className="report-brand">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <div>
            <h1>แจ้งเหตุ</h1>
            <p>ส่งเรื่องเรียบร้อย</p>
          </div>
        </div>

        <div className="sheet" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
          <div className="sh-head" style={{ justifyContent: 'center' }}>
            <h2>ส่งเรื่องเรียบร้อย</h2>
          </div>
          <p style={{ fontSize: 14, color: '#c9d7ee' }}>เคส #{sent.no}</p>
          <div className="sh-actions" style={{ justifyContent: 'center' }}>
            <Link href="/cases" className="btn">รายการเคส</Link>
            <button className="btn primary" type="button" onClick={() => location.reload()}>แจ้งใหม่</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="report-wrap">
      <div className="report-brand">
        <div className="logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <div>
          <h1>แจ้งเหตุ</h1>
          <p>เลือกคลิป 30 วิ · วางจุดที่ตรวจสอบ</p>
        </div>
        <Link href="/cases" className="btn" style={{ marginLeft: 'auto', height: 36, fontSize: 12.5 }}>
          รายการเคส
        </Link>
      </div>

      <form className="sheet" onSubmit={submit} style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="fgroup">
          <div className="fg-head">ผู้แจ้ง</div>
          <label className="lbl">ID DC <span className="req">*</span></label>
          <input className="inp mono" value={repDc} onChange={e => setRepDc(e.target.value)} placeholder="ID DC ของคุณ" inputMode="numeric" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <div>
              <div className="lbl" style={{ marginTop: 0 }}>กลุ่มผู้แจ้ง</div>
              <input className="inp" value={repGang} onChange={e => setRepGang(e.target.value)} placeholder="ไม่บังคับ" />
            </div>
            <div>
              <div className="lbl" style={{ marginTop: 0 }}>กลุ่มผู้ต้องสงสัย</div>
              <input className="inp" value={accusedGang} onChange={e => setAccusedGang(e.target.value)} placeholder="ไม่บังคับ" />
            </div>
          </div>

          <label className="lbl">รายละเอียด <span className="opt">ไม่บังคับ</span></label>
          <textarea className="inp area" rows={2} value={repDetail} onChange={e => setRepDetail(e.target.value)} placeholder="ชื่อในเกม / เซิร์ฟเวอร์" />
        </div>

        <div className="fgroup">
          <div className="fg-head">ผู้ต้องสงสัย</div>

          <div className="sus-nav">
            <div className="sus-tabs-wrap">
              <div className="sus-tabs">
                {suspects.map((_, i) => (
                  <div key={i} className={`sus-tab ${i === active ? 'on' : ''}`}>
                    <button className="sus-tab-pick" type="button" onClick={() => setActive(i)}>สงสัย {i + 1}</button>
                    {suspects.length > 1 && (
                      <button className="sus-tab-x" type="button" onClick={() => removeSuspect(i)}>×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <button className="sus-add" type="button" onClick={addSuspect}>
              <Icon name="plus" /> เพิ่มผู้ต้องสงสัย
            </button>
          </div>

          <label className="lbl">ชื่อ <span className="opt">ไม่บังคับ</span></label>
          <input className="inp" value={s.name} onChange={e => patchSuspect({ name: e.target.value })} placeholder="ชื่อผู้ต้องสงสัย" />

          <label className="lbl">ID DC <span className="opt">ไม่บังคับ</span></label>
          <input className="inp mono" value={s.dcId} onChange={e => patchSuspect({ dcId: e.target.value })} placeholder="ID DC" inputMode="numeric" />

          <label className="lbl">Identifier <span className="opt">ไม่บังคับ</span></label>
          <input className="inp mono" value={s.identifier} onChange={e => patchSuspect({ identifier: e.target.value })} placeholder="steam:..." />

          <label className="lbl">รายละเอียด <span className="opt">ไม่บังคับ</span></label>
          <textarea className="inp area" rows={2} value={s.detail} onChange={e => patchSuspect({ detail: e.target.value })} placeholder="พฤติการณ์" />

          <div className="lbl">คลิปหลักฐาน <span className="opt">อัปโหลดเท่านั้น · 30 วิขึ้นไป</span></div>
          {s.clips.map((c, ci) => (
            <div className="clipitem" key={ci}>
              <div className="cliprow">
                <div
                  className="inp mono"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: c.staged ? '#e7eefb' : '#6b7d9b',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {c.staged ? c.staged.file.name : 'ยังไม่ได้เลือกคลิป'}
                </div>
                <button className="ic" type="button" onClick={() => pickFile(active, ci)} title="อัปโหลด/ตัด 30 วิ">
                  <Icon name="upload" />
                </button>
                <button
                  className="ic"
                  type="button"
                  title="ลบ"
                  onClick={() => {
                    if (s.clips.length <= 1) { patchClip(ci, { url: '', staged: null }); return; }
                    patchSuspect({ clips: s.clips.filter((_, i) => i !== ci) });
                  }}
                >
                  <Icon name="close" />
                </button>
              </div>
              {c.staged && (
                <div className="clipnote" style={{ display: 'flex' }}>
                  <span className="okdot" />
                  <span>พร้อมส่ง · จุดที่ตรวจสอบ {fmtClock(c.staged.mark)} · {(c.staged.file.size / 1024 / 1024).toFixed(1)} MB</span>
                </div>
              )}
            </div>
          ))}
          <button className="addbtn" type="button" onClick={() => patchSuspect({ clips: [...s.clips, { url: '', staged: null }] })}>
            <Icon name="plus" /> เพิ่มคลิป
          </button>
        </div>

        <div className="sh-actions">
          <button className="btn primary grow" type="submit" disabled={saving}>
            {saving ? 'กำลังส่ง...' : 'ส่งเรื่อง'}
          </button>
        </div>
      </form>

      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />

      {picked && (
        <ClipEditor
          url={picked.url}
          duration={picked.duration}
          onCancel={() => { URL.revokeObjectURL(picked.url); setPicked(null); }}
          onUse={stage}
        />
      )}

      {queue && <QueueOverlay info={queue} startedAt={queueAt} message={queueMsg} />}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-[#2c3e5c] bg-[#121e33] px-4 py-2.5 text-xs text-[#e7eefb]">
          {toast}
        </div>
      )}
    </div>
  );
}
