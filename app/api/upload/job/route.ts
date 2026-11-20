import { jobSnapshot } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** สถานะคิวของงานอัปโหลดคลิปหนึ่งงาน */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!id) return Response.json({ ok: false, error: 'missing id' }, { status: 400 });

  const job = jobSnapshot(id);
  if (!job) return Response.json({ ok: false, error: 'job not found' }, { status: 404 });

  return Response.json({ ok: true, ...job });
}
