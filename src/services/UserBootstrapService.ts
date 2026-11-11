import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import { AppDataSource } from '../database.js'
import { AuthUser } from '../entities/AuthUser.js'

const scrypt = promisify(scryptCallback)
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64) as Buffer
  return `scrypt$${salt}$${key.toString('hex')}`
}

export async function seedConfiguredUsers(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  const displayName = process.env.ADMIN_NAME?.trim() || 'SECGEN'
  if (!email || !password || password.length < 12) {
    throw new Error('ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters must be configured')
  }
  const users = AppDataSource.getRepository(AuthUser)
  const existing = await users.findOne({ where: { email } })
  if (existing) {
    if (existing.role !== 'admin') throw new Error('ADMIN_EMAIL belongs to a non-admin account')
    return
  }
  await users.save(users.create({ email, displayName, role: 'admin', passwordHash: await hashPassword(password), isActive: true }))
  console.log('Configured SECGEN account; worker accounts are managed in the SECGEN dashboard')
}
