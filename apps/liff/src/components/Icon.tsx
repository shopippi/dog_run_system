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
