const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFParse } = require('pdf-parse');
const { getOCRText } = require('./utils/tesseractManager');
const { saveForImprovement } = require('./utils/improvementLogic');

const DEFAULT_IMG_DIR = path.resolve(__dirname, './assets/images');
const DEFAULT_PDF_DIR = path.resolve(__dirname, './assets/pdfs');

/**
 * Main application runner
 * @param {{ imageDir?: string, pdfDir?: string }} [options] - Optional dirs (API uses per-job folders).
 */
async function runAnalysis(options = {}) {
    const IMG_DIR = options.imageDir ? path.resolve(options.imageDir) : DEFAULT_IMG_DIR;
    const PDF_DIR = options.pdfDir ? path.resolve(options.pdfDir) : DEFAULT_PDF_DIR;

    console.log("=== Starting Financial Document Analyzer ===");
    const extractedDataStore = [];

    // 1. Directory Checks
    if (!fs.existsSync(IMG_DIR)) {
        const msg = `Image directory not found at ${IMG_DIR}`;
        console.error(`❌ ERROR: ${msg}`);
        return { error: true, code: 'MISSING_IMAGE_DIR', details: msg };
    }
    if (!fs.existsSync(PDF_DIR)) {
        const msg = `PDF directory not found at ${PDF_DIR}`;
        console.error(`❌ ERROR: ${msg}`);
        return { error: true, code: 'MISSING_PDF_DIR', details: msg };
    }

    const imageFiles = fs.readdirSync(IMG_DIR).filter(file =>
        ['.png', '.jpg', '.jpeg'].includes(path.extname(file).toLowerCase())
    );
    
    const pdfFiles = fs.readdirSync(PDF_DIR).filter(file => 
        file.toLowerCase().endsWith('.pdf')
    );

    console.log(`🚀 Found ${imageFiles.length} images and ${pdfFiles.length} PDFs. Starting extraction...`);

    // --- STEP 1: Process Images ---
    for (const file of imageFiles) {
        try {
            const filePath = path.join(IMG_DIR, file);
            const processedBuffer = await preprocessImage(filePath);
            
            const { text, confidence } = await getOCRText(processedBuffer);
            const data = extractFinancialDataFromText(text);

            saveForImprovement(file, processedBuffer, data, confidence);

            extractedDataStore.push({ fileName: file, confidence, ...data });
            console.log(`✅ Processed Image: ${file} (Conf: ${(confidence ?? 0).toFixed(1)}%)`);
        } catch (error) {
            console.error(`❌ Error processing image ${file}: ${error.message}`);
        }
    }

    console.log("\n--- Image Extraction Complete ---");

    // --- STEP 2: Verify against ALL PDFs and Filter ---
    if (extractedDataStore.length > 0 && pdfFiles.length > 0) {
        console.log(`📄 Analyzing ${pdfFiles.length} PDF files for verification...`);
        
        // Get the full report across all PDFs
        const verificationReport = await verifyDataAgainstMultiplePDFs(extractedDataStore, PDF_DIR, pdfFiles);

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
        
        // Return only the unmatched data
        return unmatchedData; 
    } else if (pdfFiles.length === 0) {
        console.log("⚠️ No PDFs found in the directory. Skipping verification.");
        return extractedDataStore; // Return all data since nothing could be matched
    } else {
        console.log("⚠️ No data extracted from images. Skipping PDF verification.");
        return [];
    }
}

/**
 * Multi-PDF Verification Logic
 */
async function verifyDataAgainstMultiplePDFs(extractedDataStore, pdfDir, pdfFiles) {
    try {
        const parsedPdfRecords = [];

        // 1. Read and Parse all PDF files into memory
        for (const pdfFile of pdfFiles) {
            let parser;
            try {
                const pdfPath = path.join(pdfDir, pdfFile);
                const dataBuffer = fs.readFileSync(pdfPath);

                parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
                const result = await parser.getText();

                // Normalize the PDF text for robust searching
                const pdfText = result.text.replace(/\s+/g, ' ');
                const normalizedPdf = pdfText.toUpperCase().replace(/[^A-Z0-9]/g, '');

                parsedPdfRecords.push({ fileName: pdfFile, normalizedText: normalizedPdf });
            } catch (err) {
                console.error(`⚠️ Failed to parse PDF ${pdfFile}: ${err.message}`);
            } finally {
                if (parser) {
                    await parser.destroy().catch(() => {});
                }
            }
        }

        if (parsedPdfRecords.length === 0) {
            throw new Error("Could not successfully parse any PDF texts.");
        }

        // 2. Map over the extracted image data and check against parsed PDFs
        return extractedDataStore.map(entry => {
            let isMatched = false;
            let matchedPdfName = null;
            let failureErrors = []; // Holds the specific mismatch reasons

            // Preliminary OCR Failure Check
            const ocrErrors = [];
            if (entry.amount === "Not found") ocrErrors.push("Amount OCR extraction failed.");
            if (entry.date === "Not found") ocrErrors.push("Date OCR extraction failed.");
            if (entry.ibanOrAccount === "Not found") ocrErrors.push("Account/IBAN OCR extraction failed.");

            if (ocrErrors.length > 0) {
                // If OCR failed, it cannot match any PDF
                failureErrors = ocrErrors;
            } else {
                const cleanAmount = entry.amount.replace(/[^0-9]/g, '');
                const cleanDate = entry.date.replace(/[^0-9]/g, '');
                const cleanAccount = entry.ibanOrAccount.toUpperCase().replace(/[^A-Z0-9]/g, '');

                // Check against each PDF. If it finds a match in ANY PDF, break the loop and count as matched.
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
                        // Store errors in case it doesn't match ANY pdf. 
                        // (Usually just "Not found in any PDF" is enough, but tracking helps debug)
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
 * Image Preprocessing (Sharp)
 */
async function preprocessImage(imagePath) {
    const input = await fs.promises.readFile(imagePath);
    return await sharp(input)
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

    const datePattern = /\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/;
    const date = cleanText.match(datePattern)?.[0] || "Not found";

    const amountMatches = cleanText.match(/\b\d{1,3}(?:,?\d{3})*(?:\.\d{2})?\b/g) || [];
    const amount = amountMatches.find(m => {
        const numOnly = m.replace(/,/g, '');
        return numOnly.length >= 5 && !date.includes(m); 
    }) || "Not found";

    const ibanFuzzyPattern = /PK[A-Z0-9\.\s\-\_]{10,26}/i;
    const digitAccPattern = /\b\d{10,22}\b/;

    const ibanMatch = cleanText.match(ibanFuzzyPattern);
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

if (require.main === module) {
    runAnalysis().then((out) => {
        if (out && out.error) {
            process.exitCode = 1;
        }
    });
}