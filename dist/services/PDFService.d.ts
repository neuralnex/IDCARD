import type { Student } from '../entities/Student.js';
export declare class PDFService {
    generateStudentIDCard(student: Student): Promise<Buffer>;
    private renderStudentIDCard;
    private generateCardHTML;
    private generateBackCardHTML;
}
//# sourceMappingURL=PDFService.d.ts.map