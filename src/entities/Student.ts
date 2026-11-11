import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity('students')
export class Student {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('varchar')
  firstName!: string

  @Column('varchar')
  lastName!: string

  @Column('varchar', { unique: true })
  registrationNumber!: string

  @Column('varchar')
  department!: string

  @Column('varchar')
  faculty!: string

  @Column('varchar')
  level!: string

  @Column('text', { nullable: true })
  photoPath!: string | null

  @Column('text', { nullable: true })
  cardPdfPath!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
