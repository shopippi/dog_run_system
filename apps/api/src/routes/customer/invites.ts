import type { InviteCreated } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { loadSettings } from '../../lib/settings';
import { createInvite } from '../../services/invites';
import { requireMember } from '../../services/members';

export const inviteRoutes = new Hono<AppEnv>();

// 家族の招待を作る(C-11)。24時間有効で、1回だけ使える
inviteRoutes.post('/invites', async (c) => {
  const member = await requireMember(c.env.DB, c.get('lineUser').userId);
  const settings = await loadSettings(c.env.DB);
  const body: InviteCreated = await createInvite(c.env.DB, {
    householdId: member.householdId,
    kind: 'family',
    memberId: member.memberId,
    now: c.get('now'),
    ttl: { hours: settings.invite_ttl_hours },
  });
  return c.json(body, 201);
});
