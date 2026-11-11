import './config/env.js'
import 'reflect-metadata'
import express, { type Response } from 'express'
import cors from 'cors'
import jwt, { type JwtPayload } from 'jsonwebtoken'
import swaggerUi from 'swagger-ui-express'
import { swaggerSpec } from './config/swagger.js'
import { AppDataSource } from './database.js'
import { Student } from './entities/Student.js'
import { StudentController } from './controllers/StudentController.js'
import { AuthController } from './controllers/AuthController.js'
import { PDFService } from './services/PDFService.js'
import archiver from 'archiver'
import { AuthUser } from './entities/AuthUser.js'
import { AuditEvent } from './entities/AuditEvent.js'
import { requireAdmin } from './auth.js'
import { recordAudit } from './services/AuditService.js'
import { hashPassword, seedConfiguredUsers } from './services/UserBootstrapService.js'
import { In } from 'typeorm'
import { fileStorage } from './services/FileStorageService.js'
import { PoolOverloadedError } from './services/ConcurrencyPool.js'
import { enqueueCard, getTrackedJob, startJobWorker } from './services/JobQueue.js'

// Debug: Show dotenv loading
console.log('Current working directory:', process.cwd())
console.log('NODE_ENV:', process.env.NODE_ENV)

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured and contain at least 32 characters')
}
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be configured')
}

const app = express()
const safeFilename = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_')
const pendingCardPdfs = new Map<string, Promise<Buffer>>()

function sendOperationError(res: Response, error: unknown, message: string) {
  if (error instanceof PoolOverloadedError) {
    res.setHeader('Retry-After', '3')
    return res.status(503).json({ error: error.message })
  }
  return res.status(500).json({ error: message })
}

async function getStoredCardPdf(student: Student): Promise<Buffer> {
  if (student.cardPdfPath) {
    try { return await fileStorage.readCardPdf(student.cardPdfPath) } catch { /* regenerate missing file */ }
  }
  const existingGeneration = pendingCardPdfs.get(student.id)
  if (existingGeneration) return existingGeneration

  const generation = (async () => {
    const repository = AppDataSource.getRepository(Student)
    let current = student
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pdf = await new PDFService().generateStudentIDCard(current)
      const generatedPath = await fileStorage.saveCardPdf(current.id, pdf)
      const previousPath = current.cardPdfPath
      const result = await repository.createQueryBuilder()
        .update(Student)
        .set({ cardPdfPath: generatedPath })
        .where('"id" = :id AND "firstName" = :firstName AND "lastName" = :lastName AND "registrationNumber" = :registrationNumber AND "department" = :department AND "faculty" = :faculty AND "level" = :level AND "photoPath" IS NOT DISTINCT FROM :photoPath', {
          id: current.id,
          firstName: current.firstName,
          lastName: current.lastName,
          registrationNumber: current.registrationNumber,
          department: current.department,
          faculty: current.faculty,
          level: current.level,
          photoPath: current.photoPath,
        })
        .execute()
      if (result.affected) {
        if (previousPath && previousPath !== generatedPath) await fileStorage.remove(previousPath)
        return pdf
      }

      await fileStorage.remove(generatedPath)
      const refreshed = await repository.findOne({ where: { id: student.id } })
      if (!refreshed) throw new Error('Student was removed while generating the card')
      if (refreshed.cardPdfPath) {
        try { return await fileStorage.readCardPdf(refreshed.cardPdfPath) } catch { /* regenerate if artifact is missing */ }
      }
      current = refreshed
    }
    throw new Error('Student record changed repeatedly while generating the card')
  })()
  pendingCardPdfs.set(student.id, generation)
  try {
    return await generation
  } finally {
    if (pendingCardPdfs.get(student.id) === generation) pendingCardPdfs.delete(student.id)
  }
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map((origin) => origin.trim()).filter(Boolean)
app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
  return callback(new Error('Origin is not allowed by CORS'))
} }))
app.use(express.json({ limit: '10mb' }))

/**
 * @swagger
 * /api-docs.json:
 *   get:
 *     summary: OpenAPI specification
 *     description: Returns the OpenAPI 3.0 specification in JSON format
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: OpenAPI specification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
// Swagger JSON endpoint
app.get('/api-docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.send(swaggerSpec)
})

// Swagger UI
app.use('/api-docs', swaggerUi.serve)
app.get('/api-docs', swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Student ID Card API Documentation',
  swaggerOptions: {
    persistAuthorization: true,
    url: '/api-docs.json',
  },
}))

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`)
  next()
})

// Initialize auth controller early
const authController = new AuthController(AppDataSource.getRepository(AuthUser))
const studentController = new StudentController(AppDataSource.getRepository(Student))

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the health status of the API
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheck'
 */
app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Admin login
 *     description: |
 *       Authenticate user with email and password. The JWT defaults to a 30-day lifetime, configurable with JWT_EXPIRES_IN.
 *       Use this token in the Authorization header for protected endpoints (Bearer token).
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       description: Admin credentials
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginInput'
 *           example:
 *             email: "admin@futo.edu.ng"
 *             password: "your_password"
 *     responses:
 *       200:
 *         description: Login successful - Returns JWT token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *             example:
 *               message: "Login successful"
 *               token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImFkbWluQGZ1dG8uZWR1Lm5nIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwNDMyMDB9"
 *               user:
 *                 email: "admin@futo.edu.ng"
 *                 role: "admin"
 *       400:
 *         description: Validation error - Invalid email format or missing fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Validation failed"
 *               details: "Invalid email format"
 *       401:
 *         description: Invalid credentials - Email or password incorrect
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid credentials"
 *       500:
 *         description: Server error - Auth configuration issue
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Server auth not configured"
 */
app.post('/auth/login', (req, res) => {
  return authController.login(req, res)
})

// Everything after login is protected by default; only explicit operational
// endpoints and API documentation are public.
app.use(async (req, res, next) => {
  if (req.path === '/health' || req.path === '/api-docs' || req.path.startsWith('/api-docs/')) return next()
  const secret = process.env.JWT_SECRET
  if (!secret) return res.status(500).json({ error: 'Server auth not configured' })
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const claims = jwt.verify(authHeader.slice(7), secret, { algorithms: ['HS256'] }) as JwtPayload
    if ((claims.role !== 'admin' && claims.role !== 'worker') || typeof claims.email !== 'string' || typeof claims.sub !== 'string' || typeof claims.displayName !== 'string') {
      return res.status(401).json({ error: 'Invalid token' })
    }
    const authenticatedUser = await AppDataSource.getRepository(AuthUser).findOne({ where: { id: claims.sub } })
    if (!authenticatedUser || !authenticatedUser.isActive || authenticatedUser.email !== claims.email || authenticatedUser.role !== claims.role) {
      return res.status(401).json({ error: 'Account is inactive or no longer valid' })
    }
    req.actor = {
      id: claims.sub,
      email: claims.email,
      displayName: claims.displayName,
      role: claims.role,
    }
    return next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
})

// Initialize database
console.log('Initializing database connection...')
AppDataSource.initialize().then(async () => {
  console.log('Database initialized successfully')
  await seedConfiguredUsers()
  await startJobWorker()
  const studentFiles = AppDataSource.getRepository(Student)
  const legacyPhotos = await studentFiles.createQueryBuilder('student')
    .where('student.photoPath LIKE :prefix', { prefix: 'data:image/jpeg;base64,%' }).getMany()
  for (const student of legacyPhotos) {
    try {
      const newPath = await fileStorage.savePhoto(student.photoPath!)
      await AppDataSource.query('UPDATE students SET "photoPath" = $1 WHERE id = $2', [newPath, student.id])
    } catch (error) {
      console.error(`Could not move legacy student photo for ${student.id} to backend storage:`, error)
    }
  }
  if (legacyPhotos.length) console.log(`Moved ${legacyPhotos.length} legacy student photos into backend storage`)
  // Initialize controllers

  /**
   * @swagger
   * /test-pdf/{studentId}:
   *   post:
   *     summary: Test PDF generation
   *     description: |
   *       Generate a test PDF ID card for a specific student. This is a test endpoint to verify PDF generation functionality.
   *       The PDF will be downloaded with the student's name in the filename.
   *     tags: [Testing]
   *     parameters:
   *       - in: path
   *         name: studentId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Student UUID
   *         example: "123e4567-e89b-12d3-a456-426614174000"
   *     requestBody:
   *       required: false
   *       description: No request body required
   *     responses:
   *       200:
   *         description: PDF generated successfully - File will be downloaded
   *         content:
   *           application/pdf:
   *             schema:
   *               type: string
   *               format: binary
   *         headers:
   *           Content-Disposition:
   *             schema:
   *               type: string
   *             description: Attachment filename
   *       404:
   *         description: Student not found with the provided ID
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "Student not found"
   *       500:
   *         description: PDF generation failed - Possible Puppeteer or rendering error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "Failed to generate PDF"
   */
  app.post('/test-pdf/:studentId', async (req, res) => {
    try {
      const studentId = req.params.studentId
      const student = await AppDataSource.getRepository(Student).findOne({
        where: { id: studentId }
      })

      if (!student) {
        return res.status(404).json({ error: 'Student not found' })
      }

      const pdfBuffer = await getStoredCardPdf(student)
      await recordAudit(AppDataSource.manager, req.actor!, {
        action: 'card_downloaded',
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`,
        registrationNumber: student.registrationNumber,
        details: { source: 'test-pdf' },
      })

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(`${student.firstName}_${student.lastName}_${student.registrationNumber}`)}.pdf"`)
      res.send(pdfBuffer)
    } catch (error) {
      console.error('PDF generation error:', error)
      sendOperationError(res, error, 'Failed to generate PDF')
    }
  })

  /**
   * @swagger
   * /download-student/{studentId}:
   *   get:
   *     summary: Download single student ID card
   *     description: |
   *       Generate and download a PDF ID card for a specific student.
   *       The PDF contains both front and back of the ID card with student information.
   *       File will be downloaded with filename: {firstName}_{lastName}_ID_Card.pdf
   *     tags: [Downloads]
   *     parameters:
   *       - in: path
   *         name: studentId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Student UUID
   *         example: "123e4567-e89b-12d3-a456-426614174000"
   *     responses:
   *       200:
   *         description: PDF file downloaded successfully
   *         content:
   *           application/pdf:
   *             schema:
   *               type: string
   *               format: binary
   *         headers:
   *           Content-Disposition:
   *             schema:
   *               type: string
   *             description: Attachment filename (e.g., "John_Doe_ID_Card.pdf")
   *       404:
   *         description: Student not found with the provided ID
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "Student not found"
   *       500:
   *         description: PDF generation failed - Possible Puppeteer or rendering error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "Failed to generate PDF"
   */
  app.get('/students/:studentId/card.pdf', async (req, res) => {
    try {
      const student = await AppDataSource.getRepository(Student).findOne({ where: { id: req.params.studentId } })
      if (!student) return res.status(404).json({ error: 'Student not found' })
      const pdf = await getStoredCardPdf(student)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', 'inline')
      return res.send(pdf)
    } catch (error) {
      console.error('Card preview error:', error)
      return sendOperationError(res, error, 'Failed to generate card preview')
    }
  })

  app.post('/students/:studentId/card-jobs', async (req, res) => {
    try {
      const student = await AppDataSource.getRepository(Student).findOne({ where: { id: req.params.studentId } })
      if (!student) return res.status(404).json({ error: 'Student not found' })
      const jobId = await enqueueCard(student.id, req.actor!.id)
      return res.status(202).json({ jobId, message: 'ID card generation queued' })
    } catch (error) {
      return res.status(503).json({ error: error instanceof Error ? error.message : 'Could not queue ID card generation' })
    }
  })

  app.get('/jobs/:jobId', async (req, res) => {
    try {
      const job = await getTrackedJob(req.params.jobId, req.actor!.id)
      return job ? res.json(job) : res.status(404).json({ error: 'Job not found' })
    } catch (error) {
      console.error('Job status error:', error)
      return res.status(503).json({ error: 'Could not retrieve job status' })
    }
  })

  app.get('/download-student/:studentId', async (req, res) => {
    try {
      const studentId = req.params.studentId
      const student = await AppDataSource.getRepository(Student).findOne({
        where: { id: studentId }
      })

      if (!student) {
        return res.status(404).json({ error: 'Student not found' })
      }

      const pdfBuffer = await getStoredCardPdf(student)
      await recordAudit(AppDataSource.manager, req.actor!, {
        action: 'card_downloaded',
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`,
        registrationNumber: student.registrationNumber,
      })

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(`${student.firstName}_${student.lastName}_${student.registrationNumber}`)}.pdf"`)
      res.send(pdfBuffer)
    } catch (error) {
      console.error('PDF generation error:', error)
      sendOperationError(res, error, 'Failed to generate PDF')
    }
  })

  /**
   * @swagger
   * /download-department/{department}:
   *   get:
   *     summary: Bulk download ID cards by department
   *     description: |
   *       Generate and download a ZIP file containing PDF ID cards for all students in a specific department.
   *       The department name should be URL encoded (e.g., "Computer Science" becomes "Computer%20Science").
   *       Each PDF in the ZIP is named: {firstName}_{lastName}_{registrationNumber}.pdf
   *       ZIP filename: {department}_ID_Cards.zip
   *     tags: [Downloads]
   *     parameters:
   *       - in: path
   *         name: department
   *         required: true
   *         schema:
   *           type: string
   *         description: Department name (must be URL encoded, e.g., "Computer%20Science" for "Computer Science")
   *         example: Computer%20Science
   *     responses:
   *       200:
   *         description: ZIP file downloaded successfully containing all student ID cards
   *         content:
   *           application/zip:
   *             schema:
   *               type: string
   *               format: binary
   *         headers:
   *           Content-Disposition:
   *             schema:
   *               type: string
   *             description: Attachment filename (e.g., "Computer_Science_ID_Cards.zip")
   *       404:
   *         description: No students found in this department
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "No students found in this department"
   *       500:
   *         description: Bulk download failed - Possible error during PDF generation or ZIP creation
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "Failed to generate bulk download"
   */
  app.get('/download-department/:department', async (req, res) => {
        try {
          const department = req.params.department
          const students = await AppDataSource.getRepository(Student).find({
            where: { department }
          })

          if (students.length === 0) {
            return res.status(404).json({ error: 'No students found in this department' })
          }

          const zipFilename = `${department.replace(/[^a-zA-Z0-9]/g, '_')}_ID_Cards.zip`
          const archive = archiver('zip', { zlib: { level: 6 } })
          archive.on('error', (error) => {
            console.error('ZIP archive error:', error)
            if (!res.headersSent) res.status(500).json({ error: 'Failed to generate bulk download' })
            else res.destroy(error)
          })

          const generatedStudents: Student[] = []
          for (const student of students) {
            try {
              const pdfBuffer = await getStoredCardPdf(student)
              const filename = `${safeFilename(`${student.firstName}_${student.lastName}_${student.registrationNumber}`)}.pdf`
              archive.append(pdfBuffer, { name: filename })
              generatedStudents.push(student)
            } catch (error) {
              if (error instanceof PoolOverloadedError) throw error
              console.error(`Failed to generate PDF for ${student.firstName} ${student.lastName}:`, error)
            }
          }

          if (!generatedStudents.length) return res.status(500).json({ error: 'Could not generate any student cards' })
          await recordAudit(AppDataSource.manager, req.actor!, {
            action: 'bulk_cards_downloaded',
            details: {
              department,
              count: generatedStudents.length,
              studentIds: generatedStudents.map((student) => student.id),
            },
          })
          res.setHeader('Content-Type', 'application/zip')
          res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`)
          archive.pipe(res)
          await archive.finalize()

        } catch (error) {
          console.error('Bulk download error:', error)
          sendOperationError(res, error, 'Failed to generate bulk download')
        }
      })

  /**
   * @swagger
   * /:
   *   get:
   *     summary: Root endpoint
   *     description: Returns API information and welcome message
   *     tags: [Health]
   *     responses:
   *       200:
   *         description: API information
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Login successful
   *                 user:
   *                   type: object
   *                   properties:
   *                     email:
   *                       type: string
   *                       example: admin@example.edu
   *                     role:
   *                       type: string
   *                       example: admin
   */
  app.get('/', (req, res) => {
    res.json({ message: 'Crucique API', ok: true })
  })

  /**
   * @swagger
   * /students:
   *   get:
   *     summary: Get all students
   *     description: |
   *       Returns a list of all students ordered by creation date (newest first).
   *       Requires JWT authentication token in the Authorization header.
   *     tags: [Students]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema:
   *           type: string
   *           example: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   *         description: JWT token obtained from /auth/login
   *     responses:
   *       200:
   *         description: List of students retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Student'
   *             example:
   *               - id: "123e4567-e89b-12d3-a456-426614174000"
   *                 firstName: "John"
   *                 lastName: "Doe"
   *                 registrationNumber: "20211234567"
   *                 department: "Computer Science"
   *                 faculty: "School of Computing"
   *                 level: "400"
   *                 photoUrl: "https://example.com/photo.jpg"
   *                 createdAt: "2024-01-01T00:00:00.000Z"
   *                 updatedAt: "2024-01-01T00:00:00.000Z"
   *       401:
   *         description: Unauthorized - Missing or invalid JWT token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "Unauthorized"
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *   post:
   *     summary: Create a new student
   *     description: |
   *       Register a new student in the system. Validates input data, checks for duplicate registration numbers,
   *       creates the student record, and stores the photo with the record.
   *       Requires JWT authentication token in the Authorization header.
   *     tags: [Students]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema:
   *           type: string
   *           example: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   *         description: JWT token obtained from /auth/login
   *     requestBody:
   *       required: true
   *       description: Student information to create
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateStudentInput'
   *           example:
   *             firstName: "John"
   *             lastName: "Doe"
   *             registrationNumber: "20211234567"
   *             department: "Computer Science"
   *             faculty: "School of Computing"
   *             level: "400"
   *             photoUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
   *     responses:
   *       201:
   *         description: Student created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Student'
   *       400:
   *         description: Validation error or duplicate registration number
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             examples:
   *               validationError:
   *                 value:
   *                   error: "Validation failed"
   *                   details: [
   *                     {
   *                       "path": ["registrationNumber"],
   *                       "message": "Registration number must contain only letters and numbers"
   *                     }
   *                   ]
   *               duplicateError:
   *                 value:
   *                   error: "A student with this registration number already exists"
   *       401:
   *         description: Unauthorized - Missing or invalid JWT token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  app.get('/students', (req, res) => studentController.getAllStudents(req, res))
  app.get('/students/:id/photo', (req, res) => studentController.getStudentPhoto(req, res))
  app.get('/students/:id', (req, res) => studentController.getStudentById(req, res))
  app.post('/students', (req, res) => studentController.createStudent(req, res))

  /**
   * @swagger
   * /students/{id}:
   *   put:
   *     summary: Update a student
   *     description: |
   *       Update student information by their UUID. Supports partial updates - only include the fields you want to update.
   *       If updating the registration number, it will be checked for duplicates.
   *       Requires JWT authentication token in the Authorization header.
   *     tags: [Students]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema:
   *           type: string
   *           example: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   *         description: JWT token obtained from /auth/login
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Student UUID to update
   *         example: "123e4567-e89b-12d3-a456-426614174000"
   *     requestBody:
   *       required: true
   *       description: Student information to update (all fields are optional)
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               firstName:
   *                 type: string
   *                 example: "John"
   *               lastName:
   *                 type: string
   *                 example: "Doe"
   *               registrationNumber:
   *                 type: string
   *                 pattern: '^[A-Za-z0-9]+$'
   *                 example: "20211234567"
   *               department:
   *                 type: string
   *                 example: "Computer Science"
   *               faculty:
   *                 type: string
   *                 example: "School of Computing"
   *               level:
   *                 type: string
   *                 example: "400"
   *               photoUrl:
   *                 type: string
   *                 format: uri
   *                 nullable: true
   *                 example: "https://example.com/photo.jpg"
   *           example:
   *             firstName: "Jane"
   *             department: "Information Technology"
   *     responses:
   *       200:
   *         description: Student updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Student'
   *       400:
   *         description: Validation error or duplicate registration number
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             examples:
   *               validationError:
   *                 value:
   *                   error: "Validation failed"
   *                   details: [
   *                     {
   *                       "path": ["registrationNumber"],
   *                       "message": "Registration number must contain only letters and numbers"
   *                     }
   *                   ]
   *               duplicateError:
   *                 value:
   *                   error: "A student with this registration number already exists"
   *       401:
   *         description: Unauthorized - Missing or invalid JWT token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Student not found with the provided ID
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "Student not found"
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *   delete:
   *     summary: Delete a student
   *     description: |
   *       Permanently delete a student from the system by their UUID.
   *       Requires JWT authentication token in the Authorization header.
   *     tags: [Students]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema:
   *           type: string
   *           example: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   *         description: JWT token obtained from /auth/login
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Student UUID to delete
   *         example: "123e4567-e89b-12d3-a456-426614174000"
   *     responses:
   *       200:
   *         description: Student deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Student deleted successfully
   *       400:
   *         description: Invalid student ID format
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "Missing or invalid student id"
   *       401:
   *         description: Unauthorized - Missing or invalid JWT token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Student not found with the provided ID
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               error: "Student not found"
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  app.put('/students/:id', (req, res) => studentController.updateStudent(req, res))
  app.delete('/students/:id', requireAdmin, (req, res) => studentController.deleteStudent(req, res))

  app.get('/audit/recent', async (req, res) => {
    try {
      const events = await AppDataSource.getRepository(AuditEvent).find({
        where: req.actor?.role === 'admin' ? {} : { actorId: req.actor!.id },
        order: { createdAt: 'DESC' },
        take: 10,
      })
      return res.json(events)
    } catch (error) {
      console.error('Failed to load recent activity:', error)
      return res.status(500).json({ error: 'Could not load recent activity' })
    }
  })

  app.post('/download-cards', async (req, res) => {
    try {
      const { studentIds } = req.body as { studentIds?: unknown }
      if (!Array.isArray(studentIds) || studentIds.length < 1 || studentIds.length > 500
        || studentIds.some((id) => typeof id !== 'string' || id.length > 64)) {
        return res.status(400).json({ error: 'Provide between 1 and 500 valid student IDs' })
      }
      const uniqueIds = [...new Set(studentIds as string[])]
      const students = await AppDataSource.getRepository(Student).find({ where: { id: In(uniqueIds) } })
      if (students.length !== uniqueIds.length) return res.status(400).json({ error: 'One or more students were not found' })
      const archive = archiver('zip', { zlib: { level: 6 } })
      archive.on('error', (error) => {
        console.error('Selected cards ZIP error:', error)
        if (!res.headersSent) res.status(500).json({ error: 'Failed to generate selected card download' })
        else res.destroy(error)
      })

      const generatedStudents: Student[] = []
      for (const student of students) {
        try {
          const pdf = await getStoredCardPdf(student)
          archive.append(pdf, { name: `${safeFilename(`${student.firstName}_${student.lastName}_${student.registrationNumber}`)}.pdf` })
          generatedStudents.push(student)
        } catch (error) {
          if (error instanceof PoolOverloadedError) throw error
          console.error(`Failed to generate PDF for ${student.firstName} ${student.lastName}:`, error)
        }
      }
      if (!generatedStudents.length) return res.status(500).json({ error: 'Could not generate any student cards' })

      await recordAudit(AppDataSource.manager, req.actor!, {
        action: 'bulk_cards_downloaded',
        details: { count: generatedStudents.length, studentIds: generatedStudents.map((student) => student.id) },
      })
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', 'attachment; filename="selected_ID_Cards.zip"')
      archive.pipe(res)
      await archive.finalize()
      return
    } catch (error) {
      console.error('Failed to record download audit event:', error)
      return sendOperationError(res, error, 'Could not record download activity')
    }
  })

  app.get('/admin/audit', requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
      const offset = Math.max(Number(req.query.offset) || 0, 0)
      const repository = AppDataSource.getRepository(AuditEvent)
      const [events, total] = await repository.findAndCount({
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      })
      const summary = await repository.createQueryBuilder('event')
        .select("COUNT(*) FILTER (WHERE event.action = 'student_registered')", 'registered')
        .addSelect("COUNT(*) FILTER (WHERE event.action = 'student_updated')", 'updated')
        .addSelect("COUNT(*) FILTER (WHERE event.action = 'student_deleted')", 'deleted')
        .addSelect("COALESCE(SUM(CASE WHEN event.action = 'card_downloaded' THEN 1 WHEN event.action = 'bulk_cards_downloaded' THEN COALESCE((event.details->>'count')::int, 0) ELSE 0 END), 0)", 'downloaded')
        .getRawOne()
      const byUser = await repository.createQueryBuilder('event')
        .select('event.actorId', 'userId')
        .addSelect('event.actorName', 'name')
        .addSelect('event.actorEmail', 'email')
        .addSelect("COUNT(*) FILTER (WHERE event.action = 'student_registered')", 'registered')
        .addSelect("COUNT(*) FILTER (WHERE event.action = 'student_updated')", 'updated')
        .addSelect("COUNT(*) FILTER (WHERE event.action = 'student_deleted')", 'deleted')
        .addSelect("COALESCE(SUM(CASE WHEN event.action = 'card_downloaded' THEN 1 WHEN event.action = 'bulk_cards_downloaded' THEN COALESCE((event.details->>'count')::int, 0) ELSE 0 END), 0)", 'downloaded')
        .groupBy('event.actorId').addGroupBy('event.actorName').addGroupBy('event.actorEmail')
        .orderBy('event.actorName', 'ASC')
        .getRawMany()
      const configuredUsers = await AppDataSource.getRepository(AuthUser).find({ order: { displayName: 'ASC' } })
      const activityById = new Map(byUser.map((row) => [row.userId, row]))
      const allUsers = configuredUsers.map((user) => activityById.get(user.id) ?? {
        userId: user.id,
        name: user.displayName,
        email: user.email,
        registered: '0',
        updated: '0',
        deleted: '0',
        downloaded: '0',
      })
      return res.json({ summary, byUser: allUsers, events, total, limit, offset })
    } catch (error) {
      console.error('Failed to load audit log:', error)
      return res.status(500).json({ error: 'Could not load audit log' })
    }
  })

  app.get('/admin/users', requireAdmin, async (_req, res) => {
    const users = await AppDataSource.getRepository(AuthUser).find({ order: { createdAt: 'ASC' } })
    return res.json(users.map(({ id, email, displayName, role, isActive, createdAt }) => ({ id, email, displayName, role, isActive, createdAt })))
  })

  app.post('/admin/users', requireAdmin, async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
      const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : ''
      const password = req.body?.password
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || displayName.length < 2 || displayName.length > 100 || typeof password !== 'string' || password.length < 12 || password.length > 200) {
        return res.status(400).json({ error: 'Provide a valid email, name, and password of at least 12 characters' })
      }
      const users = AppDataSource.getRepository(AuthUser)
      if (await users.findOne({ where: { email } })) return res.status(409).json({ error: 'An account with this email already exists' })
      if (await users.count({ where: { role: 'worker' } }) >= 5) return res.status(409).json({ error: 'The SECGEN account can register up to five workers' })
      const user = await users.save(users.create({ email, displayName, role: 'worker', passwordHash: await hashPassword(password), isActive: true }))
      await recordAudit(AppDataSource.manager, req.actor!, { action: 'worker_account_created', details: { workerId: user.id, email, displayName } })
      return res.status(201).json({ id: user.id, email, displayName, role: user.role, isActive: user.isActive, createdAt: user.createdAt })
    } catch (error) {
      console.error('Worker account creation failed:', error)
      return res.status(500).json({ error: 'Could not create worker account' })
    }
  })

  app.patch('/admin/users/:id/active', requireAdmin, async (req, res) => {
    const users = AppDataSource.getRepository(AuthUser)
    const user = await users.findOne({ where: { id: req.params.id } })
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role !== 'worker') return res.status(403).json({ error: 'Only worker accounts can be deactivated' })
    if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be a boolean' })
    user.isActive = req.body.isActive
    await users.save(user)
    await recordAudit(AppDataSource.manager, req.actor!, { action: user.isActive ? 'worker_account_activated' : 'worker_account_deactivated', details: { workerId: user.id, email: user.email } })
    return res.json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role, isActive: user.isActive, createdAt: user.createdAt })
  })

  const PORT = process.env.PORT ? Number(process.env.PORT) : 4000

  // List all registered routes for debugging
  console.log('\nRegistered routes:')

  app.listen(PORT, () => {
    console.log(`\n✓ API listening on http://localhost:${PORT}`)
    console.log(`\n📚 API Documentation available at http://localhost:${PORT}/api-docs`)
  })
}).catch((err) => {
  console.error('Failed to initialize data source', err)
  process.exit(1)
})
