import QRCode from 'qrcode';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BusyLabel } from './BusyLabel';
import { ErrorNotice } from './ErrorNotice';
import { Loading, Skeleton, SkeletonGhost, SkeletonText } from './Skeleton';

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

/** 保存のボタンと、まだ保存していない変更の案内・エラー。「保存しました」はトーストで出す(呼び出し側) */
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
        <p className="cfg-foot-msg sub-text">{dirty && !saved ? 'まだ保存していない変更があります。' : ''}</p>
      )}
      <button type="button" className="btn sub" disabled={!dirty || busy} onClick={onSave}>
        <BusyLabel busy={busy} pending="保存しています…">
          {label}
        </BusyLabel>
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

/** 入力欄の形(ラベル 13px と、高さ 44 の欄) */
export function SkeletonField({ w = '100%', label = 72, h = 44 }: { w?: number | string; label?: number; h?: number | string }) {
  return (
    <div className="field">
      <SkeletonText size={13} w={label} />
      <Skeleton w={w} h={h} r={8} />
    </div>
  );
}

/**
 * 設定まわりの一覧(犬種・アンケート・スタッフ)の読み込み中。上に追加のまとまり(add)、下に一覧の行。
 * numbered は行の頭の番号の列があるとき(犬種・アンケート)。
 */
export function CfgListSkeleton({ add, rows = 6, numbered = true }: { add?: ReactNode; rows?: number; numbered?: boolean }) {
  return (
    <Loading>
      {add && <section className="panel cfg-add">{add}</section>}
      <section className="panel list-panel">
        <ul className="cfg-list">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className={`cfg-item${numbered ? '' : ' cfg-staff'}`}>
              {numbered && <SkeletonText size={13} w={14} />}
              <span className="cfg-item-body">
                <SkeletonText size={15} w={[120, 96, 150, 110, 136, 88][i % 6]} />
                <SkeletonText size={13} w={[180, 220, 160, 200, 140, 190][i % 6]} />
              </span>
              <span className="badges" />
              <span className="cfg-item-acts">
                {(numbered ? [28, 28, 42, 70] : [126, 56]).map((w, j) => (
                  <SkeletonGhost key={j} w={w} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Loading>
  );
}

/** 設定のまとまり(見出し・説明・欄)の読み込み中 */
export function CfgSectionSkeleton({
  fields = 2,
  title = 120,
  fieldW = 112,
  hint = false,
}: {
  fields?: number;
  title?: number;
  fieldW?: number | string;
  hint?: boolean;
}) {
  return (
    <section className="panel cfg-section">
      <div className="cfg-section-head">
        <SkeletonText size={17} lh={1.35} w={title} />
        <SkeletonText size={13} w="70%" />
      </div>
      <div className="cfg-section-body">
        <div className="cfg-row">
          {Array.from({ length: fields }, (_, i) => (
            <SkeletonField key={i} w={fieldW} label={[96, 120, 80][i % 3]} />
          ))}
        </div>
        {hint && <SkeletonText size={13} w={72} />}
      </div>
      <div className="cfg-section-foot">
        <span className="cfg-foot-msg" />
        <Skeleton w={96} h="var(--control-h)" r={8} />
      </div>
    </section>
  );
}
