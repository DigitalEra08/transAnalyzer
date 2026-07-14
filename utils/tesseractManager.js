const { createWorker } = require('tesseract.js');
const path = require('path');

async function getOCRText(imageBuffer) {
    const worker = await createWorker('eng', 1, {
        langPath: path.join(__dirname, '..'),
        gzip: false
    });

    try {
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/-. ',
        });

        const { data: { text, confidence } } = await worker.recognize(imageBuffer);
        return { text, confidence };
    } finally {
        await worker.terminate();
    }
}

module.exports = { getOCRText };