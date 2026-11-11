import type { Request, Response, NextFunction } from 'express'

export interface AuthenticatedActor {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'worker'
}

declare global {
  namespace Express {
    interface Request {
      actor?: AuthenticatedActor
    }
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.actor?.role !== 'admin') return res.status(403).json({ error: 'SECGEN access required' })
  return next()
}
