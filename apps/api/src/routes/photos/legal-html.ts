import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { loadSettings } from '../../lib/settings';

// 法定表示の HTML(段階1-C。docs/photo-requirements.md 9.3)。ログインなしで、LIFF の外のブラウザでも開ける。
// Stripe の審査に出す URL: /api/photos/legal.html(#tokushoho・#terms・#privacy で各章へ)。
// 中身は GET /api/photos/legal と同じ設定(photo_tokushoho_text・photo_terms_text・privacy_text)。
// 統合の担当が routes/photos/index.ts の photoPublicRoutes に足す(photoPublicRoutes.route('/', photoLegalHtmlRoutes))。
export const photoLegalHtmlRoutes = new Hono<AppEnv>();

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** 本文(改行で区切った文)を段落にする。空の行で段落を分け、段落の中の改行は <br> */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

export function legalHtml(args: { facilityName: string; tokushoho: string; terms: string; privacy: string }): string {
  const name = escapeHtml(args.facilityName);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>特定商取引法に基づく表記・利用規約・プライバシーポリシー | ${name}</title>
<style>
  :root { color-scheme: light dark; --text: #16191D; --sub: #5B6470; --border: #E3E6EA; --bg: #FFFFFF; --link: #2F5FA8; }
  @media (prefers-color-scheme: dark) { :root { --text: #ECEEF0; --sub: #A7AFB8; --border: #2A2E33; --bg: #17191C; --link: #7FA8E6; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic Medium", "Segoe UI", Roboto, sans-serif; line-break: strict; }
  main { max-width: 720px; margin: 0 auto; padding: 28px 20px 48px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; font-feature-settings: "palt"; }
  h2 { font-size: 17px; font-weight: 600; margin: 32px 0 8px; padding-top: 16px; border-top: 1px solid var(--border); font-feature-settings: "palt"; }
  p { margin: 0 0 12px; overflow-wrap: anywhere; }
  .lead { color: var(--sub); font-size: 13px; }
  nav a { color: var(--link); margin-right: 16px; }
  a:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
</style>
</head>
<body>
<main>
<h1>${name} 写真販売</h1>
<p class="lead">特定商取引法に基づく表記・利用規約・プライバシーポリシー</p>
<nav><a href="#tokushoho">特定商取引法に基づく表記</a><a href="#terms">利用規約</a><a href="#privacy">プライバシーポリシー</a></nav>
<h2 id="tokushoho">特定商取引法に基づく表記</h2>
${textToHtml(args.tokushoho)}
<h2 id="terms">利用規約(写真販売)</h2>
${textToHtml(args.terms)}
<h2 id="privacy">プライバシーポリシー</h2>
${textToHtml(args.privacy)}
</main>
</body>
</html>`;
}

photoLegalHtmlRoutes.get('/legal.html', async (c) => {
  const s = await loadSettings(c.env.DB);
  return c.html(legalHtml({ facilityName: s.facility_name, tokushoho: s.photo_tokushoho_text, terms: s.photo_terms_text, privacy: s.privacy_text }), 200, {
    'cache-control': 'public, max-age=300',
    'x-content-type-options': 'nosniff',
  });
});
