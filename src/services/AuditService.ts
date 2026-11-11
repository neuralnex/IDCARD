import type { EntityManager } from 'typeorm'
import type { AuthenticatedActor } from '../auth.js'
import { AuditEvent } from '../entities/AuditEvent.js'

export interface AuditInput {
  action: 'user_logged_in' | 'student_registered' | 'student_updated' | 'student_deleted' | 'card_downloaded' | 'bulk_cards_downloaded' | 'worker_account_created' | 'worker_account_activated' | 'worker_account_deactivated'
  studentId?: string | null
  studentName?: string | null
  registrationNumber?: string | null
  details?: Record<string, unknown> | null
}

export async function recordAudit(manager: EntityManager, actor: AuthenticatedActor, input: AuditInput) {
  const repository = manager.getRepository(AuditEvent)
  await repository.save(repository.create({
    actorId: actor.id,
    actorEmail: actor.email,
    actorName: actor.displayName,
    actorRole: actor.role,
    action: input.action,
    studentId: input.studentId ?? null,
    studentName: input.studentName ?? null,
    registrationNumber: input.registrationNumber ?? null,
    details: input.details ?? null,
  }))
}
