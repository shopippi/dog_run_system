import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, dog, fakeJpeg, registerUser, survey } from './helpers';

const PAPA = 'U001:パパ';
const OTHER = 'U900:よその人';

function photoForm(photo = fakeJpeg(800, 600), thumb = fakeJpeg(240, 240)) {
  const form = new FormData();
  form.append('photo', new File([photo], 'photo.jpg', { type: 'image/jpeg' }));
  form.append('thumb', new File([thumb], 'thumb.jpg', { type: 'image/jpeg' }));
  return form;
}

describe('C-02 犬の登録', () => {
  it('犬種の選択肢を返す。「その他」は自由入力の印つき', async () => {
    const res = await call('/api/breeds', { user: PAPA });
    expect(res.status).toBe(200);
    expect(res.body.breeds[0]).toEqual({ id: 1, name: 'トイプードル', defaultSize: 'small', isOther: false });
    expect(res.body.breeds.at(-1)).toMatchObject({ name: 'その他', isOther: true });
  });

  it('初回は1頭以上の登録が必要', async () => {
    const res = await call('/api/register', { user: PAPA, body: { consent: true, dogs: [], survey: survey() } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/1頭以上/);
  });

  it('複数の犬を登録でき、犬IDは「会員ID-連番」、おうちの呼び名は犬の名前から作る', async () => {
    const r = await registerUser(PAPA, [
      dog('アル', { breedId: 5, size: 'medium', sex: 'male', birthYm: '2020-04', neutered: 'yes' }),
      dog('ニコ'),
    ]);
    expect(r.householdName).toBe('アル・ニコのおうち');
    expect(r.dogs.map((d) => d.dogNo)).toEqual([`${r.memberNo}-1`, `${r.memberNo}-2`]);
    expect(r.dogs[0]).toMatchObject({
      name: 'アル',
      breedName: '柴犬',
      size: 'medium',
      sex: 'male',
      birthYm: '2020-04',
      neutered: 'yes',
      photoUrl: null,
    });
  });

  it('名前は20文字まで', async () => {
    const res = await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('あ'.repeat(21))], survey: survey() } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/20文字/);
  });

  it('「その他」を選んだら犬種の入力が必要。入力した犬種を表示に使う', async () => {
    const ng = await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('ポチ', { breedId: 11 })], survey: survey() } });
    expect(ng.status).toBe(400);
    expect(ng.body.error.message).toMatch(/犬種を入力/);

    const r = await registerUser(PAPA, [dog('ポチ', { breedId: 11, breedOther: '甲斐犬', size: 'medium' })]);
    expect(r.dogs[0]).toMatchObject({ breedName: '甲斐犬', breedOther: '甲斐犬' });
  });

  it('「その他」以外では自由入力を保存しない', async () => {
    const r = await registerUser(PAPA, [dog('アル', { breedOther: 'いたずら' })]);
    expect(r.dogs[0]).toMatchObject({ breedName: 'トイプードル', breedOther: null });
  });

  it('ない犬種を選ぶと 400 で、選び直すよう案内する', async () => {
    const res = await call('/api/register', { user: PAPA, body: { consent: true, dogs: [dog('アル', { breedId: 999 })], survey: survey() } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/選び直して/);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM households').first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

describe('C-02 犬の写真', () => {
  it('長い辺 800px 以下の写真と一覧用の写真を保存し、変更履歴を残す', async () => {
    const r = await registerUser(PAPA);
    const res = await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: PAPA, body: photoForm() });
    expect(res.status).toBe(200);
    expect(res.body.dog.photoUrl).toMatch(new RegExp(`^/api/media/dogs/${r.dogs[0]!.dogNo}/.+\\.jpg$`));
    expect(res.body.dog.thumbUrl).toMatch(/_thumb\.jpg$/);

    const key = res.body.dog.photoUrl.replace('/api/media/', '');
    const obj = await env.MEDIA.get(key);
    expect(obj?.httpMetadata?.contentType).toBe('image/jpeg');

    const change = await env.DB.prepare("SELECT field, actor_type FROM dog_changes WHERE field = 'photo'").first();
    expect(change).toEqual({ field: 'photo', actor_type: 'member' });
  });

  it('長い辺が 800px を超える写真は受け付けない', async () => {
    const r = await registerUser(PAPA);
    const res = await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: PAPA, body: photoForm(fakeJpeg(1200, 900)) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/大きすぎ/);
  });

  it('JPEG でないものは受け付けない', async () => {
    const r = await registerUser(PAPA);
    const res = await call(`/api/dogs/${r.dogs[0]!.id}/photo`, {
      user: PAPA,
      body: photoForm(new Uint8Array([1, 2, 3])),
    });
    expect(res.status).toBe(400);
  });

  it('よそのおうちの犬の写真は登録できない', async () => {
    const r = await registerUser(PAPA);
    await registerUser(OTHER, [dog('ハナ')]);
    const res = await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: OTHER, body: photoForm() });
    expect(res.status).toBe(404);
  });

  it('写真は自分のおうちの家族だけが見られる', async () => {
    const r = await registerUser(PAPA);
    const up = await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: PAPA, body: photoForm() });
    const url = up.body.dog.thumbUrl as string;

    const own = await call(url, { user: PAPA });
    expect(own.status).toBe(200);

    await registerUser(OTHER, [dog('ハナ')]);
    expect((await call(url, { user: OTHER })).status).toBe(404);
    expect((await call(url)).status).toBe(401);
  });

  it('差し替えても前の写真は消さない(元に戻せるように)', async () => {
    const r = await registerUser(PAPA);
    const first = await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: PAPA, body: photoForm() });
    await call(`/api/dogs/${r.dogs[0]!.id}/photo`, { user: PAPA, body: photoForm() });
    const oldKey = first.body.dog.photoUrl.replace('/api/media/', '');
    expect(await env.MEDIA.head(oldKey)).not.toBeNull();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM dog_changes WHERE field = 'photo'").first<{ n: number }>();
    expect(n?.n).toBe(2);
  });
});
