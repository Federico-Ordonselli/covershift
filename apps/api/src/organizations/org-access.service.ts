import { Injectable } from '@nestjs/common';
import { SCHEDULER_ROLES } from '@covershift/shared';
import { DomainError } from '../common/domain-error';
import { TxManager } from '../database/rls/tx-manager';

/**
 * Readable access checks for the service layer. RLS enforces the same rules regardless
 * (ADR 001); these exist to answer with a clear 403/422 before the database says 42501.
 */
@Injectable()
export class OrgAccess {
  constructor(private readonly tx: TxManager) {}

  async assertScheduler(organizationId: string): Promise<void> {
    const [row] = await this.tx
      .get()
      .query<Array<{ ok: boolean }>>(`select app.has_role($1, $2::app.membership_role[]) as ok`, [
        organizationId,
        SCHEDULER_ROLES,
      ]);
    if (!row?.ok) {
      throw new DomainError(
        'FORBIDDEN',
        'Only managers or admins of this organization can manage its schedule',
        403,
      );
    }
  }

  async assertActiveMember(organizationId: string, userId: string): Promise<void> {
    const rows = await this.tx.get().query<unknown[]>(
      `select 1 from app.memberships
       where organization_id = $1 and user_id = $2 and deactivated_at is null`,
      [organizationId, userId],
    );
    if (rows.length === 0) {
      throw new DomainError(
        'NOT_A_MEMBER',
        'The user is not an active member of this organization',
        422,
      );
    }
  }
}
