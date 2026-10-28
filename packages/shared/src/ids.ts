// 会員ID(DR-000123)と犬ID(DR-000123-1)の形式。

export const MEMBER_NO_PATTERN = /^DR-\d{6}$/;
export const DOG_NO_PATTERN = /^DR-\d{6}-\d+$/;

export function formatMemberNo(seq: number): string {
  return `DR-${String(seq).padStart(6, '0')}`;
}

export function formatDogNo(memberNo: string, seq: number): string {
  return `${memberNo}-${seq}`;
}
