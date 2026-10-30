import type { WeatherKind } from '@dr/shared';

// 天気の線のアイコン(docs/design.md 7章と同じ作り。24 のグリッド、線 1.75、文字の色)。ダッシュボードのカレンダー・日の詳細で使う
const PATHS: Record<WeatherKind, JSX.Element> = {
  晴れ: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  曇り: <path d="M7 18.5h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 9.6 4.5 4.5 0 0 0 7 18.5Z" />,
  雨: (
    <>
      <path d="M7 14.5h10a3.75 3.75 0 0 0 .55-7.46A5.25 5.25 0 0 0 7.5 6.1 4.25 4.25 0 0 0 7 14.5Z" />
      <path d="m8.5 17.5-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5" />
    </>
  ),
};

export function WeatherIcon({ kind, size = 16 }: { kind: WeatherKind | null; size?: number }) {
  if (!kind) return <span className="wx-none" style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <svg
      className="wx-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[kind]}
    </svg>
  );
}
