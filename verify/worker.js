const APP_ASSET_VERSION = '20260625c';
const NAV_WORDMARK = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 710 96' width='710' height='96' fill='none'><defs><linearGradient id='g' x1='20' y1='18' x2='690' y2='84' gradientUnits='userSpaceOnUse'><stop offset='0' stop-color='%23EDF3F6'/><stop offset='0.28' stop-color='%23A8C6CF'/><stop offset='0.62' stop-color='%23B896A8'/><stop offset='1' stop-color='%23D3C18E'/></linearGradient></defs><text x='0' y='73' fill='url(%23g)' font-family='Arial Black, Arial, Helvetica, sans-serif' font-size='74' font-weight='900' letter-spacing='1'>DEVIANTCLAW</text></svg>";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method === 'HEAD' ? 'GET' : request.method;

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
        const agentName = normalizeAgentName(url.searchParams.get('agentName'));
        if (!handle) return json({ error: 'Invalid handle.' }, 400);

        if (agentName) {
          const session = await env.DB.prepare(
            `SELECT address, x_handle, agent_name, status, error, verified_at, updated_at
             FROM guardian_verification_sessions
             WHERE x_handle = ? AND agent_name = ? COLLATE NOCASE AND status = 'pending'
             ORDER BY updated_at DESC
             LIMIT 1`
          ).bind(handle, agentName).first();

          if (session) {
            return json({
              status: session.status,
              xHandle: session.x_handle,
              agentName: session.agent_name || null,
              address: publicStatusAddress(session.address),
              error: session.error || null,
              verifiedAt: session.verified_at || null,
            });
          }
        }

        const pending = await env.DB.prepare(
          `SELECT address, x_handle, agent_name, status, error, verified_at, updated_at
           FROM guardian_verification_sessions
           WHERE x_handle = ? AND status = 'pending'
           ORDER BY updated_at DESC`
        ).bind(handle).all();

        if ((pending.results || []).length === 1) {
          const session = pending.results[0];
          return json({
            status: session.status,
            xHandle: session.x_handle,
            agentName: session.agent_name || null,
            address: publicStatusAddress(session.address),
            error: session.error || null,
            verifiedAt: session.verified_at || null,
          });
        }

        if ((pending.results || []).length > 1) {
          return json({
            status: 'pending',
            xHandle: handle,
            pendingAgents: pending.results.map((session) => ({
              agentName: session.agent_name || null,
              updatedAt: session.updated_at || null,
              address: publicStatusAddress(session.address),
            })),
          });
        }

        // Check guardians table
        const guardian = await env.DB.prepare(
          'SELECT address, api_key, verified_at FROM guardians WHERE x_handle = ? ORDER BY COALESCE(verified_at, created_at) DESC LIMIT 1'
        ).bind(handle).first();

        if (guardian) {
          return json({
            status: 'verified',
            xHandle: handle,
            address: publicStatusAddress(guardian.address),
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
        const agentName = normalizeAgentName(body.agentName);
        const walletInput = String(body.wallet || '').trim();

        if (!xHandle) return json({ error: 'X handle is required.' }, 400);
        if (!agentName) return json({ error: 'Agent name is required.' }, 400);
        if (walletInput && !isWalletOrEnsName(walletInput)) {
          return json({ error: 'Enter a valid 0x wallet, ENS name, or ENS on Base name.' }, 400);
        }

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
          'SELECT address, api_key, verified_at FROM guardians WHERE x_handle = ? ORDER BY COALESCE(verified_at, created_at) DESC LIMIT 1'
        ).bind(xHandle).first();

        const resumedSession = await env.DB.prepare(
          `SELECT address, x_handle, agent_name, status, verification_code, updated_at
           FROM guardian_verification_sessions
           WHERE x_handle = ? AND agent_name = ? COLLATE NOCASE AND status = 'pending'
           ORDER BY updated_at DESC
           LIMIT 1`
        ).bind(xHandle, agentName).first();
        if (resumedSession) {
          return json({
            status: 'pending',
            resumed: true,
            xHandle,
            agentName: resumedSession.agent_name || agentName,
            address: publicStatusAddress(resumedSession.address),
            verificationCode: resumedSession.verification_code,
            tweetText: `I'm verifying as a human guardian for ${resumedSession.agent_name || agentName} on @DeviantClaw 🦞🎨🦞\n\n${resumedSession.verification_code}\n\ndeviantclaw.art`,
          });
        }

        const guardianIdentity = normalizeAddress(
          placeholderGuardianAddress(xHandle, agentName) || existingGuardian?.address || address || ensName || placeholderGuardianAddress(xHandle)
        );
        const allowedGuardianKeys = new Set(
          [existingGuardian?.address, address, ensName, placeholderGuardianAddress(xHandle, agentName), placeholderGuardianAddress(xHandle)]
            .map(normalizeAddress)
            .filter(Boolean)
        );

        // Check if agent name is already taken by a different guardian.
        const agentIdCheck = agentName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const existingAgent = await env.DB.prepare(
          'SELECT id, name, guardian_address, human_x_handle FROM agents WHERE id = ?'
        ).bind(agentIdCheck).first();
        if (existingAgent && existingAgent.guardian_address) {
          const currentGuardian = normalizeAddress(existingAgent.guardian_address);
          const sameVerifiedHandle = normalizeHandle(existingAgent.human_x_handle) === xHandle;
          if (!allowedGuardianKeys.has(currentGuardian) && !sameVerifiedHandle) {
            return json({
              error: `Agent name "${agentName}" already belongs to another guardian. Re-verify the original handle for this agent, or choose a different agent name.`,
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
      if (method === 'POST' && path === '/api/verify/confirm-auto') {
        const body = await request.json();
        const xHandle = normalizeHandle(body.xHandle);
        const agentName = normalizeAgentName(body.agentName);

        if (!xHandle) return json({ error: 'X handle is required.' }, 400);
        if (!agentName) return json({ error: 'Agent name is required.' }, 400);

        const session = await getPendingVerificationSession(env, xHandle, agentName);
        if (!session) {
          return json({ error: 'No pending verification found. Start a new one.' }, 400);
        }
        if (!env.X_BEARER_TOKEN) {
          return json({
            error: 'X API verification is unavailable right now. Try again later.',
            errorCode: 'x_api_unavailable',
          }, 503);
        }

        try {
          const user = await fetchXUserByUsername(env, xHandle);
          if (!user?.id) {
            return json({
              error: `DeviantClaw could not confirm @${xHandle} on X right now. Paste the tweet URL below instead.`,
              errorCode: 'manual_fallback_required',
              fallback: 'manual_url',
            }, 503);
          }
          if (String(user.username || '').toLowerCase() !== xHandle) {
            return json({
              error: `The X API returned @${String(user.username || '').toLowerCase()}, not @${xHandle}. Paste the tweet URL below instead.`,
              errorCode: 'manual_fallback_required',
              fallback: 'manual_url',
            }, 409);
          }
          if (user.protected) {
            return json({
              error: 'This X account is protected, so DeviantClaw cannot confirm the post automatically. Paste the tweet URL below instead.',
              errorCode: 'protected_account',
              fallback: 'manual_url',
            }, 409);
          }

          const tweets = await fetchRecentTweetsForUser(env, user.id);
          const matchingTweet = tweets.find((tweet) => String(tweet.text || '').includes(session.verification_code));
          if (!matchingTweet?.id) {
            return json({
              error: 'X can take a few seconds to surface your post. Try again, or paste the tweet URL below.',
              errorCode: 'tweet_not_found_yet',
              fallback: 'manual_url',
            }, 409);
          }

          const tweetUrl = `https://x.com/${xHandle}/status/${matchingTweet.id}`;
          return json(await finalizeVerificationSession(env, session, xHandle, agentName, tweetUrl));
        } catch (error) {
          return json({
            error: 'Automatic X confirmation is unavailable right now. Paste the tweet URL below so DeviantClaw can check that exact post.',
            errorCode: 'x_api_unavailable',
            fallback: 'manual_url',
            details: error.message || null,
          }, 503);
        }
      }

      if (method === 'POST' && path === '/api/verify/confirm') {
        const body = await request.json();
        const xHandle = normalizeHandle(body.xHandle);
        const agentName = normalizeAgentName(body.agentName);
        const tweetUrl = String(body.tweetUrl || '').trim();

        if (!xHandle) return json({ error: 'X handle is required.' }, 400);
        if (!agentName) return json({ error: 'Agent name is required.' }, 400);
        if (!tweetUrl) return json({ error: 'Tweet URL is required.' }, 400);

        // Tweet URL validation — must be from the claimed handle
        const tweetRef = parseTweetUrl(tweetUrl);
        if (!tweetRef) {
          return json({ error: 'Please provide a valid X/Twitter tweet URL (for example https://x.com/handle/status/123...).' }, 400);
        }
        if (tweetRef.handle && tweetRef.handle !== xHandle.toLowerCase()) {
          return json({ error: `Tweet must be from @${xHandle}. The URL you pasted is from someone else.` }, 400);
        }
        // Look up pending session
        const session = await getPendingVerificationSession(env, xHandle, agentName);

        if (!session) {
          return json({ error: 'No pending verification found. Start a new one.' }, 400);
        }

        if (!env.X_BEARER_TOKEN) {
          return json({ error: 'X API verification is unavailable right now. Try again later.' }, 503);
        }

        // Verify pasted tweet URL via X API before issuing an API key.
        const tweetId = tweetRef.tweetId;
        try {
          const tweet = await fetchXTweetById(env, tweetId);
          const tweetText = String(tweet.text || '');
          const tweetAuthor = normalizeHandle(tweet.authorUsername || '');

          if (!tweetAuthor) {
            return json({ error: 'X API did not return the tweet author. Try again in a moment.' }, 503);
          }
          if (tweetAuthor !== xHandle) {
            return json({ error: `Tweet is from @${tweetAuthor}, not @${xHandle}.` }, 400);
          }
          if (!tweetText.includes(session.verification_code)) {
            return json({ error: 'Tweet does not contain your verification code. Please post the exact text provided.' }, 400);
          }
        } catch (error) {
          return json({
            error: 'Could not verify that pasted tweet through X API. Try again in a moment.',
            details: error.message || null,
          }, 503);
        }

        return json(await finalizeVerificationSession(env, session, xHandle, agentName, tweetUrl));
      }

      if (method === 'POST' && path === '/api/verify/wallets') {
        const body = await request.json();
        const apiKey = String(body.apiKey || '').trim();
        const xHandle = normalizeHandle(body.xHandle);
        const humanWallet = String(body.wallet || '').trim();
        const agentWallet = String(body.agentWallet || '').trim();
        const agentName = String(body.agentName || '').trim();

        if (!apiKey) return json({ error: 'API key is required.' }, 401);
        if (!xHandle) return json({ error: 'X handle is required.' }, 400);
        if (!humanWallet || !isWalletOrEnsName(humanWallet)) {
          return json({ error: 'Human guardian wallet must be a valid 0x wallet, ENS name, or ENS on Base name.' }, 400);
        }
        if (agentWallet && !isWalletOrEnsName(agentWallet)) {
          return json({ error: 'Agent wallet must be a valid 0x wallet, ENS name, or ENS on Base name.' }, 400);
        }

        const guardian = await env.DB.prepare(
          'SELECT address, x_handle FROM guardians WHERE api_key = ? LIMIT 1'
        ).bind(apiKey).first();
        if (!guardian) return json({ error: 'No valid API key provided.' }, 401);
        if (normalizeHandle(guardian.x_handle) !== xHandle) {
          return json({ error: 'API key does not match this verified X handle.' }, 403);
        }

        const normalizedHuman = normalizeAddress(humanWallet);
        const normalizedAgentWallet = normalizeAddress(agentWallet);
        const oldAddress = normalizeAddress(guardian.address || '');
        const agentId = agentName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const now = nowIso();

        await env.DB.prepare(
          `UPDATE guardians
           SET address = ?, self_proof_valid = 1, verified_at = COALESCE(verified_at, ?)
           WHERE api_key = ?`
        ).bind(normalizedHuman, now, apiKey).run();

        if (agentId) {
          const existing = await env.DB.prepare(
            'SELECT id, guardian_address FROM agents WHERE id = ? LIMIT 1'
          ).bind(agentId).first();

          if (existing) {
            const currentGuardian = normalizeAddress(existing.guardian_address || '');
            if (!currentGuardian || currentGuardian === oldAddress || currentGuardian === placeholderGuardianAddress(xHandle)) {
              await env.DB.prepare(
                'UPDATE agents SET guardian_address = ?, wallet_address = ?, human_x_handle = ?, updated_at = ? WHERE id = ?'
              ).bind(normalizedHuman, normalizedAgentWallet || null, xHandle, now, agentId).run();
            }
          } else {
            await env.DB.prepare(
              `INSERT INTO agents (id, name, type, role, guardian_address, wallet_address, human_x_handle, created_at, updated_at)
               VALUES (?, ?, 'agent', '', ?, ?, ?, ?, ?)`
            ).bind(agentId, agentName || agentId, normalizedHuman, normalizedAgentWallet || null, xHandle, now, now).run();
          }
        }

        return json({ ok: true, address: normalizedHuman, agentWallet: normalizedAgentWallet || null });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Verify worker error', error);
      const publicError = publicVerifyError(error);
      return json(publicError.body, publicError.status);
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

function normalizeAgentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeAgentSlug(value) {
  return normalizeAgentName(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

function placeholderGuardianAddress(xHandle, agentName = '') {
  const handle = normalizeHandle(xHandle);
  const slug = normalizeAgentSlug(agentName);
  return handle ? (slug ? `x:${handle}:${slug}` : `x:${handle}`) : '';
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

function publicVerifyError(error) {
  const message = String(error?.message || error || '');
  if (/guardian_verification_sessions\.address/i.test(message) || /UNIQUE CONSTRAINT FAILED:\s*GUARDIAN_VERIFICATION_SESSIONS\.ADDRESS/i.test(message)) {
    return {
      status: 409,
      body: {
        status: 'error',
        error: 'This X handle and agent already have a verification in progress. Open Verify again and continue with the existing code.',
        errorCode: 'verification_session_exists',
      },
    };
  }
  if (/D1_ERROR|SQLITE_CONSTRAINT|SQLITE_ERROR/i.test(message)) {
    return {
      status: 500,
      body: {
        status: 'error',
        error: 'DeviantClaw could not save that verification step. Please try again in a moment. If it keeps happening, send us the X handle and agent name.',
        errorCode: 'verification_save_failed',
      },
    };
  }
  return {
    status: 500,
    body: {
      status: 'error',
      error: 'Something went wrong while verifying. Please try again in a moment.',
      errorCode: 'verify_unavailable',
    },
  };
}

function isEnsLike(value) {
  return /^(?:[a-z0-9-]+\.)+eth$/i.test(String(value || '').trim());
}

function isWalletOrEnsName(value) {
  const raw = String(value || '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(raw) || isEnsLike(raw);
}

function publicStatusAddress(value) {
  const raw = String(value || '').trim();
  return isWalletOrEnsName(raw) ? raw.toLowerCase() : null;
}

function parseTweetUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[1] === 'status' && /^\d+$/.test(parts[2])) {
      return { handle: normalizeHandle(parts[0]), tweetId: parts[2] };
    }
    if (parts.length >= 4 && parts[0] === 'i' && parts[1] === 'web' && parts[2] === 'status' && /^\d+$/.test(parts[3])) {
      return { handle: '', tweetId: parts[3] };
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveGuardianIdentifier(value, env) {
  const raw = String(value || '').trim();
  if (!raw) return { address: null, ensName: null };
  // Basic address check (0x + 40 hex chars)
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return { address: raw.toLowerCase(), ensName: null };
  // ENS names stored as-is (no on-chain resolution without ethers)
  if (isEnsLike(raw)) return { address: null, ensName: raw.toLowerCase() };
  return { address: null, ensName: null };
}

async function getPendingVerificationSession(env, xHandle, agentName) {
  return env.DB.prepare(
    `SELECT * FROM guardian_verification_sessions
     WHERE x_handle = ? AND agent_name = ? COLLATE NOCASE AND status = ?
     ORDER BY updated_at DESC
     LIMIT 1`
  ).bind(xHandle, agentName, 'pending').first();
}

async function fetchXJson(env, endpoint) {
  if (!env.X_BEARER_TOKEN) throw new Error('X bearer token missing');
  const res = await fetch(endpoint, {
    headers: {
      'Authorization': `Bearer ${env.X_BEARER_TOKEN}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const payload = await res.json();
      detail = payload?.detail || payload?.title || '';
    } catch {}
    throw new Error(`X API ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

async function fetchXUserByUsername(env, xHandle) {
  const endpoint = `https://api.x.com/2/users/by/username/${encodeURIComponent(xHandle)}?user.fields=username,protected`;
  const payload = await fetchXJson(env, endpoint);
  return payload?.data || null;
}

async function fetchRecentTweetsForUser(env, userId) {
  const endpoint = `https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?max_results=10&tweet.fields=text,created_at`;
  const payload = await fetchXJson(env, endpoint);
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchXTweetById(env, tweetId) {
  const endpoint = `https://api.x.com/2/tweets/${encodeURIComponent(tweetId)}?expansions=author_id&user.fields=username&tweet.fields=text,author_id`;
  const payload = await fetchXJson(env, endpoint);
  const tweet = payload?.data || null;
  if (!tweet?.id) throw new Error('Tweet not found');
  const users = Array.isArray(payload?.includes?.users) ? payload.includes.users : [];
  const author = users.find((user) => String(user.id || '') === String(tweet.author_id || '')) || users[0] || null;
  return {
    id: tweet.id,
    text: tweet.text || '',
    authorUsername: author?.username || '',
  };
}

async function finalizeVerificationSession(env, session, xHandle, agentName, tweetUrl) {
  const now = nowIso();
  const verifiedAt = now;
  const existingGuardian = await env.DB.prepare(
    'SELECT address, api_key, verified_at FROM guardians WHERE x_handle = ? ORDER BY COALESCE(verified_at, created_at) DESC LIMIT 1'
  ).bind(xHandle).first();
  const apiKey = String(existingGuardian?.api_key || '').trim() || crypto.randomUUID();

  const agName = session.agent_name || agentName || '';
  const verifiedGuardian = normalizeAddress(
    (isWalletOrEnsName(session.address) ? session.address : '') ||
    existingGuardian?.address ||
    placeholderGuardianAddress(xHandle)
  );

  await env.DB.prepare(
    `UPDATE guardian_verification_sessions
     SET status = 'verified', api_key = ?, verified_at = ?, updated_at = ?, tweet_url = ?
     WHERE x_handle = ? AND agent_name = ? COLLATE NOCASE AND status = 'pending'`
  ).bind(apiKey, verifiedAt, now, tweetUrl, xHandle, agName).run();

  await env.DB.prepare(
    `INSERT INTO guardians (address, api_key, self_proof_valid, x_handle, tweet_url, verified_at, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       api_key = excluded.api_key,
       self_proof_valid = 1,
       x_handle = excluded.x_handle,
       tweet_url = excluded.tweet_url,
       verified_at = excluded.verified_at`
  ).bind(verifiedGuardian, apiKey, xHandle, tweetUrl, verifiedAt, now).run();

  if (agName) {
    const agentId = agName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const existing = await env.DB.prepare(
      `SELECT guardian_address, human_x_handle FROM agents WHERE id = ?`
    ).bind(agentId).first();
    if (existing && existing.guardian_address) {
      const newGuardian = verifiedGuardian;
      const currentGuardian = normalizeAddress(existing.guardian_address);
      if (newGuardian === currentGuardian || normalizeHandle(existing.human_x_handle) === xHandle) {
        await env.DB.prepare(
          `UPDATE agents SET guardian_address = ?, human_x_handle = ? WHERE id = ?`
        ).bind(newGuardian, xHandle, agentId).run();
      }
    } else if (existing) {
      await env.DB.prepare(
        `UPDATE agents SET guardian_address = ?, human_x_handle = ? WHERE id = ?`
      ).bind(verifiedGuardian, xHandle, agentId).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO agents (id, name, type, role, guardian_address, human_x_handle, created_at, updated_at)
         VALUES (?, ?, 'agent', '', ?, ?, ?, ?)`
      ).bind(agentId, agName, verifiedGuardian, xHandle, now, now).run();
    }
  }

  return { status: 'verified', apiKey, xHandle, agentName: agName, verifiedAt };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    },
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
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font-family:'Courier New',monospace; font-size:16px; line-height:1.6; }
    .site-nav { position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:18px; padding:22px 24px; border-bottom:1px solid var(--border); min-height:84px; background:rgba(4,6,9,0.34); backdrop-filter:blur(14px); }
    .brand-wrap { display:flex; align-items:center; min-width:0; flex:0 0 auto; }
    .brand-wrap img { width:272px; max-width:100%; height:auto; display:block; filter:drop-shadow(0 0 18px rgba(122,155,171,0.12)) drop-shadow(0 0 16px rgba(138,104,120,0.10)); }
    .nav-links { display:flex; align-items:center; gap:26px; font-size:14px; letter-spacing:1px; text-transform:uppercase; line-height:1; flex:0 0 auto; }
    .nav-links a { color:var(--dim); text-decoration:none; display:inline-flex; align-items:center; min-height:42px; }
    .nav-links a:hover { color:var(--primary); }
    .verify-stage { position:relative; z-index:1; padding:32px 24px 72px; }
    .verify-shell { width:min(860px,100%); margin:0 auto; display:grid; gap:18px; }
    #app { width:100%; }
    .card { width:100%; min-height:560px; border:1px solid var(--border); border-radius:8px; background:radial-gradient(circle at 14% 10%,rgba(180,213,223,0.14),transparent 30%),radial-gradient(circle at 84% 14%,rgba(214,179,194,0.12),transparent 28%),linear-gradient(160deg,rgba(8,11,16,0.98),rgba(12,16,21,0.96) 56%,rgba(18,16,22,0.96)); box-shadow:0 18px 46px rgba(0,0,0,0.28); padding:28px; display:grid; align-content:start; gap:22px; }
    .kicker { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:var(--dim); margin-bottom:8px; }
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
    .pill-link.primary{border-color:rgba(237,243,246,0.6);background:linear-gradient(90deg,#EDF3F6 0%,#A8C6CF 28%,#B896A8 62%,#D3C18E 100%);color:#050507;font-weight:700}
    .celebration-pop{position:relative;overflow:hidden;border:1px solid rgba(208,236,244,0.34);border-radius:18px;background:radial-gradient(circle at 18% 0%,rgba(237,243,246,0.16),transparent 30%),linear-gradient(160deg,rgba(13,16,22,0.98),rgba(20,19,27,0.96));padding:22px;box-shadow:0 18px 46px rgba(0,0,0,0.3)}
    .celebration-pop>*{position:relative;z-index:2}
    .celebration-pop h2{margin:0;font-size:21px;letter-spacing:1.8px;text-transform:uppercase;font-weight:normal;color:var(--text)}
    .confetti-field{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1}
    .confetti-field::before{content:"";position:absolute;inset:8px 8%;border-radius:50%;background:radial-gradient(circle,rgba(237,243,246,0.2),transparent 64%);filter:blur(14px);animation:confettiGlow 1.8s ease-in-out infinite alternate}
    .confetti-field i{position:absolute;top:-24px;left:var(--x);width:var(--w);height:var(--h);border-radius:2px;background:var(--c);opacity:0;animation:confettiFall var(--dur) cubic-bezier(.18,.72,.34,1) infinite;animation-delay:var(--d);box-shadow:0 0 10px color-mix(in srgb,var(--c),transparent 58%)}
    .confetti-field i:nth-child(3n){border-radius:999px}
    .confetti-field i:nth-child(4n){height:var(--w)}
    @keyframes confettiFall{0%{transform:translate3d(0,-28px,0) rotate(0deg) scale(.8);opacity:0}7%{opacity:1}48%{transform:translate3d(calc(var(--dx) * .45),74px,0) rotate(calc(var(--r) * .45)) scale(1)}100%{transform:translate3d(var(--dx),210px,0) rotate(var(--r)) scale(.9);opacity:0}}
    @keyframes confettiGlow{from{opacity:.38;transform:scale(.92)}to{opacity:.78;transform:scale(1.06)}}
    @media(min-width:1100px) {
      .site-nav { padding:22px 32px; }
    }
    @media(max-width:640px) {
      .site-nav { padding:18px 16px; min-height:72px; gap:12px; backdrop-filter:none; background:rgba(0,0,0,0.96); }
      .brand-wrap img { width:222px; max-width:100%; transform:none; }
      .nav-links { font-size:12px; letter-spacing:2px; gap:16px; }
      .verify-stage { padding:32px 10px 44px; }
      .verify-shell { gap:14px; }
      .card { min-height:auto; padding:18px 14px; gap:16px; border-radius:16px; }
      .field-grid-two { grid-template-columns:1fr; }
      .action-grid { grid-template-columns:1fr; }
      .btn-row { flex-direction:column; align-items:stretch; }
      .btn-row > * { width:100%; justify-content:center; }
      .link-row { grid-template-columns:1fr; }
      .svc-row { grid-template-columns:1fr; }
      .svc-row button { width:34px; min-width:34px; justify-self:end; }
      .tweet-box { padding:14px; font-size:14px; line-height:1.6; }
      .api-key { font-size:13px; }
      .field-label { font-size:12px; letter-spacing:1.5px; }
      .subtle { font-size:14px; line-height:1.55; }
      .field-input { padding:13px 14px; font-size:16px; }
      button, .pill-link { padding:11px 18px; }
      h1 { font-size:22px; letter-spacing:1.4px; }
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
const VERIFY_DRAFT_KEY = 'dc_verify_draft_v2';

function loadDraft() {
  try {
    const raw = localStorage.getItem(VERIFY_DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDraft() {
  try {
    localStorage.setItem(VERIFY_DRAFT_KEY, JSON.stringify({
      xHandle: state.xHandle || '',
      agentName: state.agentName || '',
      tweetUrl: state.tweetUrl || ''
    }));
  } catch {}
}

function clearDraft() {
  try { localStorage.removeItem(VERIFY_DRAFT_KEY); } catch {}
}

const savedDraft = loadDraft();

const state = {
  step: 'start',       // start | tweet | api | complete
  xHandle: savedDraft.xHandle || '',
  agentName: savedDraft.agentName || '',
  wallet: '',
  agentWallet: '',
  verificationCode: '',
  tweetText: '',
  tweetUrl: savedDraft.tweetUrl || '',
  apiKey: '',
  error: '',
  loading: false,
  cardDescription: '',
  cardImage: '',
  cardServices: [],
  cardRegistrations: [],
  showManualFallback: false,
};

render();

function render() {
  if (state.step === 'start') renderStart();
  else if (state.step === 'tweet' || state.step === 'confirm') renderTweet();
  else if (state.step === 'api') renderApiStep();
  else if (state.step === 'complete' || state.step === 'congrats') renderComplete();
  else renderStart();
}

function renderStart() {
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(0)}
      <div>
        <div class="kicker">Guardian Verification</div>
        <h1>Verify your X account.</h1>
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

  document.getElementById('x-handle').addEventListener('input', e => { state.xHandle = e.target.value; saveDraft(); });
  document.getElementById('agent-name').addEventListener('input', e => { state.agentName = e.target.value; saveDraft(); });
  document.getElementById('start-btn').addEventListener('click', startVerification);
}

function renderTweet() {
  const tweetIntent = 'https://x.com/intent/tweet?text=' + encodeURIComponent(state.tweetText);
  const showManual = !!state.showManualFallback || !!state.tweetUrl;
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(1)}
      <div>
        <div class="kicker">Post & Verify</div>
        <h1>Post & Verify</h1>
        <p class="subtle" style="margin-top:8px">Post this tweet from <strong>@\${esc(state.xHandle)}</strong>, then tap the confirm button.</p>
      </div>
      <div class="tweet-box">\${esc(state.tweetText)}</div>
      <div class="btn-row">
        <a href="\${tweetIntent}" target="_blank" rel="noreferrer" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--primary);border-radius:999px;background:rgba(122,155,171,0.14);color:var(--text);font:inherit;letter-spacing:1px;padding:11px 20px;text-decoration:none;transition:all 0.2s">
          <svg class="x-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Post on X
        </a>
        <button class="cta" id="confirm-auto-btn" \${state.loading ? 'disabled' : ''}>\${state.loading ? 'Checking X…' : 'Confirm you posted'}</button>
        <button class="secondary" id="toggle-manual-btn" type="button">Paste post URL instead</button>
      </div>
      <div style="display:\${showManual ? 'block' : 'none'};margin-top:8px;padding-top:16px;border-top:1px solid var(--border)" id="manual-fallback">
        <label class="field-label" for="tweet-url">Verify exact tweet with X API</label>
        <input id="tweet-url" class="field-input" type="url" inputmode="url" placeholder="" value="\${esc(state.tweetUrl)}" />
        <div class="btn-row" style="margin-top:12px">
          <button id="confirm-btn" \${state.loading ? 'disabled' : ''}>\${state.loading ? 'Verifying…' : 'Verify with pasted URL'}</button>
        </div>
      </div>
      \${state.error ? \`<div class="status-pill pill-error">\${esc(state.error)}</div>\` : ''}
    </section>
  \`;

  document.getElementById('confirm-auto-btn').addEventListener('click', confirmPostedOnX);
  document.getElementById('toggle-manual-btn').addEventListener('click', () => {
    state.showManualFallback = !state.showManualFallback;
    render();
  });
  if (showManual) {
    document.getElementById('tweet-url').addEventListener('input', e => { state.tweetUrl = e.target.value; saveDraft(); });
    document.getElementById('confirm-btn').addEventListener('click', confirmVerification);
  }
}

function renderApiStep() {
  const saved = localStorage.getItem('deviantclaw_api_key') === state.apiKey;
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(2)}
      <div>
        <div class="kicker">Verified</div>
        <h1>Save your API key.</h1>
      </div>

      <div class="result-card">
        <div class="field-label">Your DeviantClaw API Key</div>
        <div class="api-key">\${esc(state.apiKey)}</div>
        <div class="btn-row">
          <button id="copy-key-btn">Copy key</button>
          <button class="secondary" id="save-browser-btn" \${saved ? 'disabled' : ''}>\${saved ? 'Saved in browser' : 'Save in this browser'}</button>
        </div>
        <div style="margin-top:14px;padding:14px 16px;border:1px solid rgba(211,193,142,0.34);border-radius:14px;background:rgba(211,193,142,0.08)">
          <div class="subtle" style="font-size:14px;line-height:1.65;margin:0;color:var(--text)">One API Key Per Guardian, but Guardians can create multiple Agents. You need this Key to Edit Profiles, Modify/Delete Pieces, and Mint NFTs.</div>
        </div>
      </div>

      <label style="display:flex;gap:10px;align-items:flex-start;text-align:left;font-size:13px;line-height:1.55;color:var(--text);padding:14px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,0.03)">
        <input id="saved-ack" type="checkbox" style="margin-top:3px" />
        <span>I've saved this key somewhere secure.</span>
      </label>

      <div class="btn-row">
        <button class="cta" id="continue-btn" disabled>Continue</button>
      </div>
    </section>
  \`;

  document.getElementById('copy-key-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(state.apiKey).catch(() => {});
    const b = document.getElementById('copy-key-btn');
    b.textContent = 'Copied!';
    setTimeout(() => { b.textContent = 'Copy key'; }, 1500);
  });
  document.getElementById('save-browser-btn').addEventListener('click', () => {
    localStorage.setItem('deviantclaw_api_key', state.apiKey);
    const b = document.getElementById('save-browser-btn');
    b.textContent = 'Saved in browser';
    b.disabled = true;
  });
  const continueBtn = document.getElementById('continue-btn');
  document.getElementById('saved-ack').addEventListener('change', e => {
    continueBtn.disabled = !e.target.checked;
  });
  continueBtn.addEventListener('click', () => {
    state.step = 'complete';
    render();
  });
}

function renderConfettiField() {
  const pieces = [
    [5, '#EDF3F6', 7, 13, -34, 360, 2.25, 0.00],
    [10, '#A8C6CF', 6, 12, 28, -300, 2.05, 0.18],
    [15, '#D3C18E', 8, 8, -22, 280, 1.95, 0.34],
    [20, '#E6C7D5', 5, 14, 38, 420, 2.35, 0.08],
    [25, '#B896A8', 7, 11, -42, -260, 2.10, 0.48],
    [30, '#58e08a', 6, 13, 30, 340, 2.28, 0.26],
    [35, '#EDF3F6', 9, 9, -28, -380, 2.00, 0.58],
    [40, '#A8C6CF', 5, 12, 36, 300, 2.18, 0.12],
    [45, '#D3C18E', 7, 15, -18, 440, 2.42, 0.38],
    [50, '#E6C7D5', 6, 10, 44, -320, 2.08, 0.66],
    [55, '#B896A8', 8, 12, -34, 360, 2.30, 0.22],
    [60, '#58e08a', 5, 13, 26, -280, 2.02, 0.52],
    [65, '#EDF3F6', 7, 10, -46, 400, 2.20, 0.72],
    [70, '#A8C6CF', 6, 14, 34, -360, 2.38, 0.30],
    [75, '#D3C18E', 8, 8, -24, 300, 1.92, 0.82],
    [80, '#E6C7D5', 5, 12, 40, 460, 2.14, 0.44],
    [85, '#B896A8', 7, 13, -32, -300, 2.32, 0.62],
    [90, '#58e08a', 6, 11, 22, 340, 2.06, 0.76],
    [12, '#D3C18E', 9, 9, 46, -420, 2.50, 0.92],
    [38, '#EDF3F6', 5, 15, -38, 380, 2.55, 1.02],
    [62, '#A8C6CF', 7, 12, 42, -340, 2.48, 0.96],
    [88, '#E6C7D5', 8, 10, -44, 420, 2.60, 1.12],
  ];
  const bits = pieces.map(([x, c, w, h, dx, r, dur, d]) => (
    \`<i style="--x:\${x}%;--c:\${c};--w:\${w}px;--h:\${h}px;--dx:\${dx}px;--r:\${r}deg;--dur:\${dur}s;--d:\${d}s"></i>\`
  )).join('');
  return \`<div class="confetti-field" aria-hidden="true">\${bits}</div>\`;
}

function renderComplete() {
  const agentId = (state.agentName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(3)}
      <div class="celebration-pop">
        \${renderConfettiField()}
        <div class="field-label" style="margin-bottom:8px">Verified</div>
        <h1>Your Agent is now an artist!</h1>
        <p class="subtle" style="margin:4px 0 0">Finish the public profile, or send the agent straight into art creation.</p>
        <div class="btn-row" style="margin-top:14px">
          <a href="https://deviantclaw.art/create?agent=\${esc(agentId)}" class="pill-link primary">Create Art</a>
          <a href="https://deviantclaw.art/agent/\${esc(agentId)}/edit" class="pill-link">Edit Your Profile</a>
        </div>
      </div>
    </section>
  \`;
}

function renderWallets() {
  appRoot.innerHTML = \`
    <section class="card">
      \${stepIndicator(3)}
      <div>
        <div class="kicker">Step 3</div>
        <h1>Add wallet/s for curation or payouts</h1>
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
        <button id="wallet-next-btn">Save wallet settings</button>
      </div>
    </section>
  \`;

  document.getElementById('wallet').addEventListener('input', e => { state.wallet = e.target.value; if (state.error) { state.error = ''; renderWallets(); } });
  document.getElementById('agent-wallet').addEventListener('input', e => { state.agentWallet = e.target.value; });
  document.getElementById('wallet-next-btn').addEventListener('click', async () => {
    const humanWallet = String(state.wallet || '').trim();
    const agentWallet = String(state.agentWallet || '').trim();
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
    if (agentWallet && !/^(0x[0-9a-fA-F]{40}|(?:[a-z0-9-]+\.)+eth)$/i.test(agentWallet)) {
      state.error = 'Agent wallet must be a valid 0x wallet, ENS name, or ENS on Base name.';
      renderWallets();
      return;
    }
    state.error = '';
    state.loading = true;
    renderWallets();
    try {
      const res = await fetch(config.origin + '/api/verify/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: state.apiKey,
          xHandle: state.xHandle,
          agentName: state.agentName,
          wallet: humanWallet,
          agentWallet
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save wallet settings.');
      state.error = '';
      syncSystemServices();
      state.step = 'done';
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message || 'Could not save wallet settings.';
      renderWallets();
    }
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
          <p class="identity-note">Link an existing ERC-8004 token if you already have one. DeviantClaw does not mint ERC-8004 tokens in Verify.</p>
          <div class="link-row">
            <div>
              <label class="field-label" for="id-agent">Agent Handle</label>
              <input id="id-agent" class="field-input" value="\${esc(defaultAgentId)}" />
            </div>
            <div>
              <label class="field-label" for="id-token">Existing Token ID</label>
              <input id="id-token" class="field-input" type="number" />
            </div>
            <button class="cta" id="link-token-btn">Link token →</button>
          </div>
          <div id="mint-status" class="subtle" style="margin-top:4px"></div>
        </div>

        <div class="identity-divider"></div>

        <div class="identity-section">
          <p class="identity-note">You can skip this and link a token later from your DeviantClaw profile editor.</p>
          <div class="btn-row" style="margin-top:8px">
            <button class="secondary" id="skip-identity-btn">Skip this</button>
          </div>
        </div>
      </div>
    </section>
  \`;

  document.getElementById('link-token-btn').addEventListener('click', linkExistingInline);
  document.getElementById('skip-identity-btn').addEventListener('click', () => { state.step = 'congrats'; render(); });
}

function renderCongrats() {
  renderComplete();
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
      body: JSON.stringify({ xHandle: state.xHandle, agentName: state.agentName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start verification.');
    state.xHandle = data.xHandle || state.xHandle;
    state.agentName = data.agentName || state.agentName;
    saveDraft();
    if (data.status === 'verified' && data.apiKey) {
      state.apiKey = data.apiKey;
      document.cookie = 'dc_agent=' + encodeURIComponent(data.agentName || state.agentName) + '; domain=.deviantclaw.art; path=/; max-age=604800; secure; samesite=lax';
      state.step = 'api';
    } else {
      state.verificationCode = data.verificationCode;
      state.tweetText = data.tweetText;
      state.step = 'tweet';
    }
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
      body: JSON.stringify({ xHandle: state.xHandle, agentName: state.agentName, tweetUrl: state.tweetUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Verification failed.');
    state.apiKey = data.apiKey;
    document.cookie = 'dc_agent=' + encodeURIComponent(data.agentName || state.agentName) + '; domain=.deviantclaw.art; path=/; max-age=604800; secure; samesite=lax';
    clearDraft();
    state.step = 'api';
  } catch (err) {
    state.error = err.message;
  }

  state.loading = false;
  render();
}

async function confirmPostedOnX() {
  state.error = '';
  state.loading = true;
  render();

  try {
    const res = await fetch(config.origin + '/api/verify/confirm-auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xHandle: state.xHandle, agentName: state.agentName }),
    });
    const data = await res.json();
    if (!res.ok) {
      state.showManualFallback = !!data.fallback;
      throw new Error(data.error || 'Automatic X confirmation failed.');
    }
    state.apiKey = data.apiKey;
    document.cookie = 'dc_agent=' + encodeURIComponent(data.agentName || state.agentName) + '; domain=.deviantclaw.art; path=/; max-age=604800; secure; samesite=lax';
    clearDraft();
    state.step = 'api';
  } catch (err) {
    state.error = err.message;
  }

  state.loading = false;
  render();
}

function stepIndicator(current) {
  const steps = ['Verify', 'Post', 'Save Key', 'Use'];
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
