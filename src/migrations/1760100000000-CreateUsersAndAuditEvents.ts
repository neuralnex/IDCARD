import type { MigrationInterface, QueryRunner } from 'typeorm'
import { Table } from 'typeorm'

export class CreateUsersAndAuditEvents1760100000000 implements MigrationInterface {
  name = 'CreateUsersAndAuditEvents1760100000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('auth_users'))) {
      await queryRunner.createTable(new Table({
        name: 'auth_users',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, isGenerated: true, generationStrategy: 'uuid' },
          { name: 'email', type: 'varchar', isUnique: true, isNullable: false },
          { name: 'displayName', type: 'varchar', isNullable: false },
          { name: 'role', type: 'varchar', isNullable: false },
          { name: 'passwordHash', type: 'varchar', isNullable: false },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
        ],
      }))
    }

    if (!(await queryRunner.hasTable('audit_events'))) {
      await queryRunner.createTable(new Table({
        name: 'audit_events',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, isGenerated: true, generationStrategy: 'uuid' },
          { name: 'actorId', type: 'uuid', isNullable: true },
          { name: 'actorEmail', type: 'varchar', isNullable: false },
          { name: 'actorName', type: 'varchar', isNullable: false },
          { name: 'actorRole', type: 'varchar', isNullable: false },
          { name: 'action', type: 'varchar', isNullable: false },
          { name: 'studentId', type: 'uuid', isNullable: true },
          { name: 'studentName', type: 'varchar', isNullable: true },
          { name: 'registrationNumber', type: 'varchar', isNullable: true },
          { name: 'details', type: 'jsonb', isNullable: true },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
        ],
        indices: [
          { name: 'IDX_audit_events_createdAt', columnNames: ['createdAt'] },
          { name: 'IDX_audit_events_actorId', columnNames: ['actorId'] },
          { name: 'IDX_audit_events_action', columnNames: ['action'] },
        ],
      }))
    }

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_audit_event_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Audit events are append-only';
      END;
      $$ LANGUAGE plpgsql;
    `)
    await queryRunner.query('DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events')
    await queryRunner.query(`
      CREATE TRIGGER audit_events_append_only
      BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events')
    await queryRunner.dropTable('audit_events', true)
    await queryRunner.dropTable('auth_users', true)
    await queryRunner.query('DROP FUNCTION IF EXISTS reject_audit_event_mutation()')
  }
}
