import { createApp } from './app';
import { runScheduled } from './cron';
import type { Bindings } from './env';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(controller.cron, env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Bindings>;
