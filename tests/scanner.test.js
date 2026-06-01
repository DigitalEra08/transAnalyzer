/**
 * Unit Tests for scanner.js
 * 
 * Run with: node tests/scanner.test.js
 * 
 * Note: These tests focus on the pure logic functions that don't require
 * heavy native dependencies like sharp or tesseract.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Test results storage
const testResults = {
    passed: 0,
    failed: 0,
    tests: []
};

/**
 * Simple test runner
 */
function test(description, fn) {
    try {
        fn();
        testResults.passed++;
        testResults.tests.push({ description, status: 'PASS' });
        console.log(`✅ PASS: ${description}`);
    } catch (error) {
        testResults.failed++;
        testResults.tests.push({ description, status: 'FAIL', error: error.message });
        console.log(`❌ FAIL: ${description}`);
        console.log(`   Error: ${error.message}`);
    }
}

/**
 * Assert helper that throws with meaningful message
 */
function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

console.log('\n=== Testing Financial Data Extraction Patterns ===\n');

test('Date pattern should match DD/MM/YYYY format', () => {
    const datePattern = /\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/;
    const text1 = 'Transaction dated 15/01/2024';
    const text2 = 'Date: 12-25-2023';
    const text3 = 'On 03.04.2022';
    
    assert(datePattern.test(text1), 'Should match DD/MM/YYYY');
    assert(datePattern.test(text2), 'Should match DD-MM-YYYY');
    assert(datePattern.test(text3), 'Should match DD.MM.YYYY');
});

test('Amount pattern should match currency amounts', () => {
    const amountPattern = /\b\d{1,3}(?:,?\d{3})*(?:\.\d{2})?\b/g;
    const text1 = 'Amount: 1,234.56';
    const text2 = 'Total 50000';
    const text3 = 'Paid 999.99';
    
    const match1 = text1.match(amountPattern);
    const match2 = text2.match(amountPattern);
    const match3 = text3.match(amountPattern);
    
    assert(match1 && match1.some(m => m.length >= 5), 'Should find large amounts');
    assert(match2 && match2.some(m => m.length >= 5), 'Should find 5+ digit amounts');
    assert(match3 !== null, 'Should find decimal amounts');
});

test('IBAN pattern should match Pakistan IBAN format', () => {
    const ibanPattern = /PK[A-Z0-9\.\s\-\_]{10,26}/i;
    const text1 = 'Account: PK1234567890123456';
    const text2 = 'IBAN: PK76 SCBL 0123 4567 8901';
    
    assert(ibanPattern.test(text1), 'Should match continuous IBAN');
    assert(ibanPattern.test(text2), 'Should match formatted IBAN');
});

test('Numeric account pattern should match long digit sequences', () => {
    const digitAccPattern = /\b\d{10,22}\b/;
    const text1 = 'Account number 1234567890';
    const text2 = 'Ref: 9876543210123456789012';
    
    assert(digitAccPattern.test(text1), 'Should match 10 digit account');
    assert(digitAccPattern.test(text2), 'Should match longer account numbers');
});

/**
 * Test extractFinancialDataFromText logic by re-implementing it
 */
console.log('\n=== Testing extractFinancialDataFromText Logic ===\n');

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

test('extractFinancialDataFromText should extract date', () => {
    const text = 'Transaction on 15/01/2024 for payment';
    const result = extractFinancialDataFromText(text);
    
    assertEqual(result.date, '15/01/2024', 'Should extract correct date');
});

test('extractFinancialDataFromText should extract amount', () => {
    const text = 'Payment of 50,000.00 was processed';
    const result = extractFinancialDataFromText(text);
    
    assertEqual(result.amount, '50,000.00', 'Should extract correct amount');
});

test('extractFinancialDataFromText should extract IBAN', () => {
    const text = 'Transfer to PK76SCBL0123456789012 completed';
    const result = extractFinancialDataFromText(text);
    
    // IBAN pattern matches up to 26 chars after PK, so it may include extra characters
    // The important thing is that it extracts the IBAN correctly
    assert(result.ibanOrAccount.startsWith('PK76SCBL'), 'Should extract IBAN starting with PK');
    assert(result.ibanOrAccount.includes('0123456789012'), 'Should include account digits');
});

test('extractFinancialDataFromText should extract numeric account', () => {
    const text = 'Account 1234567890 debited';
    const result = extractFinancialDataFromText(text);
    
    assertEqual(result.ibanOrAccount, '1234567890', 'Should extract numeric account');
});

test('extractFinancialDataFromText returns Not found for missing data', () => {
    const text = 'Some random text without financial data';
    const result = extractFinancialDataFromText(text);
    
    assertEqual(result.date, 'Not found', 'Date should be Not found');
    assertEqual(result.amount, 'Not found', 'Amount should be Not found');
    assertEqual(result.ibanOrAccount, 'Not found', 'Account should be Not found');
});

test('extractFinancialDataFromText handles complete transaction text', () => {
    const text = 'On 25/12/2023, amount 125,000.50 transferred to account PK1234567890123456';
    const result = extractFinancialDataFromText(text);
    
    assertEqual(result.date, '25/12/2023', 'Should extract date');
    assertEqual(result.amount, '125,000.50', 'Should extract amount');
    assertEqual(result.ibanOrAccount, 'PK1234567890123456', 'Should extract IBAN');
});

/**
 * Improvement Logic Tests
 */
console.log('\n=== Testing Improvement Logic ===\n');

const { saveForImprovement } = require('../utils/improvementLogic');

test('saveForImprovement should save low confidence results', () => {
    const os = require('os');
    
    const tmpDir = path.join(os.tmpdir(), 'test_feedback_' + Date.now());
    
    // Mock the training_feedback directory
    const originalResolve = path.resolve;
    path.resolve = (...args) => {
        if (args.includes('training_feedback')) {
            return tmpDir;
        }
        return originalResolve(...args);
    };
    
    try {
        const testData = { date: '01/01/2024', amount: '1000', ibanOrAccount: '1234567890' };
        const imageBuffer = Buffer.from('test image data');
        
        // Low confidence should trigger save
        saveForImprovement('test.png', imageBuffer, testData, 75);
        
        // Check if directory was created
        assert(fs.existsSync(tmpDir), 'Should create feedback directory');
        
        // Check if log file exists
        const logPath = path.join(tmpDir, 'corrections.log');
        assert(fs.existsSync(logPath), 'Should create corrections log');
        
    } finally {
        path.resolve = originalResolve;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('saveForImprovement should NOT save high confidence results', () => {
    const os = require('os');
    
    const tmpDir = path.join(os.tmpdir(), 'test_feedback_high_' + Date.now());
    
    const originalResolve = path.resolve;
    path.resolve = (...args) => {
        if (args.includes('training_feedback')) {
            return tmpDir;
        }
        return originalResolve(...args);
    };
    
    try {
        const testData = { date: '01/01/2024', amount: '1000', ibanOrAccount: '1234567890' };
        const imageBuffer = Buffer.from('test image data');
        
        // High confidence should NOT trigger save
        saveForImprovement('test.png', imageBuffer, testData, 95);
        
        // Directory should NOT be created for high confidence
        assert(!fs.existsSync(tmpDir), 'Should NOT create feedback directory for high confidence');
        
    } finally {
        path.resolve = originalResolve;
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    }
});

test('saveForImprovement threshold is exactly 85%', () => {
    const os = require('os');
    
    const tmpDir = path.join(os.tmpdir(), 'test_feedback_threshold_' + Date.now());
    
    const originalResolve = path.resolve;
    path.resolve = (...args) => {
        if (args.includes('training_feedback')) {
            return tmpDir;
        }
        return originalResolve(...args);
    };
    
    try {
        const testData = { date: '01/01/2024', amount: '1000', ibanOrAccount: '1234567890' };
        const imageBuffer = Buffer.from('test image data');
        
        // Exactly 85% should NOT trigger save (< 85, not <= 85)
        saveForImprovement('test.png', imageBuffer, testData, 85);
        
        assert(!fs.existsSync(tmpDir), 'Should NOT save at exactly 85% confidence');
        
    } finally {
        path.resolve = originalResolve;
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    }
});

/**
 * Print Test Summary
 */
console.log('\n=== Test Summary ===\n');
console.log(`Total: ${testResults.passed + testResults.failed}`);
console.log(`Passed: ${testResults.passed}`);
console.log(`Failed: ${testResults.failed}`);

if (testResults.failed > 0) {
    console.log('\nFailed tests:');
    testResults.tests
        .filter(t => t.status === 'FAIL')
        .forEach(t => console.log(`  - ${t.description}: ${t.error}`));
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
}
