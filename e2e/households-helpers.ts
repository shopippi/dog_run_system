import { expect, type Page } from '@playwright/test';
import { openCheckin, openLiff } from './helpers';

// おうちの詳細と記録(A-02〜A-06、A-15)の e2e で使う補助。
// 見え方の確かめ方は e2e/admin.layout.spec.ts の checkScreen、コントラストは e2e/contrast.spec.ts の lowContrast と同じ。

/** 終わる動き(ダイアログが開くときなど)が終わるのを待つ */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/**
 * 1つの画面を確かめる(e2e/admin.layout.spec.ts の checkScreen と同じ)。
 * 横にはみ出さない・押す部品の高さ(指 44px / マウス 40px)・入力欄の文字 16px 以上。SHOT_DIR があれば写真を保存する。
 */
export async function checkScreen(page: Page, folder: string, screen: string, touch: boolean) {
  await settle(page);
  const minHeight = touch ? 44 : 40;
  const problems = await page.evaluate((minHeight) => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`横にはみ出し: ${doc.scrollWidth}px > ${doc.clientWidth}px`);
    const pressables = document.querySelectorAll<HTMLElement>(
      'button, a, [role=tab], .chips label, .pick-row, label.check',
    );
    for (const el of pressables) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.closest('[hidden]')) continue;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20);
      if (r.height < minHeight - 0.5) out.push(`押す部品が低い(${Math.round(r.height)}px): ${name}`);
      const inScroller = el.closest('.nav') !== null && doc.clientWidth < 960;
      if (!inScroller && r.right > doc.clientWidth + 1) out.push(`押す部品がはみ出し: ${name}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
      if (el.getBoundingClientRect().width === 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`入力欄の文字が小さい(${size}px): ${el.getAttribute('aria-label') ?? el.id}`);
    }
    return out;
  }, minHeight);
  expect(problems, `${folder} / ${screen}`).toEqual([]);
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/${folder}/${screen}.png`, fullPage: true });
    // 縦に長い画面を丸ごと撮ると、指で操作する端末のまね(pointer: coarse)が外れるため、かけ直す
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    }
  }
}

/** 文字と背景のコントラストが 4.5:1 未満の文字(e2e/contrast.spec.ts の lowContrast と同じ) */
export async function lowContrast(page: Page): Promise<string[]> {
  await settle(page);
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      let m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      m = c.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/);
      if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
      throw new Error(`読めない色: ${c}`);
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => {
      const a = top[3];
      return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
    };
    const hex = (c: RGBA) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const luminance = (c: RGBA) => {
      const [r, g, b] = c.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const backgroundOf = (el: Element): RGBA => {
      const layers: RGBA[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const bg = parse(getComputedStyle(n).backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      let color: RGBA = [255, 255, 255, 1];
      for (const layer of layers.reverse()) color = over(layer, color);
      return color;
    };
    const opacityOf = (el: Element) => {
      let o = 1;
      for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      return o;
    };
    const out: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!text) continue;
      if (el.closest('svg, select, option, script, style, .sr-only, button:disabled, [aria-disabled="true"]')) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      const bg = backgroundOf(el);
      const fgRaw = parse(getComputedStyle(el).color);
      const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacityOf(el)], bg);
      const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      if (ratio < 4.5) {
        const name = el.tagName.toLowerCase() + [...el.classList].map((c) => `.${c}`).join('');
        out.push(`${name}「${text.slice(0, 24)}」 文字 ${hex(fg)} / 背景 ${hex(bg)} = ${ratio.toFixed(2)}:1`);
      }
    }
    return out;
  });
}

/** お客さんとしてチェックインする(LIFF の画面から) */
export async function checkinViaLiff(page: Page, user: string) {
  await openCheckin(page, user);
  await page.getByRole('button', { name: 'チェックインする' }).click();
  await page.getByRole('region', { name: 'チェックイン完了' }).waitFor();
}

/** 今日の来場から、犬の名前の行のチェックインを取り消す(S-03) */
export async function cancelOnToday(page: Page, dogName: string, reason = '入力ミス') {
  await page.getByRole('link', { name: '今日の来場' }).click();
  const row = page.getByRole('listitem', { name: new RegExp(dogName) }).first();
  await row.getByRole('button', { name: '取り消す' }).click();
  const dialog = page.getByRole('dialog', { name: 'チェックインを取り消す' });
  await dialog.getByRole('radio', { name: reason }).check();
  await dialog.getByRole('button', { name: '取り消す' }).click();
  await row.getByText(/取り消し済み/).waitFor();
}

/** 受付の招待QR(A-06)を API で作り、家族として参加させる(画面の確かめに使う準備) */
export async function joinByReceptionInvite(admin: Page, customer: Page, householdId: number, user: string) {
  const res = await admin.request.post(`/admin/api/households/${householdId}/invite-qr`, { headers: { 'x-dr-admin': '1' } });
  const { url } = (await res.json()) as { url: string };
  await openLiff(customer, user, url.replace('/liff', ''));
  await customer.getByRole('radiogroup', { name: /年代/ }).getByRole('radio', { name: '40代' }).check();
  await customer.getByRole('radiogroup', { name: /性別/ }).getByRole('radio', { name: '女性' }).check();
  await customer.getByLabel('利用規約とプライバシーポリシーに同意します').check();
  await customer.getByRole('button', { name: '参加する' }).click();
  await customer.getByText('参加しました').waitFor();
}
