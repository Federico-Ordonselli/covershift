import { Injectable } from '@nestjs/common';
import {
  ACTIVE_SWAP_REQUEST_STATUSES,
  type CreateSwapRequest,
  type ListSwapRequestsQuery,
  type SwapRequestStatus,
} from '@covershift/shared';
import { In } from 'typeorm';
import { DomainError } from '../common/domain-error';
import { SwapRequest } from '../database/entities';
import { TxManager } from '../database/rls/tx-manager';
import { OrgAccess } from '../organizations/org-access.service';
import { ShiftsService } from '../shifts/shifts.service';

/**
 * Swap requests. The state machine (who may move a request from which status to which)
 * lives in the database trigger, the single source of truth (ADR 001); its CS409 errors
 * reach the client as 409 with a reason. This service adds what the trigger can't:
 * certification/overlap checks, the claim race, and readable pre-checks.
 */
@Injectable()
export class SwapRequestsService {
  constructor(
    private readonly tx: TxManager,
    private readonly access: OrgAccess,
    private readonly shifts: ShiftsService,
  ) {}

  async list(query: ListSwapRequestsQuery): Promise<SwapRequest[]> {
    return this.tx.get().find(SwapRequest, {
      where: {
        ...(query.organizationId && { organizationId: query.organizationId }),
        ...(query.shiftId && { shiftId: query.shiftId }),
        ...(query.status && { status: query.status }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async get(id: string): Promise<SwapRequest> {
    const swap = await this.tx.get().findOneBy(SwapRequest, { id });
    if (!swap) throw new DomainError('NOT_FOUND', 'Swap request not found', 404);
    return swap;
  }

  /** Offer a shift assigned to the caller, to one coworker or (no target) to anyone. */
  async create(callerId: string, input: CreateSwapRequest): Promise<SwapRequest> {
    const shift = await this.shifts.get(input.shiftId);
    if (shift.assignedUserId !== callerId) {
      throw new DomainError(
        'SWAP_NOT_ALLOWED',
        'You can only offer shifts that are assigned to you',
        403,
      );
    }
    if (input.targetUserId === callerId) {
      throw new DomainError('SWAP_NOT_ALLOWED', 'You cannot offer a shift to yourself', 422);
    }
    if (input.targetUserId) {
      await this.access.assertActiveMember(shift.organizationId, input.targetUserId);
    }
    const active = await this.tx.get().existsBy(SwapRequest, {
      shiftId: shift.id,
      status: In([...ACTIVE_SWAP_REQUEST_STATUSES]),
    });
    if (active) {
      // The partial unique index is the backstop for concurrent creations.
      throw new DomainError(
        'SWAP_ALREADY_ACTIVE',
        'This shift already has an active swap request',
        409,
      );
    }

    const { rows } = await this.tx.write<{ id: string }>(
      this.tx
        .get()
        .createQueryBuilder()
        .insert()
        .into(SwapRequest)
        .values({
          organizationId: shift.organizationId,
          shiftId: shift.id,
          requesterId: callerId,
          targetUserId: input.targetUserId,
          note: input.note ?? null,
        })
        .returning(['id']),
    );
    return this.get(rows[0]!.id);
  }

  /**
   * The direct target accepts, or any other member claims an open offer. Fails fast if the
   * caller couldn't take the shift (membership, certifications valid through the shift end,
   * overlaps). Approval re-checks all of it, since certificates can expire in between.
   */
  async accept(callerId: string, id: string): Promise<SwapRequest> {
    const swap = await this.get(id);
    const isOpenOffer = swap.targetUserId === null;
    // Explicit pre-checks so validation below only ever runs for a legitimate taker.
    // The trigger enforces the same rules on the write itself.
    if (swap.status !== 'pending') {
      throw new DomainError(
        'SWAP_INVALID_TRANSITION',
        `cannot accept a ${swap.status} request`,
        409,
      );
    }
    if (isOpenOffer && swap.requesterId === callerId) {
      throw new DomainError('SWAP_NOT_ALLOWED', 'cannot claim your own offer', 409);
    }
    if (!isOpenOffer && swap.targetUserId !== callerId) {
      throw new DomainError('SWAP_NOT_ALLOWED', 'only the target can accept', 403);
    }

    const shift = await this.shifts.get(swap.shiftId);
    await this.shifts.validateAssignment({
      organizationId: shift.organizationId,
      positionId: shift.positionId,
      userId: callerId,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      shiftId: shift.id,
    });

    // Conditional update: of two concurrent claims, the second re-evaluates the WHERE after
    // the first commits, matches nothing, and gets a 409 (ADR 001).
    const qb = this.tx
      .get()
      .createQueryBuilder()
      .update(SwapRequest)
      .set({ status: 'accepted', targetUserId: callerId })
      .where('id = :id', { id })
      .andWhere('status = :pending', { pending: 'pending' });
    if (isOpenOffer) qb.andWhere('target_user_id is null');
    else qb.andWhere('target_user_id = :me', { me: callerId });

    const { affected } = await this.tx.write(qb);
    if (affected === 0) {
      throw new DomainError(
        'SWAP_CONFLICT',
        'This swap request was taken or changed in the meantime',
        409,
      );
    }
    return this.get(id);
  }

  async decline(id: string): Promise<SwapRequest> {
    await this.get(id);
    return this.setStatus(id, 'declined');
  }

  async cancel(id: string): Promise<SwapRequest> {
    await this.get(id);
    return this.setStatus(id, 'cancelled');
  }

  async reject(id: string): Promise<SwapRequest> {
    const swap = await this.get(id);
    await this.access.assertScheduler(swap.organizationId);
    return this.setStatus(id, 'rejected');
  }

  /**
   * Approve, re-checking the target inside this transaction; the database then reassigns
   * the shift in the same statement (exclusion constraint and FKs apply atomically).
   */
  async approve(id: string): Promise<SwapRequest> {
    const swap = await this.get(id);
    await this.access.assertScheduler(swap.organizationId);

    if (swap.status === 'accepted' && swap.targetUserId) {
      const shift = await this.shifts.get(swap.shiftId);
      await this.shifts.validateAssignment({
        organizationId: shift.organizationId,
        positionId: shift.positionId,
        userId: swap.targetUserId,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        shiftId: shift.id,
      });
    }

    const { affected } = await this.tx.write(
      this.tx
        .get()
        .createQueryBuilder()
        .update(SwapRequest)
        .set({ status: 'approved' })
        .where('id = :id', { id })
        .andWhere('status = :status', { status: swap.status }),
    );
    if (affected === 0) {
      throw new DomainError('SWAP_CONFLICT', 'This swap request changed in the meantime', 409);
    }
    return this.get(id);
  }

  /** Plain transition; the trigger decides whether this caller may make it. */
  private async setStatus(id: string, status: SwapRequestStatus): Promise<SwapRequest> {
    const { affected } = await this.tx.write(
      this.tx
        .get()
        .createQueryBuilder()
        .update(SwapRequest)
        .set({ status })
        .where('id = :id', { id }),
    );
    // Visible to read but not to update (e.g. a bystander on a direct offer): not yours.
    if (affected === 0) throw new DomainError('NOT_FOUND', 'Swap request not found', 404);
    return this.get(id);
  }
}
