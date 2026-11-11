import type { Request, Response } from 'express'
import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Repository } from 'typeorm'
import { AuthUser } from '../entities/AuthUser.js'
import { loginSchema } from '../schemas.js'
import { recordAudit } from '../services/AuditService.js'
import { createAuthToken } from '../authTokens.js'

const scrypt = promisify(scryptCallback)

export class AuthController {
  constructor(private userRepository: Repository<AuthUser>) {}

  private async verifyPassword(password: string, encodedHash: string): Promise<boolean> {
    const [algorithm, salt, storedHex] = encodedHash.split('$')
    if (algorithm !== 'scrypt' || !salt || !storedHex) return false
    const storedKey = Buffer.from(storedHex, 'hex')
    const suppliedKey = await scrypt(password, salt, storedKey.length) as Buffer
    return storedKey.length === suppliedKey.length && timingSafeEqual(storedKey, suppliedKey)
  }

  async login(req: Request, res: Response) {
    try {
      const validatedData = loginSchema.parse(req.body)

      const jwtSecret = process.env.JWT_SECRET

      if (!jwtSecret) {
        return res.status(500).json({ error: 'Server auth not configured' })
      }

      const user = await this.userRepository.findOne({ where: { email: validatedData.email.trim().toLowerCase() } })
      if (!user || !user.isActive || !(await this.verifyPassword(validatedData.password, user.passwordHash))) {
        return res.status(401).json({ error: 'Invalid credentials' })
      }

      await recordAudit(this.userRepository.manager, {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      }, { action: 'user_logged_in' })

      const token = createAuthToken(user, jwtSecret)

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        }
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: error.message })
      }
      
      console.error('Error during login:', error)
      res.status(500).json({ error: 'Login failed' })
    }
  }
}
