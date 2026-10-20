import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ShiftOverride1792400000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`alter table app.shifts add column override_reason text`);
    await q.query(`
      create or replace function app.apply_approved_swap()
      returns trigger language plpgsql set search_path = '' as $$
      begin
        update app.shifts
           set assigned_user_id = new.target_user_id,
               override_reason = null,
               updated_at = now()
         where id = new.shift_id
           and organization_id = new.organization_id
           and assigned_user_id = new.requester_id;
        if not found then
          perform app.raise_swap_error('SWAP_CONFLICT', 'the shift is no longer assigned to the requester');
        end if;
        return null;
      end;
      $$`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      create or replace function app.apply_approved_swap()
      returns trigger language plpgsql set search_path = '' as $$
      begin
        update app.shifts
           set assigned_user_id = new.target_user_id,
               updated_at = now()
         where id = new.shift_id
           and organization_id = new.organization_id
           and assigned_user_id = new.requester_id;
        if not found then
          perform app.raise_swap_error('SWAP_CONFLICT', 'the shift is no longer assigned to the requester');
        end if;
        return null;
      end;
      $$`);
    await q.query(`alter table app.shifts drop column override_reason`);
  }
}
