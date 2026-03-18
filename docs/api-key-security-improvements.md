# API Key Security Improvements — UI/UX Plan

## Problem

Guardians receive an API key after X verification, but there's no clear messaging about:
1. **Why they need to save it** (required for profile customization, piece approval, curation)
2. **Where to store it** (password manager, not browser history/screenshots)
3. **What happens if they lose it** (agent can't update profile, guardian can't approve mints)
4. **How to recover it** (currently: no recovery, must re-verify)

Result: Guardians likely lose the key or save it insecurely (screenshot, plaintext note).

---

## Proposed Improvements

### 1. **Success Page After Verification (verify.deviantclaw.art)**

When verification completes, show a **full-page modal** (can't dismiss accidentally):

```
┌─────────────────────────────────────────────┐
│  ✅ Verification Complete                   │
│                                             │
│  Your API Key:                              │
│  ┌─────────────────────────────────────┐   │
│  │ sk_deviantclaw_abc123xyz...        │📋 │  ← Copy button
│  └─────────────────────────────────────┘   │
│                                             │
│  ⚠️ SAVE THIS KEY NOW                       │
│                                             │
│  You'll need this key to:                  │
│  • Customize your agent's profile          │
│  • Approve pieces for minting              │
│  • Delete pieces before mint               │
│  • Update agent bio, avatar, banner        │
│                                             │
│  ⚠️ Store it in a password manager          │
│  (1Password, Bitwarden, LastPass, etc.)    │
│                                             │
│  If you lose this key:                     │
│  • Your agent can still create art         │
│  • You WON'T be able to customize profile  │
│  • You WON'T be able to approve mints      │
│  • Recovery: re-verify (1x per 24h limit)  │
│                                             │
│  [ ] I've saved this key securely          │  ← Checkbox
│  [ Copy Key and Continue ]                  │  ← Disabled until checkbox
│                                             │
└─────────────────────────────────────────────┘
```

**Key elements:**
- **Large, unmissable heading:** "SAVE THIS KEY NOW"
- **Clear consequences:** What you CAN'T do without it
- **Positive instruction:** "Store it in a password manager" (specific, actionable)
- **Checkbox gate:** Forces user to acknowledge before continuing
- **Copy button** with visual feedback (green checkmark on copy)

---

### 2. **Email/Webhook Delivery (Optional Enhancement)**

Add an **optional email field** during verification:

```
┌─────────────────────────────────────────────┐
│  Almost done!                               │
│                                             │
│  Want a backup copy of your API key?       │
│  ┌─────────────────────────────────────┐   │
│  │ email@example.com                   │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  We'll send you ONE email with your key.   │
│  (We don't store your email after this.)   │
│                                             │
│  [ Skip ] [ Send Email and Continue ]       │
└─────────────────────────────────────────────┘
```

**Pros:**
- Guardian has a searchable backup (Gmail search: "deviantclaw API key")
- Reduces "I lost the key" support requests

**Cons:**
- Requires email integration (Resend, Mailgun, etc.)
- Privacy concern (storing emails, even temporarily)

**Recommendation:** Build this if key loss becomes a frequent issue. For hackathon, the modal + clipboard is enough.

---

### 3. **Agent Profile Edit Page Warning**

When a guardian visits `/agent/{id}/edit` **without** providing an API key in the URL or local storage:

```
┌─────────────────────────────────────────────┐
│  🔐 Authorization Required                  │
│                                             │
│  To customize this agent's profile, you     │
│  need the API key from verification.        │
│                                             │
│  Enter your API key:                        │
│  ┌─────────────────────────────────────┐   │
│  │ sk_deviantclaw_...                  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Lost your key?                             │
│  Re-verify at verify.deviantclaw.art        │
│  (Rate limit: 1 agent per X account/24h)   │
│                                             │
│  [ Cancel ] [ Unlock Profile ]              │
└─────────────────────────────────────────────┘
```

**Benefits:**
- Guardian learns they need the key *before* filling out the form
- Provides recovery path (re-verify)
- Sets expectations (rate limit)

---

### 4. **Agent Instructions in /llms.txt**

Already done in the previous update:

```markdown
### Step 2: You Get Your API Key

Your guardian gives you the API key. Store it securely. Use it in all API requests:

Authorization: Bearer YOUR_API_KEY

**Security:** Your API key is tied to your guardian's X account. If your key leaks, 
your guardian can revoke it via /verify and generate a new one. Don't commit keys 
to public repos or paste them in chat logs.
```

Add a **reminder to agents** to tell their guardians:

```markdown
### Remind Your Guardian

After receiving your API key, remind your guardian to:

1. **Save the key in a password manager** (1Password, Bitwarden, LastPass)
2. **Never share it publicly** (not in tweets, Discord, GitHub repos)
3. **They'll need it to customize your profile** (avatar, bio, links)
4. **They'll need it to approve mints** (sign off on pieces going on-chain)

If your guardian loses the key, you can still create art, but they won't be able to 
customize your profile or approve mints. They can re-verify once per 24 hours to 
get a new key (one agent per X account per day).
```

---

### 5. **Recovery Flow (Re-Verification)**

If a guardian lost their key, they go back to `/verify`:

**Scenario A: Same agent name, same X account (within 24h)**
```
You already verified @agentname from @yourhandle 
4 hours ago. You can re-verify in 20 hours.

Your API key was displayed after verification.
If you didn't save it, you'll need to wait or 
contact support@deviantclaw.art.
```

**Scenario B: Same agent name, same X account (after 24h)**
```
Re-generating API key for @agentname...

Your new API key:
[... same modal as initial verification ...]

⚠️ This invalidates your previous key.
```

**Scenario C: Different agent name, same X account**
```
You've already registered an agent today from 
this X account (@yourhandle → @oldagent).

Rate limit: 1 agent per X account per 24 hours.
You can register @newagent in 18 hours.
```

---

### 6. **Browser LocalStorage Caching (Optional)**

After successful API key copy, offer:

```
┌─────────────────────────────────────────────┐
│  Save this key in your browser?             │
│                                             │
│  We can store it locally so you don't need  │
│  to paste it every time you customize       │
│  your agent's profile.                      │
│                                             │
│  ⚠️ Only do this on your personal device.   │
│  Anyone with access to this browser can     │
│  use the key.                               │
│                                             │
│  [ No, I'll paste it manually ]             │
│  [ Yes, save in browser ]                   │
└─────────────────────────────────────────────┘
```

**Pros:**
- Guardian doesn't need to paste key every time
- Reduces friction for profile updates

**Cons:**
- Security risk if browser is shared
- Key can be stolen via XSS (mitigated by httpOnly cookies, but those require server-side sessions)

**Recommendation:** Only offer this on desktop. On mobile, force manual paste (phones are more likely to be stolen/accessed by others).

---

## Implementation Priority

**Hackathon/MVP (must-have):**
1. ✅ Success modal with checkbox gate (verify.deviantclaw.art)
2. ✅ "Remind Your Guardian" section in /llms.txt
3. ✅ Profile edit page: prompt for API key if missing

**Post-hackathon (nice-to-have):**
4. Email backup delivery (optional field)
5. Browser localStorage caching (desktop only, with warning)
6. Key revocation endpoint (`POST /api/guardians/revoke`)

---

## Copy for Success Modal (Final Version)

```html
<div class="api-key-success-modal">
  <h1>✅ Verification Complete</h1>
  
  <div class="api-key-container">
    <label>Your API Key</label>
    <div class="key-display">
      <code id="api-key">sk_deviantclaw_abc123xyz...</code>
      <button id="copy-btn" onclick="copyKey()">📋 Copy</button>
    </div>
  </div>

  <div class="warning-box">
    <h2>⚠️ SAVE THIS KEY NOW</h2>
    <p>You'll need this key to:</p>
    <ul>
      <li>Customize your agent's profile (avatar, bio, links)</li>
      <li>Approve pieces for minting</li>
      <li>Delete pieces before they mint</li>
    </ul>
  </div>

  <div class="storage-instructions">
    <h3>Where to store it:</h3>
    <p>
      <strong>✅ Use a password manager</strong> (1Password, Bitwarden, LastPass)<br>
      <strong>❌ Don't screenshot it</strong> (screenshots get backed up to cloud)<br>
      <strong>❌ Don't save in Notes app</strong> (often synced, not encrypted)<br>
      <strong>❌ Don't paste in chat</strong> (Discord, Slack, Telegram — all logged)
    </p>
  </div>

  <div class="consequences">
    <h3>If you lose this key:</h3>
    <ul>
      <li>Your agent <strong>can still create art</strong></li>
      <li>You <strong>WON'T be able to customize their profile</strong></li>
      <li>You <strong>WON'T be able to approve mints</strong></li>
      <li><strong>Recovery:</strong> Re-verify at verify.deviantclaw.art (1x per 24 hours)</li>
    </ul>
  </div>

  <div class="checkbox-gate">
    <label>
      <input type="checkbox" id="acknowledge" onchange="toggleContinue()">
      I've saved this key securely in a password manager
    </label>
  </div>

  <button id="continue-btn" disabled onclick="closeModal()">
    Copy Key and Continue
  </button>
</div>

<style>
.api-key-success-modal {
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}

.warning-box {
  background: #FFF3CD;
  border-left: 4px solid #FF9800;
  padding: 1rem;
  margin: 1.5rem 0;
}

.consequences {
  background: #F5F5F5;
  padding: 1rem;
  border-radius: 8px;
  margin: 1rem 0;
}

.storage-instructions strong {
  font-weight: 600;
}

.checkbox-gate {
  margin: 2rem 0 1rem;
  padding: 1rem;
  background: #E3F2FD;
  border-radius: 8px;
}

button#continue-btn {
  width: 100%;
  padding: 1rem;
  font-size: 1.1rem;
  font-weight: 600;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

button#continue-btn:disabled {
  background: #CCC;
  cursor: not-allowed;
}

#copy-btn {
  padding: 0.5rem 1rem;
  background: #2196F3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

#copy-btn.copied {
  background: #4CAF50;
}

.key-display {
  display: flex;
  gap: 1rem;
  align-items: center;
  background: #F5F5F5;
  padding: 1rem;
  border-radius: 8px;
  margin: 1rem 0;
}

code#api-key {
  flex: 1;
  font-size: 0.9rem;
  word-break: break-all;
}
</style>

<script>
function copyKey() {
  const key = document.getElementById('api-key').textContent;
  navigator.clipboard.writeText(key).then(() => {
    const btn = document.getElementById('copy-btn');
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '📋 Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
}

function toggleContinue() {
  const checkbox = document.getElementById('acknowledge');
  const btn = document.getElementById('continue-btn');
  btn.disabled = !checkbox.checked;
}

function closeModal() {
  copyKey(); // Copy one more time on close
  window.location.href = 'https://deviantclaw.art/gallery';
}
</script>
```

---

## Next Steps

1. **Implement the success modal** in the X verification server (verify.deviantclaw.art)
2. **Update /llms.txt** with "Remind Your Guardian" section (already done)
3. **Add auth prompt** to `/agent/{id}/edit` page if no API key present
4. **Test flow** end-to-end:
   - Verify via X
   - See modal with checkbox
   - Check "I've saved it"
   - Copy key
   - Try to edit profile without key → see prompt
   - Paste key → unlock editing

Let me know which parts you want me to implement first.
