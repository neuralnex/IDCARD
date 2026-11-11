import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

@Entity('auth_users')
export class AuthUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('varchar', { unique: true })
  email!: string

  @Column('varchar')
  displayName!: string

  @Column('varchar')
  role!: 'admin' | 'worker'

  @Column('varchar')
  passwordHash!: string

  @Column('boolean', { default: true })
  isActive!: boolean

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
