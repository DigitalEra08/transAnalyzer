const sharp = require('sharp');
const pdf = require('pdf-parse');
const { getOCRText } = require('./utils/tesseractManager');
const { saveForImprovement } = require('./utils/improvementLogic');

/**
 * Main analysis runner.
 *
 * Accepts pre-loaded file buffers instead of reading from disk directories.
 * This is Cloudinary/Vercel-friendly — no local asset directories needed.
 *
 * @param {object} options
 * @param {{ name: string, buffer: Buffer }[]} options.imageBuffers — Image file buffers with filenames
 * @param {{ name: string, buffer: Buffer }[]} options.pdfBuffers   — PDF file buffers with filenames
 * @returns {Promise<object[]|object>}
 */
async function runAnalysis(options = {}) {
    const imageBuffers = options.imageBuffers || [];
    const pdfBuffers = options.pdfBuffers || [];

    console.log("=== Starting Financial Document Analyzer ===");
    const extractedDataStore = [];

    console.log(`🚀 Received ${imageBuffers.length} images and ${pdfBuffers.length} PDFs. Starting extraction...`);

    // --- STEP 1: Process Images ---
    for (const { name, buffer } of imageBuffers) {
        try {
            const processedBuffer = await preprocessImage(buffer);

            const { text, confidence } = await getOCRText(processedBuffer);
            const data = extractFinancialDataFromText(text);

            saveForImprovement(name, processedBuffer, data, confidence);

            extractedDataStore.push({ fileName: name, confidence, ...data });
            console.log(`✅ Processed Image: ${name} (Conf: ${(confidence ?? 0).toFixed(1)}%)`);
        } catch (error) {
            console.error(`❌ Error processing image ${name}: ${error.message}`);
        }
    }

    console.log("\n--- Image Extraction Complete ---");

    // --- STEP 2: Verify against ALL PDFs and Filter ---
    if (extractedDataStore.length > 0 && pdfBuffers.length > 0) {
        console.log(`📄 Analyzing ${pdfBuffers.length} PDF files for verification...`);

        const verificationReport = await verifyDataAgainstMultiplePDFs(extractedDataStore, pdfBuffers);

        if (verificationReport.error) {
            console.error(`\n❌ PDF ERROR: ${verificationReport.error}`);
            console.error(`Details: ${verificationReport.details}`);
            return {
                error: true,
                code: verificationReport.error,
                details: verificationReport.details,
            };
        }

        // FILTER LOGIC: Keep only the items that MISMATCHED
        const unmatchedData = verificationReport.filter(item => item.status === "MISMATCH");

        console.log(`\n✅ Successfully Matched & Excluded: ${verificationReport.length - unmatchedData.length} records.`);
        console.log(`⚠️ Unmatched Records: ${unmatchedData.length}`);

        console.log("\n=== UNMATCHED DATA (REST OF THE DATA) ===");
        console.log(JSON.stringify(unmatchedData, null, 2));

        return unmatchedData;
    } else if (pdfBuffers.length === 0) {
        console.log("⚠️ No PDFs provided. Skipping verification.");
        return extractedDataStore;
    } else {
        console.log("⚠️ No data extracted from images. Skipping PDF verification.");
        return [];
    }
}

/**
 * Multi-PDF Verification Logic — now works with in-memory buffers.
 */
async function verifyDataAgainstMultiplePDFs(extractedDataStore, pdfBuffers) {
    try {
        const parsedPdfRecords = [];

        for (const { name, buffer } of pdfBuffers) {
            try {
                const result = await pdf(buffer);

                const pdfText = result.text.replace(/\s+/g, ' ');
                const normalizedPdf = pdfText.toUpperCase().replace(/[^A-Z0-9]/g, '');

                parsedPdfRecords.push({ fileName: name, normalizedText: normalizedPdf });
            } catch (err) {
                console.error(`⚠️ Failed to parse PDF ${name}: ${err.message}`);
            }
        }

        if (parsedPdfRecords.length === 0) {
            throw new Error("Could not successfully parse any PDF texts.");
        }

        return extractedDataStore.map(entry => {
            let isMatched = false;
            let matchedPdfName = null;
            let failureErrors = [];

            const ocrErrors = [];
            if (entry.amount === "Not found") ocrErrors.push("Amount OCR extraction failed.");
            if (entry.date === "Not found") ocrErrors.push("Date OCR extraction failed.");
            if (entry.ibanOrAccount === "Not found") ocrErrors.push("Account/IBAN OCR extraction failed.");

            if (ocrErrors.length > 0) {
                failureErrors = ocrErrors;
            } else {
                const cleanAmount = entry.amount.replace(/[^0-9]/g, '');
                const cleanDate = entry.date.replace(/[^0-9]/g, '');
                const cleanAccount = entry.ibanOrAccount.toUpperCase().replace(/[^A-Z0-9]/g, '');

                for (const pdf of parsedPdfRecords) {
                    const currentPdfErrors = [];

                    if (!pdf.normalizedText.includes(cleanAmount)) currentPdfErrors.push(`Amount ${entry.amount} missing.`);
                    if (!pdf.normalizedText.includes(cleanDate)) currentPdfErrors.push(`Date ${entry.date} missing.`);
                    if (!pdf.normalizedText.includes(cleanAccount)) currentPdfErrors.push(`Account ${entry.ibanOrAccount} missing.`);

                    if (currentPdfErrors.length === 0) {
                        isMatched = true;
                        matchedPdfName = pdf.fileName;
                        failureErrors = null;
                        break;
                    } else {
                        failureErrors = ["Data not found perfectly in any parsed PDF."];
                    }
                }
            }

            return {
                file: entry.fileName,
                status: isMatched ? "MATCHED" : "MISMATCH",
                matchedInPdf: matchedPdfName,
                errors: isMatched ? null : failureErrors,
                originalData: entry
            };
        });

    } catch (error) {
        return { error: "Multi-PDF Processing Error", details: error.message };
    }
}

/**
 * Image Preprocessing (Sharp) — now accepts a Buffer directly.
 */
async function preprocessImage(inputBuffer) {
    return await sharp(inputBuffer)
        .resize(2500)
        .grayscale()
        .normalize()
        .threshold(155)
        .toBuffer();
}

/**
 * Regex Data Extraction Logic
 */
function extractFinancialDataFromText(text) {
    const cleanText = text.replace(/\s+/g, ' ');

    // Match DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY
    const datePattern = /\b\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}\b/;
    const date = cleanText.match(datePattern)?.[0] || "Not found";

    // Amount extraction: look for numbers with potential thousands separators and decimal points
    // We filter for values that look like amounts (e.g., at least 2 digits before decimal or large numbers)
    const amountMatches = cleanText.match(/\b\d{1,3}(?:,?\d{3})*(?:\.\d{2})?\b/g) || [];
    const amount = amountMatches.find(m => {
        const numOnly = m.replace(/,/g, '');
        // Avoid matching the date as an amount
        return numOnly.length >= 4 && !date.includes(m);
    }) || "Not found";

    // IBAN: PK followed by 22 alphanumeric characters (standard for Pakistan)
    const ibanPattern = /\bPK[A-Z0-9]{22}\b/i;
    // Generic account number: 10 to 22 digits
    const digitAccPattern = /\b\d{10,22}\b/;

    const ibanMatch = cleanText.match(ibanPattern);
    const digitMatch = cleanText.match(digitAccPattern);

    let finalAccount = "Not found";
    if (ibanMatch) {
        finalAccount = ibanMatch[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
    } else if (digitMatch) {
        finalAccount = digitMatch[0];
    }

    return { date, amount, ibanOrAccount: finalAccount };
}

module.exports = { runAnalysis };