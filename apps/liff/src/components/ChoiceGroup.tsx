import { useId } from 'react';

type Props<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  /** 見出しの要素の id(見出しで名前を付けるとき) */
  labelledBy?: string;
  /** 見出しがないときの名前 */
  label?: string;
};

/**
 * 1つを選ぶ部品。2〜4択はセグメント、5択以上はチップ(docs/design.md 4章)。
 * ラジオボタンは見えないようにして、押す場所いっぱいに重ねる(キーボードでも選べる)。
 */
export function ChoiceGroup<T extends string>({ options, value, onChange, labelledBy, label }: Props<T>) {
  const name = useId();
  const kind = options.length <= 4 && options.every((o) => [...o.label].length <= 5) ? 'segment' : 'chips';
  return (
    <div className={kind} role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label}>
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
