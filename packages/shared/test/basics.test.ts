import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  addDays,
  autoHouseholdName,
  formatDogNo,
  formatMemberNo,
  normalizeForSearch,
  settingsSchema,
  toJstDate,
  toJstIso,
  weekdayOf,
} from '../src';

describe('日本時間の日付', () => {
  it('UTC の 14:59 は日本時間で同じ日、15:00 は翌日になる', () => {
    expect(toJstDate(new Date('2026-10-28T14:59:59Z'))).toBe('2026-10-28');
    expect(toJstDate(new Date('2026-10-28T15:00:00Z'))).toBe('2026-10-29');
  });

  it('日時を +09:00 付きの文字列にする', () => {
    expect(toJstIso(new Date('2026-10-28T00:15:30Z'))).toBe('2026-10-28T09:15:30+09:00');
  });

  it('月末・年末をまたいで日数を足せる', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('曜日を返す', () => {
    expect(weekdayOf('2026-10-28')).toBe(3); // 水曜
    expect(weekdayOf('2026-11-01')).toBe(0); // 日曜
  });
});

describe('会員ID・犬ID', () => {
  it('DR- と6桁の連番', () => {
    expect(formatMemberNo(1)).toBe('DR-000001');
    expect(formatMemberNo(123)).toBe('DR-000123');
    expect(formatDogNo('DR-000123', 2)).toBe('DR-000123-2');
  });
});

describe('検索の正規化', () => {
  it('ひらがなとカタカナを区別しない', () => {
    expect(normalizeForSearch('アル')).toBe(normalizeForSearch('ある'));
    expect(normalizeForSearch('ﾆｺ')).toBe('にこ');
  });

  it('英数字は半角の小文字にそろえ、空白を除く', () => {
    expect(normalizeForSearch('ＤＲ－０００１ 2')).toBe('dr-00012');
  });
});

describe('おうちの呼び名', () => {
  it('犬の名前から作る', () => {
    expect(autoHouseholdName(['アル', 'ニコ'])).toBe('アル・ニコのおうち');
    expect(autoHouseholdName([])).toBe('おうち');
  });
});

describe('設定の初期値', () => {
  it('入力チェックを通る', () => {
    expect(() =>
      settingsSchema.parse({ ...DEFAULT_SETTINGS, checkin_passphrase: 'abcdefgh12345678' }),
    ).not.toThrow();
  });

  it('無料券を使った日もポイントを付ける', () => {
    expect(DEFAULT_SETTINGS.grant_point_on_ticket_day).toBe(true);
    expect(DEFAULT_SETTINGS.points_per_ticket).toBe(10);
  });
});
