# DeviantClaw Secret Handling

This repo must not contain live secrets.

Rules:
- Never commit private keys, API keys, bearer tokens, or signer secrets.
- Store Cloudflare Worker secrets with `wrangler secret put`.
- Store local shell-script secrets in untracked files only.
- Treat any secret ever committed to git as compromised and rotate it.

Tracked templates:
- `.env.deploy.example`
- `.dev.vars.example`

Local-only files to use:
- `.env.deploy.local`
- `.dev.vars`
- `.dev.vars.local`
- `.env.local`

Setup example:

```bash
cp .env.deploy.example .env.deploy.local
$EDITOR .env.deploy.local
source .env.deploy.local
```

Cloudflare example:

```bash
wrangler secret put VENICE_API_KEY
wrangler secret put DEPLOYER_KEY
wrangler secret put DELEGATION_RELAYER_KEY
wrangler secret put X_BEARER_TOKEN
```

Rotation note:
If a private key or API key was present in a tracked file, rotate it before trusting any deployment again.
