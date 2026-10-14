import { type MembershipRole } from '@covershift/shared';
import { type SupabaseClient } from '@supabase/supabase-js';
import { type Pool } from 'pg';
import { evaluateEligibility } from '../src/certifications/eligibility';

export interface SeedOptions {
  /** Privileged pool (DATABASE_MIGRATION_URL): seeding bypasses RLS by design. */
  pool: Pool;
  /** Supabase client with the secret key: creates login-capable users via auth.admin. */
  auth: SupabaseClient;
  slug?: string;
  emailDomain?: string;
  password: string;
  /** Shifts start on this day (UTC midnight); defaults to tomorrow. */
  startDay?: Date;
}

export interface SeedResult {
  organizationId: string;
  users: Record<UserKey, { id: string; email: string; role: MembershipRole }>;
  shiftIds: string[];
  openSwapRequestId: string;
}

type UserKey = 'manager' | 'sam' | 'alex' | 'jo';
type CertKey = 'xray' | 'etd' | 'patdown';
type PositionKey = 'gate' | 'hold' | 'queue';

const USERS: Record<UserKey, { name: string; role: MembershipRole }> = {
  manager: { name: 'Maria Rossi', role: 'manager' },
  sam: { name: 'Sam Carter', role: 'staff' },
  alex: { name: 'Alex Moreau', role: 'staff' },
  jo: { name: 'Jo Lindqvist', role: 'staff' },
};

const CERTS: Record<CertKey, string> = {
  xray: 'X-ray screening',
  etd: 'Explosive trace detection',
  patdown: 'Passenger pat-down',
};

const POSITIONS: Record<PositionKey, { name: string; requires: CertKey[] }> = {
  gate: { name: 'Gate screening', requires: ['xray', 'patdown'] },
  hold: { name: 'Hold baggage screening', requires: ['etd'] },
  queue: { name: 'Queue host', requires: [] },
};

const DAY = 24 * 60 * 60 * 1000;

/** Certificates; `expiresInDays: null` = does not expire. */
function certificates(): Array<{ user: UserKey; cert: CertKey; expiresInDays: number | null }> {
  return [
    { user: 'alex', cert: 'xray', expiresInDays: null },
    { user: 'alex', cert: 'patdown', expiresInDays: 365 },
    { user: 'alex', cert: 'etd', expiresInDays: 365 },
    { user: 'sam', cert: 'etd', expiresInDays: 365 },
    // Expires mid-week: Sam can't be given the later gate shifts (demoes the rule).
    { user: 'sam', cert: 'xray', expiresInDays: 3 },
    { user: 'sam', cert: 'patdown', expiresInDays: 365 },
    { user: 'manager', cert: 'xray', expiresInDays: null },
    { user: 'manager', cert: 'patdown', expiresInDays: null },
    // Jo holds nothing yet: queue host only.
  ];
}

/** A week of morning (06-14) and afternoon (14-22) shifts, UTC. null = unassigned. */
function shifts(): Array<{
  day: number;
  half: 'am' | 'pm';
  position: PositionKey;
  user: UserKey | null;
}> {
  const rows: Array<{
    day: number;
    half: 'am' | 'pm';
    position: PositionKey;
    user: UserKey | null;
  }> = [];
  for (let day = 0; day < 7; day++) {
    rows.push(
      { day, half: 'am', position: 'gate', user: 'alex' },
      { day, half: 'pm', position: 'gate', user: day < 2 ? 'sam' : null },
      { day, half: 'am', position: 'hold', user: 'sam' },
      { day, half: 'pm', position: 'hold', user: day % 2 === 0 ? 'alex' : null },
      { day, half: day % 2 === 0 ? 'am' : 'pm', position: 'queue', user: 'jo' },
    );
  }
  return rows;
}

export async function seed(options: SeedOptions): Promise<SeedResult> {
  const { pool, auth, password } = options;
  const slug = options.slug ?? 'lakeside-security';
  const emailDomain = options.emailDomain ?? 'covershift.test';
  const startDay = options.startDay ?? utcMidnight(new Date(Date.now() + DAY));

  // 1. Users: reuse if present (password reset), so the script is re-runnable.
  const users = {} as SeedResult['users'];
  for (const [key, spec] of Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>) {
    const email = `${key}@${emailDomain}`;
    users[key] = {
      id: await upsertUser(auth, pool, email, password, spec.name),
      email,
      role: spec.role,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // 2. Reset this demo organization only (everything else in the database is untouched).
    await client.query(`delete from app.organizations where slug = $1`, [slug]);
    const {
      rows: [org],
    } = await client.query<{ id: string }>(
      `insert into app.organizations (name, slug, timezone) values ($1, $2, $3) returning id`,
      ['Lakeside International Airport: Security', slug, 'Europe/Rome'],
    );
    const organizationId = org!.id;

    for (const key of Object.keys(USERS) as UserKey[]) {
      await client.query(
        `insert into app.memberships (organization_id, user_id, role) values ($1, $2, $3)`,
        [organizationId, users[key].id, users[key].role],
      );
    }

    const certIds = {} as Record<CertKey, string>;
    for (const [key, name] of Object.entries(CERTS) as Array<[CertKey, string]>) {
      const { rows } = await client.query<{ id: string }>(
        `insert into app.certification_types (organization_id, name) values ($1, $2) returning id`,
        [organizationId, name],
      );
      certIds[key] = rows[0]!.id;
    }

    const positionIds = {} as Record<PositionKey, string>;
    for (const [key, spec] of Object.entries(POSITIONS) as Array<
      [PositionKey, (typeof POSITIONS)[PositionKey]]
    >) {
      const { rows } = await client.query<{ id: string }>(
        `insert into app.positions (organization_id, name) values ($1, $2) returning id`,
        [organizationId, spec.name],
      );
      positionIds[key] = rows[0]!.id;
      for (const cert of spec.requires) {
        await client.query(
          `insert into app.position_certification_requirements
             (organization_id, position_id, certification_type_id) values ($1, $2, $3)`,
          [organizationId, positionIds[key], certIds[cert]],
        );
      }
    }

    const held = certificates().map((c) => ({
      ...c,
      expiresAt:
        c.expiresInDays === null ? null : new Date(startDay.getTime() + c.expiresInDays * DAY),
    }));
    for (const c of held) {
      await client.query(
        `insert into app.user_certifications
           (organization_id, user_id, certification_type_id, issued_at, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [
          organizationId,
          users[c.user].id,
          certIds[c.cert],
          new Date(startDay.getTime() - 300 * DAY),
          c.expiresAt,
        ],
      );
    }

    // 3. Shifts, each assignment checked against the real domain rules before insert.
    const shiftIds: string[] = [];
    const assigned: Array<{ user: UserKey; start: Date; end: Date }> = [];
    for (const s of shifts()) {
      const start = new Date(
        startDay.getTime() + s.day * DAY + (s.half === 'am' ? 6 : 14) * 3_600_000,
      );
      const end = new Date(start.getTime() + 8 * 3_600_000);
      if (s.user) {
        assertSeedAssignmentValid(s.user, s.position, start, end, held, assigned);
        assigned.push({ user: s.user, start, end });
      }
      const { rows } = await client.query<{ id: string }>(
        `insert into app.shifts (organization_id, position_id, starts_at, ends_at, assigned_user_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [organizationId, positionIds[s.position], start, end, s.user ? users[s.user].id : null],
      );
      shiftIds.push(rows[0]!.id);
    }

    // 4. One open offer to try the swap flow: Sam offers their hold-baggage shift on day 3.
    const samShift = shifts().findIndex(
      (s) => s.day === 3 && s.position === 'hold' && s.user === 'sam',
    );
    const {
      rows: [swap],
    } = await client.query<{ id: string }>(
      `insert into app.swap_requests (organization_id, shift_id, requester_id, note)
       values ($1, $2, $3, $4) returning id`,
      [organizationId, shiftIds[samShift], users.sam.id, 'Family event, anyone free?'],
    );

    await client.query('commit');
    return { organizationId, users, shiftIds, openSwapRequestId: swap!.id };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** The seed bypasses the API, so it applies the API's assignment rules itself. */
function assertSeedAssignmentValid(
  user: UserKey,
  position: PositionKey,
  start: Date,
  end: Date,
  held: Array<{ user: UserKey; cert: CertKey; expiresAt: Date | null }>,
  assigned: Array<{ user: UserKey; start: Date; end: Date }>,
): void {
  const required = POSITIONS[position].requires.map((c) => ({ id: c, name: CERTS[c] }));
  const mine = held
    .filter((h) => h.user === user)
    .map((h) => ({ certificationTypeId: h.cert, expiresAt: h.expiresAt }));
  const result = evaluateEligibility(required, mine, end);
  if (!result.eligible) {
    throw new Error(
      `Seed bug: ${user} is not eligible for ${position} ending ${end.toISOString()}`,
    );
  }
  if (assigned.some((a) => a.user === user && a.start < end && start < a.end)) {
    throw new Error(`Seed bug: ${user} would overlap at ${start.toISOString()}`);
  }
}

async function upsertUser(
  auth: SupabaseClient,
  pool: Pool,
  email: string,
  password: string,
  fullName: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`select id from auth.users where email = $1`, [
    email,
  ]);
  if (rows[0]) {
    const { error } = await auth.auth.admin.updateUserById(rows[0].id, { password });
    if (error) throw error;
    return rows[0].id;
  }
  const { data, error } = await auth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user.id;
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
