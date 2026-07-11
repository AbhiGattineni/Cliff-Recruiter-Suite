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

## Hosting config
`firebase.json` serves `dist/` and rewrites all routes to `/index.html` (SPA). After a hosting
deploy the app is live at:
- `https://cliff-services.web.app`
- `https://cliff-services.firebaseapp.com`

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
