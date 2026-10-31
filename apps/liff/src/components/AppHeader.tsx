import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { useFacilityName } from '../hooks/useFacilityName';

export type HeaderBack = { to: string; label: string };

/** ページがこれだけスクロールしたら、ヘッダーの下に線を出す(px) */
const LINE_AFTER = 4;

/**
 * 画面の上の帯。下の階層では、左に戻り先の名前を出す(docs/design.md 5章)。
 * 上に固定し、すりガラスにする。下の線は、ページが少しスクロールしてから出す(11.3)。
 */
export function AppHeader({ back }: { back?: HeaderBack | null }) {
  const facilityName = useFacilityName();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > LINE_AFTER);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return (
    <header className={`app-header${scrolled ? ' scrolled' : ''}`}>
      {back ? (
        <Link to={back.to} className="header-back">
          <Icon name="chevron-left" size={20} />
          {back.label}
        </Link>
      ) : (
        <span className="app-title">{facilityName} 会員証</span>
      )}
    </header>
  );
}
