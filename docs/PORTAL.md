# The portal: one door, two audiences

`www.cliffservices.com` is the front of the company — public, indexed, for people who have not
met us yet. `portal.cliffservices.com` is this app: the place the people who already work with
us sign in. Two hostnames, two repos, two hosts (the site is on Vercel, the portal on Firebase),
one brand.

## Why one hostname and not two

The obvious shape is `recruiters.cliffservices.com` and `consultants.cliffservices.com` — it
sounds tidy when you say it out loud. It isn't, and the reason is in the code rather than in the
URL bar.

**Access here is decided by the role on the account, not by the address someone typed.** A
signed-in user has exactly one role — `admin`, `manager`, `employee` or `consultant` — and:

- `src/App.tsx` routes on it: a `consultant` gets `/portal` and nothing else; staff get the
  suite. A consultant who guesses a suite URL is redirected out of it.
- `firestore.rules` enforces it, which is the part that actually matters. `isStaff()` gates
  every staff collection; `assignmentRates` is denied to consultants outright, which is why
  bill and pay rates live in their own collection rather than as fields on the assignment —
  Firestore grants whole documents, so a field cannot be hidden inside one.

Two hostnames would not add a single security boundary on top of that. They would add a way to
get it wrong: the same bundle on two names, a consultant handed the recruiter link by a
colleague and meeting an error instead of their timesheet, two sets of DNS and TLS to keep
alive, and a second entry in every auth allowlist. And the one case that is certain to come up —
a consultant we later hire, or a recruiter who also has an assignment — would mean changing the
URL a person has bookmarked, when all that actually changed is one field on their profile.

So: one address for everyone, and the role decides what is behind it. The sign-in screen says
"Cliff Services", never "Recruiter Suite", because a consultant filing hours for a client does
not work at a recruiting firm and the front door is not the place to tell them what the people
on the other side of it are using.

## Who gets an account, and how

| | Staff (`admin` / `manager` / `employee`) | Consultant |
|---|---|---|
| How the account is made | Self-registration at `/signup` | Invited by staff — **Consultants → invite** |
| Email | `@cliff-services.com` only, enforced in `AuthContext.signUp` | Their own address, usually personal |
| Lands on | The recruiter suite | `/portal` — their timesheet, nothing else |
| Can reach | Per role; `admin`/`manager` also get Consultants and Ask Anything | Their own assignment and their own weeks |

Signing **in** is open to any address on purpose. It used to be domain-locked, back when every
account belonged to staff; a placed consultant is invited on a personal email, and refusing them
at the door meant an account we deliberately created could never be used. Nothing is lost by
dropping it — an account only exists if we made it or if someone self-registered, and
self-registration is still domain-locked.

## Setting the hostname up

Four steps. `firebase deploy` does none of them, and the first three are one-time.

**1. Add the domain in Firebase.** Console → **Hosting** → **Add custom domain** →
`portal.cliffservices.com`. Firebase issues a TXT record to prove we own it, then two A records.

**2. Add the DNS records** at whoever hosts `cliffservices.com`'s zone. The A records Firebase
gives are usually:

```
portal.cliffservices.com.  A  151.101.1.195
portal.cliffservices.com.  A  151.101.65.195
```

Use the values the console actually shows — they are Firebase's to change, not ours to memorise.
If the marketing site's DNS is managed at Vercel, this record goes in the same zone as the
`www` record and does not disturb it: `www` keeps pointing at Vercel, `portal` points at
Firebase. Nothing about the public site changes.

**3. Authorise the domain for sign-in.** Console → **Authentication** → **Settings** →
**Authorised domains** → add `portal.cliffservices.com`.

This one is easy to skip and confusing when you do: hosting works, the page loads, and only the
sign-in call fails — with `auth/unauthorized-domain` — while `cliff-services.web.app` keeps
working perfectly. It reads like the new domain is broken. It is one checkbox.

**4. Point the auth action links at it.** Password-reset and verification emails are built from
the **action URL**, which defaults to `cliff-services.firebaseapp.com`. Left alone, someone who
resets their password from `portal.cliffservices.com` gets an email that sends them to a
hostname they have never seen — which is exactly what a phishing mail looks like, and is worth
avoiding for that reason alone.

Console → **Authentication** → **Templates** → edit any template → **Customise action URL** →
`https://portal.cliffservices.com`. It applies to all of them.

Certificate provisioning takes Firebase anywhere from a few minutes to ~24 hours after the DNS
records resolve. Until it finishes the domain serves a warning; that is normal and needs no
action.

## Checking it

```bash
dig +short portal.cliffservices.com            # expect the two Firebase A records
curl -sSI https://portal.cliffservices.com | head -1   # expect HTTP/2 200
```

Then, in a browser: sign in as a member of staff and confirm you land on the dashboard; sign in
as a consultant and confirm you land on `/portal` and cannot reach `/recruiters` by typing it.

## Keeping the two looking like one company

The portal's stylesheet (`src/index.css`) is the marketing site's Tailwind theme restated as
plain CSS custom properties — same ink ground, same violet→indigo gradient, same Inter and
Space Grotesk. The public site has Tailwind; this app does not and does not need it, so the
palette is duplicated rather than shared.

That means **a brand change is two edits, not one**. If the palette moves in
`cliff/tailwind.config.js`, move the tokens in `:root` here to match. Everything in this app
reads from those tokens — no component should ever name a colour directly.
