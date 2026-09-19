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

## Regional CPU quota

The constraint that shapes this project's backend. Cloud Run's **Total CPU
allocation, in milli vCPU, per project per region** is **20,000** (= 20 vCPU),
and Google will not raise it: the console answers a request with *"Based on your
service usage history, you are not eligible for a quota increase at this time."*

**The functions live in `us-east1`.** `us-central1` filled up and stayed full,
and a deploy needs headroom for each new revision to run beside the old one
until traffic moves — so deploys stopped landing. Worse, they stopped landing
*quietly*: a refused revision leaves firebase-tools recording the uploaded
source as current, so the next pass reports "Skipped (No changes detected)" and
a build that shipped nothing looks like a build that shipped everything.

Note what the move did and did not buy. `us-east1` has the **same 20,000**, so
this is a clean region, not a bigger one — it has no stale revisions from failed
attempts holding reservations. Twenty-odd services at `maxInstances: 6` will
fill it the same way in time. When that happens the answer is the ceiling
(point 1 below), not a third region.

Cloud Run reserves `cpu x maxInstances` for a service whether or not a request
ever arrives, so the cost of a function is its **ceiling, not its traffic**.
Current *usage* sits at 0% — nothing is running — while the *allocation* is
full. Those are different numbers against the same limit, which is why the
quota page looks idle while a deploy is being refused.

A deploy that hits it says:

```
Could not create or update Cloud Run service <name>, Container Healthcheck failed.
Quota exceeded for total allowable CPU per project per region.
```

Three things follow, learned the hard way:

1. **`commonOpts.maxInstances` is a quota setting, not a performance one.** It
   went from the platform default of 100 to 10, and to 6 when the 23rd function
   would not fit. A v2 callable serves 80 concurrent requests per instance, so
   6 is ~480 in flight on any one callable — far more than a few dozen people
   can use.

2. **You cannot shrink your way out of a full region.** Lowering the ceiling
   means *updating* every service, each update briefly runs a new revision
   beside the old one, and a full region has no headroom for the overlap. An
   attempt to cut 6 -> 3 failed on all twenty-two functions for exactly that
   reason, and Firebase then reported "no changes detected" on the next pass
   because its change detection hashes the source, not the runtime config —
   which makes the failure easy to miss.

3. **The quota is per region, so another region is a clean way out.** Cloud Run
   allows this project 3 regions and only `us-central1` was in use.
   `meetingDigestSchedule` runs in `us-east1` for that reason and no other. It
   is a timer that talks to Firestore, Fireflies, the LLM and SMTP, all of which
   are reached identically from anywhere, and nobody is waiting on it.

   Anything user-facing should stay in `us-central1` beside the rest; a
   cross-region hop is free for a cron job and not for a person clicking a
   button. If `us-central1` fills again, the honest options are deleting unused
   functions, moving more background work out of the region, or asking Google
   again once usage history supports it.

## Secrets and new functions

Deploying a function that declares a **new** secret makes Firebase grant the
runtime service account read access to it. If the deploy account lacks
`secretmanager.secrets.setIamPolicy` the deploy fails with a 403 naming the
secret. Either grant the binding once by hand:

```bash
gcloud secrets add-iam-policy-binding <SECRET_NAME> \
  --member="serviceAccount:<project-number>-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" --project cliff-services
```

or give the deploy service account `roles/secretmanager.admin` once, so future
secrets need no manual step.

## Post-deploy checklist
- [ ] Enable the **Email/Password** provider in the Firebase console (before re-enabling auth).
- [ ] Confirm the four secrets are set (`firebase functions:secrets:access <NAME>`).
- [ ] Smoke-test `parseResume` and `ceipalReport` from the deployed app.
- [ ] `portal.cliffservices.com` resolves and serves the app over HTTPS.
- [ ] It is listed under **Authentication → Settings → Authorised domains**. Until it is,
      sign-in on that hostname fails with `auth/unauthorized-domain` while the `.web.app`
      address keeps working — which reads as "the new domain is broken" and is really just
      this checkbox.
