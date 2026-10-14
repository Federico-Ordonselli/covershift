import { type MembershipRole } from '@covershift/shared';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { type SupabaseClaims } from '../../src/auth/auth-user';
import { required } from './env';

/**
 * Privileged pool (DATABASE_MIGRATION_URL) for arranging and cleaning up test data only.
 * Assertions always go through the covershift_api role, never through this pool.
 */
export function adminPool(): Pool {
  return new Pool({ connectionString: required('DATABASE_MIGRATION_URL'), max: 2 });
}

export interface TestUser {
  id: string;
  email: string;
  role: MembershipRole;
}

export interface Tenant {
  orgId: string;
  slug: string;
  positionId: string;
  users: Record<string, TestUser>;
}

/** One organization with the given members and a "Gate screening" position. */
export async function createTenant(
  pool: Pool,
  label: string,
  members: Record<string, MembershipRole>,
): Promise<Tenant> {
  const suffix = randomUUID().slice(0, 8);
  const slug = `${label}-${suffix}`;
  const orgId = randomUUID();
  const positionId = randomUUID();
  await pool.query(`insert into app.organizations (id, name, slug) values ($1, $2, $3)`, [
    orgId,
    `Test ${label}`,
    slug,
  ]);
  await pool.query(`insert into app.positions (id, organization_id, name) values ($1, $2, $3)`, [
    positionId,
    orgId,
    'Gate screening',
  ]);

  const users: Record<string, TestUser> = {};
  for (const [key, role] of Object.entries(members)) {
    const user = { id: randomUUID(), email: `${key}-${suffix}@covershift.test`, role };
    // The on_auth_user_created trigger creates the profile.
    await pool.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3)`,
      [user.id, user.email, { full_name: key }],
    );
    await pool.query(
      `insert into app.memberships (organization_id, user_id, role) values ($1, $2, $3)`,
      [orgId, user.id, role],
    );
    users[key] = user;
  }
  return { orgId, slug, positionId, users };
}

/** Deletes the organization (everything cascades) and its users. */
export async function dropTenant(pool: Pool, tenant: Tenant | undefined): Promise<void> {
  if (!tenant) return;
  await pool.query(`delete from app.organizations where id = $1`, [tenant.orgId]);
  await pool.query(`delete from auth.users where id = any($1::uuid[])`, [
    Object.values(tenant.users).map((u) => u.id),
  ]);
}

/** Claims shaped like a verified Supabase access token for `user`. */
export function claimsFor(user: { id: string }): SupabaseClaims {
  return {
    sub: user.id,
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

export async function insertShift(
  pool: Pool,
  tenant: Tenant,
  values: { startsAt: string; endsAt: string; assignedUserId?: string | null },
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into app.shifts (id, organization_id, position_id, starts_at, ends_at, assigned_user_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      tenant.orgId,
      tenant.positionId,
      values.startsAt,
      values.endsAt,
      values.assignedUserId ?? null,
    ],
  );
  return id;
}

export async function addCertificationType(
  pool: Pool,
  tenant: Tenant,
  name: string,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into app.certification_types (id, organization_id, name) values ($1, $2, $3)`,
    [id, tenant.orgId, name],
  );
  return id;
}

export async function requireCertification(
  pool: Pool,
  tenant: Tenant,
  certificationTypeId: string,
  positionId = tenant.positionId,
): Promise<void> {
  await pool.query(
    `insert into app.position_certification_requirements
       (organization_id, position_id, certification_type_id) values ($1, $2, $3)`,
    [tenant.orgId, positionId, certificationTypeId],
  );
}

export async function grantCertification(
  pool: Pool,
  tenant: Tenant,
  userId: string,
  certificationTypeId: string,
  expiresAt: string | null,
): Promise<void> {
  await pool.query(
    `insert into app.user_certifications (organization_id, user_id, certification_type_id, expires_at)
     values ($1, $2, $3, $4)`,
    [tenant.orgId, userId, certificationTypeId, expiresAt],
  );
}
