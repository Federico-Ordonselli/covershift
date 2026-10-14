import { SWAP_REQUEST_STATUSES, type SwapRequestStatus } from '@covershift/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Shift } from './shift.entity';

@Entity({ schema: 'app', name: 'swap_requests' })
export class SwapRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'shift_id', type: 'uuid' })
  shiftId: string;

  @ManyToOne(() => Shift, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @Column({ name: 'requester_id', type: 'uuid' })
  requesterId: string;

  /** null = open offer. Set to the claimer on accept. */
  @Column({ name: 'target_user_id', type: 'uuid', nullable: true })
  targetUserId: string | null;

  @Column({ type: 'enum', enum: SWAP_REQUEST_STATUSES, enumName: 'swap_request_status' })
  status: SwapRequestStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'decided_by_id', type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
