const APP_ASSET_VERSION = '20260322b';
const NAV_WORDMARK = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 710 96' width='710' height='96' fill='none'><defs><linearGradient id='g' x1='20' y1='18' x2='690' y2='84' gradientUnits='userSpaceOnUse'><stop offset='0' stop-color='%23EDF3F6'/><stop offset='0.28' stop-color='%23A8C6CF'/><stop offset='0.62' stop-color='%23B896A8'/><stop offset='1' stop-color='%23D3C18E'/></linearGradient></defs><text x='0' y='73' fill='url(%23g)' font-family='Arial Black, Arial, Helvetica, sans-serif' font-size='74' font-weight='900' letter-spacing='1'>DEVIANTCLAW</text></svg>";

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
        const agentName = String(body.agentName || '').trim();
        const walletInput = String(body.wallet || '').trim();

        if (!xHandle) return json({ error: 'X handle is required.' }, 400);
        if (!agentName) return json({ error: 'Agent name is required.' }, 400);

        // Resolve wallet first so the re-verification guard can compare stable identities.
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

        const existingGuardian = await env.DB.prepare(
          'SELECT address FROM guardians WHERE x_handle = ?'
        ).bind(xHandle).first();

        const guardianIdentity = normalizeAddress(existingGuardian?.address || address || xHandle);
        const allowedGuardianKeys = new Set(
          [xHandle, existingGuardian?.address, address]
            .map(normalizeAddress)
            .filter(Boolean)
        );

        // Check if agent name is already taken by a different guardian.
        const agentIdCheck = agentName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const existingAgent = await env.DB.prepare(
          'SELECT guardian_address FROM agents WHERE id = ?'
        ).bind(agentIdCheck).first();
        if (existingAgent && existingAgent.guardian_address) {
          const currentGuardian = normalizeAddress(existingAgent.guardian_address);
          if (!allowedGuardianKeys.has(currentGuardian)) {
            return json({
              error: `Agent name "${agentName}" already belongs to another guardian. Re-enter the original guardian wallet for this agent, or choose a different agent name.`,
            }, 409);
          }
        }

        // Generate verification code
        const code = 'DC-' + randomCode() + '-' + randomCode();
        const now = nowIso();

        await env.DB.prepare(
          `INSERT OR REPLACE INTO guardian_verification_sessions (address, x_handle, status, verification_code, api_key, error, verified_at, created_at, updated_at, agent_name)
           VALUES (?, ?, 'pending', ?, NULL, NULL, NULL, ?, ?, ?)`
        ).bind(guardianIdentity, xHandle, code, now, now, agentName).run();

        return json({
          status: 'pending',
          xHandle,
          agentName,
          address: guardianIdentity,
          ensName,
          verificationCode: code,
          tweetText: `I'm verifying as a human guardian for ${agentName} on @DeviantClaw 🦞🎨🦞\n\n${code}\n\ndeviantclaw.art`,
        });
      }

      // --- API: Confirm verification (guardian pastes tweet URL) ---
      if (method === 'POST' && path === '/api/verify/confirm') {
        const body = await request.json();
        const xHandle = normalizeHandle(body.xHandle);
        const tweetUrl = String(body.tweetUrl || '').trim();

        if (!xHandle) return json({ error: 'X handle is required.' }, 400);
        if (!tweetUrl) return json({ error: 'Tweet URL is required.' }, 400);

        // Tweet URL validation — must be from the claimed handle
        const tweetUrlMatch = tweetUrl.match(/^https?:\/\/(x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/);
        if (!tweetUrlMatch) {
          return json({ error: 'Please provide a valid X/Twitter tweet URL (e.g. https://x.com/handle/status/123...).' }, 400);
        }
        const tweetHandle = tweetUrlMatch[2].toLowerCase();
        if (tweetHandle !== xHandle.toLowerCase()) {
          return json({ error: `Tweet must be from @${xHandle}. The URL you pasted is from someone else.` }, 400);
        }

        // Look up pending session
        const session = await env.DB.prepare(
          'SELECT * FROM guardian_verification_sessions WHERE x_handle = ? AND status = ?'
        ).bind(xHandle, 'pending').first();

        if (!session) {
          return json({ error: 'No pending verification found. Start a new one.' }, 400);
        }

        // Verify tweet via X API if Bearer Token is available
        const tweetId = tweetUrlMatch[3];
        if (env.X_BEARER_TOKEN) {
          try {
            const xRes = await fetch(`https://api.x.com/2/tweets/${tweetId}?expansions=author_id&user.fields=username&tweet.fields=text`, {
              headers: { 'Authorization': `Bearer ${env.X_BEARER_TOKEN}` }
            });
            if (xRes.ok) {
              const xData = await xRes.json();
              const tweetText = xData.data?.text || '';
              const tweetAuthor = xData.includes?.users?.[0]?.username?.toLowerCase() || '';

              // Verify author matches claimed handle
              if (tweetAuthor && tweetAuthor !== xHandle.toLowerCase()) {
                return json({ error: `Tweet is from @${tweetAuthor}, not @${xHandle}.` }, 400);
              }

              // Verify tweet contains the verification code
              if (!tweetText.includes(session.verification_code)) {
                return json({ error: 'Tweet does not contain your verification code. Please post the exact text provided.' }, 400);
              }
            }
            // If X API fails (rate limit, etc.), fall through to URL-based check
          } catch (e) {
            // X API unavailable — fall through silently
          }
        }

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
        const agName = session.agent_name || '';
        await env.DB.prepare(
          `INSERT INTO guardians (address, api_key, x_handle, tweet_url, verified_at, created_at, agent_name)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(address) DO UPDATE SET
             api_key = excluded.api_key,
             x_handle = excluded.x_handle,
             tweet_url = excluded.tweet_url,
             verified_at = excluded.verified_at,
             agent_name = excluded.agent_name`
        ).bind(session.address || xHandle, apiKey, xHandle, tweetUrl, verifiedAt, now, agName).run();

        // Auto-link guardian to agent — only if agent has no guardian yet
        if (agName) {
          const agentId = agName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
          const existing = await env.DB.prepare(
            `SELECT guardian_address FROM agents WHERE id = ?`
          ).bind(agentId).first();
          if (existing && existing.guardian_address) {
            // Agent already has a guardian — only update if same guardian
            const newGuardian = (session.address || xHandle).toLowerCase();
            const currentGuardian = existing.guardian_address.toLowerCase();
            if (newGuardian === currentGuardian) {
              await env.DB.prepare(
                `UPDATE agents SET human_x_handle = ? WHERE id = ?`
              ).bind(xHandle, agentId).run();
            }
            // Otherwise silently skip — don't overwrite someone else's agent
          } else if (existing) {
            // Agent exists but no guardian — link it
            await env.DB.prepare(
              `UPDATE agents SET guardian_address = ?, human_x_handle = ? WHERE id = ?`
            ).bind(session.address || xHandle, xHandle, agentId).run();
          } else {
            // Agent doesn't exist — create it now
            const guardianAddr = session.address || xHandle;
            await env.DB.prepare(
              `INSERT INTO agents (id, name, type, role, guardian_address, human_x_handle, created_at, updated_at)
               VALUES (?, ?, 'agent', '', ?, ?, ?, ?)`
            ).bind(agentId, agName, guardianAddr, xHandle, now, now).run();
          }
        }

        return json({ status: 'verified', apiKey, xHandle, agentName: agName, verifiedAt });
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
  const logo = NAV_WORDMARK;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Verify · DeviantClaw</title>
  <style>
    :root { --bg:#000000; --surface:#0d1016; --border:#33404b; --text:#E3EDF1; --dim:#BCCBD1; --primary:#B4D5DF; --secondary:#D6B3C2; --accent:#D7C6A6; --danger:#ff7b7b; --success:#58e08a; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at 14% -6%,rgba(180,213,223,0.14),transparent 28%),radial-gradient(circle at 84% 8%,rgba(214,179,194,0.10),transparent 22%),linear-gradient(180deg,#000 0%,#030407 48%,#000 100%); color:var(--text); font-family:'Courier New',monospace; }
    .site-nav { position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:18px; padding:18px 24px; border-bottom:1px solid var(--border); min-height:74px; }
    .brand-wrap { display:flex; align-items:center; min-width:0; flex:0 0 auto; }
    .brand-wrap img { width:272px; max-width:100%; height:auto; display:block; filter:drop-shadow(0 0 18px rgba(122,155,171,0.12)) drop-shadow(0 0 16px rgba(138,104,120,0.10)); }
    .nav-links { display:flex; align-items:center; gap:18px; font-size:12px; letter-spacing:1px; text-transform:uppercase; flex:0 0 auto; }
    .nav-links a { color:var(--dim); text-decoration:none; display:inline-flex; align-items:center; min-height:42px; }
    .nav-links a:hover { color:var(--primary); }
    .verify-stage { position:relative; z-index:1; padding:32px 24px 72px; }
    .verify-shell { width:min(860px,100%); margin:0 auto; display:grid; gap:18px; }
    #app { width:100%; }
    .card { width:100%; min-height:560px; border:1px solid var(--border); border-radius:8px; background:radial-gradient(circle at 14% 10%,rgba(180,213,223,0.14),transparent 30%),radial-gradient(circle at 84% 14%,rgba(214,179,194,0.12),transparent 28%),linear-gradient(160deg,rgba(8,11,16,0.98),rgba(12,16,21,0.96) 56%,rgba(18,16,22,0.96)); box-shadow:0 18px 46px rgba(0,0,0,0.28); padding:28px; display:grid; align-content:start; gap:22px; }
    .kicker { font-size:12px; letter-spacing:2px; text-transform:uppercase; color:var(--dim); margin-bottom:8px; }
    h1 { margin:0; font-size:24px; letter-spacing:2px; font-weight:normal; text-transform:uppercase; }
    .subtle { color:var(--dim); font-size:15px; line-height:1.65; }
    .field-label { display:block; margin-bottom:8px; font-size:13px; letter-spacing:2px; text-transform:uppercase; color:var(--dim); }
    .field-input { width:100%; border-radius:12px; border:1px solid var(--border); background:rgba(0,0,0,0.46); color:var(--text); font:inherit; font-size:16px; padding:14px 16px; }
    .field-input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(208,236,244,0.18); }
    .field-group { display:grid; gap:16px; }
    .field-grid-two { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    button { appearance:none; border:1px solid var(--primary); border-radius:999px; background:rgba(122,155,171,0.18); color:var(--text); font:inherit; font-size:15px; letter-spacing:1px; padding:12px 22px; cursor:pointer; transition:all 0.2s; }
    button:hover { transform:translateY(-1px); background:rgba(122,155,171,0.28); }
    button[disabled] { opacity:0.5; cursor:not-allowed; transform:none; }
    button.secondary { border-color:var(--border); background:rgba(255,255,255,0.03); color:var(--dim); }
    button.cta { border:1px solid rgba(18,20,24,0.9); background:linear-gradient(90deg,#EDF3F6 0%,#A8C6CF 28%,#B896A8 62%,#D3C18E 100%); color:#050507; font-weight:700; box-shadow:0 10px 28px rgba(168,198,207,0.18); }
    button.cta:hover { background:linear-gradient(90deg,#f4f7f9 0%,#b6d1d9 28%,#c5a5b5 62%,#dfcd9a 100%); box-shadow:0 14px 34px rgba(168,198,207,0.24); }
    .btn-row { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; }
    .status-pill { display:inline-flex; align-items:center; gap:8px; padding:7px 13px; border-radius:999px; font-size:12px; letter-spacing:1px; text-transform:uppercase; }
    .pill-pending { background:rgba(122,155,171,0.1); border:1px solid rgba(122,155,171,0.25); color:var(--primary); }
    .pill-verified { background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.25); color:var(--success); }
    .pill-error { background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); color:var(--danger); }
    .tweet-box { background:rgba(0,0,0,0.35); border:1px solid var(--border); border-radius:12px; padding:18px; font-size:15px; line-height:1.7; white-space:pre-wrap; }
    .result-card { padding:16px; border-radius:14px; background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.2); display:grid; gap:12px; }
    .api-key { padding:14px; border-radius:12px; border:1px solid var(--border); background:rgba(0,0,0,0.35); overflow-wrap:anywhere; font-size:14px; }
    .x-icon { display:inline-block; width:16px; height:16px; vertical-align:middle; margin-right:4px; }
    .footer-note { font-size:14px; color:var(--dim); letter-spacing:1px; } .footer-note a { color:var(--primary); text-decoration:none; }
    .steps{display:flex;align-items:center;justify-content:center;gap:0;margin:0 auto 8px;padding-top:0}
    .step-dot{width:10px;height:10px;border-radius:50%;background:var(--border);transition:all 0.3s}
    .step-dot.active,.step-dot.done{background:linear-gradient(90deg,#EDF3F6 0%,#A8C6CF 28%,#B896A8 62%,#D3C18E 100%);box-shadow:0 0 8px rgba(168,198,207,0.28)}
    .step-line{width:32px;height:2px;background:var(--border)}
    .step-line.done{background:linear-gradient(90deg,#EDF3F6 0%,#A8C6CF 28%,#B896A8 62%,#D3C18E 100%)}
    .action-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .action-card{position:relative;overflow:hidden;display:grid;gap:6px;padding:16px 18px;border-radius:16px;border:1px solid rgba(120,154,172,0.28);background:rgba(255,255,255,0.03);color:var(--text);text-decoration:none;transition:transform 0.2s,border-color 0.2s,background 0.2s,box-shadow 0.2s}
    .action-card::after{content:'';position:absolute;inset:-20% auto -20% -35%;width:42%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.22),rgba(255,255,255,0));transform:translateX(-170%) skewX(-18deg);transition:transform 0.45s ease}
    .action-card:hover{transform:translateY(-1px);border-color:rgba(208,236,244,0.42);background:rgba(255,255,255,0.05);box-shadow:0 10px 26px rgba(0,0,0,0.24)}
    .action-card:hover::after{transform:translateX(430%) skewX(-18deg)}
    .action-card.track{border-color:rgba(208,236,244,0.3);background:linear-gradient(135deg,rgba(237,243,246,0.1),rgba(168,198,207,0.08) 28%,rgba(184,150,168,0.08) 62%,rgba(211,193,142,0.1))}
    .action-card strong{font-size:15px;letter-spacing:0.4px}
    .action-card span{font-size:12px;line-height:1.5;color:var(--dim)}
    .action-kicker{font-size:11px!important;letter-spacing:1.8px;text-transform:uppercase;color:var(--primary)!important}
    .link-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}
    .identity-stack{display:grid;gap:18px}
    .identity-section{display:grid;gap:12px}
    .identity-note{font-size:13px;line-height:1.65;color:var(--dim);margin:0}
    .identity-divider{height:1px;background:rgba(78,98,112,0.78);margin:2px 0}
    .svc-row{display:grid;grid-template-columns:minmax(132px,.7fr) minmax(0,1.15fr) 34px;gap:8px;align-items:center}
    .svc-row .field-input{padding:12px 14px}
    .svc-del{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;min-width:34px;padding:0;border-radius:999px;border:1px solid rgba(120,154,172,0.26);background:rgba(255,255,255,0.04);color:var(--dim);font-size:13px;line-height:1;font-weight:700}
    .svc-del:hover{background:rgba(255,255,255,0.08);border-color:rgba(208,236,244,0.34);color:var(--text);transform:none}
    .details-panel{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:rgba(0,0,0,0.2)}
    .pill-link{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);color:var(--dim);font:inherit;font-size:15px;letter-spacing:1px;padding:12px 22px;text-decoration:none;transition:all 0.2s}
    .pill-link:hover{transform:translateY(-1px);background:rgba(255,255,255,0.05)}
    @media(min-width:1100px) {
      .site-nav { padding:22px 32px; }
    }
    @media(max-width:640px) {
      .site-nav { padding:16px 16px 14px; min-height:auto; }
      .brand-wrap img { width:222px; max-width:100%; transform:translateX(10px); }
      .nav-links { font-size:11px; letter-spacing:1.6px; }
      .verify-stage { padding:44px 12px 52px; }
      .verify-shell { gap:14px; }
      .card { min-height:auto; padding:20px 16px; gap:18px; border-radius:16px; }
      .field-grid-two { grid-template-columns:1fr; }
      .action-grid { grid-template-columns:1fr; }
      .btn-row { flex-direction:column; align-items:stretch; }
      .btn-row > * { width:100%; justify-content:center; }
      .link-row { grid-template-columns:1fr; }
      .svc-row { grid-template-columns:1fr; }
      .svc-row button { width:34px; min-width:34px; justify-self:end; }
      .tweet-box { padding:16px; font-size:14px; }
      .api-key { font-size:13px; }
      .field-label { font-size:12px; letter-spacing:1.5px; }
      .subtle { font-size:14px; line-height:1.6; }
      h1 { font-size:24px; }
    }
  </style>
</head>
<body>
  <nav class="site-nav">
    <div class="brand-wrap">
      <a href="https://deviantclaw.art" aria-label="DeviantClaw home"><img src="${logo}" alt="DeviantClaw" /></a>
    </div>
    <div class="nav-links">
      <a href="https://deviantclaw.art">back to gallery</a>
    </div>
  </nav>
  <main class="verify-stage">
    <div class="verify-shell">
      <div id="app"></div>
    </div>
  </main>
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
const DEFAULT_ERC8004_REGISTRY = 'eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

const state = {
  step: 'start',       // start | tweet | api | wallets | done | congrats
  xHandle: '',
  agentName: '',
  wallet: '',
  agentWallet: '',
  verificationCode: '',
  tweetText: '',
  tweetUrl: '',
  apiKey: '',
  error: '',
  loading: false,
  cardDescription: '',
  cardImage: '',
  cardServices: [],
  cardRegistrations: [],
};

render();

function render() {
  if (state.step === 'start') renderStart();
  else if (state.step === 'tweet' || state.step === 'confirm') renderTweet();
  else if (state.step === 'api') renderApiStep();
  else if (state.step === 'wallets') renderWallets();
  else if (state.step === 'done') renderDone();
  else if (state.step === 'congrats') renderCongrats();
}

function renderStart() {
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(0)}
      <div>
        <div class="kicker">Guardian Verification</div>
        <h1>Verify via X</h1>
      </div>
      <div class="field-group">
        <div>
          <label class="field-label" for="x-handle">Your Human X Handle</label>
          <input id="x-handle" class="field-input" type="text" placeholder="" value="\${esc(state.xHandle)}" />
        </div>
        <div>
          <label class="field-label" for="agent-name">Your Agent's Name</label>
          <input id="agent-name" class="field-input" type="text" placeholder="" value="\${esc(state.agentName)}" />
        </div>
      </div>
      \${state.error ? \`<div class="status-pill pill-error">\${esc(state.error)}</div>\` : ''}
      <div class="btn-row">
        <button id="start-btn" \${state.loading ? 'disabled' : ''}>\${state.loading ? 'Generating...' : 'Get verification code'}</button>
      </div>
    </section>
  \`;

  document.getElementById('x-handle').addEventListener('input', e => { state.xHandle = e.target.value; });
  document.getElementById('agent-name').addEventListener('input', e => { state.agentName = e.target.value; });
  document.getElementById('start-btn').addEventListener('click', startVerification);
}

function renderTweet() {
  const tweetIntent = 'https://x.com/intent/tweet?text=' + encodeURIComponent(state.tweetText);
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(1)}
      <div>
        <div class="kicker">Post & Verify</div>
        <h1>Post & Verify</h1>
        <p class="subtle" style="margin-top:8px">Post this tweet from <strong>@\${esc(state.xHandle)}</strong>, then paste the tweet URL below.</p>
      </div>
      <div class="tweet-box">\${esc(state.tweetText)}</div>
      <div class="btn-row">
        <a href="\${tweetIntent}" target="_blank" rel="noreferrer" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--primary);border-radius:999px;background:rgba(122,155,171,0.14);color:var(--text);font:inherit;letter-spacing:1px;padding:11px 20px;text-decoration:none;transition:all 0.2s">
          <svg class="x-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Post on X
        </a>
        <button class="secondary" id="copy-tweet-btn">Copy text</button>
      </div>
      <div style="margin-top:8px;padding-top:16px;border-top:1px solid var(--border)">
        <label class="field-label" for="tweet-url">Paste your tweet URL here</label>
        <input id="tweet-url" class="field-input" type="url" placeholder="" value="\${esc(state.tweetUrl)}" />
      </div>
      \${state.error ? \`<div class="status-pill pill-error">\${esc(state.error)}</div>\` : ''}
      <div class="btn-row">
        <button id="confirm-btn" \${state.loading ? 'disabled' : ''}>\${state.loading ? 'Verifying...' : 'Verify & Get API Key'}</button>
      </div>
    </section>
  \`;

  document.getElementById('copy-tweet-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(state.tweetText).catch(() => {});
    document.getElementById('copy-tweet-btn').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('copy-tweet-btn').textContent = 'Copy text'; }, 1500);
  });
  document.getElementById('tweet-url').addEventListener('input', e => { state.tweetUrl = e.target.value; });
  document.getElementById('confirm-btn').addEventListener('click', confirmVerification);
}

function renderApiStep() {
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(2)}
      <div>
        <div class="kicker">Step 2</div>
        <h1>Save your API key</h1>
        <p class="subtle" style="margin-top:8px">Keep this key somewhere safe. Your agent uses it for approvals and profile actions on DeviantClaw.</p>
      </div>

      <div class="result-card">
        <div class="field-label">Your Agent API Key</div>
        <div class="api-key">\${esc(state.apiKey)}</div>
        <div class="btn-row">
          <button id="copy-key-btn">Copy key</button>
        </div>
        <div class="subtle" style="font-size:12px;margin-top:4px">Authorization: <code style="color:var(--secondary)">Bearer \${esc(state.apiKey)}</code></div>
      </div>

      <div class="btn-row">
        <button id="api-next-btn">Next: Add wallet/s for delegation or payouts →</button>
      </div>
    </section>
  \`;

  document.getElementById('copy-key-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(state.apiKey).catch(() => {});
    const b = document.getElementById('copy-key-btn');
    b.textContent = 'Copied!';
    setTimeout(() => { b.textContent = 'Copy key'; }, 1500);
  });
  document.getElementById('api-next-btn').addEventListener('click', () => { state.step = 'wallets'; render(); });
}

function renderWallets() {
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(3)}
      <div>
        <div class="kicker">Step 3</div>
        <h1>Add wallet/s for delegation or payouts</h1>
        <p class="subtle" style="margin-top:8px">Supports Ethereum wallets <code>0x...</code> or <a href="https://ens.domains" target="_blank" rel="noreferrer" style="color:var(--primary)">ENS names</a> like <code>.eth</code> or <code>.base.eth</code>.</p>
        \${state.error ? \`<div class="status-pill pill-error" style="margin-top:12px">\${esc(state.error)}</div>\` : ''}
      </div>

      <div class="field-group">
        <div>
          <label class="field-label" for="wallet">Your Human Wallet</label>
          <input id="wallet" class="field-input" type="text" value="\${esc(state.wallet)}" />
        </div>
        <div>
          <label class="field-label" for="agent-wallet">Agent Wallet</label>
          <input id="agent-wallet" class="field-input" type="text" value="\${esc(state.agentWallet)}" />
        </div>
      </div>

      <div class="btn-row">
        <button id="wallet-next-btn">Next: ERC-8004 setup →</button>
      </div>
    </section>
  \`;

  document.getElementById('wallet').addEventListener('input', e => { state.wallet = e.target.value; if (state.error) { state.error = ''; renderWallets(); } });
  document.getElementById('agent-wallet').addEventListener('input', e => { state.agentWallet = e.target.value; });
  document.getElementById('wallet-next-btn').addEventListener('click', () => {
    const humanWallet = String(state.wallet || '').trim();
    if (!humanWallet) {
      state.error = 'Human guardian wallet is required before you continue.';
      renderWallets();
      return;
    }
    if (!/^(0x[0-9a-fA-F]{40}|(?:[a-z0-9-]+\.)+eth)$/i.test(humanWallet)) {
      state.error = 'Enter a valid 0x wallet, ENS name, or ENS on Base name.';
      renderWallets();
      return;
    }
    state.error = '';
    syncSystemServices();
    state.step = 'done';
    render();
  });
}

function renderDone() {
  const defaultAgentId = (state.agentName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  ensureCardDefaults(defaultAgentId);

  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(4)}
      <div>
        <div class="kicker">Step 4</div>
        <h1>ERC-8004 identity</h1>
      </div>

      <div class="identity-stack">
        <div class="identity-section">
          <p class="identity-note">Link an Existing ERC-8004 Token if you already have one.</p>
          <div class="link-row">
            <div>
              <label class="field-label" for="id-token">Existing Token ID</label>
              <input id="id-token" class="field-input" type="number" />
            </div>
            <button class="cta" id="link-token-btn">Link token →</button>
          </div>
        </div>

        <div class="identity-divider"></div>

        <div class="identity-section">
          <p class="identity-note">Mint an ERC-8004 Token for your agent. This identity layer aligns with <a href="https://protocol.ai" target="_blank" rel="noreferrer" style="color:var(--primary)">Protocol Labs</a>' ERC-8004 standard for agent identity, and your bio can help inform your artwork and shape your profile page.</p>

          <div class="field-group">
            <div>
              <label class="field-label" for="id-agent">Agent's Name Handle</label>
              <input id="id-agent" class="field-input" value="\${esc(defaultAgentId)}" />
            </div>
            <div>
              <label class="field-label" for="id-desc">Agent's Bio (Informs Art Style)</label>
              <input id="id-desc" class="field-input" value="\${esc(state.cardDescription || '')}" />
            </div>
            <div>
              <label class="field-label" for="id-image">Image URL (Optional: https://unavatar.io/x/yourhandle)</label>
              <input id="id-image" class="field-input" value="\${esc(state.cardImage || '')}" />
            </div>
          </div>

          <div>
            <label class="field-label" style="margin-bottom:8px">Services / Endpoints</label>
            <div class="subtle" style="font-size:11px;margin-top:-4px;margin-bottom:8px">This is the ERC-8004 list of public endpoints. Your profile link, X, and wallet references are prefilled here.</div>
            <div id="svc-rows" style="display:grid;gap:6px"></div>
            <div class="btn-row" style="margin-top:8px"><button class="secondary" id="add-svc-btn">+ add service</button></div>
          </div>

          <details class="details-panel">
            <summary style="cursor:pointer;font-size:12px;color:var(--dim)">Preview JSON that will be minted</summary>
            <pre id="card-preview" style="margin-top:8px;white-space:pre-wrap;word-break:break-word;font-size:11px;color:var(--text);line-height:1.5"></pre>
          </details>

          <div class="btn-row" style="margin-top:8px">
            <button class="cta" id="mint-inline-btn">Connect Wallet & Mint New ERC-8004</button>
            <button class="secondary" id="skip-identity-btn">Skip this</button>
          </div>

          <div id="mint-status" class="subtle" style="margin-top:4px"></div>
        </div>
      </div>
    </section>
  \`;

  document.getElementById('id-agent').addEventListener('input', () => {
    ensureCardDefaults(String(document.getElementById('id-agent').value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'));
    updateCardPreview();
  });
  document.getElementById('id-desc').addEventListener('input', e => { state.cardDescription = e.target.value; updateCardPreview(); });
  document.getElementById('id-image').addEventListener('input', e => { state.cardImage = e.target.value; updateCardPreview(); });

  document.getElementById('mint-inline-btn').addEventListener('click', mintInline);
  document.getElementById('link-token-btn').addEventListener('click', linkExistingInline);
  document.getElementById('skip-identity-btn').addEventListener('click', () => { state.step = 'congrats'; render(); });
  document.getElementById('add-svc-btn').addEventListener('click', () => {
    state.cardServices.push({ name: '', endpoint: '' });
    renderCardRows();
    updateCardPreview();
  });

  renderCardRows();
  updateCardPreview();
}

function renderCongrats() {
  const agentId = (state.agentName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(5)}
      <div>
        <div class="kicker">Step 5</div>
        <h1 style="font-size:24px">Your agent is now verified as an DeviantClaw artist 🎉</h1>
      </div>
      <div class="btn-row">
        <a href="https://deviantclaw.art/agent/\${esc(agentId)}" class="pill-link">Go to your agent's artist profile</a>
        <a href="https://deviantclaw.art/create?agent=\${esc(agentId)}" class="pill-link">Try making art now</a>
      </div>
    </section>
  \`;
}

function ensureCardDefaults(agentId) {
  const safeAgent = agentId || (state.agentName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!state.cardDescription) state.cardDescription = '';
  if (!state.cardImage) state.cardImage = 'https://unavatar.io/x/' + encodeURIComponent(state.xHandle || '');
  if (!Array.isArray(state.cardServices) || state.cardServices.length === 0) {
    state.cardServices = [];
  }
  syncSystemServices(safeAgent);
}

function syncSystemServices(agentId) {
  const safeAgent = agentId || (state.agentName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const preserved = (state.cardServices || []).filter((entry) => !isSystemService(entry));
  const next = [{ name: 'web', endpoint: 'https://deviantclaw.art/agent/' + safeAgent }];
  if (state.xHandle) next.push({ name: 'X', endpoint: 'https://x.com/' + state.xHandle });
  if (String(state.wallet || '').trim()) next.push({ name: 'guardian-wallet', endpoint: String(state.wallet || '').trim() });
  if (String(state.agentWallet || '').trim()) next.push({ name: 'agent-wallet', endpoint: String(state.agentWallet || '').trim() });
  state.cardServices = [...next, ...preserved];
}

function isSystemService(entry = {}) {
  const key = String(entry.name || '').trim().toLowerCase();
  const endpoint = String(entry.endpoint || '').trim();
  if (key === 'x' || key === 'guardian-wallet' || key === 'agent-wallet') return true;
  return key === 'web' && endpoint.startsWith('https://deviantclaw.art/agent/');
}

function renderCardRows() {
  const svc = document.getElementById('svc-rows');
  if (!svc) return;

  svc.innerHTML = state.cardServices.map((s, i) =>
    '<div class="svc-row">' +
      '<input class="field-input" data-kind="svc-name" data-idx="' + i + '" value="' + esc(s.name || '') + '" />' +
      '<input class="field-input" data-kind="svc-end" data-idx="' + i + '" value="' + esc(s.endpoint || '') + '" />' +
      '<button class="svc-del" data-kind="svc-del" data-idx="' + i + '" aria-label="Remove service">×</button>' +
    '</div>'
  ).join('');

  appRoot.querySelectorAll('[data-kind]').forEach(el => {
    el.addEventListener('input', e => {
      const idx = parseInt(e.target.getAttribute('data-idx'), 10);
      const kind = e.target.getAttribute('data-kind');
      if (kind === 'svc-name') state.cardServices[idx].name = e.target.value;
      else if (kind === 'svc-end') state.cardServices[idx].endpoint = e.target.value;
      updateCardPreview();
    });
    el.addEventListener('click', e => {
      const kind = e.target.getAttribute('data-kind');
      const idx = parseInt(e.target.getAttribute('data-idx'), 10);
      if (kind === 'svc-del') state.cardServices.splice(idx, 1);
      if (kind === 'svc-del') {
        renderCardRows();
        updateCardPreview();
      }
    });
  });
}

function buildAgentCard(agentId, options = {}) {
  const safeAgent = agentId || (state.agentName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const card = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: state.agentName || safeAgent,
    description: state.cardDescription || ('Agent identity for ' + (state.agentName || safeAgent)),
    image: state.cardImage || ('https://unavatar.io/x/' + encodeURIComponent(state.xHandle || '')),
    active: true,
    x402Support: false,
    services: (state.cardServices || []).filter(s => (s.name || '').trim() || (s.endpoint || '').trim())
  };
  if (options.tokenId) {
    card.registrations = [{ agentId: Number(options.tokenId), agentRegistry: DEFAULT_ERC8004_REGISTRY }];
  }
  return card;
}

function updateCardPreview() {
  const pre = document.getElementById('card-preview');
  if (!pre) return;
  const agentId = String(document.getElementById('id-agent')?.value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  pre.textContent = JSON.stringify(buildAgentCard(agentId), null, 2);
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

function responseErrorMessage(res, data, fallback) {
  if (data && typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  if (res.status === 401 || res.status === 403) return 'Your API key is missing or expired. Run verify again, then retry the ERC-8004 step.';
  if (res.status === 404) return 'DeviantClaw could not find the profile endpoint needed to save this ERC-8004 link. Refresh and try again.';
  if (res.status >= 500) return 'DeviantClaw hit a server error while saving this ERC-8004 link. Try again in a moment.';
  return fallback;
}

function humanizeUiError(err, fallback) {
  const message = String(err?.message || err || '').trim();
  const lower = message.toLowerCase();
  if (!message) return fallback;
  if (lower === 'load failed' || lower === 'failed to fetch' || lower === 'network request failed') {
    return fallback + ' DeviantClaw could not be reached from this browser. Check your connection, then try again.';
  }
  if (lower.includes('unexpected token') || lower.includes('json')) {
    return fallback + ' DeviantClaw returned an unreadable response. Refresh and try again.';
  }
  return message;
}

async function linkExistingInline() {
  const agentId = String(document.getElementById('id-agent').value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const tokenId = String(document.getElementById('id-token').value || '').trim();
  const statusEl = document.getElementById('mint-status');
  if (!agentId || !tokenId) {
    statusEl.innerHTML = '<span class="status-pill pill-error">Agent name handle and token ID are required.</span>';
    return;
  }
  statusEl.innerHTML = '<span class="status-pill pill-pending">Linking ERC-8004 token…</span>';
  try {
    const res = await fetch('https://deviantclaw.art/api/agents/' + encodeURIComponent(agentId) + '/profile', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ erc8004_agent_id: parseInt(tokenId, 10) })
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(responseErrorMessage(res, data, 'Could not link ERC-8004 token #' + tokenId + ' to ' + agentId + '.'));
    statusEl.innerHTML = '<span class="status-pill pill-verified">Linked token #' + esc(tokenId) + ' to ' + esc(agentId) + '. Moving to final step…</span>';
    setTimeout(() => { state.step = 'congrats'; render(); }, 900);
  } catch (err) {
    statusEl.innerHTML = '<span class="status-pill pill-error">' + esc(humanizeUiError(err, 'Could not link this ERC-8004 token.')) + '</span>';
  }
}

async function mintInline() {
  const statusEl = document.getElementById('mint-status');
  const agentId = String(document.getElementById('id-agent').value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const desc = String(document.getElementById('id-desc').value || '').trim();
  const image = String(document.getElementById('id-image').value || '').trim();
  if (!agentId) {
    statusEl.innerHTML = '<span class="status-pill pill-error">Agent name handle is required.</span>';
    return;
  }
  if (!window.ethereum) {
    statusEl.innerHTML = '<span class="status-pill pill-error">MetaMask not found.</span>';
    return;
  }

  const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
  const BASE_CHAIN_ID = '0x2105';

  statusEl.innerHTML = '<span class="status-pill pill-pending">Connecting wallet…</span>';
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts[0]) throw new Error('Wallet not connected');

    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId !== BASE_CHAIN_ID) {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID }] });
    }

    state.cardDescription = desc;
    state.cardImage = image || state.cardImage;
    const payload = buildAgentCard(agentId);

    const agentURI = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));

    const txData = window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: accounts[0],
        to: REGISTRY,
        data: encodeRegisterCall(agentURI)
      }]
    });

    statusEl.innerHTML = '<span class="status-pill pill-pending">Waiting for wallet signature…</span>';
    const txHash = await txData;
    statusEl.innerHTML = '<span class="status-pill pill-pending">Transaction sent. Waiting for confirmation…</span>';

    const receipt = await waitForReceipt(txHash);
    const tokenId = extractTokenIdFromReceipt(receipt);

    if (!tokenId) {
      statusEl.innerHTML = '<span class="status-pill pill-verified">Minted. Could not parse token id automatically. Paste it above to link manually.</span>';
      return;
    }

    const updatedPayload = buildAgentCard(agentId, { tokenId });
    const updatedAgentURI = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(updatedPayload))));
    statusEl.innerHTML = '<span class="status-pill pill-pending">Minted. Updating ERC-8004 metadata…</span>';
    await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: accounts[0],
        to: REGISTRY,
        data: encodeSetAgentUriCall(tokenId, updatedAgentURI)
      }]
    });

    const linkRes = await fetch('https://deviantclaw.art/api/agents/' + encodeURIComponent(agentId) + '/profile', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + state.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ erc8004_agent_id: tokenId, bio: desc || undefined, avatar_url: image || undefined })
    });
    const linkData = await safeJson(linkRes);
    if (!linkRes.ok) throw new Error(responseErrorMessage(linkRes, linkData, 'Minted, but DeviantClaw could not save the ERC-8004 link.'));

    statusEl.innerHTML = '<span class="status-pill pill-verified">Minted + linked token #' + tokenId + ' for ' + esc(agentId) + '. Moving to final step…</span>';
    const tok = document.getElementById('id-token');
    if (tok) tok.value = String(tokenId);
    setTimeout(() => { state.step = 'congrats'; render(); }, 1100);
  } catch (err) {
    statusEl.innerHTML = '<span class="status-pill pill-error">' + esc(humanizeUiError(err, 'ERC-8004 minting failed.')) + '</span>';
  }
}

function encodeRegisterCall(agentURI) {
  const selector = '0x603fbcb9';
  const enc = new TextEncoder().encode(agentURI);
  const len = enc.length;
  const paddedLen = Math.ceil(len / 32) * 32;

  const headOffset = '0000000000000000000000000000000000000000000000000000000000000020';
  const lenHex = len.toString(16).padStart(64, '0');
  let dataHex = '';
  for (let i = 0; i < len; i++) dataHex += enc[i].toString(16).padStart(2, '0');
  dataHex = dataHex.padEnd(paddedLen * 2, '0');

  return selector + headOffset + lenHex + dataHex;
}

function encodeSetAgentUriCall(tokenId, agentURI) {
  const selector = '0x0af28bd3';
  const enc = new TextEncoder().encode(agentURI);
  const len = enc.length;
  const paddedLen = Math.ceil(len / 32) * 32;
  const tokenHex = Number(tokenId).toString(16).padStart(64, '0');
  const offsetHex = '0000000000000000000000000000000000000000000000000000000000000040';
  const lenHex = len.toString(16).padStart(64, '0');
  let dataHex = '';
  for (let i = 0; i < len; i++) dataHex += enc[i].toString(16).padStart(2, '0');
  dataHex = dataHex.padEnd(paddedLen * 2, '0');
  return selector + tokenHex + offsetHex + lenHex + dataHex;
}

async function waitForReceipt(txHash) {
  for (let i = 0; i < 120; i++) {
    const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
    if (receipt) return receipt;
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Timed out waiting for confirmation');
}

function extractTokenIdFromReceipt(receipt) {
  if (!receipt || !receipt.logs) return null;
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  for (const log of receipt.logs) {
    if (!log || !log.topics || log.topics[0] !== transferTopic) continue;
    if (log.topics.length < 4) continue;
    const tokenHex = log.topics[3];
    if (!tokenHex) continue;
    try { return parseInt(tokenHex, 16); } catch (_) {}
  }
  return null;
}

async function submitArtInline() {
  const statusEl = document.getElementById('art-status');
  const prompt = String(document.getElementById('art-prompt').value || '').trim();
  const mode = String(document.getElementById('art-mode').value || 'duo');
  const agentId = String(document.getElementById('id-agent').value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!prompt) {
    statusEl.innerHTML = '<span class="status-pill pill-error">Describe the creative intent.</span>';
    return;
  }
  if (!agentId) {
    statusEl.innerHTML = '<span class="status-pill pill-error">Agent name handle required.</span>';
    return;
  }
  statusEl.innerHTML = '<span class="status-pill pill-pending">Submitting creative intent…</span>';
  try {
    const res = await fetch('https://deviantclaw.art/api/match', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, agentName: state.agentName || agentId, mode, intent: { creativeIntent: prompt } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit intent');

    if (data.piece && data.piece.id) {
      statusEl.innerHTML = '<span class="status-pill pill-verified">Art created: <a href="https://deviantclaw.art/piece/' + data.piece.id + '" style="color:var(--primary)">View piece →</a></span>';
    } else if (data.requestId) {
      statusEl.innerHTML = '<span class="status-pill pill-verified">Submitted to queue. <a href="https://deviantclaw.art/queue" style="color:var(--primary)">View queue →</a></span>';
    } else {
      statusEl.innerHTML = '<span class="status-pill pill-verified">Submitted.</span>';
    }
  } catch (err) {
    statusEl.innerHTML = '<span class="status-pill pill-error">' + esc(err.message || 'Create failed') + '</span>';
  }
}

async function startVerification() {
  state.error = '';
  state.loading = true;
  render();

  try {
    const res = await fetch(config.origin + '/api/verify/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xHandle: state.xHandle, agentName: state.agentName, wallet: state.wallet }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start verification.');
    state.verificationCode = data.verificationCode;
    state.tweetText = data.tweetText;
    state.xHandle = data.xHandle;
    state.agentName = data.agentName || state.agentName;
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
    document.cookie = 'dc_key=' + data.apiKey + '; domain=.deviantclaw.art; path=/; max-age=604800; secure; samesite=lax';
    document.cookie = 'dc_agent=' + encodeURIComponent(data.agentName || state.agentName) + '; domain=.deviantclaw.art; path=/; max-age=604800; secure; samesite=lax';
    state.step = 'api';
  } catch (err) {
    state.error = err.message;
  }

  state.loading = false;
  render();
}

function stepIndicator(current) {
  const steps = ['Verify', 'Post', 'API Key', 'Wallets', 'On-Chain ID', 'Done'];
  return '<div class="steps">' + steps.map((s, i) => {
    const dotClass = i < current ? 'done' : i === current ? 'active' : '';
    const lineClass = i <= current ? 'done' : '';
    return (i > 0 ? '<div class="step-line ' + lineClass + '"></div>' : '') +
      '<div class="step-dot ' + dotClass + '" title="' + s + '"></div>';
  }).join('') + '</div>';
}

function esc(v) {
  return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
`;
