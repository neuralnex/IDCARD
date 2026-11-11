import type { Request, Response } from 'express';
import type { Repository } from 'typeorm';
import { AuthUser } from '../entities/AuthUser.js';
export declare class AuthController {
    private userRepository;
    constructor(userRepository: Repository<AuthUser>);
    private verifyPassword;
    login(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
//# sourceMappingURL=AuthController.d.ts.map