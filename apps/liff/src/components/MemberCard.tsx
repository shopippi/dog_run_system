import { CARD_LIGHT_PRESETS, type CardBackgroundView, type DogSummary } from '@dr/shared';
import { AnimatePresence, m } from 'motion/react';
import { Link } from 'react-router-dom';
import { easeOut } from '../lib/motion';
import { RollingNumber } from './RollingNumber';
import { useAuthedImage } from '../hooks/useAuthedImage';
import { DogAvatar } from './DogAvatar';
import { Icon } from './Icon';

type Props = {
  displayName: string;
  memberNo: string;
  facilityName: string;
  dogs: DogSummary[];
  balance: number;
  background: CardBackgroundView;
  /** 写真を選んだ直後に、送る前から見せるための端末の中の URL */
  previewUrl?: string | null;
  /** 右上の「背景を変える」を出すか(背景を変える画面のプレビューでは出さない) */
  showChange?: boolean;
  /** 出たときに、ほんの少し下からふわっと出す(会員証の画面で、読み込み中の形から切り替わるとき) */
  appear?: boolean;
};

/**
 * 会員証(L-07、docs/design.md 5章)。縦横比 1.58:1 の面に、お客さんが選んだ背景を敷く。
 * 写真の上には下に向かって濃くなる影と文字の影を重ね、どんな写真でも呼び名・会員ID・ポイントが読めるようにする。
 * 明るい単色(砂・白)では影を重ねず、文字を墨にする。
 * 背景を変えたときは、色・写真がクロスフェードで切り替わる(色は styles.css の transition、写真は Motion)。
 */
export function MemberCard({
  displayName,
  memberNo,
  facilityName,
  dogs,
  balance,
  background,
  previewUrl,
  showChange = true,
  appear = false,
}: Props) {
  const loaded = useAuthedImage(background.kind === 'photo' && !previewUrl ? background.url : null);
  const photo = background.kind === 'photo' ? (previewUrl ?? loaded) : null;
  const tone =
    background.kind === 'photo'
      ? 'mc-photo-bg'
      : `mc-preset-${background.color}${CARD_LIGHT_PRESETS.includes(background.color) ? ' mc-light' : ''}`;
  return (
    <m.section
      className={`member-card ${tone}`}
      aria-label="会員証"
      initial={appear ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...easeOut, duration: 0.26 }}
    >
      <AnimatePresence initial={false}>
        {photo ? (
          <m.img
            key={photo}
            className="mc-photo"
            src={photo}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          />
        ) : null}
      </AnimatePresence>
      <div className="mc-top">
        <p className="mc-name">{displayName}</p>
        <p className="mc-facility">{facilityName}</p>
        {showChange ? (
          <Link to="/card/background" className="mc-change" aria-label="会員証の背景を変える" title="背景を変える">
            <Icon name="image" size={20} />
          </Link>
        ) : null}
      </div>
      <div className="mc-dogs">
        {dogs.map((d) => (
          <DogAvatar key={d.id} name={d.name} breedName={d.breedName} url={d.thumbUrl} size={44} />
        ))}
      </div>
      <div className="mc-bottom">
        <p className="mc-id mono">{memberNo}</p>
        <p className="mc-points">
          <b>
            <RollingNumber value={balance} />
          </b>
          <span>ポイント</span>
        </p>
      </div>
    </m.section>
  );
}
