import { describe, expect, it } from 'vitest';
import { adminCall, createStaff, login } from './helpers';

async function as(role: 'staff' | 'admin' | 'developer') {
  await createStaff(`${role}@example.com`, role);
  return login(`${role}@example.com`);
}

describe('A-16 使い方と「困ったとき」', () => {
  it('製作者の連絡先は、受付スタッフ・製作者も見られる。ほかの設定は返さない', async () => {
    const admin = await as('admin');
    await adminCall('/admin/api/settings', { cookie: admin, method: 'PATCH', body: { developer_contact: '山田 090-0000-0000' } });
    for (const role of ['staff', 'developer'] as const) {
      const cookie = await as(role);
      const res = await adminCall('/admin/api/settings/public', { cookie });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ developerContact: '山田 090-0000-0000' });
    }
  });

  it('連絡先が未設定なら空。ログインしていなければ 401', async () => {
    const cookie = await as('staff');
    expect((await adminCall('/admin/api/settings/public', { cookie })).body).toEqual({ developerContact: '' });
    expect((await adminCall('/admin/api/settings/public')).status).toBe(401);
  });
});
