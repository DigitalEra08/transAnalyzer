const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { runAnalysis } = require('./scanner');

const PORT = process.env.PORT || 5001;
const ROOT = __dirname;
const IMG_DIR = path.join(ROOT, 'assets', 'images');
const PDF_DIR = path.join(ROOT, 'assets', 'pdfs');
const UPLOADS_ROOT = path.join(ROOT, 'assets', 'uploads');

function ensureAssetDirs() {
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.mkdirSync(PDF_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
}

/**
 * Windows often returns EBUSY when deleting files still held by Sharp/antivirus
 * or when two requests overlap. Per-job dirs avoid deleting in-use files; this
 * handles leftover cleanup with backoff.
 */
async function rmWithRetry(dir, attempts = 12, baseDelayMs = 80) {
    for (let i = 0; i < attempts; i++) {
        try {
            await fs.promises.rm(dir, { recursive: true, force: true });
            return;
        } catch (err) {
            if (err.code === 'ENOENT') return;
            const retryable = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'ENOTEMPTY';
            if (retryable && i < attempts - 1) {
                await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
                continue;
            }
            throw err;
        }
    }
}

function emptyDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        fs.unlinkSync(path.join(dir, name));
    }
}

function attachJobUploadDirs(req, res, next) {
    try {
        const jobId = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
        const jobRoot = path.join(UPLOADS_ROOT, jobId);
        req.jobRoot = jobRoot;
        req.jobImgDir = path.join(jobRoot, 'images');
        req.jobPdfDir = path.join(jobRoot, 'pdfs');
        fs.mkdirSync(req.jobImgDir, { recursive: true });
        fs.mkdirSync(req.jobPdfDir, { recursive: true });
        next();
    } catch (e) {
        next(e);
    }
}

const storage = multer.diskStorage({
    destination(req, file, cb) {
        if (!req.jobImgDir || !req.jobPdfDir) {
            return cb(new Error('Upload job directories not initialized.'));
        }
        if (file.fieldname === 'statementPdfs') {
            cb(null, req.jobPdfDir);
        } else {
            cb(null, req.jobImgDir);
        }
    },
    filename(req, file, cb) {
        const base = path.basename(file.originalname).replace(/[^\w.\-()+ ]/g, '_');
        cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${base}`);
    },
});

const upload = multer({
    storage,
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
    (req, res, next) => {
        try {
            ensureAssetDirs();
            next();
        } catch (e) {
            next(e);
        }
    },
    attachJobUploadDirs,
    upload.fields([
        { name: 'transactionImages', maxCount: 50 },
        { name: 'statementPdfs', maxCount: 30 },
    ]),
    async (req, res) => {
        const jobRoot = req.jobRoot;
        if (jobRoot) {
            res.on('finish', () => {
                setImmediate(() => {
                    rmWithRetry(jobRoot).catch((e) =>
                        console.warn(`Upload job cleanup (${jobRoot}): ${e.message}`)
                    );
                });
            });
        }
        try {
            const imageFiles = req.files?.transactionImages || [];
            const pdfFiles = req.files?.statementPdfs || [];

            if (imageFiles.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Add at least one transaction image (PNG or JPEG).',
                });
            }

            const rawOut = await runAnalysis({
                imageDir: req.jobImgDir,
                pdfDir: req.jobPdfDir,
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

/** Clear inputs before a new batch (optional query ?clear=1 from dev tools). */
app.post('/api/reset-assets', (req, res) => {
    ensureAssetDirs();
    emptyDir(IMG_DIR);
    emptyDir(PDF_DIR);
    res.json({ ok: true });
});

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

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, error: err.message });
    }
    if (err) {
        return res.status(400).json({ success: false, error: err.message || 'Bad request' });
    }
    next();
});

ensureAssetDirs();
app.listen(PORT, () => {
    const ui = fs.existsSync(frontendDist);
    console.log(`API listening on http://localhost:${PORT}`);
    if (ui) {
        console.log(`Web UI (production build): http://localhost:${PORT}/`);
    } else {
        console.log('Tip: run npm run build:ui then restart to serve the web UI from this port.');
    }
});
