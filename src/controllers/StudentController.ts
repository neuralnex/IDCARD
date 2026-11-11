import type { Request, Response } from 'express'
import { Repository } from 'typeorm'
import { Student } from '../entities/Student.js'
import { createStudentSchema, updateStudentSchema } from '../schemas.js'
import { ZodError } from 'zod'
import { AppDataSource } from '../database.js'
import { recordAudit } from '../services/AuditService.js'
import { fileStorage } from '../services/FileStorageService.js'
import { enqueueRegistration } from '../services/JobQueue.js'

export class StudentController {
  constructor(private studentRepository: Repository<Student>) {}

  private async present(student: Student) {
    let photoUrl = student.photoPath
    if (photoUrl && !photoUrl.startsWith('data:image/')) {
      try {
        photoUrl = `data:image/jpeg;base64,${(await fileStorage.readPhoto(photoUrl)).toString('base64')}`
      } catch (error) {
        // Older database rows can contain external URLs or file paths from the
        // previous ephemeral container. Keep the student record readable when
        // that legacy photo is no longer available in managed storage.
        if (!(error instanceof Error && (error.message === 'Invalid stored file path' || 'code' in error && error.code === 'ENOENT'))) {
          throw error
        }
        photoUrl = null
      }
    }
    return { ...student, photoUrl, hasPhoto: Boolean(student.photoPath), photoPath: undefined, cardPdfPath: undefined }
  }

  async getAllStudents(req: Request, res: Response) {
    try {
      const students = await this.studentRepository.find({
        order: { createdAt: 'DESC' }
      })
      res.json(students.map((student) => ({
        ...student,
        photoUrl: null,
        hasPhoto: Boolean(student.photoPath),
        photoPath: undefined,
        cardPdfPath: undefined,
      })))
    } catch (error) {
      console.error('Error fetching students:', error)
      res.status(500).json({ error: 'Failed to fetch students' })
    }
  }

  async getStudentPhoto(req: Request, res: Response) {
    try {
      const student = await this.studentRepository.findOne({ where: { id: req.params.id } })
      if (!student?.photoPath) return res.status(404).json({ error: 'Student photo not found' })
      const photo = student.photoPath.startsWith('data:image/')
        ? Buffer.from(student.photoPath.slice(student.photoPath.indexOf(',') + 1), 'base64')
        : await fileStorage.readPhoto(student.photoPath)
      res.setHeader('Cache-Control', 'private, max-age=300')
      res.type('image/jpeg').send(photo)
    } catch (error) {
      console.error('Error fetching student photo:', error)
      res.status(500).json({ error: 'Failed to fetch student photo' })
    }
  }

  async getStudentById(req: Request, res: Response) {
    try {
      const student = await this.studentRepository.findOne({ where: { id: req.params.id } })
      if (!student) return res.status(404).json({ error: 'Student not found' })
      return res.json(await this.present(student))
    } catch (error) {
      console.error('Error fetching student:', error)
      return res.status(500).json({ error: 'Failed to fetch student' })
    }
  }

  async createStudent(req: Request, res: Response) {
    try {
      createStudentSchema.parse(req.body)
      const jobId = await enqueueRegistration(req.body, req.actor!)
      res.status(202).json({ jobId, message: 'Registration queued' })
    } catch (error) {
      if (error instanceof ZodError) {
        // Return the structured Zod issues array to help the client debug
        return res.status(400).json({ error: 'Validation failed', details: error.issues })
      }

      if (error instanceof Error && error.name === 'ZodError') {
        // Fallback for other forms of Zod error
        return res.status(400).json({ error: 'Validation failed', details: error.message })
      }

      console.error('Error creating student:', error)
      return res.status(503).json({ error: 'Registration queue is unavailable. Please try again shortly.' })
    }
  }

  async updateStudent(req: Request, res: Response) {
    try {
      const { id } = req.params
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid student id' })
      }

      const validatedData = updateStudentSchema.parse(req.body)
      
      // Check if student exists
      const existingStudent = await this.studentRepository.findOne({
        where: { id }
      })
      
      if (!existingStudent) {
        return res.status(404).json({ error: 'Student not found' })
      }

      // If registration number is being updated, check for duplicates
      if (validatedData.registrationNumber && validatedData.registrationNumber !== existingStudent.registrationNumber) {
        const duplicateStudent = await this.studentRepository.findOne({
          where: { registrationNumber: validatedData.registrationNumber }
        })
        
        if (duplicateStudent) {
          return res.status(400).json({ 
            error: 'A student with this registration number already exists' 
          })
        }
      }

      // Update student fields (filter out undefined values to ensure only provided fields are updated)
      const { photoUrl, ...studentFields } = validatedData
      const updateData = Object.fromEntries(
        Object.entries(studentFields).filter(([_, value]) => value !== undefined)
      )
      let oldPhotoPath: string | null = null
      if (photoUrl !== undefined) {
        oldPhotoPath = existingStudent.photoPath
        existingStudent.photoPath = photoUrl === null ? null : await fileStorage.savePhoto(photoUrl)
      }
      const oldPdfPath = existingStudent.cardPdfPath
      existingStudent.cardPdfPath = null
      Object.assign(existingStudent, updateData)
      const updatedStudent = await AppDataSource.transaction(async (manager) => {
        const saved = await manager.getRepository(Student).save(existingStudent)
        await recordAudit(manager, req.actor!, {
          action: 'student_updated',
          studentId: saved.id,
          studentName: `${saved.firstName} ${saved.lastName}`,
          registrationNumber: saved.registrationNumber,
          details: { changedFields: Object.keys(updateData).filter((field) => field !== 'photoUrl') },
        })
        return saved
      })
      if (oldPhotoPath && !oldPhotoPath.startsWith('data:image/')) await fileStorage.remove(oldPhotoPath)
      if (oldPdfPath) await fileStorage.remove(oldPdfPath)
      res.json(await this.present(updatedStudent))
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues })
      }

      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: error.message })
      }

      console.error('Error updating student:', error)
      res.status(500).json({ error: 'Failed to update student' })
    }
  }

  async deleteStudent(req: Request, res: Response) {
    try {
      const { id } = req.params
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid student id' })
      }
      
      const removed = await AppDataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Student)
        const student = await repository.findOne({ where: { id } })
        if (!student) return null
        await recordAudit(manager, req.actor!, {
          action: 'student_deleted',
          studentId: student.id,
          studentName: `${student.firstName} ${student.lastName}`,
          registrationNumber: student.registrationNumber,
        })
        await repository.remove(student)
        return student
      })
      if (!removed) return res.status(404).json({ error: 'Student not found' })
      await Promise.all([
        removed.photoPath?.startsWith('data:image/') ? Promise.resolve() : fileStorage.remove(removed.photoPath),
        fileStorage.remove(removed.cardPdfPath),
      ])
      
      res.json({ message: 'Student deleted successfully' })
    } catch (error) {
      console.error('Error deleting student:', error)
      res.status(500).json({ error: 'Failed to delete student' })
    }
  }
}
