import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { createAuthToken } from '../dist/authTokens.js'

const user = { id: 'user-123', email: 'secgen@example.edu', displayName: 'SECGEN', role: 'admin' }
const secret = 'test-only-secret-with-at-least-32-characters'

test('auth tokens persist for the 30-day default', () => {
  const previousExpiry = process.env.JWT_EXPIRES_IN
  delete process.env.JWT_EXPIRES_IN
  try {
    const token = createAuthToken(user, secret)
    const claims = jwt.verify(token, secret)
    assert.equal(claims.sub, user.id)
    assert.ok(claims.exp - claims.iat >= 30 * 24 * 60 * 60 - 1)
    assert.ok(claims.exp - claims.iat <= 30 * 24 * 60 * 60)
  } finally {
    if (previousExpiry === undefined) delete process.env.JWT_EXPIRES_IN
    else process.env.JWT_EXPIRES_IN = previousExpiry
  }
})

test('JWT_EXPIRES_IN can configure a shorter session lifetime', () => {
  const previousExpiry = process.env.JWT_EXPIRES_IN
  process.env.JWT_EXPIRES_IN = '7d'
  try {
    const claims = jwt.verify(createAuthToken(user, secret), secret)
    assert.equal(claims.exp - claims.iat, 7 * 24 * 60 * 60)
  } finally {
    if (previousExpiry === undefined) delete process.env.JWT_EXPIRES_IN
    else process.env.JWT_EXPIRES_IN = previousExpiry
  }
})
