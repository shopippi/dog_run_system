import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, adminCall, call, createStaff, dog, fakeJpeg, login, registerUser } from './helpers';

// C-06 会員証の背景(docs/design.md 5章 L-07・L-07b、docs/changes-2026-10-28.md 8章)。
// おうちで共通。単色 8 色か、自分の写真(スマホで縮小して送る。1.8MB まで)。写真は認証つきの API からだけ返す。

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const OTHER = 'U009:よその人';
const NOW = '2026-10-28T03:00:00Z';

const me = (user: string) => call('/api/me', { user, now: NOW });
const putPreset = (user: string, color: unknown) =>
  call('/api/me/card-background', { user, method: 'PUT', body: { color }, now: NOW });

function photoForm(bytes: Uint8Array, name = 'card.jpg', type = 'image/jpeg') {
  const form = new FormData();
  form.append('photo', new File([bytes], name, { type }));
  return form;
}
const postPhoto = (user: string, form: FormData) => call('/api/me/card-background/photo', { user, body: form, now: NOW });

async function householdRow(memberNo: string) {
  return env.DB.prepare('SELECT id, card_background FROM households WHERE member_no = ?')
    .bind(memberNo)
    .first<{ id: number; card_background: string | null }>();
}

describe('C-06 会員証の背景', () => {
  it('初期値は墨の単色。単色を選ぶと保存され、家族にも同じ背景が出る。操作ログに家族の操作として残る', async () => {
    const papa = await registerUser(PAPA, [dog('アル')]);
    await addFamily(papa.memberNo, 'U002', 'ママ');
    expect((await me(PAPA)).body.cardBackground).toEqual({ kind: 'preset', color: 'ink' });
    expect((await householdRow(papa.memberNo))!.card_background).toBeNull();

    // 家族の誰でも変えられる
    const res = await putPreset(MAMA, 'navy');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cardBackground: { kind: 'preset', color: 'navy' } });
    expect((await me(PAPA)).body.cardBackground).toEqual({ kind: 'preset', color: 'navy' });
    expect((await call('/api/me/card-background', { user: PAPA, now: NOW })).body.cardBackground).toEqual({
      kind: 'preset',
      color: 'navy',
    });

    const mama = await env.DB.prepare("SELECT id FROM family_members WHERE line_user_id = 'U002'").first<{ id: number }>();
    const log = await env.DB.prepare(
      "SELECT actor_type, actor_id, target_type, target_id, before_value, after_value FROM audit_log WHERE action = 'household.card_background'",
    ).first<Record<string, unknown>>();
    expect(log).toMatchObject({
      actor_type: 'member',
      actor_id: mama!.id,
      target_type: 'household',
      target_id: String((await householdRow(papa.memberNo))!.id),
    });
    expect(JSON.parse(String(log!.before_value))).toEqual({ kind: 'preset', color: 'ink' });
    expect(JSON.parse(String(log!.after_value))).toEqual({ kind: 'preset', color: 'navy' });
  });

  it('用意した 8 色以外は 400', async () => {
    await registerUser(PAPA);
    for (const color of ['ink', 'navy', 'forest', 'brown', 'wine', 'gray', 'sand', 'white']) {
      expect((await putPreset(PAPA, color)).status).toBe(200);
    }
    for (const color of ['green', '#ff0000', '', null, 3]) {
      const res = await putPreset(PAPA, color);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('色を選び直してください。');
    }
  });

  it('写真を保存すると、認証つきの API から取り出せる。前の写真は消さず、操作ログに前後のキーが残る', async () => {
    const papa = await registerUser(PAPA);
    const hh = await householdRow(papa.memberNo);
    const first = await postPhoto(PAPA, photoForm(fakeJpeg(1200, 800)));
    expect(first.status).toBe(200);
    const url1 = first.body.cardBackground.url as string;
    expect(first.body.cardBackground.kind).toBe('photo');
    expect(url1).toMatch(new RegExp(`^/api/media/cards/${hh!.id}/[0-9a-f-]{36}\\.jpg$`));
    expect((await me(PAPA)).body.cardBackground).toEqual({ kind: 'photo', url: url1 });

    const img = await call(url1, { user: PAPA, now: NOW });
    expect(img.status).toBe(200);
    // 認証がなければ開けない
    expect((await call(url1, { now: NOW })).status).toBe(401);

    // PNG・WebP も受け取る
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const second = await postPhoto(PAPA, photoForm(png, 'card.png', 'image/png'));
    expect(second.status).toBe(200);
    expect(second.body.cardBackground.url).toMatch(/\.png$/);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
    const third = await postPhoto(PAPA, photoForm(webp, 'card.webp', 'image/webp'));
    expect(third.status).toBe(200);

    // 前の写真のファイルは残る。ただし、いまの背景でなくなった写真は API からは開けない
    const key1 = url1.slice('/api/media/'.length);
    expect(await env.MEDIA.get(key1)).not.toBeNull();
    expect((await call(url1, { user: PAPA, now: NOW })).status).toBe(404);
    const { results } = await env.DB.prepare(
      "SELECT before_value, after_value FROM audit_log WHERE action = 'household.card_background' ORDER BY id",
    ).all<{ before_value: string; after_value: string }>();
    expect(results).toHaveLength(3);
    expect(JSON.parse(results[1]!.before_value)).toEqual({ kind: 'photo', key: key1 });

    // 写真をやめると墨に戻る(写真のファイルは消さない)
    const off = await call('/api/me/card-background/photo', { user: PAPA, method: 'DELETE', now: NOW });
    expect(off.status).toBe(200);
    expect(off.body.cardBackground).toEqual({ kind: 'preset', color: 'ink' });
    expect(await env.MEDIA.get(third.body.cardBackground.url.slice('/api/media/'.length))).not.toBeNull();
  });

  it('ほかのおうちの背景の写真は 403 で開けない。家族は開ける', async () => {
    const papa = await registerUser(PAPA);
    await addFamily(papa.memberNo, 'U002', 'ママ');
    await registerUser(OTHER, [dog('ポチ')]);
    const res = await postPhoto(PAPA, photoForm(fakeJpeg(800, 600)));
    const url = res.body.cardBackground.url as string;
    expect((await call(url, { user: MAMA, now: NOW })).status).toBe(200);
    const stranger = await call(url, { user: OTHER, now: NOW });
    expect(stranger.status).toBe(403);
    expect(stranger.body.error.message).toContain('ほかのおうちの写真は開けません');
  });

  it('登録していない人は変えられない。1.8MB を超える写真と、写真でないファイルは 400', async () => {
    expect((await putPreset('U050:まだの人', 'navy')).status).toBe(409);
    await registerUser(PAPA);
    const big = new Uint8Array(1_800_001);
    big.set(fakeJpeg(1200, 800));
    const tooBig = await postPhoto(PAPA, photoForm(big));
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.message).toContain('1.8MB');
    // ちょうど 1.8MB は受け取る
    const just = new Uint8Array(1_800_000);
    just.set(fakeJpeg(1200, 800));
    expect((await postPhoto(PAPA, photoForm(just))).status).toBe(200);

    const text = await postPhoto(PAPA, photoForm(new TextEncoder().encode('hello, this is not a photo'), 'a.txt', 'text/plain'));
    expect(text.status).toBe(400);
    expect(text.body.error.message).toContain('写真の形式に対応していません');
    const none = await call('/api/me/card-background/photo', { user: PAPA, body: new FormData(), now: NOW });
    expect(none.status).toBe(400);
  });

  it('管理画面のアカウント(製作者を含む)では、お客さんの背景の API は使えない。おうちの詳細には背景の種類だけが出る', async () => {
    const papa = await registerUser(PAPA);
    await createStaff('dev@example.com', 'developer');
    const cookie = await login('dev@example.com');
    const asStaff = await adminCall('/api/me/card-background', { cookie, method: 'PUT', body: { color: 'navy' } });
    expect(asStaff.status).toBe(401);

    const hh = await householdRow(papa.memberNo);
    const before = await adminCall(`/admin/api/households/${hh!.id}`, { cookie });
    expect(before.body.cardBackgroundLabel).toBe('単色(墨)');
    await postPhoto(PAPA, photoForm(fakeJpeg(800, 600)));
    const after = await adminCall(`/admin/api/households/${hh!.id}`, { cookie });
    expect(after.body.cardBackgroundLabel).toBe('写真');
    expect(JSON.stringify(after.body)).not.toContain('cards/');
  });

  it('おうちをまとめると、残す側が初期値のままなら、まとめる側の背景とアンケートの回答を引き継ぐ。元に戻すと統合の前の値に戻る', async () => {
    await createStaff('admin@example.com', 'admin');
    const admin = await login('admin@example.com');
    const papa = await registerUser(PAPA, [dog('アル')]);
    const mama = await registerUser(MAMA, [dog('モカ')]);
    await putPreset(MAMA, 'wine');
    await env.DB.prepare("UPDATE households SET preferred_times = '[\"平日の昼\"]', wants_news = 1 WHERE member_no = ?")
      .bind(mama.memberNo)
      .run();
    await env.DB.prepare('UPDATE households SET wants_news = 0 WHERE member_no = ?').bind(papa.memberNo).run();
    const keep = (await householdRow(papa.memberNo))!.id;
    const absorb = (await householdRow(mama.memberNo))!.id;
    const merged = await adminCall('/admin/api/merges', {
      cookie: admin,
      body: { keepHouseholdId: keep, absorbHouseholdId: absorb, dogPairs: [] },
      now: NOW,
    });
    expect(merged.status).toBe(201);
    const row = () =>
      env.DB.prepare('SELECT card_background, preferred_times, wants_news FROM households WHERE id = ?')
        .bind(keep)
        .first<Record<string, unknown>>();
    expect(await row()).toEqual({
      card_background: JSON.stringify({ kind: 'preset', color: 'wine' }),
      preferred_times: '["平日の昼"]',
      // 残す側に答えがあれば、そのまま
      wants_news: 0,
    });
    expect((await me(PAPA)).body.cardBackground).toEqual({ kind: 'preset', color: 'wine' });

    const undo = await adminCall(`/admin/api/merges/${merged.body.mergeId}/undo`, { cookie: admin, body: {}, now: NOW });
    expect(undo.status).toBe(200);
    expect(await row()).toEqual({ card_background: null, preferred_times: null, wants_news: 0 });
  });
});
