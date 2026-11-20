import { Elysia } from 'elysia';
import { config } from '@/server/config';

/** Operational health probe used by the host and by /cases. */
export const healthRoutes = new Elysia({ prefix: '/health' }).get('/', () => ({
  ok: true,
  webhook: !!config.discordWebhook,
  sheets: !!config.sheetId,
  targetMb: config.uploadTargetMb,
}));
