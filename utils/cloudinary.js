const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

// Load environment variables if not already loaded (e.g. when run outside of server.js)
if (!process.env.CLOUDINARY_CLOUD_NAME) {
    try {
        require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    } catch (e) {
        const dotenvPath = path.join(__dirname, '..', '.env');
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
}

// Configure from environment variables
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a buffer (image or PDF) to Cloudinary.
 *
 * @param {Buffer} buffer       — File contents
 * @param {object} options
 * @param {string} options.folder          — Cloudinary folder, e.g. "uploads/images"
 * @param {string} options.publicId        — Optional public ID
 * @param {'image'|'raw'|'auto'} options.resourceType — "image" for images, "raw" for PDFs
 * @returns {Promise<object>} Cloudinary upload result
 */
function uploadBuffer(buffer, { folder = 'uploads', publicId, resourceType = 'auto' } = {}) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                public_id: publicId,
                resource_type: resourceType,
                overwrite: true,
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(buffer);
    });
}

/**
 * Upload a local file path to Cloudinary.
 *
 * @param {string} filePath     — Absolute path on disk
 * @param {object} options
 * @param {string} options.folder          — Cloudinary folder
 * @param {string} options.publicId        — Optional public ID
 * @param {'image'|'raw'|'auto'} options.resourceType
 * @returns {Promise<object>} Cloudinary upload result
 */
function uploadFile(filePath, { folder = 'uploads', publicId, resourceType = 'auto' } = {}) {
    return cloudinary.uploader.upload(filePath, {
        folder,
        public_id: publicId,
        resource_type: resourceType,
        overwrite: true,
    });
}

/**
 * Delete a Cloudinary asset by its public ID.
 *
 * @param {string} publicId
 * @param {'image'|'raw'} resourceType
 */
function deleteAsset(publicId, resourceType = 'image') {
    return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

module.exports = {
    cloudinary,
    uploadBuffer,
    uploadFile,
    deleteAsset,
};
