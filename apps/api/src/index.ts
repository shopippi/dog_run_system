import { createApp } from './app';
import { runScheduled } from './cron';
import type { Bindings } from './env';
import { withMedia } from './lib/d1-media';

const app = createApp();

export default {
  // R2 がつながっていないときは、写真をデータベースに保存する(withMedia)
  fetch: (req: Request, env: Bindings, ctx: ExecutionContext) => app.fetch(req, withMedia(env), ctx),
  async scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(controller.cron, withMedia(env), new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Bindings>;
