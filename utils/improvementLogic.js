const { uploadBuffer } = require('./cloudinary');

/**
 * Saves low-confidence images to Cloudinary for future retraining review.
 * Replaces the old local-disk approach that bloated the project with hundreds of JPEGs.
 */
async function saveForImprovement(fileName, imageBuffer, extractedData, confidence) {
    // If confidence is below 85%, upload to Cloudinary for review
    if (confidence < 85) {
        try {
            const publicId = `${Date.now()}_${fileName.replace(/\.[^.]+$/, '')}`;

            await uploadBuffer(imageBuffer, {
                folder: 'transanalyzer/training_feedback',
                publicId,
                resourceType: 'image',
            });

            console.log(`⚠️ Low confidence (${confidence}%). Uploaded to Cloudinary training_feedback for review.`);
        } catch (err) {
            console.warn(`Low confidence (${confidence}%) — feedback upload failed: ${err.message}`);
        }
    }
}

module.exports = { saveForImprovement };