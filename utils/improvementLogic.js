const fs = require('fs');
const path = require('path');

/**
 * Saves images with low confidence for future retraining
 */
function saveForImprovement(fileName, imageBuffer, extractedData, confidence) {
    // If confidence is below 85%, we save it to review and retrain later
    if (confidence < 85) {
        try {
            const feedbackDir = path.resolve(__dirname, '..', 'training_feedback');
            if (!fs.existsSync(feedbackDir)) fs.mkdirSync(feedbackDir);

            const imgPath = path.join(feedbackDir, `${Date.now()}_${fileName}`);
            fs.writeFileSync(imgPath, imageBuffer);

            const logPath = path.join(feedbackDir, 'corrections.log');
            const entry = `[${new Date().toISOString()}] File: ${fileName} | Conf: ${confidence}% | Data: ${JSON.stringify(extractedData)}\n`;
            fs.appendFileSync(logPath, entry);

            console.log(`⚠️ Low confidence (${confidence}%). Saved to training_feedback for review.`);
        } catch (err) {
            console.warn(`Low confidence (${confidence}%) — feedback not saved: ${err.message}`);
        }
    }
}

module.exports = { saveForImprovement };