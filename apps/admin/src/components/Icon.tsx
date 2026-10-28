import type { ReactNode } from 'react';

// 線のアイコン(docs/design.md 7章)。24 のグリッド、線の太さ 1.75。文字の色を使う。
const PATHS = {
  'chevron-left': <path d="m14.5 18-6-6 6-6" />,
  'chevron-right': <path d="m9.5 18 6-6-6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.75 20c.4-3.4 3-5.5 6.25-5.5s5.85 2.1 6.25 5.5" />
      <path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.8c2 .7 3.4 2.5 3.75 5.2" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8.5" y="2.75" width="7" height="4" rx="1" />
      <path d="M15.5 4.75h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V6.75a2 2 0 0 1 2-2h2M9 12.5l2 2 4-4" />
    </>
  ),
  'log-out': (
    <>
      <path d="M9.5 20.5h-4a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4" />
      <path d="m16 16.5 4.5-4.5L16 7.5M20.5 12H9.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
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
      {PATHS[name]}
    </svg>
  );
}
