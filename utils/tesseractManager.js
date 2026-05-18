const { createWorker } = require('tesseract.js');
const path = require('path');

async function getOCRText(imageBuffer) {
    // Correct v5 syntax:
    // Argument 1: Language ('eng')
    // Argument 2: Worker Index (1)
    // Argument 3: Options object (langPath, etc.)
    const worker = await createWorker('eng', 1, {
        langPath: path.join(__dirname, '..'),
        gzip: false
    });

    // In v5, loadLanguage and initialize are handled automatically by createWorker
    // but you can still set parameters here.
    await worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/-. ',
    });

    const { data: { text, confidence } } = await worker.recognize(imageBuffer);

    await worker.terminate();
    
    return { text, confidence };
}

module.exports = { getOCRText };