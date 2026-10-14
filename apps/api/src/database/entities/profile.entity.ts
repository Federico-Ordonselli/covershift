import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 1:1 with auth.users; created by the `on_auth_user_created` trigger. */
@Entity({ schema: 'app', name: 'profiles' })
export class Profile {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'full_name', type: 'text' })
  fullName: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
