import type { PhotoLegalResponse } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { SkeletonScreen, Skeleton, SkeletonText } from '../../components/Skeleton';
import { api } from '../../lib/api';
import './checkout.css';

// 特定商取引法に基づく表記・利用規約(写真販売)・プライバシーポリシー(段階1-C)。GET /api/photos/legal(ログインなしで読める)。
// Stripe の審査には、ログインなしで開ける URL が要る: 同じ中身を Worker が LIFF の外の HTML でも出す(/api/photos/legal.html。docs/photo-requirements.md 9.3)。
// 準備中でも見られる(PhotoRoutes)。返金の条件は利用規約の本文(設定 photo_terms_text)に書いてある
export function LegalPage() {
  const [legal, setLegal] = useState<PhotoLegalResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    api<PhotoLegalResponse>('/api/photos/legal').then(setLegal).catch(setError);
  }, []);
  useEffect(load, [load]);

  if (error && !legal) return <main className="screen"><ErrorNotice error={error} onRetry={load} /></main>;
  if (!legal) {
    return (
      <SkeletonScreen>
        <Skeleton width="80%" height={30} />
        <SkeletonText lines={6} />
        <SkeletonText lines={6} />
      </SkeletonScreen>
    );
  }
  return (
    <main className="screen">
      <div className="page-head">
        <h2>特定商取引法に基づく表記・利用規約</h2>
        <p className="lead">{legal.facilityName}の写真販売についての表記です。</p>
      </div>
      <div className="co-legal">
        <section className="section" aria-labelledby="lg-tokushoho">
          <h3 className="section-title" id="lg-tokushoho">特定商取引法に基づく表記</h3>
          <p className="co-legal-text">{legal.tokushoho}</p>
        </section>
        <section className="section" aria-labelledby="lg-terms">
          <h3 className="section-title" id="lg-terms">利用規約(写真販売)</h3>
          <p className="co-legal-text">{legal.terms}</p>
        </section>
        <section className="section" aria-labelledby="lg-privacy">
          <h3 className="section-title" id="lg-privacy">プライバシーポリシー</h3>
          <p className="co-legal-text">{legal.privacy}</p>
        </section>
      </div>
    </main>
  );
}
