import { env } from 'cloudflare:test';
import { currentJstYear } from '@dr/shared';
import { describe, expect, it } from 'vitest';
import { getUndo, type AuditRow } from '../src/services/undo';
import '../src/routes/admin/household-detail';
import { adminCall, call, checkin, createStaff, dog, login, registerUser, survey as baseSurvey } from './helpers';

// C-03 飼い主とワンちゃんの情報の見直し(docs/changes-2026-10-28.md 7章、担当J)
// 固定の質問の番号: 6 来たい時間帯(複数) / 7 興味のあるイベント(複数) / 8 ほかのドッグラン(はい・いいえ) / 9 お知らせ(はい・いいえ)

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';
const NOW = '2026-10-28T03:00:00Z';
const Q = { times: 6, events: 7, otherRuns: 8, news: 9 } as const;
/** 必須の回答(helpers の survey)に、複数選択(配列)を含む回答を足す */
const survey = (extra: { questionId: number; value: string | string[] | null }[] = []) => [...baseSurvey(), ...extra];

async function adminCookies() {
  await createStaff('staff@example.com', 'staff');
  await createStaff('admin@example.com', 'admin');
  await createStaff('dev@example.com', 'developer');
  return {
    staff: await login('staff@example.com'),
    admin: await login('admin@example.com'),
    dev: await login('dev@example.com'),
  };
}
const householdRow = () =>
  env.DB.prepare('SELECT id, preferred_times, event_interests, uses_other_runs, wants_news FROM households').first<Record<string, unknown>>();
const lastLog = (action: string) =>
  env.DB.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').bind(action).first<AuditRow>();
const valueOf = (body: { answers: { questionId: number; value: unknown }[] }, id: number) =>
  body.answers.find((a) => a.questionId === id)?.value;

describe('C-03 おうちへの任意の質問(来たい時間帯・興味のあるイベント・ほかのドッグラン・お知らせ)', () => {
  it('登録で答えると、おうちの列に入る(複数選択は選択肢の順の配列、はい・いいえは 1 / 0)', async () => {
    await registerUser(PAPA, undefined, {
      survey: survey([
        { questionId: Q.times, value: ['土日の午後', '平日の昼'] },
        { questionId: Q.events, value: ['写真撮影会'] },
        { questionId: Q.otherRuns, value: 'はい' },
        { questionId: Q.news, value: 'いいえ' },
      ]),
    });
    expect(await householdRow()).toMatchObject({
      preferred_times: '["平日の昼","土日の午後"]',
      event_interests: '["写真撮影会"]',
      uses_other_runs: 1,
      wants_news: 0,
    });
  });

  it('新しい質問は全部任意。答えなくても登録でき、列は空のまま。必須は年代・性別・きっかけのまま', async () => {
    await registerUser(PAPA);
    expect(await householdRow()).toMatchObject({ preferred_times: null, event_interests: null, uses_other_runs: null, wants_news: null });
    const { results } = await env.DB.prepare('SELECT fixed_key FROM survey_questions WHERE required = 1 ORDER BY sort_order').all();
    expect(results.map((r) => r.fixed_key)).toEqual(['age_group', 'gender', 'referral']);
    const qs = await call('/api/survey', { user: 'U009:だれか' });
    const multi = qs.body.questions.filter((q: { kind: string }) => q.kind === 'multi');
    expect(multi.map((q: { fixedKey: string; options: string[] }) => [q.fixedKey, q.options])).toEqual([
      ['preferred_times', ['平日の昼', '平日の夕方', '土日の午前', '土日の午後']],
      ['event_interests', ['しつけ教室', '写真撮影会', '季節のイベント', '犬種別の集まり', '健康・ケアの相談']],
    ]);
  });

  it('選択肢にない回答や、答え方の違う回答は受け付けない', async () => {
    const bad = (value: unknown, questionId: number = Q.times) =>
      call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('アル')], survey: survey([{ questionId, value } as never]) } });
    const notOption = await bad(['深夜']);
    expect(notOption.status).toBe(400);
    expect(notOption.body.error.message).toMatch(/選び直して/);
    const arrayForChoice = await bad(['はい'], Q.otherRuns);
    expect(arrayForChoice.status).toBe(400);
    const yesNoText = await bad('たぶん', Q.otherRuns);
    expect(yesNoText.status).toBe(400);
    // 空の配列は「答えない」と同じ
    expect((await bad([])).status).toBe(201);
    expect((await householdRow())?.preferred_times).toBeNull();
  });

  it('登録済みのお客さんには、登録のあとのアンケートの画面で新しい任意の質問を出さない。会員証に小さく出す印だけを返す', async () => {
    await registerUser(PAPA);
    const pending = await call('/api/survey', { user: PAPA });
    expect(pending.body.questions).toEqual([]);
    const me = await call('/api/me', { user: PAPA });
    expect(me.body.optionalSurveyPending).toBe(true);

    // プロフィールで1つでも答えると、印は消える
    const res = await call('/api/me/profile', { user: PAPA, method: 'PATCH', body: { answers: [{ questionId: Q.news, value: 'はい' }] } });
    expect(res.status).toBe(200);
    expect((await call('/api/me', { user: PAPA })).body.optionalSurveyPending).toBe(false);
  });

  it('プロフィールで、家族の誰でも見て変えられる(複数選択は配列、はい・いいえは文で返す)', async () => {
    const r = await registerUser(PAPA, undefined, { survey: survey([{ questionId: Q.times, value: ['平日の夕方'] }]) });
    await env.DB.prepare(
      `INSERT INTO family_members (household_id, line_user_id, line_display_name, joined_at, join_method, status, updated_at)
       SELECT id, 'U002', 'ママ', '2026-01-01T00:00:00+09:00', 'invite', 'active', '2026-01-01T00:00:00+09:00' FROM households WHERE member_no = ?`,
    )
      .bind(r.memberNo)
      .run();
    const mama = await call('/api/me/profile', { user: MAMA });
    expect(valueOf(mama.body, Q.times)).toEqual(['平日の夕方']);
    expect(valueOf(mama.body, Q.otherRuns)).toBeNull();

    const res = await call('/api/me/profile', {
      user: MAMA,
      method: 'PATCH',
      body: {
        answers: [
          { questionId: Q.times, value: ['土日の午前', '平日の夕方'] },
          { questionId: Q.events, value: ['しつけ教室', '健康・ケアの相談'] },
          { questionId: Q.otherRuns, value: 'いいえ' },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(valueOf(res.body, Q.times)).toEqual(['平日の夕方', '土日の午前']);
    expect(valueOf(res.body, Q.otherRuns)).toBe('いいえ');
    const papa = await call('/api/me/profile', { user: PAPA });
    expect(valueOf(papa.body, Q.events)).toEqual(['しつけ教室', '健康・ケアの相談']);

    // 空にできる(任意)
    const cleared = await call('/api/me/profile', { user: PAPA, method: 'PATCH', body: { answers: [{ questionId: Q.times, value: [] }, { questionId: Q.otherRuns, value: null }] } });
    expect(valueOf(cleared.body, Q.times)).toBeNull();
    expect(await householdRow()).toMatchObject({ preferred_times: null, uses_other_runs: null });
  });
});

describe('C-02・C-08 ワンちゃんの任意の項目(体重・ほかの犬との相性・予防注射の年)', () => {
  const year = currentJstYear();

  it('登録と追加で入れられ、会員証やワンちゃんの一覧で返す', async () => {
    const r = await registerUser(PAPA, [dog('アル', { weightKg: 5.2, sociability: 'shy', rabiesVaccineYear: year, comboVaccineYear: 2025 })]);
    const dogs = await call('/api/dogs', { user: PAPA });
    expect(dogs.body.dogs[0]).toMatchObject({ weightKg: 5.2, sociability: 'shy', rabiesVaccineYear: year, comboVaccineYear: 2025 });
    const added = await call('/api/dogs', { user: PAPA, body: dog('ニコ', { weightKg: 12, sociability: 'good' }) });
    expect(added.status).toBe(201);
    expect(added.body.dog).toMatchObject({ weightKg: 12, sociability: 'good', rabiesVaccineYear: null });
    expect(r.dogs).toHaveLength(1);
  });

  it('境界値: 体重は 0.1〜100.0 の小数1桁、年は 2000年〜今年', async () => {
    const add = (extra: Record<string, unknown>) => call('/api/dogs', { user: PAPA, body: dog('テスト', extra) });
    await registerUser(PAPA);
    for (const ok of [{ weightKg: 0.1 }, { weightKg: 100 }, { weightKg: 23.5 }, { rabiesVaccineYear: 2000 }, { comboVaccineYear: year }]) {
      expect((await add(ok)).status, JSON.stringify(ok)).toBe(201);
    }
    for (const ng of [
      { weightKg: 0 },
      { weightKg: 0.05 },
      { weightKg: 100.1 },
      { weightKg: 5.25 },
      { rabiesVaccineYear: 1999 },
      { comboVaccineYear: year + 1 },
      { sociability: 'bad' },
    ]) {
      const res = await add(ng);
      expect(res.status, JSON.stringify(ng)).toBe(400);
    }
    const msg = await add({ weightKg: 5.25 });
    expect(msg.body.error.message).toBe('体重は小数1桁まで(例: 5.2)で入力してください。');
  });

  it('お客さんが変えると変更履歴に残る。空にもできる', async () => {
    const r = await registerUser(PAPA);
    const id = r.dogs[0]!.id;
    const res = await call(`/api/dogs/${id}`, { user: PAPA, method: 'PATCH', body: { weightKg: 4.8, sociability: 'normal', rabiesVaccineYear: 2025 } });
    expect(res.status).toBe(200);
    expect(res.body.dog).toMatchObject({ weightKg: 4.8, sociability: 'normal', rabiesVaccineYear: 2025 });
    const cleared = await call(`/api/dogs/${id}`, { user: PAPA, method: 'PATCH', body: { weightKg: null } });
    expect(cleared.body.dog.weightKg).toBeNull();
    const { results } = await env.DB.prepare('SELECT field, before_value, after_value, actor_type FROM dog_changes ORDER BY id').all();
    expect(results).toEqual([
      { field: 'weight_kg', before_value: null, after_value: '4.8', actor_type: 'member' },
      { field: 'sociability', before_value: null, after_value: 'normal', actor_type: 'member' },
      { field: 'rabies_vaccine_year', before_value: null, after_value: '2025', actor_type: 'member' },
      { field: 'weight_kg', before_value: '4.8', after_value: null, actor_type: 'member' },
    ]);
  });

  it('管理者(M-07)も変えられ、変更の履歴・操作ログに残り、操作ログから元に戻せる。製作者は 403', async () => {
    const c = await adminCookies();
    const r = await registerUser(PAPA);
    const id = r.dogs[0]!.id;
    const res = await adminCall(`/admin/api/dogs/${id}`, { cookie: c.admin, method: 'PATCH', body: { weightKg: 6.3, sociability: 'good', comboVaccineYear: 2026 } });
    expect(res.status).toBe(200);
    expect(res.body.dog).toMatchObject({ weightKg: 6.3, sociability: 'good', comboVaccineYear: 2026 });
    expect(res.body.changes.map((x: { fieldLabel: string; after: string }) => `${x.fieldLabel}:${x.after}`)).toEqual(
      expect.arrayContaining(['体重:6.3kg', 'ほかの犬との相性:得意', '混合ワクチン:2026年']),
    );
    const audit = await adminCall('/admin/api/audit', { cookie: c.admin });
    const entry = audit.body.entries.find((e: { actionLabel: string }) => e.actionLabel === 'ワンちゃんの情報の変更');
    expect(entry.detail).toBe('体重: 未登録 → 6.3kg、ほかの犬との相性: 未登録 → 得意、混合ワクチン: 未登録 → 2026年');
    await getUndo('dog.update')!(env.DB, (await lastLog('dog.update'))!, { staffId: 1, now: new Date() });
    const back = await adminCall(`/admin/api/dogs/${id}`, { cookie: c.admin });
    expect(back.body.dog).toMatchObject({ weightKg: null, sociability: null, comboVaccineYear: null });
    expect((await adminCall(`/admin/api/dogs/${id}`, { cookie: c.dev, method: 'PATCH', body: { weightKg: 3 } })).status).toBe(403);
    expect((await adminCall(`/admin/api/dogs/${id}`, { cookie: c.admin, method: 'PATCH', body: { weightKg: 300 } })).status).toBe(400);
  });
});

describe('A-02 管理者がおうちの回答を見る・変える(M-06)', () => {
  it('おうちの詳細に、新しい項目を言葉で出す', async () => {
    const c = await adminCookies();
    await registerUser(PAPA, undefined, {
      survey: survey([
        { questionId: Q.times, value: ['平日の昼', '土日の午前'] },
        { questionId: Q.otherRuns, value: 'はい' },
      ]),
    });
    const id = (await householdRow())!.id as number;
    const d = await adminCall(`/admin/api/households/${id}`, { cookie: c.admin });
    expect(d.body.survey.household).toEqual(
      expect.arrayContaining([
        { label: '来たい時間帯', answer: '平日の昼・土日の午前' },
        { label: '興味のあるイベント', answer: null },
        { label: 'ほかのドッグランも使っていますか', answer: 'はい' },
        { label: 'お知らせをLINEで受け取りますか', answer: null },
      ]),
    );
  });

  it('おうちへの固定の質問の回答を変えられ、操作ログから元に戻せる。受付は 403、製作者は見るだけ', async () => {
    const c = await adminCookies();
    await registerUser(PAPA);
    const id = (await householdRow())!.id as number;
    const get = await adminCall(`/admin/api/households/${id}/profile`, { cookie: c.admin });
    expect(get.status).toBe(200);
    expect(get.body.questions.map((q: { fixedKey: string }) => q.fixedKey)).toEqual([
      'postal_code',
      'referral',
      'transport',
      'preferred_times',
      'event_interests',
      'uses_other_runs',
      'wants_news',
    ]);
    expect(valueOf(get.body, 4)).toBe('Instagram');

    const body = {
      answers: [
        { questionId: 3, value: '１５０-０００１' },
        { questionId: Q.events, value: ['季節のイベント'] },
        { questionId: Q.news, value: 'はい' },
      ],
    };
    expect((await adminCall(`/admin/api/households/${id}/profile`, { cookie: c.staff, method: 'PATCH', body })).status).toBe(403);
    expect((await adminCall(`/admin/api/households/${id}/profile`, { cookie: c.dev, method: 'PATCH', body })).status).toBe(403);
    expect((await adminCall(`/admin/api/households/${id}/profile`, { cookie: c.staff })).status).toBe(403);
    expect((await adminCall(`/admin/api/households/${id}/profile`, { cookie: c.dev })).status).toBe(200);
    const res = await adminCall(`/admin/api/households/${id}/profile`, { cookie: c.admin, method: 'PATCH', body, now: NOW });
    expect(res.status).toBe(200);
    expect(valueOf(res.body, 3)).toBe('1500001');
    expect(valueOf(res.body, Q.events)).toEqual(['季節のイベント']);
    expect(valueOf(res.body, Q.news)).toBe('はい');
    expect(await householdRow()).toMatchObject({ event_interests: '["季節のイベント"]', wants_news: 1 });

    const audit = await adminCall('/admin/api/audit', { cookie: c.admin, now: NOW });
    const entry = audit.body.entries.find((e: { actionLabel: string }) => e.actionLabel === 'おうちのアンケートの回答の変更');
    expect(entry.detail).toBe('郵便番号: 未回答 → 1500001、興味のあるイベント: 未回答 → 季節のイベント、お知らせ: 未回答 → はい');
    expect(entry.canUndo).toBe(true);
    const undo = await adminCall(`/admin/api/audit/${entry.id}/undo`, { cookie: c.admin, body: {}, now: NOW });
    expect(undo.status).toBe(200);
    expect(await householdRow()).toMatchObject({ event_interests: null, wants_news: null });

    // 必須の「知ったきっかけ」は空にできない。おうちへの質問でないものは変えられない
    const empty = await adminCall(`/admin/api/households/${id}/profile`, { cookie: c.admin, method: 'PATCH', body: { answers: [{ questionId: 4, value: null }] } });
    expect(empty.status).toBe(400);
    const member = await adminCall(`/admin/api/households/${id}/profile`, { cookie: c.admin, method: 'PATCH', body: { answers: [{ questionId: 1, value: '20代' }] } });
    expect(member.status).toBe(400);
  });

  it('CSV にも新しい項目が出る(おうち・ワンちゃん・アンケートの回答)', async () => {
    const c = await adminCookies();
    await registerUser(PAPA, [dog('アル', { weightKg: 5.2, sociability: 'shy', rabiesVaccineYear: 2026 })], {
      survey: survey([
        { questionId: Q.times, value: ['平日の昼', '土日の午後'] },
        { questionId: Q.otherRuns, value: 'いいえ' },
        { questionId: Q.news, value: 'はい' },
      ]),
    });
    const csv = async (name: string) =>
      String((await adminCall<string>(`/admin/api/export/${name}`, { cookie: c.admin })).body).replace(/^﻿/, '').split('\r\n').filter((l) => !l.startsWith('#')); // 先頭の説明行(#)は外す
    const h = await csv('households');
    expect(h[0]).toMatch(/,来たい時間帯,興味のあるイベント,ほかのドッグランの利用,お知らせの受け取り$/);
    expect(h[1]).toMatch(/,平日の昼・土日の午後,,いいえ,はい$/);
    const d = await csv('dogs');
    expect(d[0]).toMatch(/,体重\(kg\),ほかの犬との相性,狂犬病の予防注射の年,混合ワクチンの年$/);
    expect(d[1]).toMatch(/,5\.2,苦手,2026,$/);
    const s = await csv('survey');
    expect(s).toEqual(expect.arrayContaining([expect.stringMatching(/,おうち,おうちごと,来たい時間帯,平日の昼・土日の午後,/)]));
  });
});

describe('A-10 アンケートの質問に「いくつでも選ぶ」を足す', () => {
  it('管理者が「いくつでも選ぶ」の質問を作ると、登録済みのお客さんに1回だけ出て、答えると選択肢ごとに集計される', async () => {
    const c = await adminCookies();
    await registerUser(PAPA);
    await registerUser('U003:ハナ', [dog('ハナ')]);
    const created = await adminCall('/admin/api/survey-questions', {
      cookie: c.admin,
      body: { target: 'household', kind: 'multi', label: '連れてきたい友だち', options: ['犬友', '家族', '同僚'] },
    });
    expect(created.status).toBe(201);
    const qid = created.body.id as number;
    expect(created.body.questions.find((q: { id: number }) => q.id === qid)).toMatchObject({ kind: 'multi', options: ['犬友', '家族', '同僚'] });
    const row = await env.DB.prepare('SELECT kind, multiple FROM survey_questions WHERE id = ?').bind(qid).first();
    expect(row).toEqual({ kind: 'choice', multiple: 1 });

    const pending = await call('/api/survey', { user: PAPA });
    expect(pending.body.questions).toEqual([expect.objectContaining({ id: qid, kind: 'multi' })]);
    const ans = await call('/api/survey', { user: PAPA, body: { answers: [{ questionId: qid, value: ['同僚', '犬友'] }] } });
    expect(ans.status).toBe(200);
    await call('/api/survey', { user: 'U003:ハナ', body: { answers: [{ questionId: qid, value: ['犬友'] }] } });

    const summary = await adminCall(`/admin/api/survey-questions/${qid}/summary`, { cookie: c.admin });
    expect(summary.body.answered).toBe(2);
    expect(summary.body.counts).toEqual([
      { option: '犬友', count: 2, current: true },
      { option: '家族', count: 0, current: true },
      { option: '同僚', count: 1, current: true },
    ]);
    const profile = await call('/api/me/profile', { user: PAPA });
    expect(valueOf(profile.body, qid)).toEqual(['犬友', '同僚']);
    const id = (await householdRow())!.id as number;
    const detail = await adminCall(`/admin/api/households/${id}`, { cookie: c.admin });
    expect(detail.body.survey.household).toEqual(expect.arrayContaining([{ label: '連れてきたい友だち', answer: '犬友・同僚' }]));

    // 選択肢が1つでは作れない
    const one = await adminCall('/admin/api/survey-questions', { cookie: c.admin, body: { target: 'member', kind: 'multi', label: 'x', options: ['a'] } });
    expect(one.status).toBe(400);
  });

  it('はい・いいえの固定の質問は、文は変えられるが選択肢は変えられない。複数選択の固定の質問は選択肢を変えられる', async () => {
    const c = await adminCookies();
    const ng = await adminCall(`/admin/api/survey-questions/${Q.news}`, { cookie: c.admin, method: 'PATCH', body: { options: ['受け取る', '受け取らない'] } });
    expect(ng.status).toBe(400);
    expect(ng.body.error.message).toMatch(/選択肢を変えられません/);
    const label = await adminCall(`/admin/api/survey-questions/${Q.news}`, { cookie: c.admin, method: 'PATCH', body: { label: 'お知らせを受け取りますか', options: ['はい', 'いいえ'] } });
    expect(label.status).toBe(200);
    const times = await adminCall(`/admin/api/survey-questions/${Q.times}`, {
      cookie: c.admin,
      method: 'PATCH',
      body: { options: ['平日の朝', '平日の昼', '平日の夕方', '土日の午前', '土日の午後'] },
    });
    expect(times.status).toBe(200);
    expect(times.body.questions.find((q: { id: number }) => q.id === Q.times)).toMatchObject({ kind: 'multi', isFixed: true });
  });
});

describe('A-01 ダッシュボードの内訳', () => {
  it('来たい時間帯・興味のあるイベント(選んだ選択肢ごと)・ほかのドッグランの利用と、ワンちゃんの相性の内訳を返す', async () => {
    await createStaff('staff@example.com', 'staff');
    const staff = await login('staff@example.com', 'password-1234', NOW);
    const a = await registerUser(PAPA, [dog('アル', { sociability: 'good' }), dog('ニコ', { sociability: 'shy' })], {
      survey: survey([
        { questionId: Q.times, value: ['平日の昼', '土日の午前'] },
        { questionId: Q.events, value: ['しつけ教室'] },
        { questionId: Q.otherRuns, value: 'はい' },
      ]),
    });
    const b = await registerUser('U003:ハナ', [dog('ハナ')], { survey: survey([{ questionId: Q.times, value: ['土日の午前'] }, { questionId: Q.otherRuns, value: 'いいえ' }]) });
    await registerUser('U004:来ていない', [dog('ソラ', { sociability: 'good' })], { survey: survey([{ questionId: Q.times, value: ['平日の夕方'] }]) });
    await checkin(PAPA, a.dogs.map((d) => d.id), { now: NOW });
    await checkin('U003:ハナ', b.dogs.map((d) => d.id), { now: NOW });
    const res = await adminCall('/admin/api/dashboard?from=2026-10-01&to=2026-10-31', { cookie: staff, now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.owners.preferredTimes).toEqual([
      { label: '平日の昼', count: 1 },
      { label: '平日の夕方', count: 0 },
      { label: '土日の午前', count: 2 },
      { label: '土日の午後', count: 0 },
    ]);
    expect(res.body.owners.eventInterests).toEqual([
      { label: 'しつけ教室', count: 1 },
      { label: '写真撮影会', count: 0 },
      { label: '季節のイベント', count: 0 },
      { label: '犬種別の集まり', count: 0 },
      { label: '健康・ケアの相談', count: 0 },
      { label: '未回答', count: 1 },
    ]);
    expect(res.body.owners.otherRuns).toEqual([
      { label: 'はい', count: 1 },
      { label: 'いいえ', count: 1 },
    ]);
    expect(res.body.dogs.sociability).toEqual([
      { label: '得意', count: 1 },
      { label: 'ふつう', count: 0 },
      { label: '苦手', count: 1 },
      { label: '未回答', count: 1 },
    ]);
  });
});
