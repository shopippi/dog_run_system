import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getUndo, type AuditRow } from '../src/services/undo';
import '../src/routes/admin/survey-questions';
import { addFamily, adminCall, call, createStaff, login, registerUser } from './helpers';

async function as(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
const lastLog = () => env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').first<AuditRow>();
const add = (cookie: string, body: Record<string, unknown>) => adminCall('/admin/api/survey-questions', { cookie, body });
const patch = (cookie: string, id: number, body: Record<string, unknown>) =>
  adminCall(`/admin/api/survey-questions/${id}`, { cookie, method: 'PATCH', body });
const pending = async (user: string) =>
  ((await call('/api/survey', { user })).body.questions as { id: number; label: string }[]).map((q) => q.label);

describe('A-10 アンケートの管理', () => {
  it('一覧は固定の質問を含み、固定かどうか・表示するかを返す', async () => {
    const cookie = await as('admin');
    const res = await adminCall('/admin/api/survey-questions', { cookie });
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(9);
    expect(res.body.questions[0]).toMatchObject({ fixedKey: 'age_group', isFixed: true, visible: true, answerCount: null });
  });

  it('管理画面から追加した質問は、既存の会員が次に開いたときに1回だけ出て、答えると集計に出る(7.2)', async () => {
    const cookie = await as('admin');
    await registerUser('U001:パパ');
    await registerUser('U002:ママ');
    const r = await add(cookie, {
      target: 'member',
      kind: 'choice',
      label: 'ほかのドッグランを使っていますか',
      options: ['はい', ' いいえ ', '', 'はい'],
      required: true,
    });
    expect(r.status).toBe(201);
    const q = r.body.questions.find((x: { id: number }) => x.id === r.body.id);
    expect(q).toMatchObject({ isFixed: false, options: ['はい', 'いいえ'], required: true, answerCount: 0 });
    expect(await lastLog()).toMatchObject({ action: 'survey_question.create', target_id: String(r.body.id) });

    expect(await pending('U001:パパ')).toEqual(['ほかのドッグランを使っていますか']);
    const ans = await call('/api/survey', { user: 'U001:パパ', body: { answers: [{ questionId: r.body.id, value: 'はい' }] } });
    expect(ans.status).toBe(200);
    expect(await pending('U001:パパ')).toEqual([]);

    // 「答えない」で進んでも、次からは出ない
    await call('/api/survey', { user: 'U002:ママ', body: { answers: [{ questionId: r.body.id, value: null }] } });
    expect(await pending('U002:ママ')).toEqual([]);

    const sum = await adminCall(`/admin/api/survey-questions/${r.body.id}/summary`, { cookie });
    expect(sum.status).toBe(200);
    expect(sum.body).toMatchObject({
      answered: 1,
      skipped: 1,
      counts: [
        { option: 'はい', count: 1, current: true },
        { option: 'いいえ', count: 0, current: true },
      ],
    });
  });

  it('おうちごとの質問は、おうちの誰か1人が答えれば、家族にはもう出ない', async () => {
    const cookie = await as('admin');
    const p = await registerUser('U001:パパ');
    await addFamily(p.memberNo, 'U002', 'ママ');
    const r = await add(cookie, { target: 'household', kind: 'text', label: '来てほしいイベントは', options: ['無視される'] });
    expect(r.body.questions.at(-1)).toMatchObject({ kind: 'text', options: [] });
    expect(await pending('U002:ママ')).toContain('来てほしいイベントは');
    await call('/api/survey', { user: 'U001:パパ', body: { answers: [{ questionId: r.body.id, value: '夜のイベント' }] } });
    expect(await pending('U002:ママ')).not.toContain('来てほしいイベントは');
    const sum = await adminCall(`/admin/api/survey-questions/${r.body.id}/summary`, { cookie });
    expect(sum.body).toMatchObject({ answered: 1, counts: [], texts: [{ answer: '夜のイベント' }] });
  });

  it('入力のチェック: 選ぶ質問は選択肢2つ以上、質問の文は100文字まで(境界値)', async () => {
    const cookie = await as('admin');
    const one = await add(cookie, { target: 'member', kind: 'choice', label: '質問', options: ['はい'] });
    expect(one.status).toBe(400);
    expect(one.body.error.message).toBe('「選ぶ」「いくつでも選ぶ」の質問には、選択肢を2つ以上入れてください。');
    expect((await add(cookie, { target: 'member', kind: 'text', label: 'あ'.repeat(100) })).status).toBe(201);
    const long = await add(cookie, { target: 'member', kind: 'text', label: 'あ'.repeat(101) });
    expect(long.status).toBe(400);
    expect(long.body.error.message).toBe('質問の文は100文字までで入力してください。');
    expect((await add(cookie, { target: 'member', kind: 'text', label: '   ' })).body.error.message).toBe('質問の文を入力してください。');
  });

  it('非表示にした質問はお客さんに出ない。選択肢を変えると、前の選択肢の回答は「今はない」として集計に残る', async () => {
    const cookie = await as('admin');
    await registerUser('U001:パパ');
    await registerUser('U002:ママ');
    const r = await add(cookie, { target: 'member', kind: 'choice', label: '車種', options: ['軽', '普通'] });
    await call('/api/survey', { user: 'U001:パパ', body: { answers: [{ questionId: r.body.id, value: '軽' }] } });
    const changed = await patch(cookie, r.body.id, { options: ['軽自動車', '普通車'] });
    expect(changed.status).toBe(200);
    const sum = await adminCall(`/admin/api/survey-questions/${r.body.id}/summary`, { cookie });
    expect(sum.body.counts).toEqual([
      { option: '軽自動車', count: 0, current: true },
      { option: '普通車', count: 0, current: true },
      { option: '軽', count: 1, current: false },
    ]);

    expect(await pending('U002:ママ')).toContain('車種');
    await patch(cookie, r.body.id, { visible: false });
    expect(await pending('U002:ママ')).not.toContain('車種');
    // 未登録の人の質問にも出ない
    expect(await pending('U003:だれか')).not.toContain('車種');

    // 回答がある質問は、聞く相手と答え方を変えられない
    const kind = await patch(cookie, r.body.id, { kind: 'text' });
    expect(kind.status).toBe(409);
  });

  it('固定の質問は、文と選択肢だけ変えられる。非表示・必須の変更はできず、集計もここでは出さない', async () => {
    const cookie = await as('admin');
    const ok = await patch(cookie, 4, { label: 'このドッグランを何で知りましたか', options: ['Instagram', 'Googleマップ', 'チラシ'] });
    expect(ok.status).toBe(200);
    expect(ok.body.questions[3]).toMatchObject({ label: 'このドッグランを何で知りましたか', options: ['Instagram', 'Googleマップ', 'チラシ'] });
    const reg = await call('/api/survey', { user: 'U009:新しい人' });
    expect(reg.body.questions.find((q: { id: number }) => q.id === 4)).toMatchObject({ options: ['Instagram', 'Googleマップ', 'チラシ'] });

    const hide = await patch(cookie, 1, { visible: false });
    expect(hide.status).toBe(400);
    expect(hide.body.error.message).toMatch(/非表示にできません/);
    expect((await patch(cookie, 1, { required: false })).status).toBe(400);
    expect((await patch(cookie, 3, { options: ['あ', 'い'] })).status).toBe(400);
    expect((await adminCall('/admin/api/survey-questions/1/summary', { cookie })).status).toBe(400);
  });

  it('並べ替えられ、登録のアンケートもその順になる。変更・並べ替えは操作ログから元に戻せる', async () => {
    const cookie = await as('admin');
    const r = await add(cookie, { target: 'member', kind: 'text', label: '好きなおやつ' });
    const ids = r.body.questions.map((q: { id: number }) => q.id) as number[];
    const moved = [r.body.id, ...ids.filter((id) => id !== r.body.id)];
    const res = await adminCall('/admin/api/survey-questions/order', { cookie, body: { ids: moved } });
    expect(res.status).toBe(200);
    expect((await call('/api/survey', { user: 'U009:新しい人' })).body.questions[0].label).toBe('好きなおやつ');
    expect((await adminCall('/admin/api/survey-questions/order', { cookie, body: { ids: moved.slice(1) } })).status).toBe(409);

    await getUndo('survey_question.reorder')!(env.DB, (await lastLog())!, { staffId: 1, now: new Date() });
    expect((await adminCall('/admin/api/survey-questions', { cookie })).body.questions.map((q: { id: number }) => q.id)).toEqual(ids);

    await patch(cookie, r.body.id, { label: '好きなごはん', required: true });
    const log = (await lastLog())!;
    expect(JSON.parse(log.before_value!)).toEqual({ label: '好きなおやつ', required: false });
    await getUndo('survey_question.update')!(env.DB, log, { staffId: 1, now: new Date() });
    const back = (await adminCall('/admin/api/survey-questions', { cookie })).body.questions.at(-1);
    expect(back).toMatchObject({ label: '好きなおやつ', required: false });
  });

  it('受付スタッフは 403。製作者は見られるが、変更は 403', async () => {
    const staff = await as('staff');
    expect((await adminCall('/admin/api/survey-questions', { cookie: staff })).status).toBe(403);
    const dev = await as('developer');
    expect((await adminCall('/admin/api/survey-questions', { cookie: dev })).status).toBe(200);
    expect((await add(dev, { target: 'member', kind: 'text', label: '質問' })).status).toBe(403);
    expect((await patch(dev, 4, { label: 'きっかけ' })).status).toBe(403);
  });
});
