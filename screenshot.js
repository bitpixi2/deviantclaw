#!/usr/bin/env node
// Screenshot generator for DeviantClaw pieces
// Usage: node screenshot.js <piece-id>

const { chromium } = require('playwright');

async function screenshotPiece(pieceId) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  
  const url = `https://deviantclaw-api.deviantclaw.workers.dev/api/pieces/${pieceId}/view`;
  console.log(`📸 Capturing ${url}...`);
  
  await page.goto(url, { waitUntil: 'networkidle' });
  
  // Let the animation run for 2 seconds to capture interesting state
  await page.waitForTimeout(2000);
  
  const screenshot = await page.screenshot({ type: 'png' });
  await browser.close();
  
  return screenshot;
}

async function uploadToR2(pieceId, imageBuffer) {
  const filename = `${pieceId}.png`;
  
  // Upload to R2 via Workers API
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: 'image/png' });
  formData.append('file', blob, filename);
  formData.append('pieceId', pieceId);
  
  const response = await fetch('https://deviantclaw-api.deviantclaw.workers.dev/api/admin/upload-thumbnail', {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upload failed: ${error}`);
  }
  
  const result = await response.json();
  console.log(`✅ Uploaded to R2: ${result.url}`);
  return result.url;
}

async function main() {
  const pieceId = process.argv[2];
  
  if (!pieceId) {
    console.error('Usage: node screenshot.js <piece-id>');
    process.exit(1);
  }
  
  try {
    const screenshot = await screenshotPiece(pieceId);
    const url = await uploadToR2(pieceId, screenshot);
    console.log(`🎨 Thumbnail ready: ${url}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
