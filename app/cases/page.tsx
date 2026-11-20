'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ClipEditor, CLIP_SEC } from '@/components/ClipEditor';
import type { ClipChoice } from '@/components/ClipEditor';
import {
  STATUS, ago, caseInspector, caseStatus, clipCount, fmtClock, hasIdentity, suspectLabel,
  type Case, type Status, type Suspect,
} from '@/lib/shared/types';
import { deleteCase as apiDelete, listCases, refreshEmbed, updateCase } from '@/lib/client/api';
import { openDiscord } from '@/lib/client/discord';
import { submitCase, saveCaseEdits } from '@/lib/client/workflow';
import type { DraftClip, DraftSuspect } from '@/lib/client/workflow';
import type { QueueInfo } from '@/lib/client/api';
import { QueueOverlay } from '@/components/QueueOverlay';

type Filter = 'all' | Status;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'collect', label: 'รวบรวมข้อมูล' },
  { key: 'todo', label: 'รอตรวจ' },
  { key: 'new', label: 'กำลังตรวจ' },
  { key: 'bad', label: 'พบปัญหา' },
  { key: 'ok', label: 'ปกติ' },
];

const SORTS = [
  { value: 'smart', label: 'เร่งด่วน' },
  { value: 'recent', label: 'ล่าสุด' },
  { value: 'old', label: 'เก่าสุด' },
  { value: 'no', label: 'เลขเคส' },
];

const QUICK_FINDINGS = [
  'โปร/โปรแกรมช่วยเล่น',
  'ล็อกเป้า',
  'ลบไฟล์ก่อนตรวจ',
  'ออกเกมหนี',
];

export default function CasesPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('smart');
  const [size, setSize] = useState(20);
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Case | null>(null);
  const [editing, setEditing] = useState<Case | null>(null);
  const [toast, setToast] = useState('');
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [queueMsg, setQueueMsg] = useState('');
  const [queueAt, setQueueAt] = useState(0);
  const [deleting, setDeleting] = useState(false);

  function notify(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3000);
  }

  async function load() {
    setLoading(true);
    try {
      setCases(await listCases());
    } catch (err) {
      notify('โหลดข้อมูลไม่สำเร็จ: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: cases.length, collect: 0, todo: 0, new: 0, bad: 0, ok: 0 };
    cases.forEach(c => { out[caseStatus(c)] += 1; });
    return out;
  }, [cases]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = cases.filter(c => {
      if (filter !== 'all' && caseStatus(c) !== filter) return false;
      if (!term) return true;
      const hay = [
        c.no, c.reporterDcId, c.reporterDetail,
        ...c.suspects.map((_, i) => suspectLabel(c.no, c.suspects.length, i)),
        ...c.suspects.flatMap(s => [s.name, s.dcId, s.identifier, s.detail, s.findings, s.inspector]),
      ].join(' ').toLowerCase();
      return hay.includes(term);
    });

    const prio: Record<Status, number> = { collect: 0, todo: 1, new: 2, bad: 3, ok: 4 };
    return list.sort((a, b) => {
      if (sort === 'recent') return b.updatedAt - a.updatedAt;
      if (sort === 'old') return a.updatedAt - b.updatedAt;
      if (sort === 'no') return b.no - a.no;
      return prio[caseStatus(a)] - prio[caseStatus(b)] || b.updatedAt - a.updatedAt;
    });
  }, [cases, filter, q, sort]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * size;
  const items = rows.slice(start, start + size);

  async function handleCreate(payload: { repDc: string; repDetail: string; repGang: string; accusedGang: string; suspects: DraftSuspect[] }) {
    if (payload.suspects.some(s => s.clips.some(c => c.staged))) {
      setQueue({ status: 'uploading', position: 0, total: 0, elapsedMs: 0 });
      setQueueMsg('กำลังบันทึกเคส…');
      setQueueAt(Date.now());
    }
    try {
      const created = await submitCase({
        reporterDcId: payload.repDc,
        reporterDetail: payload.repDetail,
        reporterGang: payload.repGang,
        accusedGang: payload.accusedGang,
        suspects: payload.suspects,
        onProgress: msg => { setQueueMsg(msg); notify(msg); },
        onQueue: setQueue,
      });
      setAddOpen(false);
      notify(`สร้างเคส #${created.no} แล้ว`);
      await load();
    } finally {
      setQueue(null);
      setQueueMsg('');
    }
  }

  async function handleReview(c: Case, idx: number, patch: { status: Status | 'todo'; findings: string; inspector: string; note: string }) {
    const suspects = c.suspects.map((s, i): Suspect => (
      i === idx ? { ...s, status: patch.status as Status, findings: patch.findings, inspector: patch.inspector, note: patch.note } : s
    ));
    const optimistic: Case = { ...c, suspects, updatedAt: Date.now() };
    setCases(list => list.map(x => (x.id === c.id ? optimistic : x)));

    try {
      const updated = await updateCase(c.id, { ...c, suspects });
      setCases(list => list.map(x => (x.id === c.id ? updated : x)));
      try { await refreshEmbed(c.id, idx); } catch { notify('บันทึกแล้ว แต่อัปเดต Discord ไม่สำเร็จ'); }
      setDetail(null);
      notify('บันทึกผลแล้ว');
    } catch (err) {
      setCases(list => list.map(x => (x.id === c.id ? c : x)));
      notify('บันทึกไม่สำเร็จ: ' + (err instanceof Error ? err.message : ''));
    }
  }

  async function handleClaim(c: Case, idx: number, name: string) {
    const cur = c.suspects[idx];
    const starting = cur.status !== 'new';
    const suspects = c.suspects.map((s, i): Suspect => (
      i === idx ? { ...s, status: starting ? 'new' : 'todo', inspector: name || s.inspector } : s
    ));

    // แสดงผลทันที (ไม่ต้องรอ Sheets)
    const optimistic: Case = { ...c, suspects };
    setDetail(optimistic);
    setCases(list => list.map(x => (x.id === c.id ? optimistic : x)));

    try {
      const updated = await updateCase(c.id, { ...c, suspects });
      setDetail(updated);
      setCases(list => list.map(x => (x.id === c.id ? updated : x)));
      notify(starting ? 'เริ่มตรวจแล้ว' : 'หยุดตรวจแล้ว');
    } catch (err) {
      setDetail(c);
      setCases(list => list.map(x => (x.id === c.id ? c : x)));
      notify('อัปเดตสถานะไม่สำเร็จ: ' + (err instanceof Error ? err.message : ''));
    }
  }

  async function handleEditSave(payload: { repDc: string; repDetail: string; repGang: string; accusedGang: string; suspects: DraftSuspect[] }) {
    if (!editing) return;
    if (payload.suspects.some(s => s.clips.some(c => c.staged))) {
      setQueue({ status: 'uploading', position: 0, total: 0, elapsedMs: 0 });
      setQueueMsg('กำลังบันทึกการแก้ไข…');
      setQueueAt(Date.now());
    }
    try {
      const updated = await saveCaseEdits(editing.id, {
        reporterDcId: payload.repDc,
        reporterDetail: payload.repDetail,
        reporterGang: payload.repGang,
        accusedGang: payload.accusedGang,
        suspects: payload.suspects,
        original: editing,
        onProgress: msg => { setQueueMsg(msg); notify(msg); },
        onQueue: setQueue,
      });
      setEditing(null);
      setDetail(updated);
      setCases(list => list.map(x => (x.id === updated.id ? updated : x)));
      notify('แก้ไขแล้ว');
    } catch (err) {
      notify('แก้ไขไม่สำเร็จ: ' + (err instanceof Error ? err.message : ''));
      throw err;
    } finally {
      setQueue(null);
      setQueueMsg('');
    }
  }

  async function handleDelete(c: Case) {
    if (deleting) return;
    if (!window.confirm(`ลบเคส #${c.no} และข้อความ Discord ทั้งหมดของเคสนี้?`)) return;

    setDeleting(true);
    notify('กำลังลบเคสและข้อความ Discord…');
    try {
      const res = await apiDelete(c.id);
      setDetail(null);
      setCases(list => list.filter(x => x.id !== c.id));
      notify(
        res.failed
          ? `ลบเคสแล้ว · ลบข้อความ Discord ไม่สำเร็จ ${res.failed} รายการ`
          : 'ลบเคสและข้อความ Discord แล้ว',
      );
    } catch (err) {
      notify('ลบไม่สำเร็จ: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <div className="brand">
            <h1>ตรวจเคส</h1>
            <p>{cases.length} เคส · {counts.todo} รอตรวจ</p>
          </div>
          <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
            <Link href="/report" className="btn" style={{ height: 38, fontSize: 12.5 }}>แจ้งเหตุ</Link>
            <button className="btn-add" type="button" style={{ marginLeft: 0 }} onClick={() => setAddOpen(true)}>
              <Icon name="plus" /><span>เพิ่มเคส</span>
            </button>
          </div>
        </div>
      </header>

      <div className="app">
        <div className="filters">
          {FILTERS.map(f => (
            <button key={f.key} type="button" className={`fpill ${filter === f.key ? 'on' : ''}`} onClick={() => { setFilter(f.key); setPage(1); }}>
              {f.key !== 'all' && <i className="dot" style={{ background: STATUS[f.key].color }} />}
              {f.label}<b>{counts[f.key] || 0}</b>
            </button>
          ))}
        </div>

        <div className="tools">
          <label className="search">
            <Icon name="search" />
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="ค้นหา ID DC / เลขเคส" autoComplete="off" />
          </label>
          <div className="opts">
            <label className="selm">
              <span>เรียง</span>
              <select value={sort} onChange={e => setSort(e.target.value)}>
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="selm">
              <select value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1); }}>
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} / หน้า</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="pbar">
          <span className="pinfo">
            <b>{total ? start + 1 : 0}–{Math.min(total, start + items.length)}</b>
            <span className="of"> จาก {total}</span>
          </span>
          <div className="pnav">
            <button className="pg" type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              <Icon name="chev" className="rotate-180" />
            </button>
            <span className="pg on">{current}</span>
            <button className="pg" type="button" disabled={current >= totalPages} onClick={() => setPage(current + 1)}>
              <Icon name="chev" />
            </button>
          </div>
        </div>

        <main className="list">
          {items.map(c => {
            const st = STATUS[caseStatus(c)];
            const first = c.suspects[0] || {};
            const more = c.suspects.length - 1;
            const inspector = caseInspector(c);
            const clips = clipCount(c);
            const rowStyle = { '--st': st.color, '--stbg': st.bg, '--stbd': st.bd } as CSSProperties;

            return (
              <div key={c.id} className="row" role="button" tabIndex={0} style={rowStyle}
                onClick={() => setDetail(c)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setDetail(c); }}>
                <span className="rmain">
                  <span className="r1">
                    <span className="rno">#{c.no}</span>
                    <span className="dcid">{first.dcId || '—'}</span>
                    <span className="idtag">ID DC</span>
                    {more > 0 && <span className="cnt">+{more}</span>}
                  </span>
                  <span className="r2">
                    {first.identifier && <span className="ident"><span className="k">steam:</span> {first.identifier.replace(/^steam:/, '')}</span>}
                    {clips > 0 && <><span className="sep">·</span><span>{clips} คลิป</span></>}
                    <span className="sep">·</span>
                    <span>{ago(c.updatedAt)}</span>
                    {inspector && <><span className="sep">·</span><span>{inspector}</span></>}
                  </span>
                </span>
                <span className="rright">
                  <span className="chip">{st.label}</span>
                  <Icon name="chev" className="chev" />
                </span>
              </div>
            );
          })}

          {!items.length && (
            <div className="empty">
              <div className="bico"><Icon name="clip" /></div>
              <h3>{loading ? 'กำลังโหลด...' : cases.length ? 'ไม่พบเคส' : 'ยังไม่มีเคส'}</h3>
              <p>{loading ? 'รอสักครู่' : cases.length ? 'ลองค้นหาคำอื่น' : 'เริ่มจากเคสแรกได้เลย'}</p>
              {!loading && !cases.length && (
                <button className="btn primary" type="button" onClick={() => setAddOpen(true)}>
                  <Icon name="plus" /> เพิ่มเคส
                </button>
              )}
            </div>
          )}
        </main>

        <div className="pbar bottom">
          <span className="pinfo">{total} เคส</span>
          <div className="pnav">
            <button className="pg" type="button" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              <Icon name="chev" className="rotate-180" />
            </button>
            <span className="pg on">{current}/{totalPages}</span>
            <button className="pg" type="button" disabled={current >= totalPages} onClick={() => setPage(current + 1)}>
              <Icon name="chev" />
            </button>
          </div>
        </div>
      </div>

      {addOpen && <CaseFormModal onClose={() => setAddOpen(false)} onSave={handleCreate} />}

      {editing && (
        <CaseFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={handleEditSave}
        />
      )}

      {detail && (
        <CaseModal
          item={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditing(detail); setDetail(null); }}
          onSave={(idx, patch) => handleReview(detail, idx, patch)}
          onClaim={(idx, name) => handleClaim(detail, idx, name)}
          onDelete={() => handleDelete(detail)}
        />
      )}

      {queue && <QueueOverlay info={queue} startedAt={queueAt} message={queueMsg} />}
      {toast && <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-[#2c3e5c] bg-[#121e33] px-4 py-2.5 text-xs text-[#e7eefb]">{toast}</div>}
    </>
  );
}

/* ---------------- เพิ่มเคส ---------------- */

type Picked = { si: number; ci: number; file: File; url: string; duration: number };

function emptyDraft(): DraftSuspect {
  return { name: '', dcId: '', identifier: '', detail: '', clips: [{ url: '', staged: null }] };
}

function CaseFormModal({ initial, onClose, onSave }: {
  initial?: Case;
  onClose: () => void;
  onSave: (p: { repDc: string; repDetail: string; repGang: string; accusedGang: string; suspects: DraftSuspect[] }) => Promise<void>;
}) {
  const [repDc, setRepDc] = useState(initial?.reporterDcId || '');
  const [repDetail, setRepDetail] = useState(initial?.reporterDetail || '');
  const [repGang, setRepGang] = useState(initial?.reporterGang || '');
  const [accusedGang, setAccusedGang] = useState(initial?.accusedGang || '');
  const [suspects, setSuspects] = useState<DraftSuspect[]>(() => (
    initial
      ? initial.suspects.map(s => ({
          name: s.name || '',
          dcId: s.dcId || '',
          identifier: s.identifier || '',
          detail: s.detail || '',
          clips: s.clips.length ? s.clips.map(c => ({ url: c.url, staged: null, mark: c.mark })) : [{ url: '', staged: null }],
        }))
      : [emptyDraft()]
  ));
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<{ si: number; ci: number } | null>(null);
  const s = suspects[active];

  function notify(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2600);
  }

  function patch(p: Partial<DraftSuspect>) {
    setSuspects(list => list.map((x, i) => (i === active ? { ...x, ...p } : x)));
  }

  function patchClip(ci: number, next: Partial<DraftClip>) {
    patch({ clips: s.clips.map((c, i) => (i === ci ? { ...c, ...next } : c)) });
  }

  function addSuspect() {
    setSuspects(list => [...list, emptyDraft()]);
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
  }

  async function save() {
    if (saving) return;
    if (!/^\d{5,25}$/.test(repDc.trim())) { notify('ใส่ ID DC ผู้แจ้ง'); return; }

    if (initial) {
      const bad = suspects.find(sp => sp.dcId && !/^\d{5,25}$/.test(sp.dcId));
      if (bad) { notify('ID DC ผู้ต้องสงสัยต้องเป็นตัวเลข'); return; }
    } else {
      if (!suspects.some(sp => /^\d{5,25}$/.test(sp.dcId))) { notify('ใส่ ID DC ผู้ต้องสงสัยอย่างน้อย 1 คน'); return; }
      if (!suspects.some(sp => sp.clips.some(c => c.staged || c.url.trim()))) { notify('เพิ่มคลิปอย่างน้อย 1 คลิป'); return; }
    }

    setSaving(true);
    try {
      await onSave({ repDc: repDc.trim(), repDetail, repGang, accusedGang, suspects });
    } catch (err) {
      notify('บันทึกไม่สำเร็จ: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wrap open" role="dialog" aria-modal="true">
      <div className="sheet">
        <div className="sh-head">
          <h2>{initial ? `แก้ไขเคส #${initial.no}` : 'เพิ่มเคส'}</h2>
          <button className="ic" type="button" onClick={onClose} aria-label="ปิด"><Icon name="close" /></button>
        </div>

        <div className="fgroup">
          <div className="fg-head">ผู้แจ้ง</div>
          <label className="lbl">ID DC <span className="req">*</span></label>
          <input className="inp mono" value={repDc} onChange={e => setRepDc(e.target.value)} placeholder="ID DC" inputMode="numeric" />

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
          <textarea className="inp area" rows={2} value={repDetail} onChange={e => setRepDetail(e.target.value)} />
        </div>

        <div className="fgroup">
          <div className="fg-head">ผู้ต้องสงสัย</div>

          <div className="sus-nav">
            <div className="sus-tabs-wrap">
              <div className="sus-tabs">
                {suspects.map((_, i) => (
                  <div key={i} className={`sus-tab ${i === active ? 'on' : ''}`}>
                    <button className="sus-tab-pick" type="button" onClick={() => setActive(i)}>สงสัย {i + 1}</button>
                    {suspects.length > 1 && <button className="sus-tab-x" type="button" onClick={() => removeSuspect(i)}>×</button>}
                  </div>
                ))}
              </div>
            </div>
            <button className="sus-add" type="button" onClick={addSuspect}>
              <Icon name="plus" /> เพิ่มผู้ต้องสงสัย
            </button>
          </div>

          <label className="lbl">ชื่อ <span className="opt">ไม่บังคับ</span></label>
          <input className="inp" value={s.name} onChange={e => patch({ name: e.target.value })} placeholder="ชื่อผู้ต้องสงสัย" />
          <label className="lbl">ID DC <span className="req">*</span></label>
          <input className="inp mono" value={s.dcId} onChange={e => patch({ dcId: e.target.value })} placeholder="ID DC" inputMode="numeric" />
          <label className="lbl">Identifier <span className="opt">ไม่บังคับ</span></label>
          <input className="inp mono" value={s.identifier} onChange={e => patch({ identifier: e.target.value })} placeholder="steam:..." />
          <label className="lbl">รายละเอียด <span className="opt">ไม่บังคับ</span></label>
          <textarea className="inp area" rows={2} value={s.detail} onChange={e => patch({ detail: e.target.value })} />

          <div className="lbl">ลิงก์คลิป</div>
          {s.clips.map((c, ci) => (
            <div className="clipitem" key={ci}>
              <div className="cliprow">
                <input className="inp mono" value={c.url} onChange={e => patchClip(ci, { url: e.target.value })} placeholder="วางลิงก์ หรืออัปโหลด 30 วิ" />
                <button className="ic" type="button" onClick={() => pickFile(active, ci)} title="อัปโหลด/ตัด 30 วิ"><Icon name="upload" /></button>
                <button className="ic" type="button" title="ลบ" onClick={() => {
                  if (s.clips.length <= 1) { patchClip(ci, { url: '', staged: null }); return; }
                  patch({ clips: s.clips.filter((_, i) => i !== ci) });
                }}><Icon name="close" /></button>
              </div>
              {c.staged ? (
                <div className="clipnote" style={{ display: 'flex' }}>
                  <span className="okdot" />
                  <span>พร้อมส่ง · จุดที่ตรวจสอบ {fmtClock(c.staged.mark)} · {(c.staged.file.size / 1024 / 1024).toFixed(1)} MB</span>
                </div>
              ) : (typeof c.mark === 'number' ? (
                <div className="clipnote" style={{ display: 'flex', color: '#ff9aa6' }}>
                  <span className="okdot" style={{ background: '#ff5d73' }} />
                  <span>จุดที่ตรวจสอบ {fmtClock(c.mark)}</span>
                </div>
              ) : null)}
            </div>
          ))}
          <button className="addbtn" type="button" onClick={() => patch({ clips: [...s.clips, { url: '', staged: null }] })}>
            <Icon name="plus" /> เพิ่มลิงก์คลิป
          </button>
        </div>

        <div className="sh-actions">
          <button className="btn" type="button" onClick={onClose}>ยกเลิก</button>
          <button className="btn primary grow" type="button" onClick={save} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
      {picked && (
        <ClipEditor url={picked.url} duration={picked.duration}
          onCancel={() => { URL.revokeObjectURL(picked.url); setPicked(null); }}
          onUse={stage} />
      )}
      {toast && <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-[#2c3e5c] bg-[#121e33] px-4 py-2.5 text-xs text-[#e7eefb]">{toast}</div>}
    </div>
  );
}

/* ---------------- ตรวจเคส ---------------- */

function CaseModal({ item, onClose, onEdit, onSave, onClaim, onDelete }: {
  item: Case;
  onClose: () => void;
  onEdit: () => void;
  onSave: (idx: number, patch: { status: Status | 'todo'; findings: string; inspector: string; note: string }) => Promise<void>;
  onClaim: (idx: number, name: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [active, setActive] = useState(0);
  const [verdict, setVerdict] = useState<Status | null>(
    item.suspects[0]?.status === 'ok' || item.suspects[0]?.status === 'bad' ? item.suspects[0].status : null,
  );
  const [findings, setFindings] = useState(item.suspects[0]?.findings || '');
  const [inspector, setInspector] = useState(item.suspects[0]?.inspector || '');
  const [note, setNote] = useState(item.suspects[0]?.note || '');
  const [saving, setSaving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [err, setErr] = useState('');
  const s = item.suspects[active];
  const reviewed = verdict === 'ok' || verdict === 'bad';
  const ready = hasIdentity(s);
  const claimState = reviewed
    ? (verdict === 'ok' ? 'ok' : 'bad')
    : !ready
      ? 'collect'
      : s.status === 'new'
        ? 'new'
        : 'todo';

  async function claim() {
    if (claiming) return;
    const starting = s.status !== 'new';
    if (starting && !inspector.trim()) { setErr('ใส่ชื่อผู้ตรวจก่อน'); return; }
    setClaiming(true);
    try {
      await onClaim(active, inspector.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ไม่สำเร็จ');
    } finally {
      setClaiming(false);
    }
  }

  function appendFinding(text: string) {
    setFindings(prev => {
      const cur = prev.trim();
      if (!cur) return text;
      if (cur.includes(text)) return prev;
      return cur + ' ' + text;
    });
  }

  function pick(i: number) {
    setActive(i);
    const next = item.suspects[i];
    setVerdict(next.status === 'ok' || next.status === 'bad' ? next.status : null);
    setFindings(next.findings || '');
    setInspector(next.inspector || '');
    setNote(next.note || '');
    setErr('');
  }

  async function save() {
    if (verdict && !inspector.trim()) { setErr('ใส่ชื่อผู้ตรวจ'); return; }
    setSaving(true);
    try {
      await onSave(active, { status: verdict ?? 'todo', findings, inspector: inspector.trim(), note });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wrap open" role="dialog" aria-modal="true">
      <div className="sheet">
        <div className="sh-head">
          <div className="sh-title">
            <h2>เคส #{item.no}{item.suspects.length > 1 ? ` · ${item.suspects.length} ผู้ต้องสงสัย` : ''}</h2>
            <p className="sub">ID DC {item.reporterDcId}</p>
          </div>
          <div className="sh-actions-top">
            <button
              className={`btn-start is-${claimState}`}
              type="button"
              disabled={reviewed || !ready}
              onClick={claim}
              title={!ready ? 'กรอกข้อมูลผู้ต้องสงสัยก่อน (ชื่อ / ID DC / Identifier)' : undefined}
            >
              {reviewed
                ? (verdict === 'ok' ? 'ปกติ' : 'พบปัญหา')
                : !ready
                  ? 'รอข้อมูล'
                  : s.status === 'new'
                    ? 'กำลังตรวจสอบ'
                    : 'เริ่มตรวจ'}
            </button>
            <button className="ic" type="button" onClick={onEdit} aria-label="แก้ไขเคส" title="แก้ไข"><Icon name="edit" /></button>
            <button className="ic danger" type="button" onClick={onDelete} aria-label="ลบเคส" title="ลบเคส"><Icon name="trash" /></button>
            <button className="ic" type="button" onClick={onClose} aria-label="ปิด"><Icon name="close" /></button>
          </div>
        </div>

        <div className="fgroup">
          <div className="fg-head">ผู้แจ้ง</div>

          <div className="rep">
            <div className="rep-id">
              <span className="k">ID DC</span>
              <span className="v">{item.reporterDcId || '—'}</span>
              {item.reporterDcId && (
                <button
                  className="copybtn xs"
                  type="button"
                  title="คัดลอก ID DC"
                  onClick={() => navigator.clipboard?.writeText(item.reporterDcId)}
                >
                  <Icon name="copy" />
                </button>
              )}
            </div>

            {(item.reporterGang || item.accusedGang) && (
              <div className="rep-gangs">
                <div className="rep-gang me">
                  <span className="k">กลุ่มผู้แจ้ง</span>
                  <span className="v">{item.reporterGang || '—'}</span>
                </div>
                <div className="rep-gang them">
                  <span className="k">กลุ่มผู้ต้องสงสัย</span>
                  <span className="v">{item.accusedGang || '—'}</span>
                </div>
              </div>
            )}

            {item.reporterDetail && (
              <div className="rep-detail">
                <span className="k">รายละเอียด</span>
                <p>{item.reporterDetail}</p>
              </div>
            )}
          </div>

          {item.clips.length > 0 && (
            <div className="rep-clips">
              {item.clips.map((c, i) => (
                <button key={i} className="cliplink" type="button" onClick={() => openDiscord(c.url)} title={c.url}>
                  <span className="u">{c.url}</span>
                  {typeof c.mark === 'number' && <span className="markpill">{fmtClock(c.mark)}</span>}
                  <span className="go">เปิด</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="fgroup">
          <div className="fg-head">ผู้ต้องสงสัย</div>
          <div className="sus-tabs-wrap" style={{ marginTop: 8 }}>
            <div className="sus-tabs">
              {item.suspects.map((x, i) => (
                <div key={i} className={`sus-tab ${i === active ? 'on' : ''}`}>
                  <button className="sus-tab-pick" type="button" onClick={() => pick(i)}>
                    #{suspectLabel(item.no, item.suspects.length, i)}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="sus-card active" style={{ display: 'block', marginTop: 10 }}>
            <div className="sc-head">
              <div className="sc-no">#{suspectLabel(item.no, item.suspects.length, active)}</div>
              {s.embedUrl && (
                <button className="sc-dc" type="button" onClick={() => openDiscord(s.embedUrl || '')}>ไปยัง Discord</button>
              )}
            </div>
            <div className="sc-line"><span className="k">ชื่อ</span><span className="v">{s.name || '—'}</span></div>
            <div className="sc-line">
              <span className="k">DC</span>
              <span className="v mono">{s.dcId || '—'}</span>
              {s.dcId && (
                <button className="copybtn xs" type="button" title="คัดลอก ID DC" onClick={() => navigator.clipboard?.writeText(s.dcId || '')}>
                  <Icon name="copy" />
                </button>
              )}
            </div>
            <div className="sc-line">
              <span className="k">Identifier</span>
              <span className="v mono">{s.identifier || '—'}</span>
              {s.identifier && (
                <button className="copybtn xs" type="button" title="คัดลอก Identifier" onClick={() => navigator.clipboard?.writeText(s.identifier || '')}>
                  <Icon name="copy" />
                </button>
              )}
            </div>
            {s.status === 'new' && s.inspector && (
              <div className="sc-line"><span className="k">กำลังตรวจ</span><span className="v">{s.inspector}</span></div>
            )}
            {s.detail && <div className="sc-detail">{s.detail}</div>}
            {s.clips.length > 0 && (
              <div className="sc-clips">
                {s.clips.map((c, i) => (
                  <button key={i} className="cliplink" type="button" onClick={() => openDiscord(c.url)} title={c.url}>
                    <span className="u">{c.url}</span>
                    {typeof c.mark === 'number' && <span className="markpill">{fmtClock(c.mark)}</span>}
                    <span className="go">เปิด</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="fgroup">
          <div className="fg-head">ผลตรวจ</div>
          <div className="verdicts" style={{ marginTop: 8 }}>
            <button className={`vbtn ${verdict === 'ok' ? 'on' : ''}`} data-v="ok" aria-pressed={verdict === 'ok'} type="button" onClick={() => setVerdict(verdict === 'ok' ? null : 'ok')}>ปกติ</button>
            <button className={`vbtn ${verdict === 'bad' ? 'on' : ''}`} data-v="bad" aria-pressed={verdict === 'bad'} type="button" onClick={() => setVerdict(verdict === 'bad' ? null : 'bad')}>พบปัญหา</button>
          </div>

          <label className="lbl">พบอะไร</label>
          <div className="quickchips">
            {QUICK_FINDINGS.map(t => (
              <button key={t} className="chipbtn" type="button" onClick={() => appendFinding(t)}>{t}</button>
            ))}
          </div>
          <textarea className="inp area" rows={2} value={findings} onChange={e => setFindings(e.target.value)} placeholder="สรุปสั้น ๆ" />

          <label className="lbl">ผู้ตรวจ <span className="req">*</span></label>
          <input className={`inp ${err ? 'invalid' : ''}`} value={inspector} onChange={e => { setInspector(e.target.value); setErr(''); }} placeholder="ชื่อผู้ตรวจ" />
          {err && <p style={{ color: '#ff8d9c', fontSize: 11.5, marginTop: 4 }}>{err}</p>}

          <label className="lbl">หมายเหตุ <span className="opt">ไม่บังคับ</span></label>
          <input className="inp" value={note} onChange={e => setNote(e.target.value)} />
        </div>

        <div className="sh-actions">
          <button className="btn" type="button" onClick={onClose}>ปิด</button>
          <button className="btn primary grow" type="button" onClick={save} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกผล'}
          </button>
        </div>
      </div>
    </div>
  );
}

