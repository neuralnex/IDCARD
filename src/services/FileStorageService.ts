import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const root = resolve(process.env.STORAGE_DIR || './storage')
const studentsDir = join(root, 'students')
const cardsDir = join(root, 'cards')

function decodeJpegDataUrl(value: string): Buffer {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) throw new Error('Photo must be a JPEG data URL')
  const data = Buffer.from(match[1], 'base64')
  if (!data.length || data.length > 5 * 1024 * 1024) throw new Error('Photo must be smaller than 5 MB')
  if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error('Uploaded photo is not a valid JPEG image')
  return data
}

export class FileStorageService {
  async savePhoto(dataUrl: string): Promise<string> {
    await mkdir(studentsDir, { recursive: true })
    const path = join(studentsDir, `${randomUUID()}.jpg`)
    await writeFile(path, decodeJpegDataUrl(dataUrl), { flag: 'wx' })
    return path
  }

  async readPhoto(path: string): Promise<Buffer> {
    return readFile(this.safePath(path, studentsDir))
  }

  async saveCardPdf(studentId: string, pdf: Buffer): Promise<string> {
    await mkdir(cardsDir, { recursive: true })
    const path = join(cardsDir, `${studentId}-${randomUUID()}.pdf`)
    await writeFile(path, pdf, { flag: 'wx' })
    return path
  }

  async readCardPdf(path: string): Promise<Buffer> {
    return readFile(this.safePath(path, cardsDir))
  }

  async remove(path: string | null | undefined): Promise<void> {
    if (!path) return
    try {
      await rm(this.safePath(path), { force: true })
    } catch (error) {
      // Legacy rows may point to external URLs or paths from an old container.
      // They are outside managed storage, so leave them alone during cleanup.
      if (!(error instanceof Error && error.message === 'Invalid stored file path')) throw error
    }
  }

  private safePath(path: string, expectedDirectory?: string): string {
    const normalized = resolve(path)
    const parent = resolve(expectedDirectory || root)
    if (normalized !== parent && !normalized.startsWith(`${parent}/`) && !normalized.startsWith(`${parent}\\`)) {
      throw new Error('Invalid stored file path')
    }
    return normalized
  }
}

export const fileStorage = new FileStorageService()
