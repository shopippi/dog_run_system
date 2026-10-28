import type { MeResponse, RegisterResponse } from '@dr/shared';
import { registerSchema } from '@dr/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { loadSettings } from '../../lib/settings';
import { parseJson } from '../../lib/validate';
import { findActiveMember, refreshDisplayName } from '../../services/members';
import { alreadyRegistered, registerHousehold } from '../../services/register';

export const meRoutes = new Hono<AppEnv>();

// 登録済みか、所属するおうち(C-01、C-06)
meRoutes.get('/me', async (c) => {
  const lineUser = c.get('lineUser');
  const member = await findActiveMember(c.env.DB, lineUser.userId);
  if (!member) {
    const settings = await loadSettings(c.env.DB);
    const body: MeResponse = {
      registered: false,
      lineDisplayName: lineUser.displayName,
      terms: { termsText: settings.terms_text, privacyText: settings.privacy_text },
    };
    return c.json(body);
  }
  await refreshDisplayName(c.env.DB, member, lineUser, c.get('now'));
  const body: MeResponse = {
    registered: true,
    member: { id: member.memberId, lineDisplayName: member.lineDisplayName },
    household: { memberNo: member.memberNo, displayName: member.householdName },
  };
  return c.json(body);
});

// 初回登録。おうちと会員IDを作る(C-01)
meRoutes.post('/register', async (c) => {
  const lineUser = c.get('lineUser');
  await parseJson(c, registerSchema);
  if (await findActiveMember(c.env.DB, lineUser.userId)) throw alreadyRegistered();
  const result = await registerHousehold(c.env.DB, c.get('now'), lineUser, { dogNames: [] });
  const body: RegisterResponse = { memberNo: result.memberNo, householdName: result.householdName };
  return c.json(body, 201);
});
