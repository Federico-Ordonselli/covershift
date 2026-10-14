import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CertificationType } from './certification-type.entity';

@Entity({ schema: 'app', name: 'positions' })
export class Position {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'text' })
  name: string;

  /**
   * Read-only navigation. The join table also carries organization_id (for RLS and the
   * composite tenant FKs), which TypeORM's implicit join table can't populate, so
   * requirements are written with explicit SQL, never through this relation.
   */
  @ManyToMany(() => CertificationType, { createForeignKeyConstraints: false })
  @JoinTable({
    schema: 'app',
    name: 'position_certification_requirements',
    joinColumn: { name: 'position_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'certification_type_id', referencedColumnName: 'id' },
  })
  requiredCertifications?: CertificationType[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
