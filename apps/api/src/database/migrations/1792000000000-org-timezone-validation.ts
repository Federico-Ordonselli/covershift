import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * organizations.timezone must be a real IANA zone: the UI renders every shift in it.
 *
 * Checked against the server's tz database (pg_timezone_names), minus the entries a
 * browser's Intl doesn't accept (posix/…, right/…, Factory, localtime, posixrules).
 * A trigger, not a CHECK: a CHECK can't consult a catalog view (not immutable).
 * Unlike the swap triggers it has no maintenance-role exemption: the seed and
 * hand-written fix-ups are held to it too.
 */
export class OrgTimezoneValidation1792000000000 implements MigrationInterface {
  name = 'OrgTimezoneValidation1792000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      create function app.is_known_timezone(zone text)
      returns boolean
      language sql
      stable
      set search_path = ''
      as $$
        select exists (
          select 1 from pg_catalog.pg_timezone_names n
          where n.name = zone
            and n.name !~ '^(posix|right)/'
            and n.name not in ('Factory', 'localtime', 'posixrules')
        )
      $$`);

    // Existing rows must already comply, or the migration stops here, loudly.
    await q.query(`
      do $$
      declare
        bad text;
      begin
        select string_agg(format('%s (%s)', slug, timezone), ', ') into bad
        from app.organizations where not app.is_known_timezone(timezone);
        if bad is not null then
          raise exception 'organizations with an unknown timezone: %', bad;
        end if;
      end
      $$`);

    await q.query(`
      create function app.validate_organization_timezone()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        if not app.is_known_timezone(new.timezone) then
          raise exception using
            errcode = 'check_violation',
            constraint = 'organizations_timezone_known',
            message = format('organizations.timezone: %L is not a known time zone', new.timezone);
        end if;
        return new;
      end;
      $$`);

    for (const fn of ['app.is_known_timezone(text)', 'app.validate_organization_timezone()']) {
      await q.query(`revoke execute on function ${fn} from public, anon`);
      await q.query(`grant execute on function ${fn} to authenticated`);
    }

    await q.query(`
      create trigger organizations_validate_timezone
        before insert or update of timezone on app.organizations
        for each row execute function app.validate_organization_timezone()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`drop trigger organizations_validate_timezone on app.organizations`);
    await q.query(`drop function app.validate_organization_timezone()`);
    await q.query(`drop function app.is_known_timezone(text)`);
  }
}
