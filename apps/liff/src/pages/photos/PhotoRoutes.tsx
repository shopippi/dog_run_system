import type { PhotoConfigResponse } from '@dr/shared';
import { useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PhotoUnavailable } from '../../components/photos/PhotoUnavailable';
import { api } from '../../lib/api';
import { AlbumsPage } from './AlbumsPage';
import { AlbumPage } from './AlbumPage';
import { ViewerPage } from './ViewerPage';
import { CartPage } from './CartPage';
import { MockCheckoutPage } from './MockCheckoutPage';
import { OrderPage } from './OrderPage';
import { PurchasedPage } from './PurchasedPage';
import { LegalPage } from './LegalPage';
import { PhotoSkeleton } from './PhotoSkeleton';
import './photos.css';

// 写真販売のお客さんの画面(docs/photo-requirements.md 9.1。段階0・統合の担当のファイル)。
// 会員登録をしていない LINE ユーザーも開ける(App.tsx で登録の確認より前に分ける)。LINE のログインは、ほかの画面と同じ LIFF のログイン。
// PU-1: 販売が準備中なら、どの画面も「準備中」(GET /api/photos/config)。
// 画面のファイルは段階1の各担当のもの(PU-2〜4: 1-B、PU-5・6: 1-C、PU-7: 1-D)。
export function PhotoRoutes() {
  const [config, setConfig] = useState<PhotoConfigResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    api<PhotoConfigResponse>('/api/photos/config').then(setConfig).catch(setError);
  }, []);
  useEffect(load, [load]);

  if (error && !config) return <main className="screen"><ErrorNotice error={error} onRetry={load} /></main>;
  if (!config) return <PhotoSkeleton />;
  return (
    <Routes>
      {/* 法定表示は準備中でも見られる */}
      <Route path="/photos/legal" element={<LegalPage />} />
      {!config.available ? (
        <Route path="*" element={<PhotoUnavailable message={config.message} />} />
      ) : (
        <>
          <Route path="/photos" element={<AlbumsPage config={config} />} />
          <Route path="/photos/albums/:albumId" element={<AlbumPage config={config} />} />
          <Route path="/photos/albums/:albumId/photos/:photoId" element={<ViewerPage config={config} />} />
          <Route path="/photos/cart" element={<CartPage config={config} />} />
          <Route path="/photos/mock-checkout/:sessionId" element={<MockCheckoutPage />} />
          <Route path="/photos/orders/:orderId" element={<OrderPage config={config} />} />
          <Route path="/photos/purchased" element={<PurchasedPage config={config} />} />
          <Route path="*" element={<AlbumsPage config={config} />} />
        </>
      )}
    </Routes>
  );
}
