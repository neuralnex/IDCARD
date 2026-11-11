import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity('audit_events')
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid', { nullable: true })
  actorId!: string | null

  @Column('varchar')
  actorEmail!: string

  @Column('varchar')
  actorName!: string

  @Column('varchar')
  actorRole!: string

  @Column('varchar')
  action!: string

  @Column('uuid', { nullable: true })
  studentId!: string | null

  @Column('varchar', { nullable: true })
  studentName!: string | null

  @Column('varchar', { nullable: true })
  registrationNumber!: string | null

  @Column('jsonb', { nullable: true })
  details!: Record<string, unknown> | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
