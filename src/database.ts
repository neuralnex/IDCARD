import { DataSource } from 'typeorm'
import { Student } from './entities/Student.js'
import { CreateStudents1760000000000 } from './migrations/1760000000000-CreateStudents.js'
import { AuthUser } from './entities/AuthUser.js'
import { AuditEvent } from './entities/AuditEvent.js'
import { CreateUsersAndAuditEvents1760100000000 } from './migrations/1760100000000-CreateUsersAndAuditEvents.js'
import { StoreStudentFiles1760200000000 } from './migrations/1760200000000-StoreStudentFiles.js'
import { ManageWorkerAccounts1760300000000 } from './migrations/1760300000000-ManageWorkerAccounts.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured to connect to PostgreSQL')
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  poolSize: positiveInteger(process.env.PG_POOL_MAX, 10),
  connectTimeoutMS: positiveInteger(process.env.PG_CONNECTION_TIMEOUT_MS, 10_000),
  extra: { idleTimeoutMillis: 30_000, keepAlive: true },
  ssl: process.env.PGSSL === 'true',
  entities: [Student, AuthUser, AuditEvent],
  synchronize: false,
  migrations: [CreateStudents1760000000000, CreateUsersAndAuditEvents1760100000000, StoreStudentFiles1760200000000, ManageWorkerAccounts1760300000000],
  migrationsRun: true,
  logging: false,
})

export const initializeDatabase = async () => {
  try {
    await AppDataSource.initialize()
    console.log('Database connection established')
  } catch (error) {
    console.error('Error during database initialization:', error)
    process.exit(1)
  }
}
