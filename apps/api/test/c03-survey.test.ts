import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, dog, registerUser, survey } from './helpers';

const PAPA = 'U001:パパ';
const T = '2026-10-28T10:00:00+09:00';

async function addQuestion(target: 'member' | 'household', kind: 'choice' | 'text', label: string, required = 0) {
  const r = await env.DB.prepare(
    `INSERT INTO survey_questions (target, kind, label, options, required, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, 100, ?) RETURNING id`,
  )
    .bind(target, kind, label, kind === 'choice' ? '["はい","いいえ"]' : '[]', required, T)
    .first<{ id: number }>();
  return r!.id;
}

describe('C-03 アンケート(登録のとき)', () => {
  it('未登録の人には、表示する質問を並び順どおりに返す', async () => {
    const res = await call('/api/survey', { user: PAPA });
    expect(res.status).toBe(200);
    expect(res.body.questions.map((q: { fixedKey: string }) => q.fixedKey)).toEqual([
      'age_group',
      'gender',
      'postal_code',
      'referral',
      'transport',
      'preferred_times',
      'event_interests',
      'uses_other_runs',
      'wants_news',
    ]);
    expect(res.body.questions[2]).toMatchObject({ label: 'お住まいの郵便番号', required: false });
  });

  it('必須の質問(年代・性別・知ったきっかけ)に答えないと登録できない', async () => {
    const res = await call('/api/register', {
      user: PAPA,
      body: { consent: true, dogs: [dog('アル')], survey: [{ questionId: 1, value: '30代' }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('「性別」に答えてください。');
  });

  it('回答は、家族(年代・性別)とおうち(郵便番号・きっかけ・来場手段)の列に入る', async () => {
    await registerUser(PAPA, [dog('アル')], {
      survey: survey([
        { questionId: 3, value: '123-4567' },
        { questionId: 5, value: '車' },
      ]),
    });
    const m = await env.DB.prepare('SELECT age_group, gender FROM family_members').first();
    expect(m).toEqual({ age_group: '30代', gender: '女性' });
    const h = await env.DB.prepare('SELECT postal_code, referral, transport FROM households').first();
    expect(h).toEqual({ postal_code: '1234567', referral: 'Instagram', transport: '車' });
  });

  it('郵便番号は任意。形が違うときは7桁で入れるよう案内する', async () => {
    await registerUser(PAPA);
    const h = await env.DB.prepare('SELECT postal_code FROM households').first();
    expect(h).toEqual({ postal_code: null });

    const ng = await call('/api/register', {
      user: 'U002:ママ',
      body: { consent: true, dogs: [dog('ニコ')], survey: survey([{ questionId: 3, value: '12-34' }]) },
    });
    expect(ng.status).toBe(400);
    expect(ng.body.error.message).toMatch(/7桁/);
  });

  it('選択肢にない回答は受け付けない', async () => {
    const res = await call('/api/register', {
      user: PAPA,
      body: { consent: true, dogs: [dog('アル')], survey: survey([{ questionId: 1, value: '90代' }]).slice(1) },
    });
    expect(res.status).toBe(400);
  });

  it('管理者が追加した質問の回答も、登録と同じまとまりで保存する', async () => {
    const qMember = await addQuestion('member', 'choice', 'ほかのドッグランを使っていますか');
    const qHouse = await addQuestion('household', 'text', '来てほしいイベントは');
    await registerUser(PAPA, [dog('アル')], {
      survey: survey([
        { questionId: qMember, value: 'はい' },
        { questionId: qHouse, value: null },
      ]),
    });
    const { results } = await env.DB.prepare(
      'SELECT question_id, member_id IS NOT NULL AS by_member, household_id IS NOT NULL AS by_house, answer, skipped FROM survey_answers ORDER BY question_id',
    ).all();
    expect(results).toEqual([
      { question_id: qMember, by_member: 1, by_house: 0, answer: 'はい', skipped: 0 },
      { question_id: qHouse, by_member: 0, by_house: 1, answer: null, skipped: 1 },
    ]);
  });

  it('非表示にした質問は出さない', async () => {
    const q = await addQuestion('member', 'text', 'かくれた質問');
    await env.DB.prepare('UPDATE survey_questions SET visible = 0 WHERE id = ?').bind(q).run();
    const res = await call('/api/survey', { user: PAPA });
    expect(res.body.questions.some((x: { id: number }) => x.id === q)).toBe(false);
  });
});

describe('C-03 アンケート(登録のあとに追加した質問)', () => {
  it('登録済みの人には、まだ出していない追加の質問だけを返す', async () => {
    await registerUser(PAPA);
    expect((await call('/api/survey', { user: PAPA })).body.questions).toEqual([]);

    const q = await addQuestion('household', 'choice', '駐車場は足りていますか', 1);
    const res = await call('/api/survey', { user: PAPA });
    expect(res.body.questions.map((x: { id: number }) => x.id)).toEqual([q]);
  });

  it('答えなくても進める。答えなかった質問は次から出さない', async () => {
    await registerUser(PAPA);
    const q = await addQuestion('household', 'choice', '駐車場は足りていますか', 1);
    const res = await call('/api/survey', { user: PAPA, body: { answers: [{ questionId: q, value: null }] } });
    expect(res.status).toBe(200);
    expect((await call('/api/survey', { user: PAPA })).body.questions).toEqual([]);
  });

  it('おうち向けの質問は、家族の誰かが答えたら、ほかの家族には出さない', async () => {
    const r = await registerUser(PAPA);
    // 家族を同じおうちに足す(招待は C-11、C-12 で作る)
    const h = await env.DB.prepare('SELECT id FROM households WHERE member_no = ?').bind(r.memberNo).first<{ id: number }>();
    await env.DB.prepare(
      `INSERT INTO family_members (household_id, line_user_id, line_display_name, joined_at, join_method, status, updated_at)
       VALUES (?, 'U002', 'ママ', ?, 'invite', 'active', ?)`,
    )
      .bind(h!.id, T, T)
      .run();
    const qHouse = await addQuestion('household', 'choice', '駐車場は足りていますか');
    const qMember = await addQuestion('member', 'choice', 'ほかのドッグランを使っていますか');
    await call('/api/survey', {
      user: PAPA,
      body: { answers: [{ questionId: qHouse, value: 'はい' }, { questionId: qMember, value: 'いいえ' }] },
    });

    const mama = await call('/api/survey', { user: 'U002:ママ' });
    // ママは年代・性別がまだなので、それと家族向けの追加の質問が出る
    expect(mama.body.questions.map((x: { fixedKey: string | null; id: number }) => x.fixedKey ?? x.id)).toEqual([
      'age_group',
      'gender',
      qMember,
    ]);
  });

  it('未登録の人は回答を送れない', async () => {
    const res = await call('/api/survey', { user: PAPA, body: { answers: [] } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('not_registered');
  });
});
