/**
 * Генерация PDF-документов для инвесторов.
 * Запуск: node docs/generate-investor-pdf.mjs [overview|memo|presentation]
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const variants = {
    overview: {
        html: path.join(__dirname, 'ODANT-investor-overview.html'),
        pdf: path.join(__dirname, 'ODANT-investor-overview.pdf'),
    },
    memo: {
        html: path.join(__dirname, 'ODANT-investment-memorandum.html'),
        pdf: path.join(__dirname, 'ODANT-investment-memorandum.pdf'),
    },
    presentation: {
        html: path.join(__dirname, 'ODANT-investor-presentation.html'),
        pdf: path.join(__dirname, 'ODANT-investor-presentation.pdf'),
    },
};

const key = process.argv[2] || 'overview';
const { html: htmlPath, pdf: pdfPath } = variants[key] || variants.overview;

if (!fs.existsSync(htmlPath)) {
    console.error('HTML not found:', htmlPath);
    process.exit(1);
}

const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

let puppeteer;
try {
    puppeteer = await import('puppeteer');
} catch {
    const { execSync } = await import('node:child_process');
    execSync('npm install puppeteer --no-save', { stdio: 'inherit', cwd: root });
    puppeteer = await import('puppeteer');
}

const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
    const page = await browser.newPage();
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        preferCSSPageSize: true,
    });
    console.log('PDF saved:', pdfPath);
} finally {
    await browser.close();
}
