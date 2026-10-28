import { createApp } from './app';
import type { Bindings } from './env';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, _env: Bindings, _ctx: ExecutionContext) {
    // 自動処理(B-01〜B-06)はフェーズ3で実装する
  },
} satisfies ExportedHandler<Bindings>;
