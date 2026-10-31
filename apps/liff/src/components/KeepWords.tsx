import { Fragment } from 'react';

/**
 * 空白で区切った文(「12月27日(日) 10:00 〜 12月29日(火) 17:00・2泊」「一緒に来た回数 4回・最後に来た日 10月1日」)を、
 * 空白のところでだけ折り返して出す。「2/泊」「10月/1日」のように、数と単位や日付の途中で行が分かれないようにする。
 * 読み上げは元の文のまま。
 */
export function KeepWords({ text }: { text: string }) {
  const parts = text.split(' ');
  // 空白のない文(「まだ来場の記録はありません。…」)は、ふつうに折り返す(まとめて折り返さないと横にはみ出す)
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? ' ' : ''}
          <span className="nowrap">{p}</span>
        </Fragment>
      ))}
    </>
  );
}
