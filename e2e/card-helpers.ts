import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { authHeaders } from './customer-helpers';

// 担当I: 会員証の背景(C-06)と肉球のスタンプの e2e で使う補助。

/** 会員証の背景の単色を API で選ぶ */
export async function setCardColor(request: APIRequestContext, user: string, color: string) {
  const res = await request.put('/api/me/card-background', { headers: authHeaders(user), data: { color } });
  expect(res.status(), await res.text()).toBe(200);
}

/**
 * 会員証の背景に使う写真をブラウザで作る(カメラで撮った写真の代わり)。
 * light: 白っぽい犬の明るい写真(文字が読みにくい場合)。dark: 暗い写真。
 */
export async function makeCardPhoto(page: Page, tone: 'light' | 'dark', width = 1800, height = 1350): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([w, h, t]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      const light = t === 'light';
      // 空と地面
      g.fillStyle = light ? '#F4F2EE' : '#1E2226';
      g.fillRect(0, 0, w, h);
      g.fillStyle = light ? '#E9E4DA' : '#2C3136';
      g.fillRect(0, h * 0.68, w, h * 0.32);
      // 犬(体・頭・耳)
      const fur = light ? '#FFFFFF' : '#3A3330';
      g.fillStyle = fur;
      g.beginPath();
      g.ellipse(w * 0.5, h * 0.78, w * 0.2, h * 0.17, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(w * 0.5, h * 0.42, h * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = light ? '#EDE6DA' : '#2A2522';
      for (const dx of [-1, 1]) {
        g.beginPath();
        g.ellipse(w * 0.5 + dx * h * 0.2, h * 0.38, h * 0.06, h * 0.14, dx * 0.3, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#1B1714';
      for (const dx of [-1, 1]) {
        g.beginPath();
        g.arc(w * 0.5 + dx * h * 0.07, h * 0.4, h * 0.02, 0, Math.PI * 2);
        g.fill();
      }
      return c.toDataURL('image/jpeg', 0.9);
    },
    [width, height, tone] as const,
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}
