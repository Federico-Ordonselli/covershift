import { adminPool } from './db';
import { expect, LAKESIDE, openOrg, orgPath, test } from './fixtures';

test.describe('forbidden actions', () => {
  test('staff deep-linking to /inbox get "Managers only", with no way to act', async ({ as }) => {
    const sam = await as('sam@covershift.test');
    await sam.goto(`${orgPath(sam)}/inbox`);
    await expect(sam.getByRole('heading', { name: 'Managers only' })).toBeVisible();
    await expect(sam.getByRole('link', { name: 'Approvals' })).toHaveCount(0);
    await expect(sam.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  /**
   * Stale UI state: the manager has the inbox open, the role is revoked server-side, then
   * they click Approve. The API refuses (403); the UI shows the reason, refetches, and
   * turns read-only. Nothing changes in the database.
   */
  test('a role revoked while the inbox is open: 403, the reason, and a refetch', async ({ as }) => {
    const db = adminPool();
    let swapId: string | undefined;
    try {
      const {
        rows: [arranged],
      } = await db.query<{ id: string }>(
        `insert into app.swap_requests (organization_id, shift_id, requester_id, target_user_id, status, note)
         select s.organization_id, s.id, s.assigned_user_id,
                (select id from auth.users where email = 'alex@covershift.test'), 'accepted', 'Stale-role check'
         from app.shifts s
         join app.organizations o on o.id = s.organization_id
         join app.positions p on p.id = s.position_id
         where o.slug = 'lakeside-security' and p.name = 'Queue host'
         order by s.starts_at desc limit 1
         returning id`,
      );
      swapId = arranged!.id;

      const manager = await as('manager@covershift.test');
      await openOrg(manager, LAKESIDE);
      await manager.getByRole('link', { name: 'Approvals' }).click();
      const card = manager.getByRole('listitem').filter({ hasText: 'Stale-role check' });
      await expect(card.getByRole('button', { name: 'Approve' })).toBeVisible();

      // Revoked behind the UI's back.
      await db.query(
        `update app.memberships m set role = 'staff'
         from app.organizations o, auth.users u
         where o.id = m.organization_id and u.id = m.user_id
           and o.slug = 'lakeside-security' and u.email = 'manager@covershift.test'`,
      );

      await card.getByRole('button', { name: 'Approve' }).click();
      const alert = manager.getByRole('alert');
      // The API checks the role first: 403 FORBIDDEN, its reason shown verbatim.
      await expect(alert).toContainText('You can’t do this');
      await expect(alert).toContainText('Only managers or admins of this organization');
      await expect(manager.getByRole('heading', { name: 'Managers only' })).toBeVisible();
      await expect(alert).toBeVisible(); // the reason survives the refetch
      await expect(manager.getByRole('link', { name: 'Approvals' })).toHaveCount(0);

      const { rows } = await db.query<{ status: string }>(
        `select status from app.swap_requests where id = $1`,
        [swapId],
      );
      expect(rows[0]!.status).toBe('accepted');
    } finally {
      await db.query(
        `update app.memberships m set role = 'manager'
         from app.organizations o, auth.users u
         where o.id = m.organization_id and u.id = m.user_id
           and o.slug = 'lakeside-security' and u.email = 'manager@covershift.test'`,
      );
      if (swapId) await db.query(`delete from app.swap_requests where id = $1`, [swapId]);
      await db.end();
    }
  });
});
