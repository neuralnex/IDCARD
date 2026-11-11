import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { Student } from '../entities/Student.js';
export declare class StudentController {
    private studentRepository;
    constructor(studentRepository: Repository<Student>);
    private present;
    getAllStudents(req: Request, res: Response): Promise<void>;
    getStudentById(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    createStudent(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateStudent(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    deleteStudent(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
//# sourceMappingURL=StudentController.d.ts.map