import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultConfigStore, SelfBackendVerifier } from '@selfxyz/core';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');

const port = Number(process.env.PORT || 3001);
const publicBaseUrl = trimTrailingSlash(process.env.PUBLIC_BASE_URL || `http://localhost:${port}`);
const workerBaseUrl = trimTrailingSlash(process.env.DEVIANTCLAW_WORKER_URL || 'https://deviantclaw.art');
const selfScope = process.env.SELF_SCOPE || 'deviantclaw';
const selfEndpoint = process.env.SELF_ENDPOINT || `${publicBaseUrl}/api/verify`;
const selfEndpointType = process.env.SELF_ENDPOINT_TYPE || 'https';
const mockPassport = process.env.SELF_MOCK_PASSPORT === 'true';
const adminKey = process.env.ADMIN_KEY || '';
const allowedIds = new Map([[1, true]]);

const verificationStates = new Map();

const verifier = new SelfBackendVerifier(
  selfScope,
  selfEndpoint,
  mockPassport,
  allowedIds,
  new DefaultConfigStore({
    minimumAge: 0,
    excludedCountries: [],
    ofac: false,
  }),
  'hex'
);

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(publicDir));

app.get('/', (_req, res) => {
  res.redirect('/verify');
});

app.get(['/verify', '/verified'], (_req, res) => {
  res.type('html').send(renderVerifyPage());
});

app.get('/logo.svg', (_req, res) => {
  res.type('image/svg+xml').send(renderLogoSvg());
});

app.get('/api/status/:userId', (req, res) => {
  const userId = normalizeAddress(req.params.userId);
  const current = verificationStates.get(userId);
  if (!current) {
    return res.json({ status: 'pending', userId });
  }
  return res.json(current);
});

app.post('/api/verify', async (req, res) => {
  const body = req.body || {};
  const userId = extractUserIdentifier(body.userContextData);

  if (!userId) {
    return res.status(400).json({ status: 'error', result: false, error: 'Missing user identifier in userContextData.' });
  }

  const normalizedUserId = normalizeAddress(userId);
  setVerificationState(normalizedUserId, { status: 'verifying', userId: normalizedUserId });

  try {
    const verificationResult = await verifier.verify(
      body.attestationId,
      body.proof,
      body.publicSignals || body.pubSignals,
      body.userContextData
    );

    if (!proofPassed(verificationResult)) {
      const payload = {
        status: 'failed',
        result: false,
        userId: normalizedUserId,
        error: 'Self proof validation failed.',
      };
      setVerificationState(normalizedUserId, payload);
      return res.status(400).json(payload);
    }

    if (!adminKey) {
      throw new Error('ADMIN_KEY is not configured.');
    }

    const apiKey = randomUUID();
    const verifiedAt = new Date().toISOString();

    const workerResponse = await fetch(`${workerBaseUrl}/api/guardians/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey,
      },
      body: JSON.stringify({
        guardianAddress: normalizedUserId,
        apiKey,
        selfProofValid: true,
        verifiedAt,
      }),
    });

    if (!workerResponse.ok) {
      const errorText = await workerResponse.text();
      throw new Error(`Worker guardian registration failed (${workerResponse.status}): ${errorText}`);
    }

    const payload = {
      status: 'verified',
      result: true,
      userId: normalizedUserId,
      apiKey,
      verifiedAt,
    };
    setVerificationState(normalizedUserId, payload);
    return res.json(payload);
  } catch (error) {
    const payload = {
      status: 'error',
      result: false,
      userId: normalizedUserId,
      error: error.message || 'Verification failed.',
    };
    setVerificationState(normalizedUserId, payload);
    return res.status(500).json(payload);
  }
});

app.listen(port, () => {
  console.log(`DeviantClaw verification server listening on ${publicBaseUrl}`);
});

function extractUserIdentifier(userContextData = {}) {
  return (
    userContextData.userIdentifier ||
    userContextData.userId ||
    userContextData.userAddress ||
    ''
  );
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function setVerificationState(userId, nextState) {
  verificationStates.set(userId, {
    updatedAt: new Date().toISOString(),
    ...nextState,
  });
}

function proofPassed(result) {
  if (result === true) return true;
  if (!result || typeof result !== 'object') return false;
  if (result.isValidDetails && typeof result.isValidDetails.isValid === 'boolean') {
    return result.isValidDetails.isValid;
  }
  if (typeof result.isValid === 'boolean') return result.isValid;
  if (typeof result.result === 'boolean') return result.result;
  return false;
}

function renderVerifyPage() {
  const config = JSON.stringify({
    appName: 'DeviantClaw',
    endpoint: selfEndpoint,
    endpointType: selfEndpointType,
    publicBaseUrl,
    scope: selfScope,
  });

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Verify · DeviantClaw</title>
    <style>
      :root {
        --bg: #000000;
        --surface: rgba(10, 10, 14, 0.92);
        --surface-strong: rgba(16, 16, 24, 0.96);
        --border: #1e1a2e;
        --text: #a0b8c0;
        --dim: #8a9e96;
        --primary: #7a9bab;
        --secondary: #8a6878;
        --accent: #c9b17a;
        --danger: #ef4444;
        --success: #22c55e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(122, 155, 171, 0.15), transparent 34%),
          radial-gradient(circle at bottom right, rgba(138, 104, 120, 0.18), transparent 30%),
          linear-gradient(180deg, #050507 0%, #000000 100%);
        color: var(--text);
        font-family: 'Courier New', monospace;
      }
      .shell {
        width: min(1100px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 56px;
      }
      .nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 28px;
        font-size: 12px;
        letter-spacing: 2px;
        text-transform: uppercase;
      }
      .nav a {
        color: var(--primary);
        text-decoration: none;
      }
      .brand {
        color: var(--text);
      }
      .brand span {
        color: var(--secondary);
      }
      .panel {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 24px;
      }
      .card {
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--surface);
        backdrop-filter: blur(12px);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.4);
      }
      .hero {
        padding: 28px;
        position: relative;
        overflow: hidden;
      }
      .hero::after {
        content: '';
        position: absolute;
        inset: auto -120px -120px auto;
        width: 260px;
        height: 260px;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(122, 155, 171, 0.16), transparent 65%);
        pointer-events: none;
      }
      .eyebrow {
        font-size: 11px;
        letter-spacing: 3px;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 16px;
      }
      h1 {
        margin: 0 0 16px;
        font-size: clamp(32px, 5vw, 54px);
        line-height: 0.95;
        text-transform: uppercase;
        letter-spacing: 4px;
        font-weight: normal;
      }
      .lede, .steps li, .status-copy, .helper, .api-key-hint {
        color: var(--dim);
        font-size: 14px;
        line-height: 1.7;
      }
      .steps {
        list-style: none;
        padding: 0;
        margin: 24px 0 0;
        display: grid;
        gap: 12px;
      }
      .steps strong {
        color: var(--text);
        display: block;
        margin-bottom: 2px;
      }
      .form-card {
        padding: 24px;
        display: grid;
        gap: 18px;
      }
      .field-label {
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: var(--dim);
      }
      .field-input {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(0, 0, 0, 0.4);
        color: var(--text);
        font: inherit;
        padding: 14px 16px;
      }
      .field-input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(122, 155, 171, 0.14);
      }
      .button-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      button, .action-link {
        appearance: none;
        border: 1px solid var(--primary);
        border-radius: 999px;
        background: rgba(122, 155, 171, 0.14);
        color: var(--text);
        font: inherit;
        letter-spacing: 1px;
        padding: 11px 18px;
        cursor: pointer;
        text-decoration: none;
        transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
      }
      button:hover, .action-link:hover {
        transform: translateY(-1px);
        border-color: var(--accent);
        background: rgba(201, 177, 122, 0.16);
      }
      button.secondary, .action-link.secondary {
        border-color: var(--border);
        background: rgba(255, 255, 255, 0.03);
        color: var(--dim);
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 12px;
        letter-spacing: 1px;
        text-transform: uppercase;
        width: fit-content;
      }
      .status-idle, .status-pending, .status-verifying {
        background: rgba(122, 155, 171, 0.1);
        border: 1px solid rgba(122, 155, 171, 0.25);
        color: var(--primary);
      }
      .status-verified {
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid rgba(34, 197, 94, 0.25);
        color: var(--success);
      }
      .status-failed, .status-error {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.25);
        color: var(--danger);
      }
      .qr-shell {
        min-height: 340px;
        border-radius: 18px;
        border: 1px dashed rgba(122, 155, 171, 0.24);
        background: rgba(255, 255, 255, 0.02);
        display: grid;
        place-items: center;
        padding: 18px;
      }
      .qr-shell > div {
        width: 100%;
      }
      .result-card {
        padding: 20px;
        border-radius: 18px;
        background: var(--surface-strong);
        border: 1px solid rgba(34, 197, 94, 0.2);
      }
      .api-key {
        margin-top: 12px;
        padding: 14px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(0, 0, 0, 0.35);
        overflow-wrap: anywhere;
        font-size: 14px;
      }
      .footer-note {
        margin-top: 22px;
        font-size: 12px;
        color: var(--dim);
        letter-spacing: 1px;
      }
      @media (max-width: 900px) {
        .panel {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 640px) {
        .shell {
          width: min(100vw - 20px, 1100px);
          padding-top: 18px;
        }
        .hero, .form-card {
          padding: 20px;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="nav">
        <div class="brand">deviant<span>claw</span> verification</div>
        <a href="https://deviantclaw.art">back to gallery</a>
      </div>
      <div id="app"></div>
    </div>
    <script>window.__VERIFY_CONFIG__ = ${config};</script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

function renderLogoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="none">
  <rect width="256" height="256" rx="48" fill="#050507"/>
  <path d="M58 173C77 115 112 79 154 65C146 84 142 103 144 121C163 102 185 92 206 89C190 116 182 144 181 172" stroke="#7A9BAB" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M86 192L110 138" stroke="#C9B17A" stroke-width="14" stroke-linecap="round"/>
  <path d="M125 198L141 150" stroke="#8A6878" stroke-width="14" stroke-linecap="round"/>
  <path d="M165 192L173 158" stroke="#A0B8C0" stroke-width="14" stroke-linecap="round"/>
</svg>`;
}
