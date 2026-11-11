import swaggerJsdoc from 'swagger-jsdoc'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Student ID Card API',
    version: '1.0.0',
    description: 'API documentation for Student ID Card Management System',
    contact: {
      name: 'API Support',
    },
  },
  servers: [
    {
      url: process.env.API_URL || process.env.SPACE_URL || 'http://localhost:7860',
      description: 'API Server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token obtained from /auth/login',
      },
    },
    schemas: {
      Student: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique student identifier',
          },
          firstName: {
            type: 'string',
            description: 'Student first name',
          },
          lastName: {
            type: 'string',
            description: 'Student last name',
          },
          registrationNumber: {
            type: 'string',
            pattern: '^[A-Za-z0-9]+$',
            description: 'Registration number containing letters and numbers',
            example: 'AB2026XYZ',
          },
          department: {
            type: 'string',
            description: 'Student department',
          },
          faculty: {
            type: 'string',
            description: 'Student faculty',
          },
          level: {
            type: 'string',
            description: 'Student level',
          },
          photoUrl: {
            type: 'string',
            format: 'uri',
            nullable: true,
            description: 'URL to student photo',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Creation timestamp',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Last update timestamp',
          },
        },
        required: ['id', 'firstName', 'lastName', 'registrationNumber', 'department', 'faculty', 'level'],
      },
      CreateStudentInput: {
        type: 'object',
        properties: {
          firstName: {
            type: 'string',
            minLength: 1,
            description: 'Student first name',
            example: 'John',
          },
          lastName: {
            type: 'string',
            minLength: 1,
            description: 'Student last name',
            example: 'Doe',
          },
          registrationNumber: {
            type: 'string',
            pattern: '^[A-Za-z0-9]+$',
            description: 'Registration number containing letters and numbers',
            example: 'AB2026XYZ',
          },
          department: {
            type: 'string',
            minLength: 1,
            description: 'Student department',
            example: 'Computer Science',
          },
          faculty: {
            type: 'string',
            minLength: 1,
            description: 'Student faculty',
            example: 'School of Computing',
          },
          level: {
            type: 'string',
            minLength: 1,
            description: 'Student level',
            example: '400',
          },
          photoUrl: {
            type: 'string',
            format: 'uri',
            description: 'JPEG photo as a base64 data URL (optional)',
            example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...',
          },
        },
        required: ['firstName', 'lastName', 'registrationNumber', 'department', 'faculty', 'level'],
      },
      LoginInput: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'Admin email address',
            example: 'admin@futo.edu.ng',
          },
          password: {
            type: 'string',
            minLength: 1,
            description: 'Admin password',
            example: 'password123',
          },
        },
        required: ['email', 'password'],
      },
      LoginResponse: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            example: 'Login successful',
          },
          token: {
            type: 'string',
            description: 'JWT authentication token',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          },
          user: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                example: 'admin@futo.edu.ng',
              },
              role: {
                type: 'string',
                example: 'admin',
              },
            },
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            description: 'Error message',
          },
          details: {
            type: 'array',
            items: {
              type: 'object',
            },
            description: 'Additional error details (for validation errors)',
          },
        },
      },
      HealthCheck: {
        type: 'object',
        properties: {
          ok: {
            type: 'boolean',
            example: true,
          },
        },
      },
    },
  },
  tags: [
    {
      name: 'Authentication',
      description: 'Authentication endpoints',
    },
    {
      name: 'Students',
      description: 'Student management endpoints',
    },
    {
      name: 'Downloads',
      description: 'PDF download endpoints',
    },
    {
      name: 'Testing',
      description: 'Test endpoints for development',
    },
    {
      name: 'Health',
      description: 'Health check endpoints',
    },
    {
      name: 'Documentation',
      description: 'API documentation endpoints',
    },
  ],
}

// Get the project root directory (where src/ is located)
// __dirname will be dist/config when running compiled code
const projectRoot = join(__dirname, '../..')
const srcDir = join(projectRoot, 'src')
const distDir = join(projectRoot, 'dist')
const cwd = process.cwd()

// Try to find files - check multiple locations
import { existsSync } from 'fs'

const apiPaths: string[] = []

// Priority 1: Check dist directory (production/runtime)
if (existsSync(join(distDir, 'index.js'))) {
  apiPaths.push(join(distDir, 'index.js'))
  apiPaths.push(join(distDir, 'controllers/*.js'))
}

// Priority 2: Check src directory (development)
if (existsSync(join(srcDir, 'index.ts'))) {
  apiPaths.push(join(srcDir, 'index.ts'))
  apiPaths.push(join(srcDir, 'controllers/*.ts'))
}

// Priority 3: Check from current working directory
if (existsSync(join(cwd, 'dist', 'index.js'))) {
  apiPaths.push(join(cwd, 'dist', 'index.js'))
  apiPaths.push(join(cwd, 'dist', 'controllers/*.js'))
}
if (existsSync(join(cwd, 'src', 'index.ts'))) {
  apiPaths.push(join(cwd, 'src', 'index.ts'))
  apiPaths.push(join(cwd, 'src', 'controllers/*.ts'))
}

// Priority 4: Fallback to relative paths
if (apiPaths.length === 0) {
  apiPaths.push('./dist/index.js', './dist/controllers/*.js')
  apiPaths.push('./src/index.ts', './src/controllers/*.ts')
}

const options = {
  definition: swaggerDefinition,
  apis: apiPaths,
}

// Generate swagger spec
const swaggerSpec = swaggerJsdoc(options) as any

// Debug: Log paths and route count
console.log('Swagger API file paths:', options.apis)
console.log('Swagger routes found:', Object.keys((swaggerSpec.paths || {}) as Record<string, unknown>).length, 'paths')
if (Object.keys((swaggerSpec.paths || {}) as Record<string, unknown>).length === 0) {
  console.warn('⚠️  WARNING: No routes found in Swagger spec! Check that JSDoc comments are present in the files.')
}

export { swaggerSpec }

