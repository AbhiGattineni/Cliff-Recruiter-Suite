# Deployment

Project: **`cliff-services`** (`.firebaserc` default). Firebase CLI ≥ 13 required, on the
**Blaze** plan (Cloud Functions with outbound network).

## One-time setup
```bash
npm install -g firebase-tools
firebase login
cd cliff-recruiter-suite
npm install
(cd functions && npm install)
```

Create the env files from the templates and fill in real values:
```bash
cp .env.example .env                     # Firebase web config (public)
cp functions/.env.example functions/.env # non-secret Ceipal + LLM config
```

## Secrets
Real secrets are **never** committed. Set them in Cloud Functions:
```bash
firebase functions:secrets:set CEIPAL_PASSWORD
firebase functions:secrets:set LLM_API_KEY      # Ollama Cloud key
firebase functions:secrets:set OPENAI_API_KEY   # optional second provider
firebase functions:secrets:set SMTP_PASS        # only when auth/OTP is enabled
```
`functions/.env` holds only **non-secret** config (base URLs, Ceipal email + apiKey, report IDs).
The frontend `.env` holds only the Firebase **web** config, which is public by design (Firebase
security is enforced by Auth + Firestore rules, not by hiding the web apiKey).

## Build
```bash
npm run build                 # → dist/
(cd functions && npm run build)
```

## Deploy
```bash
# Hosting only (the SPA):
firebase deploy --only hosting

# Functions only:
firebase deploy --only functions

# Firestore / Storage rules:
firebase deploy --only firestore:rules,storage

# Everything:
firebase deploy
```

CI (`.github/workflows/deploy.yml`, on every push to `main`) deploys in two steps —
`hosting,firestore:rules` first, then `functions`. That order is on purpose: this project's
region keeps hitting *"Quota exceeded for total allowable CPU per project per region"* on one
Cloud Run service or another, and a combined deploy aborts before releasing hosting, leaving the
site on an older build with no obvious reason. Deploy by hand the same way when the quota is
playing up: get the site out, then retry functions.

## Hosting config
`firebase.json` serves `dist/` and rewrites all routes to `/index.html` (SPA). After a hosting
deploy the app is live at:
- `https://portal.cliffservices.com` — the address to give people
- `https://cliff-services.web.app`
- `https://cliff-services.firebaseapp.com`

The `.web.app` and `.firebaseapp.com` names keep working; they are Firebase's, not ours, and are
fine as a fallback if DNS is ever in doubt.

## Custom domain: portal.cliffservices.com
One hostname for everybody. Which tool you get is decided by the **role on your account**, not by
which URL you typed — see [PORTAL.md](PORTAL.md) for why, and for the four manual steps
(DNS, domain verification, Firebase Auth authorised domains, and the auth action-link domain)
that a `firebase deploy` cannot do for you.

## Local development
```bash
npm run dev            # Vite dev server (this repo runs on port 5180)
# Optional emulators (set VITE_USE_EMULATORS=true in .env):
firebase emulators:start
```

## Post-deploy checklist
- [ ] Enable the **Email/Password** provider in the Firebase console (before re-enabling auth).
- [ ] Confirm the four secrets are set (`firebase functions:secrets:access <NAME>`).
- [ ] Smoke-test `parseResume` and `ceipalReport` from the deployed app.
- [ ] `portal.cliffservices.com` resolves and serves the app over HTTPS.
- [ ] It is listed under **Authentication → Settings → Authorised domains**. Until it is,
      sign-in on that hostname fails with `auth/unauthorized-domain` while the `.web.app`
      address keeps working — which reads as "the new domain is broken" and is really just
      this checkbox.
