import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DomainError } from '../common/domain-error';
import { Position, UserCertification } from '../database/entities';
import { TxManager } from '../database/rls/tx-manager';
import { type Eligibility, evaluateEligibility, type RequiredCertification } from './eligibility';

export interface EligibilityQuery {
  organizationId: string;
  positionId: string;
  userId: string;
  shiftEndsAt: Date;
}

/**
 * Loads what the eligibility rule needs, under the caller's RLS, and applies it.
 *
 * Callers must be able to see the user's certificates: the user themselves (accepting or
 * claiming a swap) or a manager/admin of the org (assigning, approving). Anyone else would
 * see none and get a false "missing", so that misuse throws instead of answering wrongly.
 */
@Injectable()
export class CertificationEligibilityService {
  constructor(private readonly tx: TxManager) {}

  async check(query: EligibilityQuery): Promise<Eligibility> {
    const em = this.tx.get();
    await this.assertCallerCanSeeCertificates(query);

    const position = await em.findOne(Position, {
      where: { id: query.positionId, organizationId: query.organizationId },
      relations: { requiredCertifications: true },
    });
    if (!position) {
      throw new DomainError(
        'INVALID_REFERENCE',
        'The position does not exist in this organization',
        422,
      );
    }

    const required: RequiredCertification[] = (position.requiredCertifications ?? []).map(
      (type) => ({ id: type.id, name: type.name }),
    );
    if (required.length === 0) return { eligible: true };

    const held = await em.find(UserCertification, {
      select: { certificationTypeId: true, expiresAt: true },
      where: {
        organizationId: query.organizationId,
        userId: query.userId,
        certificationTypeId: In(required.map((r) => r.id)),
      },
    });
    return evaluateEligibility(required, held, query.shiftEndsAt);
  }

  /** Throws a 422 DomainError naming the offending certifications. */
  async assertEligible(query: EligibilityQuery): Promise<void> {
    const result = await this.check(query);
    if (result.eligible) return;

    const names = (types: RequiredCertification[]) => types.map((t) => t.name).join(', ');
    if (result.missing.length > 0) {
      const alsoExpiring = result.expiring.length
        ? `; expiring before the shift ends: ${names(result.expiring)}`
        : '';
      throw new DomainError(
        'CERTIFICATION_MISSING',
        `Missing required certification(s): ${names(result.missing)}${alsoExpiring}`,
        422,
      );
    }
    throw new DomainError(
      'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END',
      `Certification(s) expire before the shift ends: ${names(result.expiring)}`,
      422,
    );
  }

  private async assertCallerCanSeeCertificates(query: EligibilityQuery): Promise<void> {
    const [row] = await this.tx
      .get()
      .query<Array<{ allowed: boolean }>>(
        `select (select auth.uid()) = $1 or app.has_role($2, '{admin,manager}') as allowed`,
        [query.userId, query.organizationId],
      );
    if (!row?.allowed) {
      throw new Error(
        'Eligibility of another user can only be checked by a manager/admin of the organization',
      );
    }
  }
}
