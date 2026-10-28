import { nameInitial, placeholderColor } from '@dr/shared';
import { usePhotoSrc } from '../hooks/usePhotoSrc';

/**
 * 犬の写真。写真がなければ犬種の色と名前の頭文字の絵(6.2)。写真はログインのクッキーで読む。
 * ふだんは丸(アバター)。写真で探す画面では四角(shape="square")。
 */
export function DogFace({
  name,
  breedName,
  url,
  size = 56,
  shape = 'circle',
}: {
  name: string;
  breedName: string;
  url?: string | null;
  size?: number;
  shape?: 'circle' | 'square';
}) {
  const cls = shape === 'square' ? 'av sq' : 'av';
  // デモでは写真を fetch で読んでから出す(読み込み中は頭文字の絵)
  const src = usePhotoSrc(url);
  if (src) {
    return <img className={cls} src={src} width={size} height={size} alt={name} style={{ width: size, height: size }} />;
  }
  return (
    <svg className={`${cls} av-ph`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${name}(写真なし)`}>
      {shape === 'square' ? (
        <rect width="100" height="100" fill={placeholderColor(breedName, name)} />
      ) : (
        <circle cx="50" cy="50" r="50" fill={placeholderColor(breedName, name)} />
      )}
      <text x="50" y="50" dy=".36em" textAnchor="middle" fontSize="44" fontWeight="600">
        {nameInitial(name)}
      </text>
    </svg>
  );
}
