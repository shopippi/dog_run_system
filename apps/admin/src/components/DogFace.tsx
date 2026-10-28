import { nameInitial, placeholderColor } from '@dr/shared';

/** 犬の写真。写真がなければ犬種の色と名前の頭文字の絵(6.2)。写真はログインのクッキーで読む */
export function DogFace({
  name,
  breedName,
  url,
  size = 56,
}: {
  name: string;
  breedName: string;
  url?: string | null;
  size?: number;
}) {
  if (url) {
    return <img className="av" src={url} width={size} height={size} alt={name} style={{ width: size, height: size }} />;
  }
  return (
    <svg className="av" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${name}(写真なし)`}>
      <circle cx="50" cy="50" r="50" fill={placeholderColor(breedName, name)} />
      <text x="50" y="50" dy=".36em" textAnchor="middle" fontSize="46" fontWeight="700" fill="#fff">
        {nameInitial(name)}
      </text>
    </svg>
  );
}
