import type { ReactNode } from 'react';

// 線のアイコン(docs/design.md 7章)。24 のグリッド、線の太さ 1.75。文字の色を使う。
const PATHS = {
  'chevron-left': <path d="m14.5 18-6-6 6-6" />,
  'chevron-right': <path d="m9.5 18 6-6-6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="m20.5 16-4.5-4.5-8.5 8" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  ticket: (
    <>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5V10a2 2 0 0 0 0 4v2.5A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5V14a2 2 0 0 0 0-4Z" />
      <path d="M14.5 6v12" />
    </>
  ),
  paw: (
    <>
      <path d="M12 12.5c-2.6 0-5 2.6-5 5 0 1.7 1.3 2.5 2.6 2.5 1 0 1.5-.5 2.4-.5s1.4.5 2.4.5c1.3 0 2.6-.8 2.6-2.5 0-2.4-2.4-5-5-5Z" />
      <ellipse cx="9.2" cy="6.8" rx="1.7" ry="2.3" />
      <ellipse cx="14.8" cy="6.8" rx="1.7" ry="2.3" />
      <ellipse cx="5" cy="11" rx="1.6" ry="2.1" />
      <ellipse cx="19" cy="11" rx="1.6" ry="2.1" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.25" />
      <path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
      <path d="M15.5 5.5a3.25 3.25 0 0 1 0 6.2M17.5 14.8c1.9.6 3.1 2.2 3.5 4.7" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
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
