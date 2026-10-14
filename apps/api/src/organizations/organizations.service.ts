import { Injectable, Logger } from '@nestjs/common';
import {
  LIST_HARD_CAP,
  type Me,
  type Member,
  type MembershipRole,
  type OrganizationSummary,
  type Position as PositionDto,
} from '@covershift/shared';
import { type AuthUser } from '../auth/auth-user';
import { DomainError } from '../common/domain-error';
import { Organization, Position, Profile } from '../database/entities';
import { TxManager } from '../database/rls/tx-manager';

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: MembershipRole;
}

interface MemberRow {
  user_id: string;
  full_name: string;
  role: MembershipRole;
  created_at: Date;
}

/**
 * Reads the frontend needs to render anything: who am I, which organizations, and their
 * positions and people. All scoped by RLS alone (ADR 001): these queries add filters for
 * meaning (active memberships, the caller's own rows), never for isolation.
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly tx: TxManager) {}

  async me(user: AuthUser): Promise<Me> {
    const profile = await this.tx.get().findOneBy(Profile, { id: user.id });
    return {
      id: user.id,
      email: user.claims.email ?? null,
      fullName: profile?.fullName ?? '',
      memberships: await this.mine(user.id),
    };
  }

  /** The caller's active memberships, with each organization's details. */
  async mine(userId: string): Promise<OrganizationSummary[]> {
    return this.tx.get().query<OrganizationRow[]>(
      `select o.id, o.name, o.slug, o.timezone, m.role
       from app.memberships m
       join app.organizations o on o.id = m.organization_id
       where m.user_id = $1 and m.deactivated_at is null
       order by o.name, o.id`,
      [userId],
    );
  }

  async positions(organizationId: string): Promise<PositionDto[]> {
    await this.assertVisible(organizationId);
    const rows = await this.tx.get().find(Position, {
      where: { organizationId },
      order: { name: 'ASC', id: 'ASC' },
      take: LIST_HARD_CAP + 1,
    });
    return this.capped(rows, 'positions', organizationId).map((p) => ({
      id: p.id,
      organizationId: p.organizationId,
      name: p.name,
    }));
  }

  /** Active members only: a deactivated member can't be assigned or offered shifts. */
  async members(organizationId: string): Promise<Member[]> {
    await this.assertVisible(organizationId);
    const rows = await this.tx.get().query<MemberRow[]>(
      `select m.user_id, p.full_name, m.role, m.created_at
       from app.memberships m
       join app.profiles p on p.id = m.user_id
       where m.organization_id = $1 and m.deactivated_at is null
       order by p.full_name, m.user_id
       limit $2`,
      [organizationId, LIST_HARD_CAP + 1],
    );
    return this.capped(rows, 'members', organizationId).map((r) => ({
      userId: r.user_id,
      fullName: r.full_name,
      role: r.role,
      memberSince: r.created_at.toISOString(),
    }));
  }

  /** Truncates to LIST_HARD_CAP; the extra fetched row only tells us that it happened. */
  private capped<T>(rows: T[], list: string, organizationId: string): T[] {
    if (rows.length <= LIST_HARD_CAP) return rows;
    this.logger.warn(`${list} of ${organizationId} truncated at ${LIST_HARD_CAP}`);
    return rows.slice(0, LIST_HARD_CAP);
  }

  /** 404 whether the organization doesn't exist or RLS hides it: deliberately indistinguishable. */
  private async assertVisible(organizationId: string): Promise<void> {
    const visible = await this.tx.get().existsBy(Organization, { id: organizationId });
    if (!visible) throw new DomainError('NOT_FOUND', 'Organization not found', 404);
  }
}
