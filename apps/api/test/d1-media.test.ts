import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { D1Media, withMedia } from '../src/lib/d1-media';

// R2 を使わないとき、写真をデータベース(media_objects)に保存する部品
describe('D1Media(R2 の代わりにデータベースへ写真を保存する)', () => {
  it('保存・取り出し・中身の確認・一覧・削除が R2 と同じ形で使える', async () => {
    const media = new D1Media(env.DB);
    const bytes = new Uint8Array([1, 2, 3, 250, 255]);
    await media.put('dogs/1/a.jpg', bytes, { httpMetadata: { contentType: 'image/jpeg' } });
    await media.put('dogs/1/b.jpg', 'xyz');
    await media.put('cards/1/c.jpg', new Uint8Array([9]));

    const got = await media.get('dogs/1/a.jpg');
    expect(got).not.toBeNull();
    expect(new Uint8Array(await got!.arrayBuffer())).toEqual(bytes);
    expect(got!.httpMetadata.contentType).toBe('image/jpeg');
    const h = new Headers();
    got!.writeHttpMetadata(h);
    expect(h.get('content-type')).toBe('image/jpeg');
    expect(await new Response(got!.body).arrayBuffer()).toEqual(bytes.buffer);

    expect((await media.head('dogs/1/b.jpg'))!.size).toBe(3);
    expect(await media.head('nothing')).toBeNull();

    const list = await media.list({ prefix: 'dogs/' });
    expect(list.objects.map((o) => o.key)).toEqual(['dogs/1/a.jpg', 'dogs/1/b.jpg']);
    const page1 = await media.list({ limit: 1 });
    expect(page1.truncated).toBe(true);
    const page2 = await media.list({ limit: 5, cursor: page1.cursor });
    expect(page2.objects.map((o) => o.key)).toEqual(['dogs/1/a.jpg', 'dogs/1/b.jpg']);

    // 同じキーに保存し直すと置き換わる
    await media.put('dogs/1/b.jpg', 'new!');
    expect(await (await media.get('dogs/1/b.jpg'))!.text()).toBe('new!');

    await media.delete(['dogs/1/a.jpg', 'dogs/1/b.jpg']);
    expect((await media.list()).objects.map((o) => o.key)).toEqual(['cards/1/c.jpg']);
  });

  it('withMedia: R2 があればそのまま、なければデータベースを使う', () => {
    const withR2 = withMedia({ DB: env.DB, MEDIA: env.MEDIA });
    expect(withR2.MEDIA).toBe(env.MEDIA);
    expect(withR2.MEDIA_BACKEND).toBe('r2');
    const without = withMedia({ DB: env.DB, MEDIA: undefined as unknown as R2Bucket });
    expect(without.MEDIA).toBeInstanceOf(D1Media);
    expect(without.MEDIA_BACKEND).toBe('d1');
  });
});
