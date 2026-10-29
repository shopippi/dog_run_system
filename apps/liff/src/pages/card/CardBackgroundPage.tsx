import {
  CARD_PHOTO_MAX_BYTES,
  CARD_PHOTO_MAX_EDGE,
  CARD_PRESET_COLORS,
  CARD_PRESET_LABELS,
  type CardBackgroundView,
  type CardPresetColor,
  type MeRegistered,
} from '@dr/shared';
import { useEffect, useId, useState } from 'react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Icon } from '../../components/Icon';
import { MemberCard } from '../../components/MemberCard';
import { useMe } from '../../hooks/useMe';
import { useFacilityName } from '../../hooks/useFacilityName';
import { ApiError, api } from '../../lib/api';
import { resizePhoto } from '../../lib/photo';
import { useToast } from '../../components/Toast';
import { CardBackgroundSkeleton } from '../skeletons';


type Saved = { cardBackground: CardBackgroundView };

/** L-07b 会員証の背景を変える(C-06)。選ぶとすぐに保存し、上のカードの見た目が変わる。おうちの家族で共通 */
export function CardBackgroundPage() {
  const { me, error, reload } = useMe();
  if (error) return <main className="screen"><ErrorNotice error={error} onRetry={reload} /></main>;
  if (!me || !me.registered) return <CardBackgroundSkeleton />;
  return <Editor me={me} />;
}

function Editor({ me }: { me: MeRegistered }) {
  const facilityName = useFacilityName();
  const [bg, setBg] = useState<CardBackgroundView>(me.cardBackground);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const fileId = useId();
  const groupId = useId();

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const run = async (send: () => Promise<Saved>, optimistic?: CardBackgroundView) => {
    const before = bg;
    if (optimistic) setBg(optimistic);
    setBusy(true);
    setError(null);
    try {
      const r = await send();
      setBg(r.cardBackground);
      // 保存は自動。済んだらトーストで知らせる(11.3)
      toast('保存しました');
    } catch (e) {
      setBg(before);
      setPreview(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const choose = (color: CardPresetColor) => {
    setPreview(null);
    void run(
      () => api<Saved>('/api/me/card-background', { method: 'PUT', body: JSON.stringify({ color }) }),
      { kind: 'preset', color },
    );
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    let photo: Blob;
    try {
      // 長い辺 1200px 以下に縮小してから送る(サーバーでは 2MB までを受け取る)
      photo = (await resizePhoto(file, { maxEdge: CARD_PHOTO_MAX_EDGE, maxBytes: CARD_PHOTO_MAX_BYTES })).photo;
    } catch {
      setError(new ApiError(0, 'photo', 'この写真は読み込めませんでした。別の写真を選ぶか、カメラで撮り直してください。'));
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    const form = new FormData();
    form.append('photo', photo, 'card.jpg');
    await run(() => api<Saved>('/api/me/card-background/photo', { method: 'POST', body: form }), {
      kind: 'photo',
      url: '',
    });
  };

  const stopPhoto = () => {
    setPreview(null);
    void run(() => api<Saved>('/api/me/card-background/photo', { method: 'DELETE' }), { kind: 'preset', color: 'ink' });
  };

  const current = bg.kind === 'preset' ? bg.color : null;

  return (
    <main className="screen">
      <div className="page-head">
        <h2>会員証の背景</h2>
        <p className="lead">色か、好きな写真を選べます。選ぶとすぐに変わり、家族の会員証も同じ背景になります。</p>
      </div>

      <MemberCard
        displayName={me.household.displayName}
        memberNo={me.household.memberNo}
        facilityName={facilityName}
        dogs={me.card.dogs}
        balance={me.card.balance}
        background={bg}
        previewUrl={bg.kind === 'photo' ? preview : null}
        showChange={false}
      />

      <section className="section cb-section" aria-labelledby={groupId}>
        <h3 className="section-label" id={groupId}>
          色
        </h3>
        <div className="cb-swatches" role="radiogroup" aria-labelledby={groupId}>
          {CARD_PRESET_COLORS.map((color) => (
            <label key={color} className={`cb-swatch mc-preset-${color}`} title={CARD_PRESET_LABELS[color]}>
              <input
                type="radio"
                name="card-color"
                value={color}
                checked={current === color}
                disabled={busy}
                aria-label={CARD_PRESET_LABELS[color]}
                onChange={() => choose(color)}
              />
              <span className="cb-dot" aria-hidden="true">
                {current === color ? <Icon name="check" size={18} /> : null}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="section cb-section" aria-label="写真">
        <h3 className="section-label">写真</h3>
        <div className="cb-photo-acts">
          <label className={`btn sub up cb-photo-btn${busy ? ' is-busy' : ''}`} htmlFor={fileId}>
            <Icon name="image" />
            {bg.kind === 'photo' ? '別の写真を選ぶ' : '写真を選ぶ'}
          </label>
          <input
            id={fileId}
            className="cb-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            disabled={busy}
            onChange={(e) => {
              void pickPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {bg.kind === 'photo' ? (
            <button type="button" className="btn ghost cb-stop" disabled={busy} onClick={stopPhoto}>
              写真をやめる
            </button>
          ) : null}
        </div>
        <p className="note">写真の上の文字が読めるよう、下のほうを少し暗くして表示します。</p>
      </section>

      {error ? <ErrorNotice error={error} /> : null}
    </main>
  );
}
