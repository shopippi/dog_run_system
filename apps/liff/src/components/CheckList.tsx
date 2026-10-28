import { useId } from 'react';

type Props = {
  options: readonly string[];
  value: readonly string[];
  onChange: (v: string[]) => void;
  /** 名前になる見出しの要素の id */
  labelledBy: string;
};

/**
 * いくつでも選ぶ部品(複数選択)。チェックボックスを見せたチップを並べる(docs/design.md 4章のチップと同じ大きさ・選択中の色)。
 * 選んだ順ではなく、選択肢の順に返す。
 */
export function CheckList({ options, value, onChange, labelledBy }: Props) {
  const name = useId();
  const toggle = (o: string, on: boolean) => {
    const next = on ? [...value, o] : value.filter((x) => x !== o);
    onChange(options.filter((x) => next.includes(x)));
  };
  return (
    <div className="pf-checks" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <label key={o}>
          <input type="checkbox" name={name} checked={value.includes(o)} onChange={(e) => toggle(o, e.target.checked)} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}
