import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  approvalReason,
  bookingMessageText,
  bookingWhenText,
  canCustomerCancel,
  cancelDeadline,
  capacityFor,
  checkBookingDates,
  checkSettingsPatch,
  countBySize,
  dayAvailability,
  estimateBooking,
  nightsOf,
  occupiedRange,
  timeOptions,
  vaccineNotice,
  zeroCounts,
} from '../src';

const S = DEFAULT_SETTINGS;

describe('予約の受け入れ数(サイズごと・日ごと。21章)', () => {
  it('いつもの数は 小型5・中型3・大型2(預かり・お泊まりとも)', () => {
    expect(capacityFor(S, 'daycare', '2026-11-04').caps).toEqual({ small: 5, medium: 3, large: 2 });
    expect(capacityFor(S, 'boarding', '2026-11-04').caps).toEqual({ small: 5, medium: 3, large: 2 });
  });

  it('臨時休業の日は、上書きがあっても休み', () => {
    const c = capacityFor(S, 'daycare', '2026-11-04', {
      shopClosed: true,
      override: { date: '2026-11-04', service: 'daycare', closed: false, caps: { small: 9, medium: null, large: null }, note: null },
    });
    expect(c.closed).toBe(true);
  });

  it('上書きで休み・数を変える(空欄はいつもの数)', () => {
    const closed = capacityFor(S, 'daycare', '2026-11-04', {
      override: { date: '2026-11-04', service: 'daycare', closed: true, caps: { small: null, medium: null, large: null }, note: '研修' },
    });
    expect(closed).toMatchObject({ closed: true, closedReason: '研修' });
    const more = capacityFor(S, 'daycare', '2026-11-04', {
      override: { date: '2026-11-04', service: 'daycare', closed: false, caps: { small: 8, medium: null, large: 0 }, note: null },
    });
    expect(more.caps).toEqual({ small: 8, medium: 3, large: 0 });
  });

  it('定休日は休み。上書きで数を入れれば、その日だけ受ける', () => {
    const s = { ...S, booking_closed_weekdays: [3] }; // 水曜
    expect(capacityFor(s, 'daycare', '2026-11-04').closed).toBe(true);
    const open = capacityFor(s, 'daycare', '2026-11-04', {
      override: { date: '2026-11-04', service: 'daycare', closed: false, caps: { small: 2, medium: null, large: null }, note: null },
    });
    expect(open.closed).toBe(false);
    expect(open.caps.small).toBe(2);
  });

  it('空きの見え方: 空きあり・残りわずか・満員・休み', () => {
    const cap = capacityFor(S, 'daycare', '2026-11-04');
    const need = countBySize(['large']);
    expect(dayAvailability(cap, zeroCounts(), need)).toBe('open');
    expect(dayAvailability(cap, { small: 0, medium: 0, large: 1 }, need)).toBe('few');
    expect(dayAvailability(cap, { small: 0, medium: 0, large: 2 }, need)).toBe('full');
    // 大型2頭を選ぶと、1頭入っている日は満員
    expect(dayAvailability(cap, { small: 0, medium: 0, large: 1 }, countBySize(['large', 'large']))).toBe('full');
    // 選んでいないサイズの混み具合は関係ない
    expect(dayAvailability(cap, { small: 5, medium: 0, large: 0 }, need)).toBe('open');
    expect(dayAvailability({ ...cap, closed: true }, zeroCounts(), need)).toBe('closed');
  });

  it('お泊まりは泊まる夜だけ数える(チェックアウトの日は数えない)', () => {
    expect(occupiedRange('boarding', '2026-11-03', '2026-11-05')).toEqual({ from: '2026-11-03', to: '2026-11-04' });
    expect(occupiedRange('daycare', '2026-11-03', '2026-11-03')).toEqual({ from: '2026-11-03', to: '2026-11-03' });
    expect(nightsOf('boarding', '2026-11-03', '2026-11-05')).toBe(2);
  });
});

describe('すぐ確定か確認待ちか(2026-10-31 の決定)', () => {
  it('預かりの経験がある子だけなら、すぐ確定', () => {
    expect(approvalReason(false, [{ experienced: true }, { experienced: true }])).toBeNull();
  });
  it('はじめての子が1頭でもいれば確認待ち', () => {
    expect(approvalReason(false, [{ experienced: true }, { experienced: false }])).toBe('first_time');
  });
  it('「すべて承認制にする」なら、経験があっても確認待ち', () => {
    expect(approvalReason(true, [{ experienced: true }])).toBe('approve_all');
  });
});

describe('料金の目安(2026-10-31 の初期値)', () => {
  const dogs = [
    { id: 1, name: 'こむぎ', size: 'small' as const },
    { id: 2, name: 'あずき', size: 'large' as const },
  ];
  it('預かり: 小型3,000円・大型5,000円(1日)', () => {
    const e = estimateBooking(S, { service: 'daycare', startDate: '2026-11-04', endDate: '2026-11-04', startTime: '10:00', endTime: '16:00', dogs });
    expect(e.total).toBe(8000);
    expect(e.lines.map((l) => l.amount)).toEqual([3000, 5000]);
    expect(e.halfDay).toBe(false);
  });
  it('お泊まり: 1泊 小型10,000円・中型12,500円・大型15,000円 × 泊数', () => {
    const e = estimateBooking(S, {
      service: 'boarding',
      startDate: '2026-11-03',
      endDate: '2026-11-05',
      startTime: '10:00',
      endTime: '16:00',
      dogs: [...dogs, { id: 3, name: 'まめ', size: 'medium' }],
    });
    expect(e.nights).toBe(2);
    expect(e.total).toBe((10000 + 15000 + 12500) * 2);
  });
  it('半日の料金は初期値では使わない。使う設定なら、短い預かりは半日の料金', () => {
    const s = { ...S, booking_prices: { ...S.booking_prices, half_day: { ...S.booking_prices.half_day, enabled: true } } };
    const short = estimateBooking(s, { service: 'daycare', startDate: '2026-11-04', endDate: '2026-11-04', startTime: '10:00', endTime: '13:00', dogs });
    expect(short.halfDay).toBe(true);
    expect(short.total).toBe(1500 + 2500);
    const long = estimateBooking(s, { service: 'daycare', startDate: '2026-11-04', endDate: '2026-11-04', startTime: '10:00', endTime: '15:00', dogs });
    expect(long.halfDay).toBe(false);
  });
});

describe('キャンセルの期限(初期値: 前の日の 18:00)', () => {
  it('期限は利用の初日の前の日の 18:00(日本時間)', () => {
    expect(cancelDeadline(S, '2026-11-04')).toBe('2026-11-03T18:00:00+09:00');
  });
  it('期限まではキャンセルできる。過ぎたらできない', () => {
    const b = { status: 'confirmed' as const, startDate: '2026-11-04' };
    expect(canCustomerCancel(S, b, new Date('2026-11-03T18:00:00+09:00'))).toBe(true);
    expect(canCustomerCancel(S, b, new Date('2026-11-03T18:00:01+09:00'))).toBe(false);
  });
  it('確認待ちもキャンセルできる。お断り・利用済みはできない', () => {
    const at = new Date('2026-11-01T10:00:00+09:00');
    expect(canCustomerCancel(S, { status: 'pending', startDate: '2026-11-04' }, at)).toBe(true);
    expect(canCustomerCancel(S, { status: 'declined', startDate: '2026-11-04' }, at)).toBe(false);
    expect(canCustomerCancel(S, { status: 'completed', startDate: '2026-11-04' }, at)).toBe(false);
  });
});

describe('予約の日にちと時刻の確かめ', () => {
  const today = '2026-10-31';
  const base = { service: 'daycare' as const, startDate: '2026-11-04', endDate: '2026-11-04', startTime: '10:00', endTime: '16:00' };
  it('ふつうの預かりは通る', () => expect(checkBookingDates(S, base, today)).toBeNull());
  it('受付の時間の外はだめ', () => expect(checkBookingDates(S, { ...base, startTime: '08:00' }, today)).toMatch('09:00〜18:00'));
  it('お迎えが預けるより前はだめ', () => expect(checkBookingDates(S, { ...base, endTime: '09:30' }, today)).toMatch('お迎え'));
  it('今日は予約できない(初期値は翌日から)', () =>
    expect(checkBookingDates(S, { ...base, startDate: today, endDate: today }, today)).toMatch('1日後から'));
  it('60日より先はだめ', () => expect(checkBookingDates(S, { ...base, startDate: '2027-01-15', endDate: '2027-01-15' }, today)).toMatch('60日後まで'));
  it('お泊まりは最長14泊', () =>
    expect(checkBookingDates(S, { ...base, service: 'boarding', startDate: '2026-11-04', endDate: '2026-11-19' }, today)).toMatch('14泊'));
  it('受付の手入力は期間の決まりを外せる', () =>
    expect(checkBookingDates(S, { ...base, startDate: today, endDate: today }, today, { ignoreWindow: true })).toBeNull());
});

describe('予防注射の案内(止めずに知らせる)', () => {
  it('両方の年が今年か去年なら、案内しない', () => {
    expect(vaccineNotice({ name: 'こむぎ', rabiesVaccineYear: 2026, comboVaccineYear: 2025 }, '2026-10-31')).toBeNull();
  });
  it('空欄・古い年は、名前つきで知らせる', () => {
    expect(vaccineNotice({ name: 'こむぎ', rabiesVaccineYear: null, comboVaccineYear: 2023 }, '2026-10-31')).toMatch(
      /こむぎは、狂犬病の予防注射の年が登録されていません。混合ワクチンの年が前の年より前/,
    );
  });
});

describe('予約の表示とお知らせの文', () => {
  it('日にちの一行', () => {
    expect(bookingWhenText({ service: 'daycare', startDate: '2026-11-04', endDate: '2026-11-04', startTime: '09:00', endTime: '17:30' })).toBe(
      '11月4日(水) 9:00〜17:30',
    );
    expect(bookingWhenText({ service: 'boarding', startDate: '2026-11-03', endDate: '2026-11-05', startTime: '10:00', endTime: '16:00' })).toBe(
      '11月3日(火) 10:00 〜 11月5日(木) 16:00・2泊',
    );
  });
  it('確定のお知らせには料金の目安と予約の内容へのリンク', () => {
    const t = bookingMessageText({
      kind: 'confirmed',
      facilityName: 'グリーンドーム',
      service: 'daycare',
      when: '11月4日(水) 9:00〜17:30',
      dogNames: ['こむぎ', 'だいず'],
      estimateTotal: 6000,
      message: null,
      link: 'https://liff.line.me/123-abc/bookings/5',
    });
    expect(t).toContain('預かりのご予約が確定しました');
    expect(t).toContain('6,000円(目安。お支払いは受付で)');
    expect(t).toContain('https://liff.line.me/123-abc/bookings/5');
  });
  it('お断りには料金を書かず、お店の一言を書く', () => {
    const t = bookingMessageText({
      kind: 'declined',
      facilityName: 'グリーンドーム',
      service: 'boarding',
      when: 'x',
      dogNames: ['あずき'],
      estimateTotal: 30000,
      message: 'その日は満室です',
      link: null,
    });
    expect(t).toContain('お受けできませんでした');
    expect(t).not.toContain('料金');
    expect(t).toContain('お店から: その日は満室です');
  });
  it('選べる時刻は受付の時間の中を30分ごと', () => {
    const t = timeOptions(S);
    expect(t[0]).toBe('09:00');
    expect(t.at(-1)).toBe('18:00');
    expect(t).toHaveLength(19);
  });
});

describe('予約の設定の確かめ(ルールの設定と同じ)', () => {
  it('受付の時間は始めが終わりより前', () => {
    expect(checkSettingsPatch({ booking_hours: { open: '18:00', close: '09:00' } }).ok).toBe(false);
    expect(checkSettingsPatch({ booking_hours: { open: '08:30', close: '19:00' } }).ok).toBe(true);
  });
  it('受け入れ数は 0〜100', () => {
    const r = checkSettingsPatch({ booking_capacity: { daycare: { small: -1, medium: 3, large: 2 }, boarding: { small: 5, medium: 3, large: 2 } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('受け入れる頭数');
  });
});

describe('その日の預け・お迎え(お店の1日の予定)', () => {
  it('預かりは預けとお迎え、お泊まりはチェックインとチェックアウトの日だけ。時刻の順', async () => {
    const { scheduleOf, bookingHoursText } = await import('../src');
    const b = (id: number, service: 'daycare' | 'boarding', startDate: string, endDate: string, startTime: string, endTime: string, status = 'confirmed' as const) =>
      ({ id, service, status, startDate, endDate, startTime, endTime });
    const items = scheduleOf(
      [
        b(1, 'daycare', '2026-11-04', '2026-11-04', '10:00', '16:00'),
        b(2, 'boarding', '2026-11-03', '2026-11-05', '11:00', '15:00'),
        b(3, 'boarding', '2026-11-04', '2026-11-06', '09:30', '16:00'),
        b(4, 'daycare', '2026-11-04', '2026-11-04', '09:00', '12:00', 'cancelled' as never),
      ],
      '2026-11-04',
    );
    expect(items.map((i) => `${i.time} ${i.kind} ${i.bookingId}`)).toEqual(['09:30 checkin 3', '10:00 dropoff 1', '16:00 pickup 1']);
    expect(scheduleOf([b(2, 'boarding', '2026-11-03', '2026-11-05', '11:00', '15:00')], '2026-11-05')[0]).toMatchObject({ kind: 'checkout', time: '15:00' });
    expect(bookingHoursText(DEFAULT_SETTINGS)).toBe('預け・お迎え 9:00〜18:00 / 定休日 なし');
    expect(bookingHoursText({ ...DEFAULT_SETTINGS, booking_closed_weekdays: [3, 0] })).toBe('預け・お迎え 9:00〜18:00 / 定休日 日・水曜');
  });
});
