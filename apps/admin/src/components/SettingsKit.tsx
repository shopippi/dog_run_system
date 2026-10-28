import QRCode from 'qrcode';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ErrorNotice } from './ErrorNotice';

// 設定まわりの画面(ルール・犬種・アンケート・スタッフ・イベント・CSV出力・使い方)で共有する小さな部品

/** 画面を開いたときに1回読み込む。reload で読み込み直す */
export function useLoaded<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, reload };
}

/** 項目ごとのまとまり。見出しと説明、中身、下に保存のボタン */
export function Section({
  title,
  desc,
  children,
  foot,
  className = '',
}: {
  title: string;
  desc?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={`panel cfg-section ${className}`} aria-labelledby={id}>
      <div className="cfg-section-head">
        <h2 id={id}>{title}</h2>
        {desc && <p className="sub-text">{desc}</p>}
      </div>
      <div className="cfg-section-body">{children}</div>
      {foot && <div className="cfg-section-foot">{foot}</div>}
    </section>
  );
}

/** 保存のボタンと、その結果(保存しました・エラー) */
export function SaveFoot({
  dirty,
  busy,
  saved,
  error,
  onSave,
  label = '保存する',
}: {
  dirty: boolean;
  busy: boolean;
  saved: boolean;
  error: unknown;
  onSave: () => void;
  label?: string;
}) {
  return (
    <>
      {error ? (
        <div className="cfg-foot-msg">
          <ErrorNotice error={error} />
        </div>
      ) : (
        <p className="cfg-foot-msg sub-text" role="status">
          {saved && !dirty ? '保存しました。' : dirty ? 'まだ保存していない変更があります。' : ''}
        </p>
      )}
      <button type="button" className="btn sub" disabled={!dirty || busy} onClick={onSave}>
        {busy ? '保存しています…' : label}
      </button>
    </>
  );
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "2026-10-28" → "10月28日(水)" */
export function formatYmd(ymd: string, withYear = false): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withYear ? `${y}年` : ''}${m}月${d}日(${w})`;
}

/** "2026-10-28T09:15:00+09:00" → "2026年10月28日 9:15" */
export function formatJstDateTime(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const [hh, mm] = iso.slice(11, 16).split(':').map(Number);
  return `${y}年${m}月${d}日 ${hh}:${String(mm).padStart(2, '0')}`;
}

/** 文字列を QR コードの画像にする(端末の中で作る)。画像を保存するための URL も返す */
export function QrCode({ value, size = 168, label, onImage }: { value: string; size?: number; label: string; onImage?: (src: string | null) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const onImageRef = useRef(onImage);
  onImageRef.current = onImage;
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 3, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!alive) return;
        setSrc(url);
        onImageRef.current?.(url);
      })
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src ? (
    <img className="cfg-qr" src={src} width={size} height={size} alt={label} />
  ) : (
    <div className="cfg-qr" style={{ width: size, height: size }} />
  );
}

/** 2〜4択(セグメント)。中身はラジオとして読み上げる */
export function RadioSegment<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="label" id={id}>
        {label}
      </span>
      <div className="segment cfg-seg" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
