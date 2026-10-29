import { nameInitial, placeholderColor } from '@dr/shared';
import { useEffect, useId, useState } from 'react';
import { useAuthedImage } from '../hooks/useAuthedImage';
import type { ResizedPhoto } from '../lib/photo';

/** 垂れ耳の形(100×100 の中の左の耳)。右の耳は左右を反転して使う */
const EAR = 'M14 22c6-9 18-10 24-3 4 5 2 16-3 27-4 8-11 12-16 9-6-4-9-19-5-33Z';

/**
 * 写真がない犬は、犬種の色と名前の頭文字で作った絵を出す(6.2)。
 * 犬らしさが少し出るよう、頭文字のうしろに垂れ耳の形を薄く添える(docs/design.md 13章)。
 */
export function DogPlaceholder({ name, breedName, size }: { name: string; breedName: string; size: number }) {
  const initial = nameInitial(name);
  const clip = useId();
  return (
    <svg
      className="av av-ph"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${name}(写真なし)`}
    >
      <clipPath id={clip}>
        <circle cx="50" cy="50" r="50" />
      </clipPath>
      <circle cx="50" cy="50" r="50" fill={placeholderColor(breedName, name)} />
      <g clipPath={`url(#${clip})`} className="av-ears" aria-hidden="true">
        <path d={EAR} />
        <path d={EAR} transform="translate(100 0) scale(-1 1)" />
      </g>
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

/**
 * ワンちゃんの変更画面の上に出す、大きな写真(幅いっぱい、縦横比 4:3、角丸 16)。
 * 写真がなければ、犬種の色の面に大きな頭文字と垂れ耳の絵。
 */
export function DogHero({
  name,
  breedName,
  url,
  photo,
}: {
  name: string;
  breedName: string;
  url?: string | null;
  /** 選んだばかりの写真(送る前) */
  photo?: ResizedPhoto | null;
}) {
  const loaded = useAuthedImage(photo ? null : url);
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!photo) {
      setLocal(null);
      return;
    }
    const u = URL.createObjectURL(photo.photo);
    setLocal(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  const src = photo ? local : loaded;
  if (src) return <img className="dog-hero" src={src} alt={name} />;
  return (
    <svg className="dog-hero dog-hero-ph" viewBox="0 0 400 300" role="img" aria-label={`${name}(写真なし)`}>
      <rect width="400" height="300" fill={placeholderColor(breedName, name)} />
      <g className="av-ears" aria-hidden="true" transform="translate(80 30) scale(2.4)">
        <path d={EAR} />
        <path d={EAR} transform="translate(100 0) scale(-1 1)" />
      </g>
      <text x="200" y="150" dy=".36em" textAnchor="middle" fontSize="120" fontWeight="600">
        {nameInitial(name)}
      </text>
    </svg>
  );
}
