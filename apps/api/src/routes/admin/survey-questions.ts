import {
  SURVEY_NEED_OPTIONS_MESSAGE,
  orderSchema,
  surveyQuestionCreateSchema,
  surveyQuestionPatchSchema,
  toJstIso,
  type AdminSurveyQuestion,
  type AdminSurveyQuestionsResponse,
  type SurveySummary,
} from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { requireRole } from '../../lib/staff-auth';
import { parseJson } from '../../lib/validate';
import { auditStatement } from '../../services/audit';
import { registerUndo } from '../../services/undo';

// A-10 アンケートの管理(M-11)
// - 固定の質問(7.1)は、文と選択肢だけ変えられる。非表示・削除はできない
// - 追加した質問(7.2)は、追加・変更・非表示・並べ替えができる。削除はしない(非表示)
// - 追加した質問は、既存の会員には次に LIFF を開いたときに1回だけ出る(/api/survey。services/survey.ts)
// 注意: このファイルのルートは管理画面の API 全体に足されるので、use('*') で権限を付けない。ルートごとに付ける。
export const surveyQuestionsRoutes = new Hono<AppEnv>();

type Row = {
  id: number;
  fixed_key: string | null;
  target: AdminSurveyQuestion['target'];
  kind: AdminSurveyQuestion['kind'];
  label: string;
  options: string;
  required: number;
  visible: number;
  is_fixed: number;
  answer_count: number | null;
};

const SELECT = `SELECT q.id, q.fixed_key, q.target, q.kind, q.label, q.options, q.required, q.visible, q.is_fixed,
    CASE WHEN q.is_fixed = 1 THEN NULL
         ELSE (SELECT COUNT(*) FROM survey_answers a WHERE a.question_id = q.id AND a.skipped = 0) END AS answer_count
  FROM survey_questions q`;

const toQuestion = (r: Row): AdminSurveyQuestion => ({
  id: r.id,
  fixedKey: r.fixed_key,
  isFixed: r.is_fixed === 1,
  target: r.target,
  kind: r.kind,
  label: r.label,
  options: JSON.parse(r.options) as string[],
  required: r.required === 1,
  visible: r.visible === 1,
  answerCount: r.answer_count,
});

async function listAll(db: D1Database): Promise<AdminSurveyQuestionsResponse> {
  const { results } = await db.prepare(`${SELECT} ORDER BY q.sort_order, q.id`).all<Row>();
  return { questions: results.map(toQuestion) };
}

async function findQuestion(db: D1Database, id: number): Promise<AdminSurveyQuestion> {
  const row = await db.prepare(`${SELECT} WHERE q.id = ?`).bind(id).first<Row>();
  if (!row) throw errors.notFound('その質問が見つかりませんでした。画面を読み込み直してください。');
  return toQuestion(row);
}

async function currentOrder(db: D1Database): Promise<number[]> {
  const { results } = await db.prepare('SELECT id FROM survey_questions ORDER BY sort_order, id').all<{ id: number }>();
  return results.map((r) => r.id);
}

const orderStatements = (db: D1Database, ids: number[]) =>
  ids.map((id, i) => db.prepare('UPDATE survey_questions SET sort_order = ? WHERE id = ?').bind((i + 1) * 10, id));

type Editable = Pick<AdminSurveyQuestion, 'target' | 'kind' | 'label' | 'options' | 'required' | 'visible'>;
const pickEditable = (q: AdminSurveyQuestion): Editable => ({
  target: q.target,
  kind: q.kind,
  label: q.label,
  options: q.options,
  required: q.required,
  visible: q.visible,
});
const updateStatement = (db: D1Database, id: number, v: Editable) =>
  db
    .prepare('UPDATE survey_questions SET target = ?, kind = ?, label = ?, options = ?, required = ?, visible = ? WHERE id = ?')
    .bind(v.target, v.kind, v.label, JSON.stringify(v.options), v.required ? 1 : 0, v.visible ? 1 : 0, id);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 質問の一覧(固定の質問・非表示を含む)。管理者(製作者は見るだけ)
surveyQuestionsRoutes.get('/survey-questions', requireRole('admin'), async (c) => c.json(await listAll(c.env.DB)));

// 質問を追加する。並び順はいちばん後ろ
surveyQuestionsRoutes.post('/survey-questions', requireRole('admin'), async (c) => {
  const input = await parseJson(c, surveyQuestionCreateSchema);
  const db = c.env.DB;
  const now = c.get('now');
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO survey_questions (fixed_key, target, kind, label, options, required, sort_order, visible, is_fixed, created_at)
         VALUES (NULL, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM survey_questions), 1, 0, ?)`,
      )
      .bind(input.target, input.kind, input.label, JSON.stringify(input.options), input.required ? 1 : 0, toJstIso(now)),
    auditStatement(db, {
      staffId: c.get('staff').id,
      action: 'survey_question.create',
      targetType: 'survey_question',
      targetId: { sql: 'last_insert_rowid()' },
      after: input,
      now,
    }),
  ]);
  return c.json({ id: res[0]!.meta.last_row_id, ...(await listAll(db)) }, 201);
});

// 並べ替え(ids: すべての質問を、並べたい順に)
surveyQuestionsRoutes.post('/survey-questions/order', requireRole('admin'), async (c) => {
  const { ids } = await parseJson(c, orderSchema);
  const db = c.env.DB;
  const before = await currentOrder(db);
  if (ids.length !== before.length || new Set(ids).size !== ids.length || ids.some((id) => !before.includes(id))) {
    throw errors.conflict('questions_changed', '質問の一覧が変わっています。画面を読み込み直してから、並べ替えてください。');
  }
  if (ids.join(',') !== before.join(',')) {
    await db.batch([
      ...orderStatements(db, ids),
      auditStatement(db, {
        staffId: c.get('staff').id,
        action: 'survey_question.reorder',
        targetType: 'survey_question',
        targetId: 'order',
        before: { ids: before },
        after: { ids },
        now: c.get('now'),
      }),
    ]);
  }
  return c.json(await listAll(db));
});

// 質問を変える
surveyQuestionsRoutes.patch('/survey-questions/:id', requireRole('admin'), async (c) => {
  const input = await parseJson(c, surveyQuestionPatchSchema);
  const db = c.env.DB;
  const q = await findQuestion(db, Number(c.req.param('id')) || 0);
  const current = pickEditable(q);
  const next: Editable = { ...current, ...input } as Editable;
  if (q.isFixed) {
    if (input.visible === false) throw errors.badRequest('固定の質問は分析に使うため、非表示にできません。文と選択肢だけ変えられます。');
    if ((['target', 'kind', 'required'] as const).some((k) => input[k] !== undefined && input[k] !== current[k])) {
      throw errors.badRequest('固定の質問は、文と選択肢だけ変えられます。');
    }
    if (q.kind === 'text' && input.options && input.options.length > 0) {
      throw errors.badRequest('この質問は自由に書く質問なので、選択肢は入れられません。');
    }
  }
  if (next.kind === 'text') next.options = [];
  if (next.kind === 'choice' && next.options.length < 2) throw errors.badRequest(SURVEY_NEED_OPTIONS_MESSAGE);
  if ((next.target !== current.target || next.kind !== current.kind) && (q.answerCount ?? 0) > 0) {
    throw errors.conflict(
      'question_answered',
      'この質問にはもう回答があるため、聞く相手と答え方は変えられません。新しい質問として追加してください。',
    );
  }
  const before: Partial<Editable> = {};
  const after: Partial<Editable> = {};
  for (const k of Object.keys(next) as (keyof Editable)[]) {
    if (same(current[k], next[k])) continue;
    (before as Record<string, unknown>)[k] = current[k];
    (after as Record<string, unknown>)[k] = next[k];
  }
  if (Object.keys(after).length > 0) {
    await db.batch([
      updateStatement(db, q.id, next),
      auditStatement(db, {
        staffId: c.get('staff').id,
        action: 'survey_question.update',
        targetType: 'survey_question',
        targetId: q.id,
        before: { label: current.label, ...before },
        after: { label: next.label, ...after },
        now: c.get('now'),
      }),
    ]);
  }
  return c.json(await listAll(db));
});

// 追加した質問の回答の集計(選択肢ごとの数)。個別の回答を含むので管理者だけ(製作者は見るだけ)
surveyQuestionsRoutes.get('/survey-questions/:id/summary', requireRole('admin'), async (c) => {
  const db = c.env.DB;
  const q = await findQuestion(db, Number(c.req.param('id')) || 0);
  if (q.isFixed) {
    throw errors.badRequest('固定の質問の集計は、ダッシュボードの「飼い主の属性」で見られます。');
  }
  const { results } = await db
    .prepare(
      `SELECT answer, COUNT(*) AS n FROM survey_answers WHERE question_id = ? AND skipped = 0 AND answer IS NOT NULL
        GROUP BY answer`,
    )
    .bind(q.id)
    .all<{ answer: string; n: number }>();
  const skipped = await db
    .prepare('SELECT COUNT(*) AS n FROM survey_answers WHERE question_id = ? AND skipped = 1')
    .bind(q.id)
    .first<{ n: number }>();
  const byAnswer = new Map(results.map((r) => [r.answer, r.n]));
  const answered = results.reduce((sum, r) => sum + r.n, 0);
  const counts: SurveySummary['counts'] = [];
  let texts: SurveySummary['texts'] = [];
  if (q.kind === 'choice') {
    for (const o of q.options) counts.push({ option: o, count: byAnswer.get(o) ?? 0, current: true });
    for (const r of results.filter((r) => !q.options.includes(r.answer)).sort((a, b) => b.n - a.n)) {
      counts.push({ option: r.answer, count: r.n, current: false });
    }
  } else {
    const { results: rows } = await db
      .prepare(
        `SELECT answer, answered_at FROM survey_answers WHERE question_id = ? AND skipped = 0 AND answer IS NOT NULL
          ORDER BY answered_at DESC, id DESC LIMIT 50`,
      )
      .bind(q.id)
      .all<{ answer: string; answered_at: string }>();
    texts = rows.map((r) => ({ answer: r.answer, answeredAt: r.answered_at }));
  }
  const body: SurveySummary = { question: q, answered, skipped: skipped?.n ?? 0, counts, texts };
  return c.json(body);
});

// ---- 操作ログから元に戻す(A-15) ----

registerUndo('survey_question.update', async (db, log) => {
  const q = await findQuestion(db, Number(log.target_id));
  const before = JSON.parse(log.before_value ?? '{}') as Partial<Editable>;
  const after = JSON.parse(log.after_value ?? '{}') as Partial<Editable>;
  const current = pickEditable(q);
  for (const k of Object.keys(after) as (keyof Editable)[]) {
    if (!same(current[k], after[k])) {
      throw errors.conflict('question_changed', 'この質問は、そのあとにまた変更されています。アンケートの画面で、直接直してください。');
    }
  }
  const next = { ...current, ...before } as Editable;
  if ((next.target !== current.target || next.kind !== current.kind) && (q.answerCount ?? 0) > 0) {
    throw errors.conflict('question_answered', 'この質問にはもう回答があるため、元に戻せません。アンケートの画面で直してください。');
  }
  await updateStatement(db, q.id, next).run();
});

// 追加の取り消しは、削除ではなく非表示にする
registerUndo('survey_question.create', async (db, log) => {
  const q = await findQuestion(db, Number(log.target_id));
  await db.prepare('UPDATE survey_questions SET visible = 0 WHERE id = ? AND is_fixed = 0').bind(q.id).run();
});

registerUndo('survey_question.reorder', async (db, log) => {
  const before = (JSON.parse(log.before_value ?? '{}') as { ids: number[] }).ids;
  const now = await currentOrder(db);
  const ids = [...before.filter((id) => now.includes(id)), ...now.filter((id) => !before.includes(id))];
  await db.batch(orderStatements(db, ids));
});
