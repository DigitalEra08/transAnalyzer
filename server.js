const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
try {
    require('dotenv').config();
} catch (e) {
    const dotenvPath = path.join(__dirname, '.env');
    if (fs.existsSync(dotenvPath)) {
        const envConfig = fs.readFileSync(dotenvPath, 'utf-8');
        envConfig.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const firstEquals = trimmed.indexOf('=');
            if (firstEquals === -1) return;
            const key = trimmed.substring(0, firstEquals).trim();
            let val = trimmed.substring(firstEquals + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.substring(1, val.length - 1);
            }
            if (process.env[key] === undefined) {
                process.env[key] = val;
            }
        });
    }
}

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { uploadBuffer } = require('./utils/cloudinary');

function getRunAnalysis() {
    return require('./scanner').runAnalysis;
}

const IS_VERCEL = String(process.env.VERCEL).toLowerCase() === 'true';
const PORT = parseInt(process.env.PORT, 10) || 5001;
const ROOT = __dirname;

// ──────────────────────────────────────────────
// Multer — memory storage (no disk writes)
// Files stay in RAM as buffers, get uploaded to
// Cloudinary, then passed to the scanner.
// ──────────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 40 * 1024 * 1024, files: 80 },
    fileFilter(req, file, cb) {
        if (file.fieldname === 'transactionImages') {
            const ok = /\.(png|jpe?g)$/i.test(file.originalname);
            if (!ok) {
                return cb(new Error('Transaction images must be PNG or JPEG.'));
            }
            return cb(null, true);
        }
        if (file.fieldname === 'statementPdfs') {
            const ok = /\.pdf$/i.test(file.originalname);
            if (!ok) {
                return cb(new Error('Statement uploads must be PDF.'));
            }
            return cb(null, true);
        }
        cb(new Error('Unexpected field name.'));
    },
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'transactions-analyzer' });
});

app.post(
    '/api/analyze',
    upload.fields([
        { name: 'transactionImages', maxCount: 50 },
        { name: 'statementPdfs', maxCount: 30 },
    ]),
    async (req, res) => {
        try {
            const imageFiles = req.files?.transactionImages || [];
            const pdfFiles = req.files?.statementPdfs || [];

            if (imageFiles.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Add at least one transaction image (PNG or JPEG).',
                });
            }

            // ── Upload images to Cloudinary ──
            console.log(`☁️ Uploading ${imageFiles.length} images to Cloudinary…`);
            const imageUploadResults = await Promise.all(
                imageFiles.map((f) =>
                    uploadBuffer(f.buffer, {
                        folder: 'transanalyzer/images',
                        publicId: `${Date.now()}_${f.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
                        resourceType: 'image',
                    })
                )
            );

            // ── Upload PDFs to Cloudinary ──
            let pdfUploadResults = [];
            if (pdfFiles.length > 0) {
                console.log(`☁️ Uploading ${pdfFiles.length} PDFs to Cloudinary…`);
                pdfUploadResults = await Promise.all(
                    pdfFiles.map((f) =>
                        uploadBuffer(f.buffer, {
                            folder: 'transanalyzer/pdfs',
                            publicId: `${Date.now()}_${f.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
                            resourceType: 'raw',
                        })
                    )
                );
            }

            console.log('✅ Cloudinary uploads complete. Running analysis…');

            // ── Pass in-memory buffers to scanner ──
            // The scanner now works with buffers, no disk paths needed.
            const imageBuffers = imageFiles.map((f, i) => ({
                name: f.originalname,
                buffer: f.buffer,
                cloudinaryUrl: imageUploadResults[i]?.secure_url,
            }));

            const pdfBuffers = pdfFiles.map((f, i) => ({
                name: f.originalname,
                buffer: f.buffer,
                cloudinaryUrl: pdfUploadResults[i]?.secure_url,
            }));

            const rawOut = await getRunAnalysis()({
                imageBuffers,
                pdfBuffers,
            });

            if (rawOut && rawOut.error) {
                return res.status(422).json({
                    success: false,
                    error: rawOut.code || 'Analysis failed',
                    details: rawOut.details,
                });
            }

            const results = Array.isArray(rawOut) ? rawOut : [];

            const hasVerificationShape =
                results.length > 0 && results[0] && 'status' in results[0];

            res.json({
                success: true,
                summary: {
                    transactionImagesUploaded: imageFiles.length,
                    statementPdfsUploaded: pdfFiles.length,
                    resultRows: results.length,
                    mode: hasVerificationShape
                        ? 'verified_against_statements'
                        : 'ocr_only_no_statement_pdfs',
                    cloudinary: {
                        images: imageUploadResults.map((r) => r.secure_url),
                        pdfs: pdfUploadResults.map((r) => r.secure_url),
                    },
                },
                results,
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({
                success: false,
                error: err.message || 'Server error',
            });
        }
    }
);

// ──────────────────────────────────────────────
// Serve frontend build (if present)
// ──────────────────────────────────────────────
const frontendDist = path.join(ROOT, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) {
            return next();
        }
        res.sendFile(path.join(frontendDist, 'index.html'));
    });
}

// ──────────────────────────────────────────────
// Error handler
// ──────────────────────────────────────────────
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, error: err.message });
    }
    if (err) {
        return res.status(400).json({ success: false, error: err.message || 'Bad request' });
    }
    next();
});

module.exports = app;

if (!IS_VERCEL) {
    app.listen(PORT, () => {
        const ui = fs.existsSync(frontendDist);
        console.log(`API listening on http://localhost:${PORT}`);
        if (ui) {
            console.log(`Web UI (production build): http://localhost:${PORT}/`);
        } else {
            console.log('Tip: run npm run build:ui then restart to serve the web UI from this port.');
        }
    });
}
