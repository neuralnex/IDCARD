import type { MigrationInterface, QueryRunner } from 'typeorm'

export class StoreStudentFiles1760200000000 implements MigrationInterface {
  name = 'StoreStudentFiles1760200000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE students RENAME COLUMN "photoUrl" TO "photoPath"')
    await queryRunner.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS "cardPdfPath" text')
    // Earlier versions stored JPEG data URLs in PostgreSQL. Keep the database migration
    // lossless; FileStorageService migrates those values to disk on the next student update.
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE students DROP COLUMN IF EXISTS "cardPdfPath"')
    await queryRunner.query('ALTER TABLE students RENAME COLUMN "photoPath" TO "photoUrl"')
  }
}
