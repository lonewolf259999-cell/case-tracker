import { Elysia } from 'elysia';
import { healthRoutes } from '@/server/routes/health';
import { caseRoutes } from '@/server/routes/cases';

/**
 * The API, mounted into Next.js at app/api/[[...slugs]]/route.ts.
 *
 * Elysia runs through `.handle(request)` rather than `.listen()`, so it needs
 * no Bun runtime — the same pattern as the Web-vesperpd project.
 */
export const api = new Elysia({ prefix: '/api' })
  .onError(({ error, code, set }) => {
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'endpoint not found' };
    }
    if (code === 'VALIDATION') {
      set.status = 400;
      return { error: 'invalid request' };
    }
    set.status = 500;
    return { error: error instanceof Error ? error.message : 'unexpected error' };
  })
  .use(healthRoutes)
  .use(caseRoutes);
