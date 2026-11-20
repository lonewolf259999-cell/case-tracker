import { api } from '@/server/app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = (request: Request) => api.handle(request);

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
