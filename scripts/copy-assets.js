import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist/assets', { recursive: true })
cpSync('src/assets', 'dist/assets', { recursive: true })
