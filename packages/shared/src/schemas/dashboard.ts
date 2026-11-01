import { z } from 'zod';
import { DASHBOARD_RANGES } from '../api-types-dashboard';

// 入力チェック(ダッシュボード・日々のメモ・地域。docs/design.md 12章)

/** 実在する日付か("2026-02-30" などをはじく) */
const realDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
};

export const noteDateSchema = z
  .string({ error: '日付を選んでください。' })
  .regex(/^20\d{2}-\d{2}-\d{2}$/, { error: '日付を選び直してください。' })
  .refine(realDate, { error: 'その日付はありません。日付を選び直してください。' });

/** メモの本文の長さ(day_notes.body) */
export const DAY_NOTE_MAX = 500;

const noteBody = z
  .string({ error: 'メモを入力してください。' })
  .trim()
  .min(1, { error: 'メモを入力してください。' })
  .max(DAY_NOTE_MAX, { error: `メモは${DAY_NOTE_MAX}文字までで入力してください。` });

export const dayNoteCreateSchema = z.object({ date: noteDateSchema, body: noteBody });
export const dayNoteUpdateSchema = z.object({ body: noteBody });

/** メモの一覧(日付1つか、期間) */
export const dayNotesQuerySchema = z
  .object({ date: noteDateSchema.optional(), from: noteDateSchema.optional(), to: noteDateSchema.optional() })
  .refine((q) => q.date || (q.from && q.to), { error: '日付を選んでください。' })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { error: '期間の始まりが終わりより後になっています。期間を選び直してください。' });

export const dashboardMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, { error: '月を選び直してください。' });

export const dashboardRangeSchema = z.enum(DASHBOARD_RANGES, { error: '期間を選び直してください。' });

/** 1つのメモの1行目(グラフの吹き出しに出す) */
export function firstLine(text: string, max = 40): string {
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
