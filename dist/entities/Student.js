var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
let Student = class Student {
};
__decorate([
    PrimaryGeneratedColumn('uuid'),
    __metadata("design:type", String)
], Student.prototype, "id", void 0);
__decorate([
    Column('varchar'),
    __metadata("design:type", String)
], Student.prototype, "firstName", void 0);
__decorate([
    Column('varchar'),
    __metadata("design:type", String)
], Student.prototype, "lastName", void 0);
__decorate([
    Column('varchar', { unique: true }),
    __metadata("design:type", String)
], Student.prototype, "registrationNumber", void 0);
__decorate([
    Column('varchar'),
    __metadata("design:type", String)
], Student.prototype, "department", void 0);
__decorate([
    Column('varchar'),
    __metadata("design:type", String)
], Student.prototype, "faculty", void 0);
__decorate([
    Column('varchar'),
    __metadata("design:type", String)
], Student.prototype, "level", void 0);
__decorate([
    Column('text', { nullable: true }),
    __metadata("design:type", Object)
], Student.prototype, "photoPath", void 0);
__decorate([
    Column('text', { nullable: true }),
    __metadata("design:type", Object)
], Student.prototype, "cardPdfPath", void 0);
__decorate([
    CreateDateColumn(),
    __metadata("design:type", Date)
], Student.prototype, "createdAt", void 0);
__decorate([
    UpdateDateColumn(),
    __metadata("design:type", Date)
], Student.prototype, "updatedAt", void 0);
Student = __decorate([
    Entity('students')
], Student);
export { Student };
//# sourceMappingURL=Student.js.map