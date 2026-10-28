import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, checkin, dog, fakeJpeg, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const T0 = '2026-10-28T01:00:00Z';
const memberSurvey = [
  { questionId: 1, value: '30代' },
  { questionId: 2, value: '女性' },
];

async function invite(user = PAPA, now = T0) {
  const res = await call('/api/invites', { user, method: 'POST', now });
  return res.body.code as string;
}

describe('C-12 招待からの参加', () => {
  it('招待を開くと、おうちの呼び名と犬、はじめての人に聞く質問(年代・性別)を返す', async () => {
    await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    const code = await invite();
    const res = await call(`/api/invites/${code}`, { user: MAMA, now: T0 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'valid', householdName: 'アル・ニコのおうち', viewer: 'new' });
    expect(res.body.dogs.map((d: { name: string }) => d.name)).toEqual(['アル', 'ニコ']);
    expect(res.body.questions.map((q: { fixedKey: string }) => q.fixedKey)).toEqual(['age_group', 'gender']);
    expect(res.body.terms.termsText).toBeTruthy();
  });

  it('パパが招待を送り、ママが参加すると、ママの会員証に同じ会員ID・ポイント・犬が表示される(19.2)', async () => {
    const r = await registerUser(PAPA, [dog('アル'), dog('ニコ')]);
    await checkin(PAPA, [r.dogs[0]!.id], { now: '2026-10-27T01:00:00Z' });
    const code = await invite();
    const res = await call(`/api/invites/${code}/accept`, {
      user: MAMA,
      now: T0,
      body: { consent: true, survey: memberSurvey },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ result: 'joined', memberNo: r.memberNo, householdName: 'アル・ニコのおうち' });

    const papa = await call('/api/me', { user: PAPA, now: T0 });
    const mama = await call('/api/me', { user: MAMA, now: T0 });
    expect(mama.body.household).toEqual(papa.body.household);
    expect(mama.body.card.balance).toBe(1);
    expect(mama.body.card.dogs.map((d: { name: string }) => d.name)).toEqual(['アル', 'ニコ']);

    const m = await env.DB.prepare("SELECT join_method, age_group, gender, consented_at FROM family_members WHERE line_user_id = 'U002'").first();
    expect(m).toEqual({ join_method: 'invite', age_group: '30代', gender: '女性', consented_at: '2026-10-28T10:00:00+09:00' });
  });

  it('24時間を過ぎた招待は使えない(19.2)', async () => {
    await registerUser(PAPA);
    const code = await invite();
    const info = await call(`/api/invites/${code}`, { user: MAMA, now: '2026-10-29T01:00:01Z' });
    expect(info.body.status).toBe('expired');
    const res = await call(`/api/invites/${code}/accept`, {
      user: MAMA,
      now: '2026-10-29T01:00:01Z',
      body: { consent: true, survey: memberSurvey },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invite_expired');
    expect(res.body.error.message).toMatch(/もう一度招待を送ってもらって/);
  });

  it('24時間ちょうどまでは使える', async () => {
    await registerUser(PAPA);
    const code = await invite();
    const res = await call(`/api/invites/${code}/accept`, {
      user: MAMA,
      now: '2026-10-29T01:00:00Z',
      body: { consent: true, survey: memberSurvey },
    });
    expect(res.status).toBe(201);
  });

  it('招待は1回だけ使える', async () => {
    await registerUser(PAPA);
    const code = await invite();
    await call(`/api/invites/${code}/accept`, { user: MAMA, now: T0, body: { consent: true, survey: memberSurvey } });
    const res = await call(`/api/invites/${code}/accept`, {
      user: 'U003:ばあば',
      now: T0,
      body: { consent: true, survey: memberSurvey },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invite_used');
  });

  it('同時に2人が開いても、参加できるのは1人だけ', async () => {
    await registerUser(PAPA);
    const code = await invite();
    const results = await Promise.all(
      [MAMA, 'U003:ばあば'].map((user) =>
        call(`/api/invites/${code}/accept`, { user, now: T0, body: { consent: true, survey: memberSurvey } }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM family_members').first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it('はじめての人は、同意と年代・性別が必要', async () => {
    await registerUser(PAPA);
    const code = await invite();
    const noConsent = await call(`/api/invites/${code}/accept`, { user: MAMA, now: T0, body: { consent: false, survey: memberSurvey } });
    expect(noConsent.status).toBe(400);
    const noSurvey = await call(`/api/invites/${code}/accept`, { user: MAMA, now: T0, body: { consent: true, survey: [] } });
    expect(noSurvey.status).toBe(400);
    expect(noSurvey.body.error.message).toBe('「年代」に答えてください。');
  });

  it('すでに別のおうちを持つ人が招待を受けると、参加ではなく「まとめる申請」が確認待ちに入る(19.2)', async () => {
    const papa = await registerUser(PAPA, [dog('アル')]);
    const mama = await registerUser(MAMA, [dog('アル')]);
    const code = await invite();
    const info = await call(`/api/invites/${code}`, { user: MAMA, now: T0 });
    expect(info.body.viewer).toBe('other');

    const res = await call(`/api/invites/${code}/accept`, { user: MAMA, now: T0, body: { consent: false, survey: [] } });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ result: 'requested' });

    const req = await env.DB.prepare(
      `SELECT r.kind, r.status, h1.member_no AS mine, h2.member_no AS related
         FROM requests r JOIN households h1 ON h1.id = r.household_id JOIN households h2 ON h2.id = r.related_household_id`,
    ).first();
    expect(req).toEqual({ kind: 'merge', status: 'pending', mine: mama.memberNo, related: papa.memberNo });
    // ママはまだ自分のおうちのまま
    const me = await call('/api/me', { user: MAMA, now: T0 });
    expect(me.body.household.memberNo).toBe(mama.memberNo);
  });

  it('同じ組み合わせのまとめる申請は、何度招待を受けても1件だけ', async () => {
    await registerUser(PAPA);
    await registerUser(MAMA, [dog('ニコ')]);
    for (let i = 0; i < 2; i++) {
      const code = await invite();
      await call(`/api/invites/${code}/accept`, { user: MAMA, now: T0, body: { consent: false, survey: [] } });
    }
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM requests').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('すでにそのおうちの家族なら、参加し直さない', async () => {
    await registerUser(PAPA);
    const code = await invite();
    const info = await call(`/api/invites/${code}`, { user: PAPA, now: T0 });
    expect(info.body.viewer).toBe('member');
    const res = await call(`/api/invites/${code}/accept`, { user: PAPA, now: T0, body: { consent: true, survey: [] } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_member');
  });

  it('使える招待を持っている人は、犬の小さな写真を見られる。使ったあとは見られない', async () => {
    const r = await registerUser(PAPA);
    const form = new FormData();
    form.append('photo', new File([fakeJpeg(800, 600)], 'p.jpg', { type: 'image/jpeg' }));
    form.append('thumb', new File([fakeJpeg(240, 240)], 't.jpg', { type: 'image/jpeg' }));
    await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: PAPA, body: form });
    const code = await invite();
    const info = await call(`/api/invites/${code}`, { user: MAMA, now: T0 });
    const url = info.body.dogs[0].thumbUrl as string;
    expect(url).toBe(`/api/invites/${code}/photos/${r.dogs[0]!.id}`);
    expect((await call(url, { user: MAMA, now: T0 })).status).toBe(200);

    await call(`/api/invites/${code}/accept`, { user: MAMA, now: T0, body: { consent: true, survey: memberSurvey } });
    expect((await call(url, { user: 'U003:ばあば', now: T0 })).status).toBe(404);
  });

  it('ない招待は 404', async () => {
    const res = await call('/api/invites/nothing', { user: MAMA });
    expect(res.status).toBe(404);
  });
});
