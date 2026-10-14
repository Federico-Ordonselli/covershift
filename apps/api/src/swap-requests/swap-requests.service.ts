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

type SwapAction = 'accept' | 'decline' | 'cancel' | 'approve' | 'reject';

/**
 * Swap requests. The state machine (who may move a request from which status to which)
 * lives in the database trigger, the single source of truth (ADR 001); its CS409 errors
 * reach the client as 409 with a reason. This service adds what the trigger can't:
 * certification/overlap checks, the claim race, and consistent status codes for every
 * transition: hidden = 404, visible but not your action = 403, wrong state = 409.
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
    // State first for accept only: once an open offer is claimed its target is set, and a
    // late claimer should hear "taken" (409), not "not your offer" (403).
    if (swap.status !== 'pending') {
      throw new DomainError(
        'SWAP_INVALID_TRANSITION',
        `cannot accept a ${swap.status} request`,
        409,
      );
    }
    await this.assertActor('accept', swap, callerId);

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
    const isOpenOffer = swap.targetUserId === null;
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

  async decline(callerId: string, id: string): Promise<SwapRequest> {
    const swap = await this.get(id);
    await this.assertActor('decline', swap, callerId);
    return this.setStatus(id, 'declined');
  }

  async cancel(callerId: string, id: string): Promise<SwapRequest> {
    const swap = await this.get(id);
    await this.assertActor('cancel', swap, callerId);
    return this.setStatus(id, 'cancelled');
  }

  async reject(callerId: string, id: string): Promise<SwapRequest> {
    const swap = await this.get(id);
    await this.assertActor('reject', swap, callerId);
    return this.setStatus(id, 'rejected');
  }

  /**
   * Approve, re-checking the target inside this transaction; the database then reassigns
   * the shift in the same statement (exclusion constraint and FKs apply atomically).
   */
  async approve(callerId: string, id: string): Promise<SwapRequest> {
    const swap = await this.get(id);
    await this.assertActor('approve', swap, callerId);
    if (swap.status !== 'accepted' || !swap.targetUserId) {
      throw new DomainError(
        'SWAP_INVALID_TRANSITION',
        'only accepted requests can be approved',
        409,
      );
    }

    const shift = await this.shifts.get(swap.shiftId);
    await this.shifts.validateAssignment({
      organizationId: shift.organizationId,
      positionId: shift.positionId,
      userId: swap.targetUserId,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      shiftId: shift.id,
    });

    const { affected } = await this.tx.write(
      this.tx
        .get()
        .createQueryBuilder()
        .update(SwapRequest)
        .set({ status: 'approved' })
        .where('id = :id', { id })
        .andWhere('status = :accepted', { accepted: 'accepted' }),
    );
    if (affected === 0) {
      throw new DomainError('SWAP_CONFLICT', 'This swap request changed in the meantime', 409);
    }
    return this.get(id);
  }

  /**
   * Who may perform a transition (the row is already known to be visible: hidden = 404).
   * Visible but not this caller's action = 403. Whether the current *state* allows it is
   * a 409, decided afterwards by the trigger (or an explicit pre-check).
   */
  private async assertActor(
    action: SwapAction,
    swap: SwapRequest,
    callerId: string,
  ): Promise<void> {
    const deny = (reason: string): never => {
      throw new DomainError('SWAP_NOT_ALLOWED', reason, 403);
    };
    switch (action) {
      case 'accept':
        if (swap.targetUserId === null) {
          if (swap.requesterId === callerId) deny('You cannot claim your own offer');
        } else if (swap.targetUserId !== callerId) {
          deny('Only the target of a direct offer can accept it');
        }
        return;
      case 'decline':
        if (swap.targetUserId === null || swap.targetUserId !== callerId) {
          deny('Only the target of a direct offer can decline it');
        }
        return;
      case 'cancel':
        if (swap.requesterId !== callerId) deny('Only the requester can cancel');
        return;
      case 'approve':
      case 'reject':
        await this.access.assertScheduler(swap.organizationId); // 403 FORBIDDEN
        if (callerId === swap.requesterId || callerId === swap.targetUserId) {
          deny('The decider cannot be the requester or the target');
        }
        return;
    }
  }

  /** Plain transition after the actor checks; the trigger enforces state and actor again. */
  private async setStatus(id: string, status: SwapRequestStatus): Promise<SwapRequest> {
    const { affected } = await this.tx.write(
      this.tx
        .get()
        .createQueryBuilder()
        .update(SwapRequest)
        .set({ status })
        .where('id = :id', { id }),
    );
    // Unreachable after assertActor (participants and schedulers pass the update policy);
    // kept so a policy change can never turn into a silent no-op.
    if (affected === 0) throw new DomainError('NOT_FOUND', 'Swap request not found', 404);
    return this.get(id);
  }
}
