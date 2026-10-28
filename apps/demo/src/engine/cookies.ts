// 画面(iframe)ごとのクッキーの入れ物。Set-Cookie を取り込み、次の要求の cookie ヘッダーにする。
// secure・path・samesite は見ない(デモは1つの画面の中で完結するため)。

export class CookieJar {
  private readonly values = new Map<string, { value: string; expires: number | null }>();

  /** Set-Cookie の値を取り込む */
  store(setCookie: string, now = Date.now()) {
    const [pair, ...attrs] = setCookie.split(';');
    const eq = pair!.indexOf('=');
    if (eq <= 0) return;
    const name = pair!.slice(0, eq).trim();
    const value = pair!.slice(eq + 1).trim();
    let expires: number | null = null;
    for (const a of attrs) {
      const [k, v = ''] = a.split('=');
      const key = k!.trim().toLowerCase();
      if (key === 'max-age') expires = now + Number(v.trim()) * 1000;
      else if (key === 'expires' && expires === null) {
        const t = Date.parse(v.trim());
        if (!Number.isNaN(t)) expires = t;
      }
    }
    if (expires !== null && expires <= now) this.values.delete(name);
    else this.values.set(name, { value, expires });
  }

  /** 次の要求に付ける cookie ヘッダーの値(なければ空) */
  header(now = Date.now()): string {
    const parts: string[] = [];
    for (const [name, c] of this.values) {
      if (c.expires !== null && c.expires <= now) this.values.delete(name);
      else parts.push(`${name}=${c.value}`);
    }
    return parts.join('; ');
  }

  clear() {
    this.values.clear();
  }

  toJSON() {
    return [...this.values];
  }

  load(entries: [string, { value: string; expires: number | null }][]) {
    this.values.clear();
    for (const [k, v] of entries) this.values.set(k, v);
  }
}
