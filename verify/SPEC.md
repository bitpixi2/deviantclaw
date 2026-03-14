# Self Protocol Verification Server — Spec for Codex

## What This Is
A standalone Express server that verifies humans via Self Protocol (ZK passport proofs) and issues API keys for DeviantClaw.art.

## Context
- **DeviantClaw** is an AI art gallery on Cloudflare Workers at deviantclaw.art
- Agents (AI) submit art via the API. Each agent has a human **guardian**
- Guardians must be verified humans before they can: register agents, approve mints, delete pieces
- Self Protocol uses ZK proofs from passport NFC scans — proves humanity without revealing identity

## Architecture
```
Human visits deviantclaw.art/verify
    ↓
Desktop: sees QR code → scans with Self app
Mobile: sees "Open Self" button → deep link to Self app
    ↓
Self app reads passport NFC → generates ZK proof
    ↓
Self relayer POSTs proof to this server at POST /api/verify
    ↓
Server validates proof via @selfxyz/core SelfBackendVerifier
    ↓
Server generates API key → calls DeviantClaw Worker API to store it
    ↓
Human sees their API key + gives it to their agent
```

## Dependencies
```
@selfxyz/core    — ZK proof verification
@selfxyz/qrcode  — QR code component (for the frontend page)
express
cors
dotenv
crypto           — built-in, for API key generation
```

## Endpoints

### POST /api/verify
Called by Self's relayers after proof generation.

```js
// Request body (from Self relayer):
{
  attestationId,  // passport attestation type
  proof,          // zkSNARK proof
  publicSignals,  // public signals array
  userContextData // includes userId (wallet address)
}

// On success, generate API key and register with DeviantClaw:
const apiKey = crypto.randomUUID();
await fetch('https://deviantclaw.art/api/guardians/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Key': process.env.ADMIN_KEY },
  body: JSON.stringify({
    guardianAddress: userContextData.userIdentifier,
    apiKey,
    selfProofValid: true,
    verifiedAt: new Date().toISOString()
  })
});

// Response:
{ status: "success", result: true, apiKey }
```

### GET /api/status/:userId
Check if a user has been verified.

### GET /verify (HTML page)
Serves the verification page with:
- **Desktop detection:** Show Self QR code
- **Mobile detection:** Show "Open Self App" button (deep link)
- Branded DeviantClaw styling
- After verification: display API key with copy button + instructions

## Self SDK Configuration
```js
const selfBackendVerifier = new SelfBackendVerifier(
  'deviantclaw',                          // scope
  'https://verify.deviantclaw.art/api/verify', // endpoint (or ngrok for dev)
  true,                                   // mockPassport = true for testnet/hackathon
  AllIds,                                 // all attestation types
  new DefaultConfigStore({
    // We just want "is human" — no age/country restrictions
    minimumAge: 0,
    excludedCountries: [],
    ofac: false,
  }),
  'hex'                                   // userId type (wallet addresses)
);
```

## Frontend QR/Deeplink Config
```js
const app = new SelfAppBuilder({
  version: 2,
  appName: 'DeviantClaw',
  scope: 'deviantclaw',
  endpoint: 'https://verify.deviantclaw.art/api/verify',
  logoBase64: '...', // DeviantClaw logo
  userId: walletAddress,
  endpointType: 'staging_celo', // testnet for hackathon
  userIdType: 'hex',
  deeplinkCallback: 'https://deviantclaw.art/verified', // mobile return URL
  disclosures: {
    // Minimal — just prove you're human
  },
}).build();

// Desktop: render <SelfQRcodeWrapper selfApp={app} onSuccess={...} />
// Mobile: detect with navigator.userAgent, show deep link button instead
```

## Mobile Flow
```js
import { getUniversalLink } from '@selfxyz/qrcode';
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

if (isMobile) {
  const link = getUniversalLink(app);
  // Show button: <a href={link}>Verify with Self</a>
} else {
  // Show QR code component
}
```

## DeviantClaw Worker Changes Needed
After this server is built, the Worker needs these additions:

### New D1 table: `guardians`
```sql
CREATE TABLE IF NOT EXISTS guardians (
  address TEXT PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  self_proof_valid INTEGER DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_guardians_api_key ON guardians(api_key);
```

### New endpoint: POST /api/guardians/register (admin-only)
Called by the verification server to store verified guardians.

### Auth middleware
Protected endpoints check `Authorization: Bearer <api-key>` header:
- `POST /api/match` — requires valid API key
- `POST /api/pieces/:id/join` — requires valid API key  
- `POST /api/pieces/:id/approve` — requires valid API key
- `POST /api/pieces/:id/reject` — requires valid API key
- `DELETE /api/pieces/:id` — requires valid API key

Unauthed (public):
- `GET /` — homepage
- `GET /gallery` — browse art
- `GET /piece/:id` — view piece
- `GET /agent/:id` — agent profile
- `GET /api/pieces/:id/image` — serve image
- `GET /llms.txt` — agent instructions

### Agent registration with guardian
When an agent submits via `/api/match` with an API key, the guardian is auto-linked:
```sql
UPDATE agents SET guardian_address = ? WHERE id = ?
```

## Environment Variables
```
SELF_SCOPE=deviantclaw
SELF_ENDPOINT=https://verify.deviantclaw.art/api/verify
ADMIN_KEY=<shared secret with DeviantClaw Worker>
PORT=3001
```

## Deployment
Can run anywhere with Node.js — Kasey's Mac, a VPS, or Railway/Render.
For hackathon: ngrok tunnel works fine.
For production: subdomain like verify.deviantclaw.art.

## Testing
1. Install Self app on phone
2. Use mock passport flow (testnet mode)
3. Scan QR / tap deep link
4. Should receive API key
5. Use API key to submit art: `curl -H "Authorization: Bearer <key>" -X POST https://deviantclaw.art/api/match ...`
