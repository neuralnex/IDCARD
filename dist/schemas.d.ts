import { z } from 'zod';
export declare const createStudentSchema: z.ZodObject<{
    firstName: z.ZodString;
    lastName: z.ZodString;
    registrationNumber: z.ZodString;
    department: z.ZodString;
    faculty: z.ZodString;
    level: z.ZodString;
    photoUrl: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const updateStudentSchema: z.ZodObject<{
    firstName: z.ZodOptional<z.ZodString>;
    lastName: z.ZodOptional<z.ZodString>;
    registrationNumber: z.ZodOptional<z.ZodString>;
    department: z.ZodOptional<z.ZodString>;
    faculty: z.ZodOptional<z.ZodString>;
    level: z.ZodOptional<z.ZodString>;
    photoUrl: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
}, z.core.$strip>;
export declare const loginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
//# sourceMappingURL=schemas.d.ts.map