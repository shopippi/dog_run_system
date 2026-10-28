import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoD1 } from '../src/engine/d1';

let d1: DemoD1;

beforeEach(async () => {
  const SQL = await initSqlJs();
  d1 = new DemoD1(new SQL.Database());
  await d1.exec(`
    CREATE TABLE visits (id INTEGER PRIMARY KEY, household_id INTEGER, visit_date TEXT NOT NULL, cancelled_at TEXT);
    CREATE UNIQUE INDEX uq ON visits(household_id, visit_date) WHERE household_id IS NOT NULL AND cancelled_at IS NULL;
    CREATE TABLE notes (id INTEGER PRIMARY KEY, visit_id INTEGER, body TEXT);
  `);
});

describe('D1 の代わり(sql.js)', () => {
  it('prepare / bind / run / first / all / raw が D1 と同じ形で返る', async () => {
    const r = await d1.prepare('INSERT INTO visits (household_id, visit_date) VALUES (?, ?)').bind(1, '2026-10-28').run();
    expect(r.success).toBe(true);
    expect(r.meta.last_row_id).toBe(1);
    expect(r.meta.changes).toBe(1);
    await d1.prepare('INSERT INTO visits (household_id, visit_date) VALUES (?1, ?2)').bind(2, '2026-10-28').run();

    expect(await d1.prepare('SELECT * FROM visits WHERE id = ?').bind(2).first()).toEqual({
      id: 2,
      household_id: 2,
      visit_date: '2026-10-28',
      cancelled_at: null,
    });
    expect(await d1.prepare('SELECT COUNT(*) AS n FROM visits').first('n')).toBe(2);
    expect(await d1.prepare('SELECT * FROM visits WHERE id = 99').first()).toBeNull();
    const all = await d1.prepare('SELECT id FROM visits ORDER BY id').all<{ id: number }>();
    expect(all.results).toEqual([{ id: 1 }, { id: 2 }]);
    expect(all.meta.changes).toBe(0);
    expect(await d1.prepare('SELECT id, visit_date FROM visits ORDER BY id').raw()).toEqual([
      [1, '2026-10-28'],
      [2, '2026-10-28'],
    ]);
    expect(await d1.prepare('SELECT id FROM visits ORDER BY id').raw({ columnNames: true })).toEqual([['id'], [1], [2]]);
  });

  it('真偽値は 1 / 0 になり、undefined はエラーになる', async () => {
    await d1.prepare('INSERT INTO notes (visit_id, body) VALUES (?, ?)').bind(true, null).run();
    expect(await d1.prepare('SELECT visit_id FROM notes').first('visit_id')).toBe(1);
    expect(() => d1.prepare('SELECT ?').bind(undefined)).toThrow(/D1_TYPE_ERROR/);
  });

  it('RETURNING と last_insert_rowid() が使える', async () => {
    const r = await d1.prepare("INSERT INTO visits (household_id, visit_date) VALUES (5, '2026-10-01') RETURNING id").first<{ id: number }>();
    expect(r).toEqual({ id: 1 });
    const [a, b] = await d1.batch([
      d1.prepare("INSERT INTO visits (household_id, visit_date) VALUES (6, '2026-10-01')"),
      d1.prepare("INSERT INTO notes (visit_id, body) VALUES (last_insert_rowid(), 'x')"),
    ]);
    expect(a!.meta.last_row_id).toBe(2);
    expect(b!.meta.last_row_id).toBe(1);
    expect(await d1.prepare('SELECT visit_id FROM notes WHERE id = 1').first('visit_id')).toBe(2);
  });

  it('batch は途中で失敗したら全部を元に戻し、D1 と同じ形のエラー文を投げる', async () => {
    await d1.prepare("INSERT INTO visits (household_id, visit_date) VALUES (1, '2026-10-28')").run();
    const err = await d1
      .batch([
        d1.prepare("INSERT INTO notes (visit_id, body) VALUES (1, 'a')"),
        d1.prepare("INSERT INTO visits (household_id, visit_date) VALUES (1, '2026-10-28')"),
      ])
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/UNIQUE constraint failed: visits\.household_id, visits\.visit_date/);
    expect((err as Error).message).toMatch(/^D1_ERROR: /);
    expect(await d1.prepare('SELECT COUNT(*) AS n FROM notes').first('n')).toBe(0);
    // 失敗のあとも続けて使える
    await d1.batch([d1.prepare("INSERT INTO notes (visit_id, body) VALUES (1, 'b')")]);
    expect(await d1.prepare('SELECT COUNT(*) AS n FROM notes').first('n')).toBe(1);
  });

  it('1つの文の失敗も D1 と同じ形のエラーになる', async () => {
    await d1.prepare("INSERT INTO visits (household_id, visit_date) VALUES (1, '2026-10-28')").run();
    await expect(d1.prepare("INSERT INTO visits (household_id, visit_date) VALUES (1, '2026-10-28')").run()).rejects.toThrow(
      /UNIQUE constraint failed: visits\.household_id, visits\.visit_date/,
    );
    await expect(d1.prepare('SELECT * FROM missing_table').all()).rejects.toThrow(/no such table/);
  });

  it('書き込みがあったときだけ onWrite を呼ぶ', async () => {
    let n = 0;
    d1.onWrite = () => n++;
    await d1.prepare('SELECT 1').first();
    expect(n).toBe(0);
    await d1.prepare("INSERT INTO notes (body) VALUES ('x')").run();
    expect(n).toBe(1);
  });
});
