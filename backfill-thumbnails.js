#!/usr/bin/env node
// Backfill thumbnails for all existing DeviantClaw pieces
// Spawned as a subagent task

const { chromium } = require('playwright');
const FormData = require('form-data');
const fetch = require('node-fetch');

const API_BASE = 'https://deviantclaw-api.deviantclaw.workers.dev';

async function fetchAllPieces() {
  console.log('📦 Fetching all pieces...');
  const response = await fetch(`${API_BASE}/api/pieces`);
  const pieces = await response.json();
  console.log(`Found ${pieces.length} pieces`);
  return pieces;
}

async function screenshotPiece(pieceId) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  
  const url = `${API_BASE}/api/pieces/${pieceId}/view`;
  console.log(`  📸 Capturing ${url}...`);
  
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  
  // Let animation run for 2 seconds
  await page.waitForTimeout(2000);
  
  const screenshot = await page.screenshot({ type: 'png' });
  await browser.close();
  
  return screenshot;
}

async function uploadThumbnail(pieceId, imageBuffer) {
  const formData = new FormData();
  formData.append('file', imageBuffer, { filename: `${pieceId}.png`, contentType: 'image/png' });
  formData.append('pieceId', pieceId);
  
  const response = await fetch(`${API_BASE}/api/admin/upload-thumbnail`, {
    method: 'POST',
    body: formData,
    headers: formData.getHeaders()
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upload failed: ${error}`);
  }
  
  const result = await response.json();
  return result.url;
}

async function processPiece(piece) {
  if (piece.thumbnail) {
    console.log(`✅ ${piece.id} - already has thumbnail, skipping`);
    return { pieceId: piece.id, status: 'skipped', reason: 'already has thumbnail' };
  }
  
  try {
    console.log(`🎨 Processing ${piece.id} - "${piece.title}"`);
    const screenshot = await screenshotPiece(piece.id);
    const url = await uploadThumbnail(piece.id, screenshot);
    console.log(`  ✅ Uploaded: ${url}`);
    return { pieceId: piece.id, status: 'success', url };
  } catch (error) {
    console.error(`  ❌ Failed: ${error.message}`);
    return { pieceId: piece.id, status: 'failed', error: error.message };
  }
}

async function main() {
  console.log('🚀 DeviantClaw Thumbnail Backfill Starting...\n');
  
  const pieces = await fetchAllPieces();
  const results = [];
  
  for (const piece of pieces) {
    const result = await processPiece(piece);
    results.push(result);
    
    // Small delay between pieces to avoid hammering the API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n📊 Summary:');
  const success = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'failed').length;
  
  console.log(`  ✅ Success: ${success}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ❌ Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\nFailed pieces:');
    results.filter(r => r.status === 'failed').forEach(r => {
      console.log(`  - ${r.pieceId}: ${r.error}`);
    });
  }
  
  console.log('\n✨ Backfill complete!');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
