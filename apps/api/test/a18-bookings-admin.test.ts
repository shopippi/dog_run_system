import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminCall, call, createStaff, dog, login, registerUser } from './helpers';

// A-18 予約カレンダー・A-19 確認待ち・A-20 手入力・A-21 状態の変更・A-22 受け入れ数の上書き(要件定義書 21章)

const NOW = '2026-10-31T10:00:00+09:00';
const DAY = '2026-11-04';

let admin: string;
let staff: string;
let developer: string;

beforeEach(async () => {
  await createStaff('admin@example.com', 'admin');
  await createStaff('staff@example.com', 'staff');
  await createStaff('dev@example.com', 'developer');
  admin = await login('admin@example.com');
  staff = await login('staff@example.com');
  developer = await login('dev@example.com');
});

const request = (user: string, dogIds: number[], extra: Record<string, unknown> = {}) =>
  call('/api/bookings', {
    user,
    now: NOW,
    body: {
      service: 'daycare',
      startDate: DAY,
      endDate: DAY,
      startTime: '10:00',
      endTime: '16:00',
      dogIds,
      checklist: ['狂犬病の予防注射と混合ワクチンを、1年以内に受けています', 'ノミ・ダニの予防をしています'],
      ...extra,
    },
  });

async function householdId(memberNo: string) {
  return (await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(memberNo).first<{ id: number }>())!.id;
}

async function counts() {
  const b = await env.DB.prepare('SELECT COUNT(*) AS n FROM bookings').first<{ n: number }>();
  const d = await env.DB.prepare('SELECT COUNT(*) AS n FROM booking_dogs').first<{ n: number }>();
  return { bookings: b!.n, dogs: d!.n };
}

/** はじめての子の予約(確認待ち) */
async function pendingBooking(user = 'U001:ママ') {
  const u = await registerUser(user);
  const r = await request(user, [u.dogs[0]!.id]);
  expect(r.body.status).toBe('pending');
  return { id: r.body.id as number, u };
}

describe('確認待ち(A-19)', () => {
  it('確認待ちの一覧と件数。承認すると確定になり、お客さんの画面も確定になる', async () => {
    const { id } = await pendingBooking();
    const cnt = await adminCall('/admin/api/bookings/pending-count', { cookie: staff, now: NOW });
    expect(cnt.body.count).toBe(1);
    const list = await adminCall('/admin/api/bookings?status=pending', { cookie: staff, now: NOW });
    expect(list.body.bookings).toHaveLength(1);
    expect(list.body.bookings[0]).toMatchObject({ id, approvalReason: 'first_time', householdName: expect.any(String) });
    expect(list.body.bookings[0].dogs[0].firstTime).toBe(true);

    const ok = await adminCall(`/admin/api/bookings/${id}/approve`, { cookie: staff, now: NOW, body: { message: 'お待ちしています' } });
    expect(ok.status).toBe(200);
    expect(ok.body.booking).toMatchObject({ status: 'confirmed', decisionMessage: 'お待ちしています', decidedBy: '受付' });
    expect(ok.body.booking.notifications[0]).toMatchObject({ kind: 'confirmed', status: 'skipped', reason: 'no_token' });
    expect(ok.body.auditId).toEqual(expect.any(Number));

    const mine = await call(`/api/bookings/${id}`, { user: 'U001:ママ', now: NOW });
    expect(mine.body).toMatchObject({ status: 'confirmed', decisionMessage: 'お待ちしています' });
    expect((await adminCall('/admin/api/bookings/pending-count', { cookie: staff, now: NOW })).body.count).toBe(0);
  });

  it('お断りすると枠が空き、お客さんに一言とお断りのお知らせ(記録)', async () => {
    const { id } = await pendingBooking();
    const r = await adminCall(`/admin/api/bookings/${id}/decline`, { cookie: admin, now: NOW, body: { message: 'その日は貸し切りです' } });
    expect(r.body.booking.status).toBe('declined');
    expect(r.body.booking.notifications[0]).toMatchObject({ kind: 'declined', status: 'skipped' });
    expect(r.body.booking.notifications[0].message).toContain('その日は貸し切りです');
    const cal = await adminCall(`/admin/api/bookings/calendar?service=daycare&from=${DAY}&to=${DAY}`, { cookie: admin, now: NOW });
    expect(cal.body.days[0].used).toEqual({ small: 0, medium: 0, large: 0 });
  });

  it('もう確認待ちでない予約は承認できない(同時に2回押しても1回だけ)', async () => {
    const { id } = await pendingBooking();
    const [a, b] = await Promise.all([
      adminCall(`/admin/api/bookings/${id}/approve`, { cookie: admin, now: NOW, body: {} }),
      adminCall(`/admin/api/bookings/${id}/approve`, { cookie: admin, now: NOW, body: {} }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const logs = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'booking.approve'").first<{ n: number }>();
    expect(logs!.n).toBe(1);
  });
});

describe('予約カレンダーと日のパネル(A-18)', () => {
  it('サイズごとの受け入れ数と使っている数、予約の数と確認待ちの数', async () => {
    await pendingBooking();
    const big = await registerUser('U002:大型', [dog('ラブ', { breedId: 9, size: 'large' })]);
    await env.DB.prepare("UPDATE dogs SET stay_experience_at = 'x' WHERE id = ?").bind(big.dogs[0]!.id).run();
    expect((await request('U002:大型', [big.dogs[0]!.id])).body.status).toBe('confirmed');
    const cal = await adminCall(`/admin/api/bookings/calendar?service=daycare&from=${DAY}&to=2026-11-05`, { cookie: staff, now: NOW });
    expect(cal.body.days[0]).toMatchObject({
      date: DAY,
      caps: { small: 5, medium: 3, large: 2 },
      used: { small: 1, medium: 0, large: 1 },
      bookings: 2,
      pending: 1,
    });
    expect(cal.body.pendingTotal).toBe(1);
    const day = await adminCall(`/admin/api/bookings/day?date=${DAY}&service=daycare`, { cookie: developer, now: NOW });
    expect(day.status).toBe(200);
    expect(day.body.bookings).toHaveLength(2);
    expect(day.body.bookings[0].dogs[0].thumbUrl === null || day.body.bookings[0].dogs[0].thumbUrl.startsWith('/admin/api/media/')).toBe(true);
  });

  it('その日を休みにする・頭数を変える・いつもの数に戻す(管理者だけ。操作ログから元に戻せる)', async () => {
    const put = (cookie: string, body: unknown) => adminCall('/admin/api/bookings/overrides', { cookie, now: NOW, method: 'PUT', body });
    expect((await put(staff, { date: DAY, service: 'daycare', closed: true })).status).toBe(403);
    expect((await put(developer, { date: DAY, service: 'daycare', closed: true })).status).toBe(403);
    const r = await put(admin, { date: DAY, service: 'daycare', caps: { small: 8, medium: null, large: 0 }, note: '小型の日' });
    expect(r.status).toBe(200);
    let cal = await adminCall(`/admin/api/bookings/calendar?service=daycare&from=${DAY}&to=${DAY}`, { cookie: admin, now: NOW });
    expect(cal.body.days[0]).toMatchObject({ overridden: true, caps: { small: 8, medium: 3, large: 0 } });
    // 休みに変える(前の行は消さずに deleted_at)
    await put(admin, { date: DAY, service: 'daycare', closed: true, note: '研修' });
    cal = await adminCall(`/admin/api/bookings/calendar?service=daycare&from=${DAY}&to=${DAY}`, { cookie: admin, now: '2026-10-31T10:00:05+09:00' });
    expect(cal.body.days[0]).toMatchObject({ closed: true, closedReason: '研修' });
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM booking_capacity_overrides').first<{ n: number }>();
    expect(rows!.n).toBe(2);
    // 元に戻すと、前の「小型8」に戻る
    const log = await env.DB.prepare("SELECT id FROM audit_log WHERE action = 'booking.override' ORDER BY id DESC").first<{ id: number }>();
    expect((await adminCall(`/admin/api/audit/${log!.id}/undo`, { cookie: admin, now: NOW, body: {} })).status).toBe(200);
    cal = await adminCall(`/admin/api/bookings/calendar?service=daycare&from=${DAY}&to=${DAY}`, { cookie: admin, now: NOW });
    expect(cal.body.days[0]).toMatchObject({ closed: false, caps: { small: 8, medium: 3, large: 0 } });
    // いつもの数に戻す
    await put(admin, { date: DAY, service: 'daycare', reset: true });
    cal = await adminCall(`/admin/api/bookings/calendar?service=daycare&from=${DAY}&to=${DAY}`, { cookie: admin, now: NOW });
    expect(cal.body.days[0]).toMatchObject({ overridden: false, caps: { small: 5, medium: 3, large: 2 } });
  });
});

describe('受付での手入力(A-20)', () => {
  it('受付スタッフが電話の予約を入れる。いつも確定で、LINE のお知らせは送らない', async () => {
    const u = await registerUser('U001:ママ');
    const r = await adminCall('/admin/api/bookings', {
      cookie: staff,
      now: NOW,
      body: { householdId: await householdId(u.memberNo), dogIds: [u.dogs[0]!.id], service: 'boarding', startDate: DAY, endDate: '2026-11-06', startTime: '10:00', endTime: '17:00', staffNote: '電話で受けた' },
    });
    expect(r.status).toBe(201);
    expect(r.body.booking).toMatchObject({ status: 'confirmed', source: 'staff', staffNote: '電話で受けた', estimateTotal: 20000 });
    // お客さんの画面にも出る
    const mine = await call('/api/bookings', { user: 'U001:ママ', now: NOW });
    expect(mine.body.upcoming).toHaveLength(1);
  });

  it('いっぱいの日は 409。受付スタッフは理由を書いても入れられない。管理者は理由を書けば入れられる', async () => {
    const hh: number[] = [];
    const dogs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const u = await registerUser(`UL${i}:大型${i}`, [dog(`ラブ${i}`, { breedId: 9, size: 'large' })]);
      hh.push(await householdId(u.memberNo));
      dogs.push(u.dogs[0]!.id);
    }
    const body = (i: number, extra: Record<string, unknown> = {}) => ({
      householdId: hh[i], dogIds: [dogs[i]], service: 'daycare', startDate: DAY, endDate: DAY, startTime: '10:00', endTime: '16:00', ...extra,
    });
    expect((await adminCall('/admin/api/bookings', { cookie: staff, now: NOW, body: body(0) })).status).toBe(201);
    expect((await adminCall('/admin/api/bookings', { cookie: staff, now: NOW, body: body(1) })).status).toBe(201);
    const full = await adminCall('/admin/api/bookings', { cookie: staff, now: NOW, body: body(2) });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('booking_full');
    expect(full.body.error.message).toContain('管理者が理由を書いて');
    expect((await adminCall('/admin/api/bookings', { cookie: staff, now: NOW, body: body(2, { overrideReason: '常連さん' }) })).status).toBe(403);
    const forced = await adminCall('/admin/api/bookings', { cookie: admin, now: NOW, body: body(2, { overrideReason: '常連さんのため' }) });
    expect(forced.status).toBe(201);
    expect(forced.body.booking.capacityOverrideReason).toBe('常連さんのため');
    const log = await env.DB.prepare("SELECT reason FROM audit_log WHERE action = 'booking.create' ORDER BY id DESC").first<{ reason: string }>();
    expect(log!.reason).toBe('常連さんのため');
  });

  it('受付の手入力は、予約できる期間の決まりを外せる(今日の予約)', async () => {
    const u = await registerUser('U001:ママ');
    const r = await adminCall('/admin/api/bookings', {
      cookie: staff,
      now: NOW,
      body: { householdId: await householdId(u.memberNo), dogIds: [u.dogs[0]!.id], service: 'daycare', startDate: '2026-10-31', endDate: '2026-10-31', startTime: '11:00', endTime: '15:00' },
    });
    expect(r.status).toBe(201);
  });
});

describe('状態の変更(A-21)と元に戻す', () => {
  async function confirmed() {
    const { id } = await pendingBooking();
    await adminCall(`/admin/api/bookings/${id}/approve`, { cookie: staff, now: NOW, body: {} });
    return id;
  }
  const lastLog = async (action: string) =>
    (await env.DB.prepare('SELECT id FROM audit_log WHERE action = ? ORDER BY id DESC').bind(action).first<{ id: number }>())!.id;
  const undo = (id: number) => adminCall(`/admin/api/audit/${id}/undo`, { cookie: admin, now: NOW, body: {} });

  it('利用開始 → 利用済み。元に戻すと1つ前の状態に戻る', async () => {
    const id = await confirmed();
    expect((await adminCall(`/admin/api/bookings/${id}/check-in`, { cookie: staff, now: NOW, body: {} })).body.booking.status).toBe('checked_in');
    expect((await adminCall(`/admin/api/bookings/${id}/complete`, { cookie: staff, now: NOW, body: {} })).body.booking.status).toBe('completed');
    expect((await undo(await lastLog('booking.complete'))).status).toBe(200);
    let d = await adminCall(`/admin/api/bookings/${id}`, { cookie: staff, now: NOW });
    expect(d.body).toMatchObject({ status: 'checked_in', completedAt: null });
    expect((await undo(await lastLog('booking.check_in'))).status).toBe(200);
    d = await adminCall(`/admin/api/bookings/${id}`, { cookie: staff, now: NOW });
    expect(d.body).toMatchObject({ status: 'confirmed', checkedInAt: null });
  });

  it('利用開始にした子は、次の予約からすぐ確定(預かり経験あり)', async () => {
    const id = await confirmed();
    await adminCall(`/admin/api/bookings/${id}/check-in`, { cookie: staff, now: NOW, body: {} });
    const dogId = (await env.DB.prepare('SELECT dog_id FROM booking_dogs WHERE booking_id = ?').bind(id).first<{ dog_id: number }>())!.dog_id;
    const next = await request('U001:ママ', [dogId], { startDate: '2026-11-08', endDate: '2026-11-08' });
    expect(next.body.status).toBe('confirmed');
  });

  it('来なかった・キャンセル(理由は必須)。キャンセルを元に戻すと、空いていれば枠を取り直す', async () => {
    const id = await confirmed();
    expect((await adminCall(`/admin/api/bookings/${id}/cancel`, { cookie: staff, now: NOW, body: {} })).status).toBe(400);
    const c = await adminCall(`/admin/api/bookings/${id}/cancel`, { cookie: staff, now: NOW, body: { reason: '体調不良の連絡' } });
    expect(c.body.booking).toMatchObject({ status: 'cancelled', cancelReason: '体調不良の連絡', cancelledBy: '受付' });
    expect((await undo(await lastLog('booking.cancel'))).status).toBe(200);
    const d = await adminCall(`/admin/api/bookings/${id}`, { cookie: staff, now: NOW });
    expect(d.body).toMatchObject({ status: 'confirmed', cancelReason: null });
    expect((await adminCall(`/admin/api/bookings/${id}/no-show`, { cookie: staff, now: NOW, body: {} })).body.booking.status).toBe('no_show');
  });

  it('キャンセルのあとにその日がいっぱいになったら、元に戻せない', async () => {
    await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('booking_capacity', '{"daycare":{"small":1,"medium":3,"large":2},"boarding":{"small":5,"medium":3,"large":2}}', 'x')`).run();
    const id = await confirmed();
    await adminCall(`/admin/api/bookings/${id}/cancel`, { cookie: staff, now: NOW, body: { reason: '都合' } });
    const other = await registerUser('U002:よそ');
    expect((await request('U002:よそ', [other.dogs[0]!.id])).status).toBe(201);
    const r = await undo(await lastLog('booking.cancel'));
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('いっぱい');
    // 戻せなかったときは「元に戻し済み」にしない
    const log = await env.DB.prepare("SELECT undone_at FROM audit_log WHERE action = 'booking.cancel'").first<{ undone_at: string | null }>();
    expect(log!.undone_at).toBeNull();
  });

  it('手入力を元に戻すとキャンセルになる(行は消さない)', async () => {
    const u = await registerUser('U001:ママ');
    const r = await adminCall('/admin/api/bookings', {
      cookie: staff,
      now: NOW,
      body: { householdId: await householdId(u.memberNo), dogIds: [u.dogs[0]!.id], service: 'daycare', startDate: DAY, endDate: DAY, startTime: '10:00', endTime: '16:00' },
    });
    const before = await counts();
    expect((await undo(r.body.auditId)).status).toBe(200);
    const d = await adminCall(`/admin/api/bookings/${r.body.booking.id}`, { cookie: staff, now: NOW });
    expect(d.body.status).toBe('cancelled');
    expect(await counts()).toEqual(before);
  });

  it('お断り・キャンセル・来なかったでも、予約の行とワンちゃんの行は消えない', async () => {
    const a = await pendingBooking('U001:ママ');
    const b = await pendingBooking('U002:パパ');
    const before = await counts();
    await adminCall(`/admin/api/bookings/${a.id}/decline`, { cookie: staff, now: NOW, body: {} });
    await call(`/api/bookings/${b.id}/cancel`, { user: 'U002:パパ', body: {}, now: NOW });
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ bookings: 2, dogs: 2 });
  });
});

describe('権限', () => {
  it('製作者は見られるが、変更はすべて 403', async () => {
    const { id, u } = await pendingBooking();
    expect((await adminCall(`/admin/api/bookings/${id}`, { cookie: developer, now: NOW })).status).toBe(200);
    expect((await adminCall('/admin/api/bookings?status=pending', { cookie: developer, now: NOW })).status).toBe(200);
    for (const path of ['approve', 'decline', 'check-in', 'complete', 'no-show', 'cancel']) {
      const r = await adminCall(`/admin/api/bookings/${id}/${path}`, { cookie: developer, now: NOW, body: { reason: 'x' } });
      expect(r.status, path).toBe(403);
    }
    const manual = await adminCall('/admin/api/bookings', {
      cookie: developer,
      now: NOW,
      body: { householdId: await householdId(u.memberNo), dogIds: [u.dogs[0]!.id], service: 'daycare', startDate: DAY, endDate: DAY, startTime: '10:00', endTime: '16:00' },
    });
    expect(manual.status).toBe(403);
    expect((await adminCall(`/admin/api/dogs/${u.dogs[0]!.id}/stay-experience`, { cookie: developer, now: NOW, body: { experienced: true } })).status).toBe(403);
    expect((await adminCall('/admin/api/settings', { cookie: developer, now: NOW, method: 'PATCH', body: { booking_approve_all: true } })).status).toBe(403);
  });

  it('受付スタッフは予約の設定を変えられない(ルールの設定は管理者だけ)', async () => {
    expect((await adminCall('/admin/api/settings', { cookie: staff, now: NOW, method: 'PATCH', body: { booking_approve_all: true } })).status).toBe(403);
    const ok = await adminCall('/admin/api/settings', { cookie: admin, now: NOW, method: 'PATCH', body: { booking_approve_all: true, booking_checklist: ['狂犬病・混合ワクチンの接種'] } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.booking_approve_all).toBe(true);
    // 受付スタッフも予約の画面に要る設定は読める
    const opts = await adminCall('/admin/api/bookings/options', { cookie: staff, now: NOW });
    expect(opts.body.rules.booking_checklist).toEqual(['狂犬病・混合ワクチンの接種']);
  });

  it('ログインしていなければ 401', async () => {
    expect((await adminCall('/admin/api/bookings/pending-count', { now: NOW })).status).toBe(401);
  });

  it('預かり経験ありの印(管理者だけ。操作ログから元に戻せる)', async () => {
    const u = await registerUser('U001:ママ');
    const dogId = u.dogs[0]!.id;
    expect((await adminCall(`/admin/api/dogs/${dogId}/stay-experience`, { cookie: staff, now: NOW, body: { experienced: true } })).status).toBe(403);
    const r = await adminCall(`/admin/api/dogs/${dogId}/stay-experience`, { cookie: admin, now: NOW, body: { experienced: true } });
    expect(r.status).toBe(200);
    expect((await request('U001:ママ', [dogId])).body.status).toBe('confirmed');
    expect((await adminCall(`/admin/api/audit/${r.body.auditId}/undo`, { cookie: admin, now: NOW, body: {} })).status).toBe(200);
    const opts = await call('/api/bookings/options', { user: 'U001:ママ', now: NOW });
    expect(opts.body.dogs[0].experienced).toBe(false);
  });
});

describe('CSV とシステムの状態', () => {
  it('予約の CSV(説明行・日本語の列名)と、分析パックの予約の列(個人情報なし)', async () => {
    const u = await registerUser('U001:ママ');
    await env.DB.prepare("UPDATE dogs SET stay_experience_at = 'x' WHERE id = ?").bind(u.dogs[0]!.id).run();
    await request('U001:ママ', [u.dogs[0]!.id]);
    const res = await adminCall<string>('/admin/api/export/bookings', { cookie: admin, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body).toContain('# ');
    expect(res.body).toContain('予約番号,種類,状態,利用の初日');
    expect(res.body).toContain('預かり,確定,2026-11-04');
    const pack = await adminCall<string>(`/admin/api/export/analysis?from=${DAY}&to=${DAY}`, { cookie: admin, now: NOW });
    expect(pack.body).toContain('預かりの予約(頭),お泊まりの予約(頭)');
    const line = pack.body.split('\n').find((l) => l.startsWith(DAY))!;
    expect(line.endsWith(',1,0') || line.endsWith(',1,0\r')).toBe(true);
    expect(pack.body).not.toContain(u.memberNo);
  });

  it('システムの状態に、今月の LINE のお知らせの数', async () => {
    const u = await registerUser('U001:ママ');
    await env.DB.prepare("UPDATE dogs SET stay_experience_at = 'x' WHERE id = ?").bind(u.dogs[0]!.id).run();
    await request('U001:ママ', [u.dogs[0]!.id]);
    await env.DB.prepare(
      "INSERT INTO booking_notifications (booking_id, kind, status, message, month, created_at) SELECT id, 'confirmed', 'sent', 'x', '2026-10', 'x' FROM bookings",
    ).run();
    const s = await adminCall('/admin/api/system-status', { cookie: admin, now: NOW });
    expect(s.body.lineMessages).toEqual({ month: '2026-10', sent: 1, skipped: 1, failed: 0, limit: 200, configured: false });
  });
});
