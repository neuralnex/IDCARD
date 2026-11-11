import jwt, { type SignOptions } from 'jsonwebtoken'

export interface TokenUser {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'worker'
}

export function createAuthToken(user: TokenUser, secret: string, expiresIn = process.env.JWT_EXPIRES_IN || '30d'): string {
  return jwt.sign(
    { email: user.email, displayName: user.displayName, role: user.role },
    secret,
    { subject: user.id, expiresIn: expiresIn as SignOptions['expiresIn'] },
  )
}
