import puppeteer, {} from 'puppeteer';
import { jsPDF } from 'jspdf';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pdfRenderPool } from './ConcurrencyPool.js';
import { fileStorage } from './FileStorageService.js';
const htmlEscapes = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
let sharedBrowser;
function getBrowser() {
    if (!sharedBrowser) {
        sharedBrowser = puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            timeout: 60000,
            dumpio: process.env.PUPPETEER_DEBUG === 'true',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        }).then((browser) => {
            browser.once('disconnected', () => { sharedBrowser = undefined; });
            return browser;
        }).catch((error) => {
            sharedBrowser = undefined;
            throw error;
        });
    }
    return sharedBrowser;
}
export class PDFService {
    async generateStudentIDCard(student) {
        return pdfRenderPool.run(() => this.renderStudentIDCard(student));
    }
    async renderStudentIDCard(student) {
        const browser = await getBrowser();
        const page = await browser.newPage();
        try {
            // Set viewport to match card dimensions
            await page.setViewport({ width: 400, height: 640 });
            // Generate front card
            const frontHtml = await this.generateCardHTML(student);
            await page.setContent(frontHtml, { waitUntil: 'load', timeout: 15000 });
            // Take screenshot of the front card
            const frontScreenshot = await page.screenshot({
                type: 'png',
                clip: { x: 0, y: 0, width: 400, height: 640 }
            });
            // Generate back card
            const backHtml = this.generateBackCardHTML();
            await page.setContent(backHtml, { waitUntil: 'load', timeout: 15000 });
            // Take screenshot of the back card
            const backScreenshot = await page.screenshot({
                type: 'png',
                clip: { x: 0, y: 0, width: 400, height: 640 }
            });
            // Create PDF
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [60, 96]
            });
            // Convert screenshots to base64
            const frontImageData = `data:image/png;base64,${Buffer.from(frontScreenshot).toString('base64')}`;
            const backImageData = `data:image/png;base64,${Buffer.from(backScreenshot).toString('base64')}`;
            // Add front image to PDF
            pdf.addImage(frontImageData, 'PNG', 0, 0, 60, 96);
            // Add back page
            pdf.addPage();
            pdf.addImage(backImageData, 'PNG', 0, 0, 60, 96);
            return Buffer.from(pdf.output('arraybuffer'));
        }
        finally {
            await page.close().catch(() => undefined);
        }
    }
    async generateCardHTML(student) {
        const logoPath = join(dirname(fileURLToPath(import.meta.url)), '../assets/aluta-mandate-logos.png');
        const logos = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`;
        const fullName = escapeHtml(`${student.firstName} ${student.lastName}`.trim().toUpperCase());
        let photoUrl = null;
        if (student.photoPath?.startsWith('data:image/')) {
            photoUrl = student.photoPath;
        }
        else if (student.photoPath) {
            try {
                photoUrl = `data:image/jpeg;base64,${(await fileStorage.readPhoto(student.photoPath)).toString('base64')}`;
            }
            catch {
                // A missing legacy photo should not prevent the card from rendering.
            }
        }
        const photo = photoUrl
            ? `<img class="photo" src="${escapeHtml(photoUrl)}" alt="${fullName}" />`
            : '<div class="photo photo-placeholder"></div>';
        return `<!doctype html>
      <html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        @page { size: 400px 640px; margin: 0; }
        html, body { width: 400px; height: 640px; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; }
        .card { position: relative; width: 400px; height: 640px; overflow: hidden; background: #fff; }
        .shape { position: absolute; inset: 0; width: 100%; height: 100%; }
        .heading { position: absolute; z-index: 1; top: 5%; left: 7%; width: 86%; color: #090909; text-align: center; font-size: 8px; font-weight: 800; line-height: 1.12; }
        .heading img { display: block; width: 26%; height: auto; margin: 0 auto; }
        .rule { height: 1.5px; margin: 0 0 5px; background: #111; }
        .heading p { margin: 0; }
        .short-rule { width: 67%; margin: 6px auto 0; }
        .title { position: absolute; z-index: 1; top: 18.5%; left: 2%; width: 96%; margin: 0; color: #080808; text-align: center; font-size: 19px; font-weight: 900; letter-spacing: -0.045em; line-height: 1; }
        .photo-frame { position: absolute; z-index: 2; top: 23.4%; left: 23.5%; width: 53%; height: 28.5%; overflow: hidden; border: 5px solid #fff; border-radius: 22px; background: #60300f; }
        .photo { display: block; width: 100%; height: 100%; object-fit: cover; }
        .details { position: absolute; z-index: 2; top: 54.5%; left: 13%; width: 68%; height: 43%; display: flex; flex-direction: column; justify-content: space-between; gap: 5px; color: #fff; }
        .field { position: relative; flex: 0 0 auto; min-width: 0; width: 100%; border-bottom: 1px solid rgba(255,255,255,.9); color: #fff; }
        .label { display: table; margin-bottom: 6px; padding-bottom: 2px; border-bottom: 1px solid #fff; font-size: 10px; font-weight: 700; line-height: 1; }
        .value { display: block; overflow-wrap: break-word; word-break: normal; font-size: 21px; font-weight: 900; line-height: 1.02; text-transform: uppercase; }
        .name .value { font-size: 26px; }
        .registration .value { font-size: 23px; }
        .department .value { font-size: 20px; }
        .faculty { border: 0; } .faculty .value { font-size: 16px; }
      </style></head><body>
        <main class="card">
          <svg class="shape" viewBox="0 0 400 640" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="aluta-brown" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#371805" /><stop offset="100%" stop-color="#291000" /></linearGradient></defs>
            <path d="M0 316 C164 316 251 329 316 303 C357 287 383 267 400 246 L400 640 L0 640 Z" fill="url(#aluta-brown)" />
            <path d="M0 316 C164 316 251 329 316 303 C357 287 383 267 400 246" fill="none" stroke="#6d5745" stroke-width="2" />
          </svg>
          <header class="heading">
            <img src="${logos}" alt="FUTO, Aluta Continuity, and Aluta Mandate logos" />
            <div class="rule"></div>
            <p>FEDERAL UNIVERSITY OF TECHNOLOGY, OWERRI</p>
            <p>STUDENTS’ UNION GOVERNMENT (SUG)</p>
            <p>ALUTA MANDATE EXECUTIVES</p>
            <div class="rule short-rule"></div>
          </header>
          <h1 class="title">STUDENT IDENTITY CARD</h1>
          <div class="photo-frame">${photo}</div>
          <section class="details">
            <div class="field name"><span class="label">STUDENT’S NAME:</span><strong class="value">${fullName}</strong></div>
            <div class="field registration"><span class="label">STUDENT’S REG NO:</span><strong class="value">${escapeHtml(student.registrationNumber)}</strong></div>
            <div class="field department"><span class="label">STUDENT’S DEPARTMENT:</span><strong class="value">${escapeHtml(student.department.toUpperCase())}</strong></div>
            <div class="field faculty"><span class="label">STUDENT’S SCHOOL/FACULTY:</span><strong class="value">${escapeHtml(student.faculty.toUpperCase())}</strong></div>
          </section>
        </main>
      </body></html>`;
    }
    generateBackCardHTML() {
        const backPath = join(dirname(fileURLToPath(import.meta.url)), '../assets/id-card-back.jpeg');
        const backImage = `data:image/jpeg;base64,${readFileSync(backPath).toString('base64')}`;
        return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Student ID Card Back</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: Arial, sans-serif;
            background: white;
            width: 400px;
            height: 640px;
            margin: 0;
            padding: 0;
          }
          .card {
            width: 400px;
            height: 640px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            overflow: hidden;
            position: relative;
          }
          .back-image {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <img 
            src="${backImage}"
            alt="ID Card Back" 
            class="back-image"
          />
        </div>
      </body>
      </html>
    `;
    }
}
//# sourceMappingURL=PDFService.js.map