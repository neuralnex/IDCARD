import test from 'node:test'
import assert from 'node:assert/strict'
import { ConcurrencyPool, PoolOverloadedError } from '../dist/services/ConcurrencyPool.js'

test('pool bounds active work, queues up to its limit, and rejects overflow', async () => {
  const pool = new ConcurrencyPool(1, 1)
  let releaseFirst
  const first = pool.run(() => new Promise((resolve) => { releaseFirst = resolve }))
  const order = []
  const second = pool.run(() => { order.push('second'); return 'done' })

  assert.equal(pool.activeCount, 1)
  assert.equal(pool.queuedCount, 1)
  await assert.rejects(pool.run(() => 'overflow'), PoolOverloadedError)

  releaseFirst('first')
  assert.equal(await first, 'first')
  assert.equal(await second, 'done')
  assert.deepEqual(order, ['second'])
  assert.equal(pool.activeCount, 0)
  assert.equal(pool.queuedCount, 0)
})

test('pool releases its slot when an operation fails', async () => {
  const pool = new ConcurrencyPool(1, 0)
  await assert.rejects(pool.run(() => { throw new Error('operation failed') }), /operation failed/)
  assert.equal(pool.activeCount, 0)
  assert.equal(await pool.run(() => 'available'), 'available')
})
