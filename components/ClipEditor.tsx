'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { fmtClock } from '@/lib/shared/types';

export const CLIP_SEC = 30;

export type ClipChoice = { start: number; mark: number; rel: number };

export function ClipEditor({
  url,
  duration,
  onCancel,
  onUse,
}: {
  url: string;
  duration: number;
  onCancel: () => void;
  onUse: (v: ClipChoice) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [start, setStart] = useState(0);
  const [mark, setMark] = useState(Math.min(15, duration / 2));

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, []);

  const rel = mark - start;
  const inRange = rel >= -0.05 && rel <= CLIP_SEC + 0.05;

  function playSelection() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = start;
    void v.play();
    const stopAt = start + CLIP_SEC;
    const id = window.setInterval(() => {
      if (v.paused || v.currentTime >= stopAt - 0.05) {
        v.pause();
        window.clearInterval(id);
      }
    }, 150);
  }

  function use() {
    if (!inRange) return;
    onUse({ start, mark, rel: Math.round(rel * 10) / 10 });
  }

  return (
    <div className="wrap open" role="dialog" aria-modal="true">
      <div className="sheet" style={{ maxWidth: 780 }}>
        <div className="sh-head">
          <h2>ตัดคลิป 30 วินาที</h2>
          <button className="ic" type="button" onClick={onCancel} aria-label="ปิด"><Icon name="close" /></button>
        </div>

        <video
          ref={videoRef}
          src={url}
          controls
          playsInline
          style={{ width: '100%', maxHeight: 300, background: '#000', borderRadius: 12, border: '1px solid #22324a' }}
        />

        <Timeline
          duration={duration}
          start={start}
          mark={mark}
          time={time}
          onStart={setStart}
          onMark={setMark}
        />

        <div className="problem-line">
          <span className="pdot" />
          <span>จุดที่ตรวจสอบ: <b>{fmtClock(mark)}</b></span>
          <span className="muted" style={inRange ? undefined : { color: '#f6b73c' }}>
            {inRange ? `(${Math.round(rel * 10) / 10} วิ ของช่วง)` : '(นอกช่วงที่เลือก)'}
          </span>
        </div>

        <div className="trimrow">
          <button className="btn" type="button" onClick={playSelection}>▶ เล่นช่วงนี้</button>
          <span style={{ flex: 1 }} />
          <button className="btn" type="button" onClick={onCancel}>ยกเลิก</button>
          <button className="btn primary" type="button" onClick={use} disabled={!inRange}>ใช้คลิปช่วงนี้</button>
        </div>
      </div>
    </div>
  );
}

function Timeline({
  duration,
  start,
  mark,
  time,
  onStart,
  onMark,
}: {
  duration: number;
  start: number;
  mark: number;
  time: number;
  onStart: (v: number) => void;
  onMark: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    kind: 'win' | 'mark';
    x: number;
    value: number;
    travel: number;
    maxStart: number;
    trackW: number;
    duration: number;
  } | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const onResize = () => force(n => n + 1);
    window.addEventListener('resize', onResize);
    const id = requestAnimationFrame(onResize);
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(id); };
  }, [duration]);

  const trackW = trackRef.current?.clientWidth || 0;
  const winW = Math.max(56, trackW * (CLIP_SEC / Math.max(duration, 1)));
  const maxStart = Math.max(0, duration - CLIP_SEC);
  const travel = Math.max(0, trackW - winW);
  const left = maxStart > 0 ? (start / maxStart) * travel : 0;
  const clampX = (x: number) => Math.min(Math.max(x, 20), Math.max(20, trackW - 20));
  const markX = trackW * (mark / Math.max(duration, 1));

  function down(kind: 'win' | 'mark', e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }

    const tw = Math.max(1, trackRef.current?.clientWidth || 1);
    const ww = Math.max(56, tw * (CLIP_SEC / Math.max(duration, 1)));

    drag.current = {
      kind,
      x: e.clientX,
      value: kind === 'win' ? start : mark,
      travel: Math.max(1, tw - ww),
      maxStart: Math.max(0, duration - CLIP_SEC),
      trackW: tw,
      duration: Math.max(1, duration),
    };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (d.kind === 'win') {
      const next = Math.max(0, Math.min(d.maxStart, d.value + (dx / d.travel) * d.maxStart));
      onStart(Math.round(next * 10) / 10);
    } else {
      const next = Math.max(0, Math.min(d.duration, d.value + (dx / d.trackW) * d.duration));
      onMark(Math.round(next * 10) / 10);
    }
  }

  function up() { drag.current = null; }

  function clickTrack(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.tl-window')) return;
    if ((e.target as HTMLElement).closest('.tl-problem')) return;
    if (!trackRef.current || maxStart <= 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - winW / 2) / Math.max(1, travel)));
    onStart(Math.round(frac * maxStart * 10) / 10);
  }

  return (
    <div className="tl-wrap">
      <div className="tl-track" ref={trackRef} onClick={clickTrack}>
        <div
          className="tl-window"
          style={{ width: winW || 0, transform: `translateX(${left}px)` }}
          onPointerDown={e => down('win', e)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <span className="tl-wlabel">30 วิ</span>
          <span className="tl-midline" />
        </div>

        <div
          className="tl-problem"
          style={{ left: `${(mark / Math.max(duration, 1)) * 100}%` }}
          onPointerDown={e => down('mark', e)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />

        <div className="tl-playhead" style={{ left: `${Math.min(100, (time / Math.max(duration, 1)) * 100)}%` }} />
      </div>

      <div className="tl-marks">
        <span className="tl-mark" style={{ left: clampX(left) }}>▲ {fmtClock(start)}</span>
        <span className="tl-mark mid" style={{ left: clampX(left + winW / 2), top: winW < 170 ? 19 : 0 }}>▲ {fmtClock(start + CLIP_SEC / 2)}</span>
        <span className="tl-mark" style={{ left: clampX(left + winW) }}>▲ {fmtClock(start + CLIP_SEC)}</span>
      </div>

      <div className="tl-mtagrow">
        <span className="tl-mtag" style={{ left: clampX(markX) }}>▲ จุดที่ตรวจสอบ</span>
      </div>
    </div>
  );
}
