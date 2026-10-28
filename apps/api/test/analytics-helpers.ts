import { afterEach, beforeEach, vi } from 'vitest';

/**
 * 毎晩・毎朝の処理(runScheduled)を呼ぶテストで、外(内閣府・気象庁)へ取りに行かないようにする。
 * fetch はすべて 404 を返す(取り込みは「失敗」として記録される)。
 */
export function blockNetwork() {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('blocked in test', { status: 404 }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}
