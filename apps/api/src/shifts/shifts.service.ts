import { Injectable } from '@nestjs/common';
import { type CreateShift, type ListShiftsQuery, type UpdateShift } from '@covershift/shared';
import { type QueryDeepPartialEntity } from 'typeorm';
import { CertificationEligibilityService } from '../certifications/certification-eligibility.service';
import { DomainError } from '../common/domain-error';
import { Position, Shift, SwapRequest } from '../database/entities';
import { TxManager } from '../database/rls/tx-manager';
import { OrgAccess } from '../organizations/org-access.service';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

interface Assignment {
  organizationId: string;
  positionId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  /** The shift being edited, excluded from the overlap check. */
  shiftId?: string;
}

/**
 * Shift CRUD. Reads are scoped by RLS alone; writes add readable pre-checks on top of the
 * policies and constraints that enforce the same rules (ADR 001, defense in depth).
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly tx: TxManager,
    private readonly access: OrgAccess,
    private readonly eligibility: CertificationEligibilityService,
  ) {}

  async list(query: ListShiftsQuery): Promise<Shift[]> {
    const qb = this.tx.get().createQueryBuilder(Shift, 's').orderBy('s.startsAt', 'ASC');
    if (query.organizationId) {
      qb.andWhere('s.organization_id = :org', { org: query.organizationId });
    }
    if (query.assignedUserId) {
      qb.andWhere('s.assigned_user_id = :assignee', { assignee: query.assignedUserId });
    }
    // Window filter: shifts overlapping [from, to).
    if (query.from) qb.andWhere('s.ends_at > :from', { from: query.from });
    if (query.to) qb.andWhere('s.starts_at < :to', { to: query.to });
    return qb.getMany();
  }

  /** 404 whether the shift doesn't exist or RLS hides it: deliberately indistinguishable. */
  async get(id: string): Promise<Shift> {
    const shift = await this.tx.get().findOneBy(Shift, { id });
    if (!shift) throw new DomainError('NOT_FOUND', 'Shift not found', 404);
    return shift;
  }

  async create(input: CreateShift): Promise<Shift> {
    await this.access.assertScheduler(input.organizationId);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (input.assignedUserId) {
      await this.validateAssignment({
        organizationId: input.organizationId,
        positionId: input.positionId,
        userId: input.assignedUserId,
        startsAt,
        endsAt,
      });
    } else {
      await this.assertPositionInOrg(input.organizationId, input.positionId);
    }

    const { rows } = await this.tx.write<{ id: string }>(
      this.tx
        .get()
        .createQueryBuilder()
        .insert()
        .into(Shift)
        .values({
          organizationId: input.organizationId,
          positionId: input.positionId,
          startsAt,
          endsAt,
          assignedUserId: input.assignedUserId,
        })
        .returning(['id']),
    );
    return this.get(rows[0]!.id);
  }

  async update(id: string, patch: UpdateShift): Promise<Shift> {
    const current = await this.get(id);
    await this.access.assertScheduler(current.organizationId);

    const next = {
      positionId: patch.positionId ?? current.positionId,
      startsAt: patch.startsAt ? new Date(patch.startsAt) : current.startsAt,
      endsAt: patch.endsAt ? new Date(patch.endsAt) : current.endsAt,
      assignedUserId:
        patch.assignedUserId === undefined ? current.assignedUserId : patch.assignedUserId,
    };
    if (next.endsAt <= next.startsAt) {
      // The schema only checks ordering when both bounds are in the same patch.
      throw new DomainError('CONSTRAINT_VIOLATION', 'endsAt must be after startsAt', 422);
    }

    // Anything that changes who works, where, or when re-validates the assignment:
    // a new time window can outlast a certificate or collide with another shift.
    if (next.assignedUserId) {
      await this.validateAssignment({
        organizationId: current.organizationId,
        positionId: next.positionId,
        userId: next.assignedUserId,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        shiftId: id,
      });
    } else if (patch.positionId) {
      await this.assertPositionInOrg(current.organizationId, next.positionId);
    }

    const values: QueryDeepPartialEntity<Shift> = {
      positionId: next.positionId,
      startsAt: next.startsAt,
      endsAt: next.endsAt,
      assignedUserId: next.assignedUserId,
    };
    const { affected } = await this.tx.write(
      this.tx.get().createQueryBuilder().update(Shift).set(values).where('id = :id', { id }),
    );
    if (affected === 0) throw new DomainError('NOT_FOUND', 'Shift not found', 404);
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const current = await this.get(id);
    await this.access.assertScheduler(current.organizationId);

    // Swap requests cascade from shifts: deleting would silently erase their audit trail.
    const history = await this.tx.get().countBy(SwapRequest, { shiftId: id });
    if (history > 0) {
      throw new DomainError(
        'CONFLICT',
        'This shift has swap-request history and cannot be deleted',
        409,
      );
    }

    const { affected } = await this.tx.write(
      this.tx.get().createQueryBuilder().delete().from(Shift).where('id = :id', { id }),
    );
    if (affected === 0) throw new DomainError('NOT_FOUND', 'Shift not found', 404);
  }

  /**
   * The assignment rules, in the order a manager would want to hear about them:
   * membership, then certifications (via the eligibility rule), then overlaps.
   * Also used by swap approval.
   */
  async validateAssignment(a: Assignment): Promise<void> {
    await this.access.assertActiveMember(a.organizationId, a.userId);
    await this.eligibility.assertEligible({
      organizationId: a.organizationId,
      positionId: a.positionId,
      userId: a.userId,
      shiftEndsAt: a.endsAt,
    });

    const overlapping = await this.tx
      .get()
      .createQueryBuilder(Shift, 's')
      .select('s.id')
      .where('s.organization_id = :org', { org: a.organizationId })
      .andWhere('s.assigned_user_id = :user', { user: a.userId })
      .andWhere('s.id <> :self', { self: a.shiftId ?? NIL_UUID })
      .andWhere(`tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(:start, :end, '[)')`, {
        start: a.startsAt,
        end: a.endsAt,
      })
      .getOne();
    if (overlapping) {
      throw new DomainError(
        'SHIFT_OVERLAP',
        'The assignee already has an overlapping shift in this organization',
        409,
      );
    }
  }

  private async assertPositionInOrg(organizationId: string, positionId: string): Promise<void> {
    const exists = await this.tx.get().existsBy(Position, { id: positionId, organizationId });
    if (!exists) {
      throw new DomainError(
        'INVALID_REFERENCE',
        'The position does not exist in this organization',
        422,
      );
    }
  }
}
