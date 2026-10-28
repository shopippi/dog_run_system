import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addFamily, call, registerUser } from './helpers';

const PAPA = 'U001:パパ';
const MAMA = 'U002:ママ';

/** 管理者が追加した質問(A-10 の代わりに直接入れる)。id を返す */
async function addQuestion(target: 'member' | 'household', kind: 'choice' | 'text', label: string, options: string[] = [], required = false) {
  const r = await env.DB.prepare(
    `INSERT INTO survey_questions (target, kind, label, options, required, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, 100, '2026-10-01T00:00:00+09:00')`,
  )
    .bind(target, kind, label, JSON.stringify(options), required ? 1 : 0)
    .run();
  return r.meta.last_row_id;
}

const patch = (user: string, answers: { questionId: number; value: string | null }[]) =>
  call('/api/me/profile', { user, method: 'PATCH', body: { answers } });

const valueOf = (body: { answers: { questionId: number; value: string | null }[] }, id: number) =>
  body.answers.find((a) => a.questionId === id)?.value;

describe('C-09 プロフィール', () => {
  it('自分の年代・性別と、おうちの郵便番号・きっかけ・来場手段を返す', async () => {
    await registerUser(PAPA, undefined, {});
    const res = await call('/api/me/profile', { user: PAPA });
    expect(res.status).toBe(200);
    expect(res.body.questions.map((q: { fixedKey: string }) => q.fixedKey)).toEqual(['age_group', 'gender', 'postal_code', 'referral', 'transport']);
    expect(res.body.answers).toEqual([
      { questionId: 1, value: '30代' },
      { questionId: 2, value: '女性' },
      { questionId: 3, value: null },
      { questionId: 4, value: 'Instagram' },
      { questionId: 5, value: null },
    ]);
  });

  it('年代・性別は自分の列だけ、郵便番号などはおうちの列を変える(家族みんなで共通)', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    const res = await patch(PAPA, [
      { questionId: 1, value: '40代' },
      { questionId: 3, value: '１２３-４５６７' },
      { questionId: 5, value: '車' },
    ]);
    expect(res.status).toBe(200);
    expect(valueOf(res.body, 1)).toBe('40代');
    expect(valueOf(res.body, 2)).toBe('女性'); // 送っていない質問は変わらない
    expect(valueOf(res.body, 3)).toBe('1234567');
    expect(valueOf(res.body, 5)).toBe('車');

    const mama = await call('/api/me/profile', { user: MAMA });
    expect(valueOf(mama.body, 1)).toBeNull(); // ママの年代は別
    expect(valueOf(mama.body, 3)).toBe('1234567');
    expect(valueOf(mama.body, 4)).toBe('Instagram');

    const h = await env.DB.prepare('SELECT postal_code, transport, referral FROM households').first();
    expect(h).toEqual({ postal_code: '1234567', transport: '車', referral: 'Instagram' });
  });

  it('必須の固定の質問は空にできない。任意の郵便番号・来場手段は空にできる', async () => {
    await registerUser(PAPA);
    await patch(PAPA, [{ questionId: 3, value: '1234567' }]);
    const empty = await patch(PAPA, [{ questionId: 1, value: null }]);
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toBe('「年代」に答えてください。');
    const referral = await patch(PAPA, [{ questionId: 4, value: '' }]);
    expect(referral.status).toBe(400);
    const ok = await patch(PAPA, [{ questionId: 3, value: null }]);
    expect(ok.status).toBe(200);
    expect(valueOf(ok.body, 3)).toBeNull();
  });

  it('登録と同じ確認: 郵便番号は7桁、選択肢にない回答は受け付けない', async () => {
    await registerUser(PAPA);
    const pc = await patch(PAPA, [{ questionId: 3, value: '123456' }]);
    expect(pc.status).toBe(400);
    expect(pc.body.error.message).toMatch(/7桁/);
    const choice = await patch(PAPA, [{ questionId: 2, value: 'その他' }]);
    expect(choice.status).toBe(400);
    expect(choice.body.error.message).toMatch(/選び直して/);
    const row = await env.DB.prepare('SELECT gender FROM family_members').first();
    expect(row).toEqual({ gender: '女性' });
  });

  it('追加の質問の回答を返し、上書きできる。家族向けは自分の回答、おうち向けはおうちの回答', async () => {
    const r = await registerUser(PAPA);
    await addFamily(r.memberNo, 'U002', 'ママ');
    const other = await addQuestion('member', 'choice', 'ほかのドッグランを使っていますか', ['使っている', '使っていない'], true);
    const event = await addQuestion('household', 'text', '来てほしいイベント');
    // 登録後の1回だけのアンケートで「答えない」にしていた
    await call('/api/survey', { user: PAPA, body: { answers: [{ questionId: other, value: null }, { questionId: event, value: 'しつけ教室' }] } });

    let res = await call('/api/me/profile', { user: PAPA });
    expect(res.body.questions.map((q: { id: number }) => q.id)).toEqual([1, 2, 3, 4, 5, other, event]);
    expect(valueOf(res.body, other)).toBeNull();
    expect(valueOf(res.body, event)).toBe('しつけ教室');

    res = await patch(PAPA, [
      { questionId: other, value: '使っている' },
      { questionId: event, value: '写真撮影会' },
    ]);
    expect(res.status).toBe(200);
    expect(valueOf(res.body, other)).toBe('使っている');
    expect(valueOf(res.body, event)).toBe('写真撮影会');
    // 上書きなので、回答は1件ずつのまま
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM survey_answers').first<{ n: number }>();
    expect(n!.n).toBe(2);

    const mama = await call('/api/me/profile', { user: MAMA });
    expect(valueOf(mama.body, other)).toBeNull();
    expect(valueOf(mama.body, event)).toBe('写真撮影会');

    // 追加の質問は、必須でも「答えない」に戻せる(7.2)
    res = await patch(PAPA, [{ questionId: other, value: null }]);
    expect(res.status).toBe(200);
    expect(valueOf(res.body, other)).toBeNull();
  });

  it('表示していない質問は返さず、送られても変えない', async () => {
    await registerUser(PAPA);
    const hidden = await addQuestion('member', 'text', 'かくれた質問');
    await env.DB.prepare('UPDATE survey_questions SET visible = 0 WHERE id = ?').bind(hidden).run();
    const res = await patch(PAPA, [{ questionId: hidden, value: 'あいうえ' }]);
    expect(res.status).toBe(200);
    expect(res.body.questions.some((q: { id: number }) => q.id === hidden)).toBe(false);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM survey_answers').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('未登録の人は 409、ログインがなければ 401', async () => {
    expect((await call('/api/me/profile', { user: PAPA })).status).toBe(409);
    expect((await patch(PAPA, [])).status).toBe(409);
    expect((await call('/api/me/profile')).status).toBe(401);
  });
});
