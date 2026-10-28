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
  inbox: (
    <>
      <path d="M3.5 13.5 6 5.5h12l2.5 8v5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
      <path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  flag: <path d="M5.5 21V4.5h11l-2 3.75 2 3.75h-11" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  tag: (
    <>
      <path d="M3.5 12.5v-8a1 1 0 0 1 1-1h8l8 8-9 9z" />
      <circle cx="8" cy="8" r="1.25" />
    </>
  ),
  sliders: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c.5-4 3.5-6.5 7.5-6.5s7 2.5 7.5 6.5" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
      <path d="M3.5 3.5v5h5M12 7.5V12l3 2" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M4 20h16" />,
  activity: <path d="M2.5 12h4l3-7 5 14 3-7h4" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  undo: <path d="M8.5 7.5H4v-4.5M4.3 7.5A8.5 8.5 0 1 1 3.5 12" />,
  merge: <path d="M7 3v5.5l5 5V21M17 3v5.5l-5 5M9 18l3 3 3-3" />,
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
