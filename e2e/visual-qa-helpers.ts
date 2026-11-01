import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';

// 見え方の点検(重なり・切れ・はみ出し・押しにくさ・下の帯に隠れる・写真のつぶれ)。
// お客さん向け(LIFF)・管理画面・デモのどの画面でも使える。使い方は e2e/liff.visual-qa.spec.ts。

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0 LIFF';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Line/15.10.0/IAB LIFF';

/**
 * 点検する端末。LIFF の Full サイズでは、LINE が自分のヘッダー(とステータスバー)を画面の上に描き、
 * ページはその下から始まる。そのため高さは、機種の画面からステータスバーと LINE のヘッダーを除いたもの
 * (iPhone はおよそ 20〜59 + 44、Android は 24 + 56)。safeBottom は、ホームバーのある機種の下の余白。
 */
export type VqaDevice = {
  id: string;
  label: string;
  viewport: { width: number; height: number };
  dpr: number;
  ua: string;
  safeBottom: number;
  dark?: boolean;
  /** 文字の大きさの倍率(端末の「文字を大きく」の代わり。1 はふつう) */
  textScale?: number;
};

export const VQA_DEVICES: Record<string, VqaDevice> = {
  se: { id: 'se', label: 'iPhone SE (375×667)', viewport: { width: 375, height: 603 }, dpr: 2, ua: IOS_UA, safeBottom: 0 },
  i13: { id: 'i13', label: 'iPhone 13/14 (390×844)', viewport: { width: 390, height: 753 }, dpr: 3, ua: IOS_UA, safeBottom: 34 },
  i16: { id: 'i16', label: 'iPhone 16 (393×852)', viewport: { width: 393, height: 749 }, dpr: 3, ua: IOS_UA, safeBottom: 34 },
  promax: { id: 'promax', label: 'iPhone 16 Pro Max (430×932)', viewport: { width: 430, height: 829 }, dpr: 3, ua: IOS_UA, safeBottom: 34 },
  android: { id: 'android', label: 'Android 小さめ (360×740)', viewport: { width: 360, height: 660 }, dpr: 3, ua: ANDROID_UA, safeBottom: 0 },
  narrow: { id: 'narrow', label: '幅 320(Android の表示サイズ大)', viewport: { width: 320, height: 560 }, dpr: 3, ua: ANDROID_UA, safeBottom: 0 },
  'se-dark': { id: 'se-dark', label: 'iPhone SE ダークモード', viewport: { width: 375, height: 603 }, dpr: 2, ua: IOS_UA, safeBottom: 0, dark: true },
  'i16-dark': { id: 'i16-dark', label: 'iPhone 16 ダークモード', viewport: { width: 393, height: 749 }, dpr: 3, ua: IOS_UA, safeBottom: 34, dark: true },
  'se-text125': { id: 'se-text125', label: 'iPhone SE 文字 125%', viewport: { width: 375, height: 603 }, dpr: 2, ua: IOS_UA, safeBottom: 0, textScale: 1.25 },
  'se-text150': { id: 'se-text150', label: 'iPhone SE 文字 150%', viewport: { width: 375, height: 603 }, dpr: 2, ua: IOS_UA, safeBottom: 0, textScale: 1.5 },
  'android-text125': { id: 'android-text125', label: 'Android 小さめ 文字 125%', viewport: { width: 360, height: 660 }, dpr: 3, ua: ANDROID_UA, safeBottom: 0, textScale: 1.25 },
  'android-text150': { id: 'android-text150', label: 'Android 小さめ 文字 150%', viewport: { width: 360, height: 660 }, dpr: 3, ua: ANDROID_UA, safeBottom: 0, textScale: 1.5 },
  'narrow-text150-dark': { id: 'narrow-text150-dark', label: '幅 320 文字 150% ダーク', viewport: { width: 320, height: 560 }, dpr: 3, ua: ANDROID_UA, safeBottom: 0, textScale: 1.5, dark: true },
};

/** CI でいつも点検する端末(いちばん狭い・文字が大きい・ダーク)。VQA_FULL=1 のときは全部 */
export function vqaDeviceList(ciIds: string[]): VqaDevice[] {
  const only = process.env.VQA_DEVICES?.split(',').filter(Boolean);
  if (only) return only.map((id) => VQA_DEVICES[id]!).filter(Boolean);
  if (process.env.VQA_FULL === '1') return Object.values(VQA_DEVICES);
  return ciIds.map((id) => VQA_DEVICES[id]!);
}

export function contextOptions(d: VqaDevice): BrowserContextOptions {
  return {
    viewport: d.viewport,
    // 写真の重さを抑えるため、画面の細かさは 2 倍まで(並び方は変わらない)
    deviceScaleFactor: Math.min(d.dpr, 2),
    isMobile: true,
    hasTouch: true,
    userAgent: d.ua,
    colorScheme: d.dark ? 'dark' : 'light',
  };
}

/**
 * 端末の設定をページに当てる(ページを開く前に呼ぶ)。
 * - 文字を大きく: 文字の大きさはすべて tokens.css の --fs-* (px)で決まるので、それを倍にする。
 *   (Android の LINE の中の画面は、端末の文字の大きさの設定で文字だけが大きくなる。それと同じ見え方)
 * - 下の安全な余白: Chromium では env(safe-area-inset-bottom) が 0 なので、CSS の中の env(safe-area-inset-bottom…) を
 *   端末の値(ホームバーの 34px)に置き換える。
 */
export async function applyDevice(page: Page, d: VqaDevice) {
  await page.addInitScript(
    ({ scale, safeBottom }) => {
      const apply = () => {
        if (scale !== 1) {
          const style = document.createElement('style');
          style.dataset.vqa = 'text-scale';
          const sizes: Record<string, number> = { '12': 12, '13': 13, '14': 14, '15': 15, '17': 17, '20': 20, '24': 24, clock: 40, input: 16 };
          style.textContent = `:root{${Object.entries(sizes).map(([k, v]) => `--fs-${k}:${Math.round(v * scale * 10) / 10}px !important;`).join('')}}`;
          document.documentElement.appendChild(style);
        }
        if (safeBottom > 0) {
          const patch = () => {
            for (const sheet of [...document.styleSheets]) {
              let rules: CSSRuleList;
              try {
                rules = sheet.cssRules;
              } catch {
                continue;
              }
              const walk = (list: CSSRuleList) => {
                for (const rule of [...list]) {
                  if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules);
                  if (!(rule instanceof CSSStyleRule)) continue;
                  const st = rule.style;
                  for (let i = 0; i < st.length; i++) {
                    const prop = st[i]!;
                    const v = st.getPropertyValue(prop);
                    if (v.includes('safe-area-inset-bottom')) {
                      st.setProperty(prop, v.replace(/env\(\s*safe-area-inset-bottom\s*(,[^)]*)?\)/g, `${safeBottom}px`), st.getPropertyPriority(prop));
                    }
                  }
                }
              };
              walk(rules);
            }
          };
          patch();
          new MutationObserver(patch).observe(document.head, { childList: true });
        }
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
      else apply();
    },
    { scale: d.textScale ?? 1, safeBottom: d.safeBottom },
  );
}

export async function newDevicePage(browser: Browser, d: VqaDevice): Promise<Page> {
  const ctx = await browser.newContext({ ...contextOptions(d), locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce', baseURL: `http://localhost:${Number(process.env.E2E_PORT ?? 8788)}` });
  const page = await ctx.newPage();
  await applyDevice(page, d);
  return page;
}

export type AuditOptions = {
  /** 押す部品の最小の大きさ(初期値 44。管理画面のマウスの端末は 40) */
  minTap?: number;
  /** 点検しない要素(CSS セレクター)。意図して重ねているもの・見えない部品 */
  ignore?: string[];
  /** 「…」で切れてもよい要素(CSS セレクター。デザインで1行に収めると決めたもの) */
  allowClip?: string[];
  /** 押す部品の大きさを点検しない要素 */
  allowSmallTap?: string[];
  /** 下に固定した帯・上に固定したヘッダーに隠れていないかを点検するか(初期値 true) */
  checkCovered?: boolean;
};

export type AuditResult = { problems: string[]; warnings: string[] };

/**
 * 1つの画面を点検する。problems は直すべきもの、warnings は目で確かめるもの(改行の位置など)。
 */
export async function auditPage(page: Page, opts: AuditOptions = {}): Promise<AuditResult> {
  // 動きが終わってから測る
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect && isFinite(Number(a.effect.getComputedTiming().endTime)))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.evaluate(() => document.fonts.ready);
  // JS で動かしている動き(開閉の高さなど)も終わるまで、位置が2回続けて変わらなくなるのを待つ
  await page.evaluate(async () => {
    const sig = () => {
      let s = 0;
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        s += r.top * 3 + r.left + r.height * 7 + r.width;
      }
      return Math.round(s);
    };
    let prev = sig();
    let same = 0;
    for (let i = 0; i < 30 && same < 2; i++) {
      await new Promise((r) => setTimeout(r, 80));
      const now = sig();
      same = now === prev ? same + 1 : 0;
      prev = now;
    }
  });
  const result = await page.evaluate(
    async ({ minTap, ignore, allowClip, allowSmallTap, checkCovered }) => {
      const problems: string[] = [];
      const warnings: string[] = [];
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const vh = window.innerHeight;
      const ignoreSel = ['[data-vqa-ignore]', '.sr-only', '.visually-hidden', ...ignore].join(',');
      const isIgnored = (el: Element) => !!el.closest(ignoreSel);
      const desc = (el: Element) => {
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        const text = ((el as HTMLElement).getAttribute?.('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
        return `${el.tagName.toLowerCase()}${cls}「${text}」`;
      };

      // 下から出るシート・ダイアログが開いているときは、その中だけを点検する(うしろは覆われている)
      const modal = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]')].find((e) => {
        const cs = getComputedStyle(e);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && e.getBoundingClientRect().height > 0;
      }) ?? null;
      // 見えているか(透明・隠れている・1px に縮めた読み上げ用の文を除く)
      const visCache = new Map<Element, boolean>();
      const visible = (el: Element): boolean => {
        if (visCache.has(el)) return visCache.get(el)!;
        let ok = true;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') ok = false;
        else if (parseFloat(cs.opacity) < 0.05) ok = false;
        else if (el instanceof HTMLElement && el.hidden) ok = false;
        else if (cs.position === 'absolute' && cs.clip !== 'auto' && cs.clip.startsWith('rect(0')) ok = false;
        else if (cs.clipPath && cs.clipPath.startsWith('inset(50%')) ok = false;
        else if (el.parentElement?.tagName === 'DETAILS' && !(el.parentElement as HTMLDetailsElement).open && el.tagName !== 'SUMMARY') ok = false;
        else if (modal && !modal.contains(el) && !el.contains(modal)) ok = false;
        else if (el.parentElement) ok = visible(el.parentElement);
        if (ok && el instanceof HTMLElement && el.offsetWidth <= 1 && el.offsetHeight <= 1 && cs.overflow === 'hidden') ok = false;
        visCache.set(el, ok);
        return ok;
      };

      // 固定・貼り付き(ヘッダー・下の帯・トースト・シート)の中か
      const fixedAncestor = (el: Element): HTMLElement | null => {
        for (let e: Element | null = el; e; e = e.parentElement) {
          const p = getComputedStyle(e).position;
          if (p === 'fixed' || p === 'sticky') return e as HTMLElement;
        }
        return null;
      };

      // 横スクロールする入れ物(管理画面の上のメニューなど)の中か
      const scrollerAncestor = (el: Element): HTMLElement | null => {
        for (let e: Element | null = el.parentElement; e && e !== doc && e !== document.body; e = e.parentElement) {
          const o = getComputedStyle(e).overflowX;
          if (o === 'auto' || o === 'scroll') return e as HTMLElement;
        }
        return null;
      };

      // 枠で切られて見えている部分(overflow: hidden の祖先と重ねる)
      const clipRect = (el: Element): DOMRect | null => {
        let r = new DOMRect(-1e5, -1e5, 2e5, 2e5);
        // 自分自身の overflow(行数を決めて … で切る呼び名など)も含める
        for (let e: Element | null = el; e && e !== doc; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
            const b = e.getBoundingClientRect();
            const x1 = Math.max(r.left, b.left), y1 = Math.max(r.top, b.top);
            const x2 = Math.min(r.right, b.right), y2 = Math.min(r.bottom, b.bottom);
            if (x2 <= x1 || y2 <= y1) return null;
            r = new DOMRect(x1, y1, x2 - x1, y2 - y1);
          }
        }
        return r;
      };

      const inter = (a: DOMRect, b: DOMRect) => {
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return { w, h };
      };

      // 横スクロール
      if (doc.scrollWidth > vw + 1) problems.push(`ページが横にはみ出している: ${doc.scrollWidth}px > ${vw}px`);
      if (document.body.scrollWidth > vw + 1 && getComputedStyle(document.body).overflowX !== 'hidden') {
        problems.push(`ページ(body)が横にはみ出している: ${document.body.scrollWidth}px > ${vw}px`);
      }

      // ---- 文字の行を集める(ページ全体の座標で。スクロールの位置によらない) ----
      type Line = { el: HTMLElement; rect: DOMRect; text: string; fixed: HTMLElement | null };
      const lines: Line[] = [];
      const textEls = new Set<HTMLElement>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const sx = window.scrollX, sy = window.scrollY;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent ?? '';
        if (!t.trim()) continue;
        const el = n.parentElement;
        if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'OPTION', 'TEXTAREA'].includes(el.tagName)) continue;
        if (isIgnored(el) || !visible(el)) continue;
        if (el.closest('select, svg')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const clip = clipRect(el);
        if (!clip) continue;
        for (const r of range.getClientRects()) {
          if (r.width < 1 || r.height < 1) continue;
          const vis = inter(r, clip);
          if (vis.w < 1 || vis.h < 1) continue;
          // 枠で切られて見えている部分だけ
          const x1 = Math.max(r.left, clip.left), y1 = Math.max(r.top, clip.top);
          lines.push({ el, rect: new DOMRect(x1 + sx, y1 + sy, vis.w, vis.h), text: t.trim(), fixed: fixedAncestor(el) });
        }
        textEls.add(el);
      }

      // ---- 押す部品を集める ----
      const tapSel = 'button, a[href], [role="button"], [role="slider"], [role="tab"], select, input:not([type="hidden"]), textarea, summary, label';
      type Tap = { el: HTMLElement; rect: DOMRect; fixed: HTMLElement | null };
      const taps: Tap[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(tapSel)) {
        if (isIgnored(el) || !visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        // ラベルは、中に入力欄があるとき(チップ・チェックの行)だけ押す部品として扱う
        if (el.tagName === 'LABEL' && !el.querySelector('input, select, textarea')) continue;
        // スクロールする入れ物の外に出ている部分は見えないので、見えている部分だけで比べる
        const clip = clipRect(el);
        if (!clip) continue;
        const vis = inter(r, clip);
        if (vis.w < 1 || vis.h < 1) continue;
        const x1 = Math.max(r.left, clip.left), y1 = Math.max(r.top, clip.top);
        taps.push({ el, rect: new DOMRect(x1 + sx, y1 + sy, vis.w, vis.h), fixed: fixedAncestor(el) });
      }

      // ---- 1. 文字どうしの重なり ----
      const related = (a: Element, b: Element) => a === b || a.contains(b) || b.contains(a);
      const seen = new Set<string>();
      for (let i = 0; i < lines.length; i++) {
        const a = lines[i]!;
        for (let j = i + 1; j < lines.length; j++) {
          const b = lines[j]!;
          if (related(a.el, b.el)) continue;
          // 固定の部品(ヘッダー・帯)と流れの中の文字は、スクロールで重なるのがふつうなので別に点検する
          if ((a.fixed === null) !== (b.fixed === null)) continue;
          const { w, h } = inter(a.rect, b.rect);
          const minH = Math.min(a.rect.height, b.rect.height);
          if (w > 3 && h > Math.max(3, minH * 0.3)) {
            const key = `${desc(a.el)}|${desc(b.el)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            problems.push(`文字が重なっている: ${desc(a.el)} と ${desc(b.el)}(${Math.round(w)}×${Math.round(h)}px)`);
          }
        }
      }

      // ---- 2. 文字と押す部品の重なり ----
      for (const l of lines) {
        for (const t of taps) {
          if (t.el.contains(l.el) || l.el.contains(t.el)) continue;
          // ラベルの中の文字と入力欄(同じラベルの中)
          const lab = l.el.closest('label');
          if (lab && (lab.contains(t.el) || lab === t.el)) continue;
          if ((l.fixed === null) !== (t.fixed === null)) continue;
          const { w, h } = inter(l.rect, t.rect);
          if (w > 3 && h > Math.max(3, l.rect.height * 0.3)) {
            const key = `${desc(l.el)}|${desc(t.el)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            problems.push(`文字が押す部品に重なっている: ${desc(l.el)} と ${desc(t.el)}(${Math.round(w)}×${Math.round(h)}px)`);
          }
        }
      }

      // ---- 3. 文字が切れている・枠からはみ出している ----
      const allowClipSel = allowClip.join(',');
      for (const el of textEls) {
        if (el.clientWidth === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'inline') continue;
        const allowed = allowClipSel && el.closest(allowClipSel);
        const hidesX = cs.overflowX !== 'visible';
        if (el.scrollWidth > el.clientWidth + 1 && !(cs.overflowX === 'auto' || cs.overflowX === 'scroll')) {
          if (hidesX || cs.textOverflow === 'ellipsis') {
            if (!allowed) problems.push(`文字が横で切れている: ${desc(el)}(${el.scrollWidth}px > ${el.clientWidth}px)`);
          } else if (!allowed && !['svg', 'img'].includes(el.tagName.toLowerCase()) && !scrollerAncestor(el)) {
            problems.push(`文字が枠から横にはみ出している: ${desc(el)}(${el.scrollWidth}px > ${el.clientWidth}px)`);
          }
        }
        const clamp = cs.getPropertyValue('-webkit-line-clamp');
        if ((cs.overflowY === 'hidden' || (clamp && clamp !== 'none')) && el.scrollHeight > el.clientHeight + 2 && !allowed) {
          problems.push(`文字が縦で切れている: ${desc(el)}(${el.scrollHeight}px > ${el.clientHeight}px)`);
        }
      }
      // ボタンの中身(文字を span で包んだものも)がボタンの枠からはみ出していないか
      for (const t of taps) {
        const el = t.el;
        // 文字だけのボタン(.btn)。一覧の行のように中で … を使うものは、行の文字の点検で見る
        if (!el.matches('.btn') || isIgnored(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowX !== 'visible') continue;
        if (el.clientWidth === 0 || (allowClipSel && el.closest(allowClipSel))) continue;
        // 文字の幅が、ボタンの左右の余白を除いた幅に収まっているか(余白に食い込むと、文字が端に付いて見える)
        const range = document.createRange();
        range.selectNodeContents(el);
        const textW = range.getBoundingClientRect().width;
        const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        if ((el.textContent ?? '').trim() && textW > inner + 1) {
          problems.push(`ボタンの文字が枠(余白)からはみ出している: ${desc(el)}(${Math.round(textW)}px > ${Math.round(inner)}px)`);
        }
      }
      // 画面の外(左右)に出ている文字
      for (const l of lines) {
        if (scrollerAncestor(l.el)) continue;
        if (l.rect.right - sx > vw + 1 || l.rect.left - sx < -1) {
          if (l.fixed) continue;
          problems.push(`文字が画面の外に出ている: ${desc(l.el)}`);
        }
      }

      // ---- 4. 押す部品の大きさ ----
      const allowSmallSel = allowSmallTap.join(',');
      for (const t of taps) {
        const el = t.el;
        if (allowSmallSel && el.closest(allowSmallSel)) continue;
        // チェックボックス・ラジオは、ラベルが押せる大きさならよい
        if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
          const lab = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
          if (lab) continue;
        }
        if (el instanceof HTMLInputElement && el.type === 'file') continue;
        // 文の中のリンク(WCAG の例外)
        if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') {
          const p = el.parentElement;
          if (p && (p.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 4) continue;
        }
        const r = el.getBoundingClientRect();
        if (r.height < minTap - 0.5 || r.width < Math.min(minTap, 24) - 0.5) {
          problems.push(`押す部品が小さい(${Math.round(r.width)}×${Math.round(r.height)}px): ${desc(el)}`);
        }
        if (r.right > vw + 1 && !scrollerAncestor(el) && !t.fixed) problems.push(`押す部品が画面の外に出ている: ${desc(el)}`);
      }

      // ---- 5. 写真・アバターのつぶれ ----
      for (const img of document.querySelectorAll('img')) {
        if (!visible(img) || isIgnored(img) || !img.naturalWidth) continue;
        const r = img.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const fit = getComputedStyle(img).objectFit;
        if (fit === 'cover' || fit === 'contain' || fit === 'scale-down') continue;
        const want = img.naturalWidth / img.naturalHeight;
        const got = r.width / r.height;
        if (Math.abs(got - want) / want > 0.03) problems.push(`写真の縦横がつぶれている: ${desc(img)}(${want.toFixed(2)} → ${got.toFixed(2)})`);
      }

      // ---- 6. 改行の位置(目で確かめるための注意) ----
      const byEl = new Map<HTMLElement, DOMRect[]>();
      for (const l of lines) {
        const block = l.el.closest('p, h1, h2, h3, h4, li, button, a, label, dd, dt, td, th, span, div, b, strong') as HTMLElement | null;
        const key = block ?? l.el;
        if (!byEl.has(key)) byEl.set(key, []);
        byEl.get(key)!.push(l.rect);
      }
      for (const [el, rects] of byEl) {
        const rows = new Map<number, { left: number; right: number }>();
        for (const r of rects) {
          const k = Math.round((r.top + r.height / 2) / 4);
          const row = rows.get(k);
          if (row) {
            row.left = Math.min(row.left, r.left);
            row.right = Math.max(row.right, r.right);
          } else rows.set(k, { left: r.left, right: r.right });
        }
        if (rows.size < 2) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        const text = (el.textContent ?? '').trim();
        const last = [...rows.entries()].sort((a, b) => a[0] - b[0]).at(-1)![1];
        if (last.right - last.left < fs * 1.6 && text.length > 3) warnings.push(`最後の行が1文字だけ: ${desc(el)}`);
        const widest = Math.max(...[...rows.values()].map((r) => r.right - r.left));
        if (rows.size >= 3 && widest < fs * 3.5 && text.length >= 6) problems.push(`文字の列が細すぎる(${rows.size}行・幅 ${Math.round(widest)}px): ${desc(el)}`);
        if (/^[\d,.\s]+$/.test(text) || /^[A-Z]{2}-\d+$/.test(text)) problems.push(`数字・会員IDが途中で改行されている: ${desc(el)}`);
        if (el.matches('button, a.btn, .btn')) warnings.push(`ボタンの文字が2行: ${desc(el)}`);
      }

      // ---- 7. 下の帯・上のヘッダーに隠れていないか ----
      if (checkCovered && !modal) {
        const fixedEls = [...document.querySelectorAll<HTMLElement>('body *')].filter((e) => {
          const cs = getComputedStyle(e);
          if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
          if (!visible(e) || isIgnored(e)) return false;
          if (e.closest('.toast-region, .toasts, [role="status"], [role="dialog"], .sheet-root')) return false;
          const r = e.getBoundingClientRect();
          return r.width > vw * 0.6 && r.height > 20 && r.height < vh * 0.5;
        });
        const bottomBars = fixedEls.filter((e) => {
          const r = e.getBoundingClientRect();
          return Math.abs(r.bottom - vh) < 2 && getComputedStyle(e).position === 'fixed';
        });
        // 下に固定した帯は、safe-area の余白を持っているか
        for (const bar of bottomBars) {
          let hasSafe = false;
          for (const sheet of [...document.styleSheets]) {
            let rules: CSSRuleList;
            try {
              rules = sheet.cssRules;
            } catch {
              continue;
            }
            for (const rule of [...rules]) {
              if (!(rule instanceof CSSStyleRule)) continue;
              try {
                if (!bar.matches(rule.selectorText)) continue;
              } catch {
                continue;
              }
              const st = rule.style;
              const text = ['padding-bottom', 'padding', 'bottom', 'margin-bottom', 'height', 'min-height'].map((p) => st.getPropertyValue(p)).join(' ');
              if (/safe-area-inset-bottom|\b34px\b/.test(text)) hasSafe = true;
            }
          }
          if (!hasSafe) problems.push(`下に固定した帯に、ホームバーの余白(safe-area-inset-bottom)がない: ${desc(bar)}`);
        }
        if (bottomBars.length > 0) {
          // いちばん下までスクロールして、流れの中の最後の部品が帯に隠れていないか
          const prev = window.scrollY;
          window.scrollTo(0, doc.scrollHeight);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const barTop = Math.min(...bottomBars.map((b) => b.getBoundingClientRect().top));
          const flow = [...document.querySelectorAll<HTMLElement>('main a[href], main button, main input:not([type=hidden]), main select, main textarea, main summary, main p, main li, main h2, main h3')]
            .filter((e) => visible(e) && !isIgnored(e) && !fixedAncestor(e) && !bottomBars.some((b) => b.contains(e)))
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 1 && r.height > 1;
            });
          for (const e of flow) {
            const r = e.getBoundingClientRect();
            // 見えないようにした入力欄(チップの中など)は、ラベルで点検される
            if (e instanceof HTMLInputElement && (e.type === 'checkbox' || e.type === 'radio') && parseFloat(getComputedStyle(e).opacity) < 0.05) continue;
            if (r.bottom > barTop + 1 && r.top < vh) {
              problems.push(`下の帯に隠れている(いちばん下までスクロールしても): ${desc(e)}(下端 ${Math.round(r.bottom)} > 帯の上端 ${Math.round(barTop)})`);
            }
          }
          window.scrollTo(0, prev);
        }
        // フォーカスした入力欄が帯に隠れていないか
        const active = document.activeElement as HTMLElement | null;
        // (ページの流れの中で下に貼り付く帯も含める)
        const stuckBottom = fixedEls.filter((e) => Math.abs(e.getBoundingClientRect().bottom - vh) < 2);
        if (active && active.matches('input, textarea, select') && stuckBottom.length > 0) {
          const r = active.getBoundingClientRect();
          const barTop = Math.min(...stuckBottom.map((b) => b.getBoundingClientRect().top));
          if (r.bottom > barTop + 1) problems.push(`入力中の欄が下の帯に隠れている: ${desc(active)}`);
        }
        // フォーカスした入力欄とそのラベルが、上に固定・貼り付いたヘッダーに隠れていないか
        if (active && active.matches('input, textarea, select')) {
          const heads = fixedEls.filter((e) => e.getBoundingClientRect().top <= 1);
          if (heads.length > 0) {
            const headBottom = Math.max(...heads.map((b) => b.getBoundingClientRect().bottom));
            const label = (active as HTMLInputElement).labels?.[0] ?? null;
            const lab = label && !label.contains(active) ? label : null;
            const top = Math.min(active.getBoundingClientRect().top, lab ? lab.getBoundingClientRect().top : Infinity);
            const bottomEdge = Math.min(vh, ...stuckBottom.map((b) => b.getBoundingClientRect().top));
            // 入力欄とラベルが、ヘッダーと帯のあいだに入りきらない高さのときは、入力している所が見えていればよい
            const fits = active.getBoundingClientRect().bottom - top <= bottomEdge - headBottom;
            // ラベルの行の上の余白(行間の半分)が少し重なるだけなら、文字は隠れていない(6px まで)
            if (fits && top < headBottom - 6) problems.push(`入力中の欄(またはそのラベル)が上のヘッダーに隠れている: ${desc(active)}(上端 ${Math.round(top)} < ヘッダーの下端 ${Math.round(headBottom)})`);
          }
        }
        // 上に固定したヘッダーの下に、一番上の内容が隠れていないか(スクロールしていないとき)
        const topBars = fixedEls.filter((e) => e.getBoundingClientRect().top <= 1 && getComputedStyle(e).position === 'fixed');
        if (topBars.length > 0 && window.scrollY === 0) {
          const bottom = Math.max(...topBars.map((b) => b.getBoundingClientRect().bottom));
          const first = document.querySelector('main');
          if (first && first.getBoundingClientRect().top < bottom - 1) {
            const firstText = lines.find((l) => !l.fixed && l.rect.top - sy < bottom - 1 && l.el.closest('main'));
            if (firstText) problems.push(`上に固定したヘッダーに隠れている: ${desc(firstText.el)}`);
          }
        }
      }

      return { problems, warnings };
    },
    {
      minTap: opts.minTap ?? 44,
      ignore: opts.ignore ?? [],
      allowClip: opts.allowClip ?? [],
      allowSmallTap: opts.allowSmallTap ?? [],
      checkCovered: opts.checkCovered ?? true,
    },
  );
  return result;
}

/** 写真の保存先(VQA_SHOTS=ディレクトリ のとき) */
export function shotPath(device: string, name: string): string | null {
  const dir = process.env.VQA_SHOTS;
  if (!dir) return null;
  const file = path.join(dir, device, `${name.replace(/[/\\:*?"<>|]/g, '_')}.png`);
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

/** 点検の結果をためておき、最後にまとめて確かめるための入れ物 */
export class VqaLog {
  problems: string[] = [];
  warnings: string[] = [];
  constructor(private device: string) {}
  async check(page: Page, name: string, opts: AuditOptions & { fullPage?: boolean; shoot?: (p: string) => Promise<void> } = {}) {
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const r = await auditPage(page, opts);
    this.problems.push(...[...new Set(r.problems)].map((p) => `[${this.device}] ${name}: ${p}`));
    this.warnings.push(...r.warnings.map((p) => `[${this.device}] ${name}: ${p}`));
    const file = shotPath(this.device, name);
    if (file) {
      if (opts.shoot) await opts.shoot(file);
      else await page.screenshot({ path: file, fullPage: opts.fullPage ?? true });
    }
  }
  report() {
    if (this.warnings.length && process.env.VQA_WARN) console.log(this.warnings.join('\n'));
    // 写真と同じ場所に、点検の結果を書き残す(全部の端末をまとめて見直すため)
    const dir = process.env.VQA_SHOTS;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      appendFileSync(path.join(dir, '_problems.txt'), this.problems.map((p) => `${p}\n`).join(''));
      appendFileSync(path.join(dir, '_warnings.txt'), this.warnings.map((p) => `${p}\n`).join(''));
    }
  }
}
