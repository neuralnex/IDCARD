import { z } from 'zod';
const photoValue = z.string().max(7000000).refine((value) => /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value), 'Photo must be a JPEG data URL');
export const createStudentSchema = z.object({
    firstName: z.string().trim().min(1, 'First name is required').max(100),
    lastName: z.string().trim().min(1, 'Last name is required').max(100),
    registrationNumber: z.string().regex(/^\d{11}$/, 'Registration number must be exactly 11 digits'),
    department: z.string().trim().min(1, 'Department is required').max(150),
    faculty: z.string().trim().min(1, 'Faculty is required').max(150),
    level: z.string().trim().min(1, 'Level is required').max(20),
    photoUrl: photoValue.optional(),
});
export const updateStudentSchema = z.object({
    firstName: z.string().trim().min(1, 'First name is required').max(100).optional(),
    lastName: z.string().trim().min(1, 'Last name is required').max(100).optional(),
    registrationNumber: z.string().regex(/^\d{11}$/, 'Registration number must be exactly 11 digits').optional(),
    department: z.string().trim().min(1, 'Department is required').max(150).optional(),
    faculty: z.string().trim().min(1, 'Faculty is required').max(150).optional(),
    level: z.string().trim().min(1, 'Level is required').max(20).optional(),
    photoUrl: z.union([
        photoValue,
        z.null(),
    ]).optional(),
});
export const loginSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
});
//# sourceMappingURL=schemas.js.map