import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ManageWorkerAccounts1760300000000 implements MigrationInterface {
  name = 'ManageWorkerAccounts1760300000000'
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true')
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE auth_users DROP COLUMN IF EXISTS "isActive"')
  }
}
