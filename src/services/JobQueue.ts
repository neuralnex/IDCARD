import { Queue, Worker, type Job } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { AppDataSource } from '../database.js'
import { Student } from '../entities/Student.js'
import { createStudentSchema } from '../schemas.js'
import { recordAudit } from './AuditService.js'
import { fileStorage } from './FileStorageService.js'
import { PDFService } from './PDFService.js'

export type ActorSnapshot = { id: string; email: string; displayName: string; role: 'admin' | 'worker' }
export type TrackedJob = { id: string; type: 'registration' | 'card'; status: string; progress: number; message: string; result?: { studentId: string }; error?: string }

const redisUrl = process.env.REDIS_URL?.trim().replace(/^(['"])(.*)\1$/, '$2')
if (!redisUrl) console.warn('REDIS_URL is not configured; background registration and card generation are unavailable')
const redisConnection = redisUrl ? (() => { const url = new URL(redisUrl); return { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined, password: url.password || undefined, tls: url.protocol === 'rediss:' ? {} : undefined } })() : null
const queue = redisConnection ? new Queue('id-card-work', { connection: { ...redisConnection, connectTimeout: 4000, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: (attempt: number) => Math.min(attempt * 300, 900) } }) : null
queue?.on('error', (error) => console.error('Background job queue connection error:', error.message))

export async function enqueueRegistration(data: unknown, actor: ActorSnapshot) {
  if (!queue) throw new Error('Background jobs are not configured. Set REDIS_URL.')
  const id = randomUUID()
  const job = await queue.add('registration', { input: data, actor }, { jobId: id, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } })
  return job.id!
}

export async function enqueueCard(studentId: string, actorId: string) {
  if (!queue) throw new Error('Background jobs are not configured. Set REDIS_URL.')
  const id = randomUUID()
  const job = await queue.add('card', { studentId, actorId }, { jobId: id, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } })
  return job.id!
}

export async function getTrackedJob(id: string, actorId: string): Promise<TrackedJob | null> {
  if (!queue) return null
  const job = await queue.getJob(id)
  if (!job || (job.data.actor?.id ?? job.data.actorId) !== actorId) return null
  const state = await job.getState()
  return { id, type: job.name as TrackedJob['type'], status: state, progress: typeof job.progress === 'number' ? job.progress : 0, message: typeof job.returnvalue?.message === 'string' ? job.returnvalue.message : state === 'completed' ? 'Complete' : state === 'failed' ? 'Failed' : state === 'active' ? 'In progress' : 'Waiting', ...(state === 'completed' ? { result: job.returnvalue?.result } : {}), ...(state === 'failed' ? { error: job.failedReason || 'Job failed' } : {}) }
}

const pendingCardJobs = new Map<string, Promise<void>>()
async function generateAndStore(studentId: string) {
  const pending = pendingCardJobs.get(studentId)
  if (pending) return pending
  const generation = generateAndStoreOnce(studentId)
  pendingCardJobs.set(studentId, generation)
  try { await generation } finally { if (pendingCardJobs.get(studentId) === generation) pendingCardJobs.delete(studentId) }
}

async function generateAndStoreOnce(studentId: string) {
  const repository = AppDataSource.getRepository(Student)
  const student = await repository.findOne({ where: { id: studentId } })
  if (!student) throw new Error('Student not found')
  if (student.cardPdfPath) { try { await fileStorage.readCardPdf(student.cardPdfPath); return } catch { /* rebuild missing artifact */ } }
  const pdf = await new PDFService().generateStudentIDCard(student)
  const path = await fileStorage.saveCardPdf(student.id, pdf)
  await repository.update({ id: student.id }, { cardPdfPath: path })
  if (student.cardPdfPath && student.cardPdfPath !== path) await fileStorage.remove(student.cardPdfPath)
}

export async function startJobWorker() {
  if (!redisConnection) return
  const worker = new Worker('id-card-work', async (job: Job) => {
    if (job.name === 'registration') {
      await job.updateProgress(10)
      const input = createStudentSchema.parse(job.data.input)
      const repository = AppDataSource.getRepository(Student)
      if (await repository.findOne({ where: { registrationNumber: input.registrationNumber } })) throw new Error('A student with this registration number already exists')
      const photoPath = input.photoUrl ? await fileStorage.savePhoto(input.photoUrl) : null
      await job.updateProgress(55)
      const student = await AppDataSource.transaction(async (manager) => {
        const { photoUrl: _photoUrl, ...fields } = input
        const saved = await manager.getRepository(Student).save(manager.getRepository(Student).create({ ...fields, photoPath, cardPdfPath: null }))
        await recordAudit(manager, job.data.actor, { action: 'student_registered', studentId: saved.id, studentName: `${saved.firstName} ${saved.lastName}`, registrationNumber: saved.registrationNumber })
        return saved
      })
      await job.updateData({ actor: job.data.actor, result: { studentId: student.id } })
      await job.updateProgress(100)
      return { message: 'Registration complete', result: { studentId: student.id } }
    }
    await job.updateProgress(10)
    await generateAndStore(job.data.studentId)
    await job.updateProgress(100)
    return { message: 'ID card ready', result: { studentId: job.data.studentId } }
  }, { connection: { ...redisConnection, connectTimeout: 4000, maxRetriesPerRequest: null, retryStrategy: (attempt: number) => Math.min(attempt * 1000, 5000) }, concurrency: 2 })
  worker.on('failed', (job, error) => console.error(`Background job ${job?.id} failed:`, error))
  let lastRedisErrorLoggedAt = 0
  worker.on('error', (error) => {
    const now = Date.now()
    if (now - lastRedisErrorLoggedAt < 30_000) return
    lastRedisErrorLoggedAt = now
    console.error('Background job worker Redis connection error:', error.message)
  })
}
