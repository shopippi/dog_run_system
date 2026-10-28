import { nameInitial, placeholderColor } from '@dr/shared';
import { useAuthedImage } from '../hooks/useAuthedImage';

/** 写真がない犬は、犬種の色と名前の頭文字で作った絵を出す(6.2) */
export function DogPlaceholder({ name, breedName, size }: { name: string; breedName: string; size: number }) {
  const initial = nameInitial(name);
  return (
    <svg
      className="av av-ph"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${name}(写真なし)`}
    >
      <circle cx="50" cy="50" r="50" fill={placeholderColor(breedName, name)} />
      <text x="50" y="50" dy=".36em" textAnchor="middle" fontSize="44" fontWeight="600">
        {initial}
      </text>
    </svg>
  );
}

type Props = {
  name: string;
  breedName: string;
  /** 認証つき API の写真の URL */
  url?: string | null;
  /** 端末の中のプレビュー(登録前の写真) */
  previewUrl?: string | null;
  size?: number;
};

export function DogAvatar({ name, breedName, url, previewUrl, size = 56 }: Props) {
  const loaded = useAuthedImage(previewUrl ? null : url);
  const src = previewUrl ?? loaded;
  if (!src) return <DogPlaceholder name={name} breedName={breedName} size={size} />;
  return <img className="av" src={src} width={size} height={size} alt={name} style={{ width: size, height: size }} />;
}
