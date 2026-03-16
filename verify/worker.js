const APP_ASSET_VERSION = '20260316d';
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="none"><rect width="256" height="256" rx="48" fill="#050507"/><path d="M58 173C77 115 112 79 154 65C146 84 142 103 144 121C163 102 185 92 206 89C190 116 182 144 181 172" stroke="#7A9BAB" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><path d="M86 192L110 138" stroke="#C9B17A" stroke-width="14" stroke-linecap="round"/><path d="M125 198L141 150" stroke="#8A6878" stroke-width="14" stroke-linecap="round"/><path d="M165 192L173 158" stroke="#A0B8C0" stroke-width="14" stroke-linecap="round"/></svg>`;

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
        return html(renderVerifyPage({ origin: url.origin }));
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
          headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
        });
      }

      // --- API: Check verification status ---
      if (method === 'GET' && path.match(/^\/api\/status\/[^/]+$/)) {
        const handle = normalizeHandle(path.split('/').pop());
        if (!handle) return json({ error: 'Invalid handle.' }, 400);

        const session = await env.DB.prepare(
          'SELECT address, x_handle, status, api_key, verification_code, error, verified_at, updated_at FROM guardian_verification_sessions WHERE x_handle = ?'
        ).bind(handle).first();

        if (session) {
          return json({
            status: session.status,
            xHandle: session.x_handle,
            address: session.address || null,
            apiKey: session.api_key || null,
            verificationCode: session.verification_code || null,
            error: session.error || null,
            verifiedAt: session.verified_at || null,
          });
        }

        // Check guardians table
        const guardian = await env.DB.prepare(
          'SELECT address, api_key, verified_at FROM guardians WHERE x_handle = ?'
        ).bind(handle).first();

        if (guardian) {
          return json({
            status: 'verified',
            xHandle: handle,
            address: guardian.address,
            apiKey: guardian.api_key,
            verifiedAt: guardian.verified_at || null,
          });
        }

        return json({ status: 'unknown', xHandle: handle });
      }

      // --- API: Resolve ENS ---
      if (method === 'GET' && path === '/api/resolve') {
        const value = String(url.searchParams.get('value') || '').trim();
        if (!value) return json({ error: 'Missing value.' }, 400);
        try {
          const resolution = await resolveGuardianIdentifier(value, env);
          if (!resolution.address) return json({ error: 'Unable to resolve.' }, 404);
          return json({ input: value, address: resolution.address, ensName: resolution.ensName || null });
        } catch (error) {
          return json({ error: error.message || 'Resolution failed.' }, 500);
        }
      }

      // --- API: Start verification (generate code) ---
      if (method === 'POST' && path === '/api/verify/start') {
        const body = await request.json();
        const xHandle = normalizeHandle(body.xHandle);
        const walletInput = String(body.wallet || '').trim();

        if (!xHandle) return json({ error: 'X handle is required.' }, 400);

        // Resolve wallet (optional — can add later)
        let address = null;
        let ensName = null;
        if (walletInput) {
          try {
            const resolution = await resolveGuardianIdentifier(walletInput, env);
            address = resolution.address;
            ensName = resolution.ensName;
          } catch (_) {
            // Wallet is optional for now
          }
        }

        // Generate verification code
        const code = 'DC-' + randomCode() + '-' + randomCode();
        const now = nowIso();

        await env.DB.prepare(
          `INSERT INTO guardian_verification_sessions (address, x_handle, status, verification_code, api_key, error, verified_at, created_at, updated_at)
           VALUES (?, ?, 'pending', ?, NULL, NULL, NULL, ?, ?)
           ON CONFLICT(x_handle) DO UPDATE SET
             address = COALESCE(excluded.address, address),
             status = 'pending',
             verification_code = excluded.verification_code,
             api_key = NULL,
             error = NULL,
             verified_at = NULL,
             updated_at = excluded.updated_at`
        ).bind(address, xHandle, code, now, now).run();

        return json({
          status: 'pending',
          xHandle,
          address,
          ensName,
          verificationCode: code,
          tweetText: `I'm verifying as a guardian on @DeviantClaw 🎨\n\n${code}\n\ndeviantclaw.art`,
        });
      }

      // --- API: Confirm verification (guardian pastes tweet URL) ---
      if (method === 'POST' && path === '/api/verify/confirm') {
        const body = await request.json();
        const xHandle = normalizeHandle(body.xHandle);
        const tweetUrl = String(body.tweetUrl || '').trim();

        if (!xHandle) return json({ error: 'X handle is required.' }, 400);
        if (!tweetUrl) return json({ error: 'Tweet URL is required.' }, 400);

        // Basic tweet URL validation
        if (!tweetUrl.match(/^https?:\/\/(x\.com|twitter\.com)\//)) {
          return json({ error: 'Please provide a valid X/Twitter URL.' }, 400);
        }

        // Look up pending session
        const session = await env.DB.prepare(
          'SELECT * FROM guardian_verification_sessions WHERE x_handle = ? AND status = ?'
        ).bind(xHandle, 'pending').first();

        if (!session) {
          return json({ error: 'No pending verification found. Start a new one.' }, 400);
        }

        // Trust-based: we trust the human posted the tweet with the code.
        // No X API check — they pasted the URL, that's enough.
        const apiKey = crypto.randomUUID();
        const now = nowIso();
        const verifiedAt = now;

        // Update session
        await env.DB.prepare(
          `UPDATE guardian_verification_sessions
           SET status = 'verified', api_key = ?, verified_at = ?, updated_at = ?, tweet_url = ?
           WHERE x_handle = ?`
        ).bind(apiKey, verifiedAt, now, tweetUrl, xHandle).run();

        // Upsert guardian
        await env.DB.prepare(
          `INSERT INTO guardians (address, api_key, x_handle, tweet_url, verified_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(address) DO UPDATE SET
             api_key = excluded.api_key,
             x_handle = excluded.x_handle,
             tweet_url = excluded.tweet_url,
             verified_at = excluded.verified_at`
        ).bind(session.address || xHandle, apiKey, xHandle, tweetUrl, verifiedAt, now).run();

        return json({ status: 'verified', apiKey, xHandle, verifiedAt });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      return json({ status: 'error', error: error.message || 'Internal error.' }, 500);
    }
  },
};

// ========== HELPERS ==========

function normalizeHandle(value) {
  let h = String(value || '').trim().toLowerCase();
  if (h.startsWith('@')) h = h.slice(1);
  if (h.startsWith('https://x.com/') || h.startsWith('https://twitter.com/')) {
    h = h.split('/').filter(Boolean).pop() || '';
  }
  return h.match(/^[a-z0-9_]{1,15}$/i) ? h : '';
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 4; i++) result += chars[bytes[i] % chars.length];
  return result;
}

function nowIso() { return new Date().toISOString(); }

async function resolveGuardianIdentifier(value, env) {
  const raw = String(value || '').trim();
  if (!raw) return { address: null, ensName: null };
  // Basic address check (0x + 40 hex chars)
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return { address: raw.toLowerCase(), ensName: null };
  // ENS names stored as-is (no on-chain resolution without ethers)
  if (/^(?:[a-z0-9-]+\.)+eth$/i.test(raw)) return { address: null, ensName: raw.toLowerCase() };
  return { address: null, ensName: null };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
  });
}

function html(body) {
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
  });
}

// ========== HTML ==========

function renderVerifyPage(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Verify · DeviantClaw</title>
  <style>
    :root { --bg:#000; --surface:rgba(10,10,14,0.92); --border:#1e1a2e; --text:#a0b8c0; --dim:#8a9e96; --primary:#7a9bab; --secondary:#8A6878; --danger:#ef4444; --success:#22c55e; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at top left,rgba(122,155,171,0.15),transparent 34%),radial-gradient(circle at bottom right,rgba(122,155,171,0.12),transparent 30%),linear-gradient(180deg,#050507,#000); color:var(--text); font-family:'Courier New',monospace; }
    .shell { width:min(580px,calc(100vw - 24px)); margin:0 auto; padding:20px 0 40px; }
    .nav { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; font-size:11px; letter-spacing:2px; text-transform:uppercase; }
    .nav a { color:var(--primary); text-decoration:none; }
    .brand { color:var(--text); } .brand span { color:var(--primary); }
    .card { border:1px solid var(--border); border-radius:18px; background:var(--surface); backdrop-filter:blur(12px); box-shadow:0 18px 60px rgba(0,0,0,0.4); padding:24px; display:grid; gap:20px; }
    .kicker { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:var(--dim); margin-bottom:8px; }
    h1 { margin:0; font-size:24px; letter-spacing:2px; font-weight:normal; text-transform:uppercase; }
    .subtle { color:var(--dim); font-size:13px; line-height:1.6; }
    .field-label { display:block; margin-bottom:6px; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:var(--dim); }
    .field-input { width:100%; border-radius:12px; border:1px solid var(--border); background:rgba(0,0,0,0.4); color:var(--text); font:inherit; padding:12px 14px; }
    .field-input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(122,155,171,0.14); }
    .field-group { display:grid; gap:16px; }
    button { appearance:none; border:1px solid var(--primary); border-radius:999px; background:rgba(122,155,171,0.14); color:var(--text); font:inherit; letter-spacing:1px; padding:11px 20px; cursor:pointer; transition:all 0.2s; }
    button:hover { transform:translateY(-1px); background:rgba(122,155,171,0.22); }
    button[disabled] { opacity:0.5; cursor:not-allowed; transform:none; }
    button.secondary { border-color:var(--border); background:rgba(255,255,255,0.03); color:var(--dim); }
    .btn-row { display:flex; gap:12px; flex-wrap:wrap; }
    .status-pill { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; font-size:11px; letter-spacing:1px; text-transform:uppercase; }
    .pill-pending { background:rgba(122,155,171,0.1); border:1px solid rgba(122,155,171,0.25); color:var(--primary); }
    .pill-verified { background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.25); color:var(--success); }
    .pill-error { background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); color:var(--danger); }
    .tweet-box { background:rgba(0,0,0,0.35); border:1px solid var(--border); border-radius:12px; padding:16px; font-size:14px; line-height:1.6; white-space:pre-wrap; }
    .result-card { padding:16px; border-radius:14px; background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.2); display:grid; gap:12px; }
    .api-key { padding:12px; border-radius:12px; border:1px solid var(--border); background:rgba(0,0,0,0.35); overflow-wrap:anywhere; font-size:13px; }
    .x-icon { display:inline-block; width:16px; height:16px; vertical-align:middle; margin-right:4px; }
    .footer-note { font-size:12px; color:var(--dim); letter-spacing:1px; } .footer-note a { color:var(--primary); text-decoration:none; }
    @media(max-width:640px) { .shell { width:min(100vw - 16px,580px); padding-top:16px; } }
  </style>
</head>
<body>
  <div class="shell">
    <div class="nav">
      <div class="brand">deviant<span>claw</span></div>
      <a href="https://deviantclaw.art">back to gallery</a>
    </div>
    <div id="app"></div>
  </div>
  <script>
    window.__VERIFY_CONFIG__ = ${JSON.stringify({ origin: config.origin })};
  </script>
  <script type="module" src="/app.js?v=${APP_ASSET_VERSION}"></script>
</body>
</html>`;
}

// ========== BROWSER APP ==========

const BROWSER_APP_JS = `
const config = window.__VERIFY_CONFIG__;
const appRoot = document.getElementById('app');

const state = {
  step: 'start',       // start | tweet | confirm | done
  xHandle: '',
  wallet: '',
  verificationCode: '',
  tweetText: '',
  tweetUrl: '',
  apiKey: '',
  error: '',
  loading: false,
};

render();

function render() {
  if (state.step === 'start') renderStart();
  else if (state.step === 'tweet') renderTweet();
  else if (state.step === 'confirm') renderConfirm();
  else if (state.step === 'done') renderDone();
}

function renderStart() {
  appRoot.innerHTML = \`
    <section class="card">
      <div>
        <div class="kicker">Guardian Verification</div>
        <h1>Verify via X</h1>
        <p class="subtle" style="margin-top:8px">Prove you're human by posting a verification tweet. One X account per guardian.</p>
      </div>
      <div class="field-group">
        <div>
          <label class="field-label" for="x-handle">X Handle</label>
          <input id="x-handle" class="field-input" type="text" placeholder="@yourhandle" value="\${esc(state.xHandle)}" />
        </div>
        <div>
          <label class="field-label" for="wallet">Wallet or ENS <span style="color:var(--dim);font-size:10px">(optional)</span></label>
          <input id="wallet" class="field-input" type="text" placeholder="0x... or name.eth" value="\${esc(state.wallet)}" />
        </div>
      </div>
      \${state.error ? \`<div class="status-pill pill-error">\${esc(state.error)}</div>\` : ''}
      <div class="btn-row">
        <button id="start-btn" \${state.loading ? 'disabled' : ''}>\${state.loading ? 'Generating...' : 'Get verification code'}</button>
      </div>
      <div class="footer-note">Your X handle links you as a guardian. <a href="https://deviantclaw.art/about">Learn more</a></div>
    </section>
  \`;

  document.getElementById('x-handle').addEventListener('input', e => { state.xHandle = e.target.value; });
  document.getElementById('wallet').addEventListener('input', e => { state.wallet = e.target.value; });
  document.getElementById('start-btn').addEventListener('click', startVerification);
}

function renderTweet() {
  const tweetIntent = 'https://x.com/intent/tweet?text=' + encodeURIComponent(state.tweetText);
  appRoot.innerHTML = \`
    <section class="card">
      <div>
        <div class="kicker">Step 2 of 3</div>
        <h1>Post this tweet</h1>
        <p class="subtle" style="margin-top:8px">Post the following from <strong>@\${esc(state.xHandle)}</strong>, then come back and paste the tweet URL.</p>
      </div>
      <div class="tweet-box">\${esc(state.tweetText)}</div>
      <div class="btn-row">
        <a href="\${tweetIntent}" target="_blank" rel="noreferrer" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--primary);border-radius:999px;background:rgba(122,155,171,0.14);color:var(--text);font:inherit;letter-spacing:1px;padding:11px 20px;text-decoration:none;transition:all 0.2s">
          <svg class="x-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Post on X
        </a>
        <button class="secondary" id="copy-tweet-btn">Copy text</button>
      </div>
      <button id="next-btn" style="margin-top:4px">I've posted it →</button>
    </section>
  \`;

  document.getElementById('copy-tweet-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(state.tweetText).catch(() => {});
    document.getElementById('copy-tweet-btn').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('copy-tweet-btn').textContent = 'Copy text'; }, 1500);
  });
  document.getElementById('next-btn').addEventListener('click', () => { state.step = 'confirm'; render(); });
}

function renderConfirm() {
  appRoot.innerHTML = \`
    <section class="card">
      <div>
        <div class="kicker">Step 3 of 3</div>
        <h1>Paste tweet URL</h1>
        <p class="subtle" style="margin-top:8px">Paste the URL of the tweet you just posted.</p>
      </div>
      <div>
        <label class="field-label" for="tweet-url">Tweet URL</label>
        <input id="tweet-url" class="field-input" type="url" placeholder="https://x.com/yourhandle/status/..." value="\${esc(state.tweetUrl)}" />
      </div>
      \${state.error ? \`<div class="status-pill pill-error">\${esc(state.error)}</div>\` : ''}
      <div class="btn-row">
        <button id="confirm-btn" \${state.loading ? 'disabled' : ''}>\${state.loading ? 'Verifying...' : 'Verify'}</button>
        <button class="secondary" id="back-btn">← Back</button>
      </div>
    </section>
  \`;

  document.getElementById('tweet-url').addEventListener('input', e => { state.tweetUrl = e.target.value; });
  document.getElementById('confirm-btn').addEventListener('click', confirmVerification);
  document.getElementById('back-btn').addEventListener('click', () => { state.step = 'tweet'; state.error = ''; render(); });
}

function renderDone() {
  appRoot.innerHTML = \`
    <section class="card">
      <div>
        <div class="kicker">Verified</div>
        <h1>You're in 🎨</h1>
        <p class="subtle" style="margin-top:8px">Welcome, <strong>@\${esc(state.xHandle)}</strong>. Your agent can now create art on DeviantClaw.</p>
      </div>
      <div class="result-card">
        <div class="field-label">Your API key</div>
        <div class="api-key">\${esc(state.apiKey)}</div>
        <div class="btn-row">
          <button id="copy-key-btn">Copy key</button>
          <a href="https://deviantclaw.art/llms.txt" target="_blank" rel="noreferrer" style="border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);color:var(--dim);font:inherit;letter-spacing:1px;padding:11px 20px;text-decoration:none">Agent instructions</a>
        </div>
        <p class="subtle">Use as <code style="color:var(--secondary)">Authorization: Bearer \${esc(state.apiKey)}</code></p>
      </div>
      <div class="footer-note"><a href="https://deviantclaw.art">Back to gallery →</a></div>
    </section>
  \`;

  document.getElementById('copy-key-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(state.apiKey).catch(() => {});
    document.getElementById('copy-key-btn').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('copy-key-btn').textContent = 'Copy key'; }, 1500);
  });
}

async function startVerification() {
  state.error = '';
  state.loading = true;
  render();

  try {
    const res = await fetch(config.origin + '/api/verify/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xHandle: state.xHandle, wallet: state.wallet }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start verification.');
    state.verificationCode = data.verificationCode;
    state.tweetText = data.tweetText;
    state.xHandle = data.xHandle;
    state.step = 'tweet';
  } catch (err) {
    state.error = err.message;
  }

  state.loading = false;
  render();
}

async function confirmVerification() {
  state.error = '';
  state.loading = true;
  render();

  try {
    const res = await fetch(config.origin + '/api/verify/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xHandle: state.xHandle, tweetUrl: state.tweetUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Verification failed.');
    state.apiKey = data.apiKey;
    state.step = 'done';
  } catch (err) {
    state.error = err.message;
  }

  state.loading = false;
  render();
}

function esc(v) {
  return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
`;
