import { DefaultConfigStore, SelfBackendVerifier } from '@selfxyz/core';
import { JsonRpcProvider, getAddress, isAddress } from 'ethers';

const PASSPORT_IDS = new Map([[1, true]]);
const APP_ASSET_VERSION = '20260316b';
const DEFAULT_ENS_RPC_URL = 'https://ethereum-rpc.publicnode.com';
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="none"><rect width="256" height="256" rx="48" fill="#050507"/><path d="M58 173C77 115 112 79 154 65C146 84 142 103 144 121C163 102 185 92 206 89C190 116 182 144 181 172" stroke="#7A9BAB" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><path d="M86 192L110 138" stroke="#C9B17A" stroke-width="14" stroke-linecap="round"/><path d="M125 198L141 150" stroke="#8A6878" stroke-width="14" stroke-linecap="round"/><path d="M165 192L173 158" stroke="#A0B8C0" stroke-width="14" stroke-linecap="round"/></svg>`;
const LOGO_BASE64 = btoa(LOGO_SVG);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return cors();

    try {
      if (method === 'GET' && path === '/') {
        return Response.redirect(`${url.origin}/verify`, 302);
      }

      if (method === 'GET' && (path === '/verify' || path === '/verified')) {
        return html(renderVerifyPage({
          origin: url.origin,
          scope: env.SELF_SCOPE || 'deviantclaw',
          endpointType: env.SELF_ENDPOINT_TYPE || 'https',
        }));
      }

      if (method === 'GET' && path === '/app.js') {
        return new Response(BROWSER_APP_JS, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (method === 'GET' && path === '/logo.svg') {
        return new Response(LOGO_SVG, {
          headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }

      if (method === 'GET' && path.match(/^\/api\/status\/[^/]+$/)) {
        const address = normalizeAddress(path.split('/').pop());
        const session = await env.DB.prepare(
          'SELECT address, status, api_key, error, verified_at, updated_at FROM guardian_verification_sessions WHERE address = ?'
        ).bind(address).first();

        if (session) {
          return json({
            status: session.status,
            userId: session.address,
            apiKey: session.api_key || null,
            error: session.error || null,
            verifiedAt: session.verified_at || null,
            updatedAt: session.updated_at || null,
          });
        }

        const guardian = await env.DB.prepare(
          'SELECT address, api_key, verified_at FROM guardians WHERE address = ?'
        ).bind(address).first();

        if (guardian) {
          return json({
            status: 'verified',
            userId: guardian.address,
            apiKey: guardian.api_key,
            verifiedAt: guardian.verified_at || null,
          });
        }

        return json({ status: 'pending', userId: address });
      }

      if (method === 'GET' && path === '/api/resolve') {
        const value = String(url.searchParams.get('value') || '').trim();
        if (!value) return json({ error: 'Missing value.' }, 400);

        try {
          const resolution = await resolveGuardianIdentifier(value, env);
          if (!resolution.address) {
            return json({ error: 'Unable to resolve ENS name.' }, 404);
          }

          return json({
            input: value,
            address: resolution.address,
            ensName: resolution.ensName || null,
          });
        } catch (error) {
          return json({ error: error.message || 'Unable to resolve ENS name.' }, 500);
        }
      }

      if (method === 'POST' && path === '/api/verify') {
        const body = await request.json();
        const userId = normalizeAddress(extractUserIdentifier(body.userContextData));
        if (!userId) {
          return json({ status: 'error', result: false, error: 'Missing user identifier in userContextData.' }, 400);
        }

        const now = nowIso();
        await upsertSession(env.DB, {
          address: userId,
          status: 'verifying',
          apiKey: null,
          error: null,
          verifiedAt: null,
          createdAt: now,
          updatedAt: now,
        });

        try {
          const verifier = new SelfBackendVerifier(
            env.SELF_SCOPE || 'deviantclaw',
            `${url.origin}/api/verify`,
            false,
            PASSPORT_IDS,
            new DefaultConfigStore({
              minimumAge: 0,
              excludedCountries: [],
              ofac: false,
            }),
            'hex'
          );

          const verificationResult = await verifier.verify(
            body.attestationId,
            body.proof,
            body.publicSignals || body.pubSignals,
            body.userContextData
          );

          if (!proofPassed(verificationResult)) {
            await upsertSession(env.DB, {
              address: userId,
              status: 'failed',
              apiKey: null,
              error: 'Self proof validation failed.',
              verifiedAt: null,
              createdAt: now,
              updatedAt: nowIso(),
            });
            return json({ status: 'failed', result: false, error: 'Self proof validation failed.' }, 400);
          }

          const apiKey = crypto.randomUUID();
          const verifiedAt = new Date().toISOString();

          await env.DB.prepare(
            `INSERT INTO guardians (address, api_key, self_proof_valid, verified_at, created_at)
             VALUES (?, ?, 1, ?, ?)
             ON CONFLICT(address) DO UPDATE SET
               api_key = excluded.api_key,
               self_proof_valid = 1,
               verified_at = excluded.verified_at`
          ).bind(userId, apiKey, verifiedAt, now).run();

          await upsertSession(env.DB, {
            address: userId,
            status: 'verified',
            apiKey,
            error: null,
            verifiedAt,
            createdAt: now,
            updatedAt: nowIso(),
          });

          return json({ status: 'success', result: true, apiKey });
        } catch (error) {
          await upsertSession(env.DB, {
            address: userId,
            status: 'error',
            apiKey: null,
            error: error.message || 'Verification failed.',
            verifiedAt: null,
            createdAt: now,
            updatedAt: nowIso(),
          });
          return json({ status: 'error', result: false, error: error.message || 'Verification failed.' }, 500);
        }
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      return json({ status: 'error', error: error.message || 'Internal error.' }, 500);
    }
  },
};

function extractUserIdentifier(userContextData = {}) {
  return userContextData.userIdentifier || userContextData.userId || userContextData.userAddress || '';
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

let ensProvider = null;
let ensProviderUrl = '';

function getEnsProvider(env) {
  const rpcUrl = String(env.ENS_RPC_URL || DEFAULT_ENS_RPC_URL).trim();
  if (!ensProvider || ensProviderUrl !== rpcUrl) {
    ensProvider = new JsonRpcProvider(rpcUrl, 1, { staticNetwork: true });
    ensProviderUrl = rpcUrl;
  }
  return ensProvider;
}

async function resolveGuardianIdentifier(value, env) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return { address: null, ensName: null };

  if (isAddress(rawValue)) {
    return {
      address: normalizeAddress(getAddress(rawValue)),
      ensName: null,
    };
  }

  if (!looksLikeEnsName(rawValue)) {
    return { address: null, ensName: null };
  }

  const provider = getEnsProvider(env);
  const resolved = await provider.resolveName(rawValue);
  if (!resolved) return { address: null, ensName: rawValue.toLowerCase() };

  return {
    address: normalizeAddress(getAddress(resolved)),
    ensName: rawValue.toLowerCase(),
  };
}

function looksLikeEnsName(value) {
  return /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(String(value || '').trim()) && /\.eth$/i.test(String(value || '').trim());
}

function nowIso() {
  return new Date().toISOString();
}

function proofPassed(result) {
  if (result === true) return true;
  if (!result || typeof result !== 'object') return false;
  if (result.isValidDetails && typeof result.isValidDetails.isValid === 'boolean') return result.isValidDetails.isValid;
  if (typeof result.isValid === 'boolean') return result.isValid;
  if (typeof result.result === 'boolean') return result.result;
  return false;
}

async function upsertSession(db, session) {
  await db.prepare(
    `INSERT INTO guardian_verification_sessions (address, status, api_key, error, verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       status = excluded.status,
       api_key = excluded.api_key,
       error = excluded.error,
       verified_at = excluded.verified_at,
       updated_at = excluded.updated_at`
  ).bind(
    session.address,
    session.status,
    session.apiKey,
    session.error,
    session.verifiedAt,
    session.createdAt,
    session.updatedAt
  ).run();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

function html(body) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

function renderVerifyPage(config) {
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
        --border: #1e1a2e;
        --text: #a0b8c0;
        --dim: #8a9e96;
        --primary: #7a9bab;
        --danger: #ef4444;
        --success: #22c55e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(122, 155, 171, 0.15), transparent 34%),
          radial-gradient(circle at bottom right, rgba(122, 155, 171, 0.12), transparent 30%),
          linear-gradient(180deg, #050507 0%, #000000 100%);
        color: var(--text);
        font-family: 'Courier New', monospace;
      }
      .shell { width: min(620px, calc(100vw - 24px)); margin: 0 auto; padding: 20px 0 40px; }
      .nav { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 16px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; }
      .nav a { color: var(--primary); text-decoration: none; }
      .brand { color: var(--text); }
      .brand span { color: var(--primary); }
      .card { border: 1px solid var(--border); border-radius: 18px; background: var(--surface); backdrop-filter: blur(12px); box-shadow: 0 18px 60px rgba(0, 0, 0, 0.4); padding: 20px; display: grid; gap: 16px; }
      .card-head { display: grid; gap: 10px; }
      .head-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
      .kicker { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--dim); }
      h1 { margin: 0; font-size: 26px; line-height: 1; letter-spacing: 2px; font-weight: normal; text-transform: uppercase; }
      .subtle, .status-copy, .helper, .api-key-hint { color: var(--dim); font-size: 13px; line-height: 1.6; }
      .field-label { display: block; margin-bottom: 8px; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: var(--dim); }
      .field-input { width: 100%; border-radius: 14px; border: 1px solid var(--border); background: rgba(0, 0, 0, 0.4); color: var(--text); font: inherit; padding: 14px 16px; }
      .field-input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(122, 155, 171, 0.14); }
      .button-row { display: flex; gap: 12px; flex-wrap: wrap; }
      button, .action-link { appearance: none; border: 1px solid var(--primary); border-radius: 999px; background: rgba(122, 155, 171, 0.14); color: var(--text); font: inherit; letter-spacing: 1px; padding: 11px 18px; cursor: pointer; text-decoration: none; transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease; }
      button:hover, .action-link:hover { transform: translateY(-1px); border-color: var(--accent); background: rgba(201, 177, 122, 0.16); }
      button.secondary, .action-link.secondary { border-color: var(--border); background: rgba(255, 255, 255, 0.03); color: var(--dim); }
      button[disabled] { opacity: 0.55; cursor: not-allowed; transform: none; }
      .status-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; width: fit-content; }
      .status-idle, .status-pending, .status-verifying { background: rgba(122, 155, 171, 0.1); border: 1px solid rgba(122, 155, 171, 0.25); color: var(--primary); }
      .status-verified, .status-success { background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.25); color: var(--success); }
      .status-failed, .status-error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: var(--danger); }
      .resolved-line { color: var(--primary); font-size: 12px; line-height: 1.5; margin-top: 8px; }
      .qr-shell { min-height: 280px; border-radius: 16px; border: 1px dashed rgba(122, 155, 171, 0.24); background: rgba(255, 255, 255, 0.02); display: grid; place-items: center; padding: 16px; }
      .qr-box { display: grid; gap: 14px; justify-items: center; text-align: center; }
      .qr-box canvas { background: white; padding: 12px; border-radius: 12px; }
      .result-card { padding: 16px; border-radius: 16px; background: rgba(34, 197, 94, 0.06); border: 1px solid rgba(34, 197, 94, 0.2); }
      .api-key { margin-top: 12px; padding: 14px; border-radius: 14px; border: 1px solid var(--border); background: rgba(0, 0, 0, 0.35); overflow-wrap: anywhere; font-size: 14px; }
      .footer-note { font-size: 12px; color: var(--dim); letter-spacing: 1px; }
      .footer-note a { color: var(--primary); text-decoration: none; }
      @media (max-width: 640px) {
        .shell { width: min(100vw - 16px, 620px); padding-top: 16px; }
        .head-top { grid-template-columns: 1fr; }
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
    <script>
      window.__VERIFY_CONFIG__ = ${JSON.stringify({
        scope: config.scope,
        endpoint: `${config.origin}/api/verify`,
        endpointType: config.endpointType,
        logoBase64: LOGO_BASE64,
      })};
    </script>
    <script type="module" src="/app.js?v=${APP_ASSET_VERSION}"></script>
  </body>
</html>`;
}

const BROWSER_APP_JS = `
import { SelfAppBuilder, getUniversalLink } from 'https://esm.sh/@selfxyz/qrcode@1.0.22';
import QRCode from 'https://esm.sh/qrcode@1.5.4';

const config = window.__VERIFY_CONFIG__;
const MOBILE_RE = /Android|iPhone|iPad|iPod/i;
const POLL_INTERVAL_MS = 3000;
const state = {
  inputValue: '',
  userId: '',
  ensName: '',
  started: false,
  status: { status: 'idle' },
  deeplink: '',
  copyState: 'idle',
  resolving: false,
};

const params = new URLSearchParams(window.location.search);
const initialUserId = params.get('userId') || '';
if (initialUserId) {
  state.inputValue = initialUserId;
  if (isHexAddress(initialUserId)) {
    state.userId = normalizeAddress(initialUserId);
    state.started = true;
    state.status = { status: 'pending' };
  }
}

const appRoot = document.getElementById('app');
render();
if (state.started && isHexAddress(state.userId)) {
  prepareFlow(false);
} else if (initialUserId && looksLikeEnsName(initialUserId)) {
  prepareFlow(false);
}

function render() {
  const isMobile = MOBILE_RE.test(navigator.userAgent);
  const canLaunch = isHexAddress(state.userId);
  const statusKey = state.resolving ? 'verifying' : (state.status.status || 'idle');
  const statusLabel = ({
    idle: 'Awaiting setup',
    pending: 'Waiting for proof',
    verifying: 'Verifying proof',
    verified: 'Verified',
    success: 'Verified',
    failed: 'Verification failed',
    error: 'Needs attention',
  })[statusKey] || 'Awaiting setup';

  appRoot.innerHTML = \`
    <section class="card">
      <div class="card-head">
        <div class="head-top">
          <div>
            <div class="kicker">DeviantClaw Verify</div>
            <h1>Verify</h1>
          </div>
          <span class="status-pill status-\${statusKey}">\${statusLabel}</span>
        </div>
        <div class="subtle">Enter a wallet or ENS name, then launch Self.</div>
      </div>
      <div>
        <label class="field-label" for="wallet-address">Wallet or ENS</label>
        <input id="wallet-address" class="field-input" type="text" placeholder="0x..., bitpixi.eth, bitpixi.base.eth" value="\${escapeHtml(state.inputValue || state.userId)}" />
        \${state.ensName && state.userId ? \`<div class="resolved-line">Resolved \${escapeHtml(state.ensName)} to \${escapeHtml(state.userId)}</div>\` : ''}
      </div>
      <div class="button-row">
        <button type="button" id="prepare-button" \${state.resolving ? 'disabled' : ''}>\${state.resolving ? 'Resolving ENS...' : 'Prepare verification'}</button>
        \${isMobile && canLaunch ? \`<a class="action-link secondary" id="open-self-link" href="\${escapeHtml(state.deeplink)}">Open Self</a>\` : \`<button class="secondary" type="button" id="show-qr-button" \${canLaunch ? '' : 'disabled'}>Show QR</button>\`}
      </div>
      <div class="status-copy">\${escapeHtml(state.status.error || state.status.message || (state.resolving ? 'Resolving wallet...' : ''))}</div>
      <div class="qr-shell">
        <div class="qr-box" id="qr-box">
          \${canLaunch ? (isMobile ? \`<a class="action-link" href="\${escapeHtml(state.deeplink)}">Open Self</a>\` : \`<canvas id="qr-canvas" width="240" height="240"></canvas><div class="subtle">Scan with Self.</div>\`) : \`<div class="subtle">Enter a wallet to continue.</div>\`}
        </div>
      </div>
      \${(state.status.status === 'verified' || state.status.status === 'success') && state.status.apiKey ? \`
        <div class="result-card">
          <div class="field-label">API key</div>
          <div class="api-key">\${escapeHtml(state.status.apiKey)}</div>
          <div class="button-row" style="margin-top:12px">
            <button type="button" id="copy-key-button">\${state.copyState === 'copied' ? 'Copied' : 'Copy key'}</button>
            <a class="action-link secondary" href="https://deviantclaw.art/llms.txt" target="_blank" rel="noreferrer">Instructions</a>
          </div>
          <div class="api-key-hint">Use as <code>Authorization: Bearer \${escapeHtml(state.status.apiKey)}</code>.</div>
        </div>
      \` : ''}
      <div class="footer-note"><a href="https://deviantclaw.art">Back to gallery</a></div>
    </section>
  \`;

  document.getElementById('wallet-address').addEventListener('input', onInputChange);
  document.getElementById('prepare-button').addEventListener('click', () => prepareFlow(true));
  const showQrButton = document.getElementById('show-qr-button');
  if (showQrButton) showQrButton.addEventListener('click', () => prepareFlow(true));
  const copyButton = document.getElementById('copy-key-button');
  if (copyButton) copyButton.addEventListener('click', copyApiKey);

  if (!isMobile && canLaunch && state.deeplink) {
    const canvas = document.getElementById('qr-canvas');
    if (canvas) {
      QRCode.toCanvas(canvas, state.deeplink, {
        width: 240,
        margin: 1,
        color: {
          dark: '#0a0a0f',
          light: '#ffffff',
        },
      }).catch((error) => {
        state.status = { status: 'error', error: error.message || 'Failed to render QR code.' };
        render();
      });
    }
  }
}

function onInputChange(event) {
  state.inputValue = event.currentTarget.value;
  state.ensName = '';
  const normalized = normalizeAddress(state.inputValue);
  state.userId = isHexAddress(normalized) ? normalized : '';
}

async function prepareFlow(updateHistory) {
  const rawValue = String(state.inputValue || state.userId || '').trim();
  if (!rawValue) {
    state.status = { status: 'failed', error: 'Enter a wallet address or ENS name before launching Self.' };
    render();
    return;
  }

  state.resolving = true;
  state.status = state.status.status === 'verified' || state.status.status === 'success' ? state.status : { status: 'verifying' };
  render();

  let resolution;
  try {
    resolution = await resolveInputValue(rawValue);
  } catch (error) {
    state.resolving = false;
    state.status = { status: 'error', error: error.message || 'Unable to resolve ENS name.' };
    render();
    return;
  }

  if (!resolution || !isHexAddress(resolution.address)) {
    state.resolving = false;
    state.status = { status: 'failed', error: 'Enter a valid wallet address or resolvable ENS name before launching Self.' };
    render();
    return;
  }

  state.userId = resolution.address;
  state.ensName = resolution.ensName || '';
  state.inputValue = resolution.ensName || resolution.address;
  state.started = true;
  state.status = state.status.status === 'verified' || state.status.status === 'success' ? state.status : { status: 'pending' };
  state.deeplink = buildDeeplink(state.userId);
  state.resolving = false;

  if (updateHistory) {
    const next = new URL(window.location.href);
    next.searchParams.set('userId', state.userId);
    window.history.replaceState({}, '', next);
  }

  render();
  pollStatus();
}

function buildDeeplink(userId) {
  const callback = window.location.origin + '/verified?userId=' + encodeURIComponent(userId);
  const selfApp = new SelfAppBuilder({
    version: 2,
    appName: 'DeviantClaw',
    scope: config.scope,
    endpoint: config.endpoint,
    logoBase64: config.logoBase64,
    userId,
    endpointType: config.endpointType,
    userIdType: 'hex',
    deeplinkCallback: callback,
    disclosures: {},
  }).build();
  return getUniversalLink(selfApp);
}

async function pollStatus() {
  if (!state.started || !isHexAddress(state.userId)) return;
  try {
    const response = await fetch('/api/status/' + encodeURIComponent(state.userId), {
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json();
    state.status = payload;
    render();
    if (payload.status === 'verified' || payload.status === 'success' || payload.status === 'failed' || payload.status === 'error') return;
  } catch (error) {
    state.status = { status: 'error', error: error.message || 'Unable to check verification status.' };
    render();
    return;
  }
  window.setTimeout(pollStatus, POLL_INTERVAL_MS);
}

async function copyApiKey() {
  if (!state.status.apiKey) return;
  try {
    await navigator.clipboard.writeText(state.status.apiKey);
    state.copyState = 'copied';
  } catch {
    state.copyState = 'failed';
  }
  render();
  window.setTimeout(() => {
    state.copyState = 'idle';
    render();
  }, 1800);
}

async function resolveInputValue(value) {
  const trimmed = String(value || '').trim();
  if (isHexAddress(trimmed)) {
    return { address: normalizeAddress(trimmed), ensName: '' };
  }

  if (!looksLikeEnsName(trimmed)) {
    return { address: '', ensName: '' };
  }

  const response = await fetch('/api/resolve?value=' + encodeURIComponent(trimmed), {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to resolve ENS name.');
  }

  return {
    address: normalizeAddress(payload.address),
    ensName: String(payload.ensName || trimmed).toLowerCase(),
  };
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function isHexAddress(value) {
  return /^0x[a-f0-9]{40}$/i.test(String(value || '').trim());
}

function looksLikeEnsName(value) {
  const trimmed = String(value || '').trim();
  return /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(trimmed) && /\.eth$/i.test(trimmed);
}

function formatTimestamp(value) {
  if (!value) return 'just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
`;
