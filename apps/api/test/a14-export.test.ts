import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/services/csv';
import { BASE, adminCall, call, checkin, createStaff, dog, login, registerUser } from './helpers';

const DAY1 = '2026-10-27T01:00:00Z';
const DAY2 = '2026-10-28T01:00:00Z';

async function as(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}
/** CSV を取り出して行に分ける(res.text() は BOM を外す。BOM は最初のテストでバイトで確かめる) */
async function csv(cookie: string, path: string) {
  const res = await adminCall<string>(`/admin/api/export/${path}`, { cookie, now: DAY2 });
  const text = String(res.body);
  return { status: res.status, lines: text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean) };
}

describe('A-14 CSV出力', () => {
  it('UTF-8 の BOM つき、Excel で開ける形(見出しは日本語、ファイル名つき)', async () => {
    const cookie = await as('admin');
    const res = await SELF.fetch(`${BASE}/admin/api/export/households`, { headers: { cookie, 'x-debug-now': DAY2 } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="households_2026-10-28.csv"');
    expect(res.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('おうち_2026-10-28.csv')}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes).split('\r\n')[0]).toBe(
      '会員ID,おうちの呼び名,登録日時,登録のしかた,状態,統合先の会員ID,郵便番号,知ったきっかけ,来場手段,家族の人数,ワンちゃんの数,ポイント,使える無料券,来場回数,最初の来場日,最後の来場日',
    );
  });

  it('おうち・家族・ワンちゃん: 画面と同じ言葉で出る', async () => {
    const cookie = await as('admin');
    const r = await registerUser('U001:パパ', [dog('アル'), dog('ニコ', { breedId: 11, breedOther: 'ポメプー' })]);
    await checkin('U001:パパ', [r.dogs[0]!.id], { now: DAY1 });
    const h = await csv(cookie, 'households');
    expect(h.lines[1]).toMatch(/^DR-000001,アル・ニコのおうち,.*,新規,有効,,,Instagram,,1,2,1,0,1,2026-10-27,2026-10-27$/);

    const m = await csv(cookie, 'members');
    expect(m.lines[0]).toBe('会員ID,おうちの呼び名,LINEの名前,年代,性別,参加日時,参加のしかた,状態,抜けた日時');
    expect(m.lines[1]).toMatch(/^DR-000001,アル・ニコのおうち,パパ,30代,女性,.*,初回登録,参加中,$/);

    const d = await csv(cookie, 'dogs');
    expect(d.lines[1]).toMatch(/^DR-000001-1,DR-000001,アル・ニコのおうち,アル,トイプードル,小型,,,登録中,なし,.*,1$/);
    expect(d.lines[2]).toMatch(/^DR-000001-2,.*,ニコ,ポメプー,小型,.*,0$/);
  });

  it('来場とポイント台帳は期間を指定できる。取り消しも出る', async () => {
    const cookie = await as('admin');
    const r = await registerUser('U001:パパ');
    await checkin('U001:パパ', [r.dogs[0]!.id], { now: DAY1 });
    const v2 = await checkin('U001:パパ', [r.dogs[0]!.id], { now: DAY2 });
    await adminCall(`/admin/api/checkins/${v2.body.visitId}/cancel`, { cookie, body: { reason: '入力ミス' }, now: DAY2 });

    const all = await csv(cookie, 'visits');
    expect(all.lines).toHaveLength(3);
    expect(all.lines[0]).toBe('来場日,時刻,会員ID,おうちの呼び名,頭数,来たワンちゃん,無料券,登録のしかた,チェックインした家族,入力したスタッフ,取り消した日時,取り消しの理由');
    expect(all.lines[1]).toBe('2026-10-27,10:00,DR-000001,アルのおうち,1,アル,,ご本人,パパ,,,');
    expect(all.lines[2]).toMatch(/^2026-10-28,10:00,.*,2026-10-28T10:00:00\+09:00,入力ミス$/);
    const one = await csv(cookie, 'visits?from=2026-10-28&to=2026-10-28');
    expect(one.lines).toHaveLength(2);
    expect(one.lines[1]).toMatch(/^2026-10-28/);

    const led = await csv(cookie, 'ledger?from=2026-10-28');
    expect(led.lines[0]).toBe('日時,会員ID,おうちの呼び名,増減,種類,理由,旧カード,有効期限,操作した人');
    expect(led.lines.slice(1).map((l) => l.split(',').slice(3, 5).join(','))).toEqual(['1,来場', '-1,来場の取り消し']);
    expect(led.lines[2]).toMatch(/,管理者$/);
    expect((await csv(cookie, 'ledger?to=2026-10-27')).lines).toHaveLength(2);

    const bad = await adminCall('/admin/api/export/visits?from=2026-10-29&to=2026-10-28', { cookie });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('期間の終わりの日は、始めの日より後にしてください。');
  });

  it('アンケート: 固定の質問と追加した質問の回答(答えないも含む)を1回答1行で出す', async () => {
    const cookie = await as('admin');
    await registerUser('U001:パパ');
    const q = await adminCall('/admin/api/survey-questions', {
      cookie,
      body: { target: 'member', kind: 'choice', label: 'ほかのドッグラン', options: ['使う', '使わない'] },
    });
    await call('/api/survey', { user: 'U001:パパ', body: { answers: [{ questionId: q.body.id, value: '使う' }] } });
    await registerUser('U002:ママ', [dog('ハナ')], {
      survey: [
        { questionId: 1, value: '40代' },
        { questionId: 2, value: '男性' },
        { questionId: 4, value: '通りがかり' },
        { questionId: q.body.id, value: null },
      ],
    });
    const s = await csv(cookie, 'survey');
    expect(s.lines[0]).toBe('会員ID,おうちの呼び名,答えた人,聞く相手,質問,回答,回答日時');
    const rows = s.lines.slice(1).map((l) => l.split(',').slice(0, 6).join(','));
    expect(rows).toEqual([
      'DR-000001,アルのおうち,パパ,家族一人ひとり,年代,30代',
      'DR-000001,アルのおうち,パパ,家族一人ひとり,性別,女性',
      'DR-000001,アルのおうち,おうち,おうちごと,このドッグランを知ったきっかけ,Instagram',
      'DR-000001,アルのおうち,パパ,家族一人ひとり,ほかのドッグラン,使う',
      'DR-000002,ハナのおうち,ママ,家族一人ひとり,年代,40代',
      'DR-000002,ハナのおうち,ママ,家族一人ひとり,性別,男性',
      'DR-000002,ハナのおうち,おうち,おうちごと,このドッグランを知ったきっかけ,通りがかり',
      'DR-000002,ハナのおうち,ママ,家族一人ひとり,ほかのドッグラン,(答えない)',
    ]);
  });

  it('出力したことを操作ログに残す', async () => {
    const cookie = await as('admin');
    await csv(cookie, 'visits?from=2026-10-01&to=2026-10-31');
    const log = await env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').first<Record<string, string>>();
    expect(log).toMatchObject({ action: 'export.csv', target_type: 'export', target_id: 'visits', actor_id: 1 });
    expect(JSON.parse(log!.after_value!)).toEqual({ name: '来場', from: '2026-10-01', to: '2026-10-31', rows: 0 });
  });

  it('受付スタッフは 403。製作者は出力できる(見るだけの操作)。知らない種類は 404', async () => {
    const staff = await as('staff');
    expect((await csv(staff, 'households')).status).toBe(403);
    expect((await csv(staff, 'members')).status).toBe(403);
    const dev = await as('developer');
    expect((await csv(dev, 'members')).status).toBe(200);
    const admin = await as('admin');
    expect((await csv(admin, 'payments')).status).toBe(404);
  });

  it('CSV の値: カンマ・引用符・改行を囲み、式として読まれる文字の前に \' を付ける(数は除く)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('1行目\n2行目')).toBe('"1行目\n2行目"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM')).toBe("'@SUM");
    expect(csvCell('-1')).toBe('-1');
    expect(csvCell(-1)).toBe('-1');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a'], [[1]])).toBe('\uFEFFa\r\n1\r\n');
  });
});
