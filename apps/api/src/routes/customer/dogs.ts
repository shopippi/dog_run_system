import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { errors } from '../../lib/errors';
import { getDog, getDogHouseholdId, listBreeds, saveDogPhoto } from '../../services/dogs';
import { requireMember } from '../../services/members';
import { MEDIA_BASE } from './media';

export const dogRoutes = new Hono<AppEnv>();

// 犬種の選択肢(C-02)
dogRoutes.get('/breeds', async (c) => c.json({ breeds: await listBreeds(c.env.DB) }));

/** 自分のおうちの犬でなければ「見つからない」にする(ほかのおうちの犬があるかどうかも分からないようにする) */
async function requireOwnDog(c: Context<AppEnv>, id: number) {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const householdId = Number.isInteger(id) ? await getDogHouseholdId(c.env.DB, id) : null;
  if (householdId !== member.householdId) {
    throw errors.notFound('ワンちゃんが見つかりませんでした。画面を読み込み直してください。');
  }
  return member;
}

// 犬の写真の登録・差し替え(C-02、C-08)
dogRoutes.post('/dogs/:id/photo', async (c) => {
  const id = Number(c.req.param('id'));
  const member = await requireOwnDog(c, id);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw errors.badRequest('写真を受け取れませんでした。写真を選び直して、もう一度お試しください。');
  }
  await saveDogPhoto(c.env.DB, c.env.MEDIA, id, form, { type: 'member', id: member.memberId }, c.get('now'));
  return c.json({ dog: await getDog(c.env.DB, id, MEDIA_BASE) });
});
