import type { MigrationInterface, QueryRunner } from 'typeorm'
import { Table } from 'typeorm'

export class CreateStudents1760000000000 implements MigrationInterface {
  name = 'CreateStudents1760000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    // Existing installs already have this table from synchronize; treat them as
    // the baseline and record this migration without replacing their data.
    if (await queryRunner.hasTable('students')) return

    await queryRunner.createTable(new Table({
      name: 'students',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, isGenerated: true, generationStrategy: 'uuid' },
        { name: 'firstName', type: 'varchar', isNullable: false },
        { name: 'lastName', type: 'varchar', isNullable: false },
        { name: 'registrationNumber', type: 'varchar', isUnique: true, isNullable: false },
        { name: 'department', type: 'varchar', isNullable: false },
        { name: 'faculty', type: 'varchar', isNullable: false },
        { name: 'level', type: 'varchar', isNullable: false },
        { name: 'photoUrl', type: 'text', isNullable: true },
        { name: 'createdAt', type: 'timestamptz', default: 'now()' },
        { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
      ],
    }))
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // This migration also baselines existing databases; dropping here could
    // erase a table whose data predates migration tracking.
  }
}
