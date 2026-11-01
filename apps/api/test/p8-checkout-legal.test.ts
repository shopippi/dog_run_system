import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/env';
import { legalHtml, photoLegalHtmlRoutes, textToHtml } from '../src/routes/photos/legal-html';

// 法定表示の HTML(docs/photo-requirements.md 9.3)。ログインなしで開ける。Stripe の審査に出す URL
// (routes/photos/index.ts へは統合の担当が足す。ここでは部品だけを組んで確かめる)

function app() {
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('now', new Date('2026-11-03T01:00:00Z'));
    await next();
  });
  a.route('/api/photos', photoLegalHtmlRoutes);
  return a;
}

describe('法定表示の HTML', () => {
  it('ログインなしで開け、特定商取引法に基づく表記・利用規約(返金の条件)・プライバシーポリシーを出す', async () => {
    const res = await app().request('/api/photos/legal.html', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('id="tokushoho"');
    expect(html).toContain('id="terms"');
    expect(html).toContain('id="privacy"');
    expect(html).toContain('グリーンドーム');
    expect(html).toContain('購入から7日以内で、まだ一度もダウンロードしていない写真に限り、返金を受け付けます');
  });

  it('設定の本文を出す。HTML として読まれないように書き換える', async () => {
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('photo_tokushoho_text', ?, '2026-11-03T10:00:00+09:00')")
      .bind(JSON.stringify('販売者: グリーンドーム\n所在地: <script>alert(1)</script>'))
      .run();
    const html = await (await app().request('/api/photos/legal.html', {}, env)).text();
    expect(html).toContain('販売者: グリーンドーム<br>所在地: &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('空の行で段落を分ける', () => {
    expect(textToHtml('一行目\n二行目\n\n次の段落')).toBe('<p>一行目<br>二行目</p>\n<p>次の段落</p>');
    expect(legalHtml({ facilityName: 'A&B', tokushoho: '', terms: '', privacy: '' })).toContain('A&amp;B 写真販売');
  });
});
