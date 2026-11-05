# Publish [ S1R1U$ <<L@B$>> ] — GitHub + DigitalOcean

**S1R1US App build #113 (live sim launch)** — live admin simulation on Coinbase last. G M0D3 AUTO, AI agents, and PR3D1CT10N$ paper tick while LIVE. Live trades off. Auto trade LOCKED. Carbon-fiber baseline DEPLOY #68.

Repo: https://github.com/S1R1US-AI/S1R1US-LaBs-public  
Site: https://s1r1us.ai

## What this repo is

Node 22 web desk. Docker build uses the Nitro node-server preset and listens on **8080**.  
Do **not** commit wallets, CDP secrets, hardware-key material, `.env`, or `*.pass.txt`.

## DigitalOcean App Platform — live production

| | |
|---|---|
| Site | https://s1r1us.ai |
| GitHub | `S1R1US-AI/S1R1US-LaBs-public` (never `s1r1us.ai/your-repo`) |
| Branch | `main` |
| Autodeploy | **on** (`deploy_on_push: true`) — a push to `main` rebuilds live |
| Spec | kept outside this repo |
| App name | `s1r1us-labs` |
| Dockerfile | root · HTTP **8080** · builds `.output` from source (2 stages) · **1 GB** runtime |
| Source directory | blank (never `/`) |

`.output` is **not** in git. The Dockerfile builds it from source on DigitalOcean's build machine (`npm ci` then `npm run build:do`). App Platform builds run on separate build resources, not on the 1 GB runtime instance, so the compile does not hit the runtime memory limit. The runtime stage copies only `.output`, `scripts/do-start.mjs` and `front-door-static`, as before.

- Push source only. Never commit `.output` (it is in `.gitignore`, and GitHub CI fails if it is tracked).
- Local check, same as DigitalOcean: `npm ci && npm run build:do && npm start`.
- The Dockerfile reads no DigitalOcean settings at build time, so nothing from the dashboard is baked into the image. Keep every secret setting at **run time** scope.
- If a DigitalOcean build fails, the last good deployment keeps serving. Roll back from **Activity → Deployments → Rollback**.

Only **one** App Platform app may own `S1R1US-AI/S1R1US-LaBs-public`. If a staging app already uses that repo, disconnect it or move it off `main` first.

### Turn autodeploy on (one Control Panel pass)

DigitalOcean cannot change the GitHub repo from a button — you edit the App Spec. Encrypted env stays on the dashboard. **Change only the `github` block.** Do not delete SECRET rows.

1. Open the production project in DigitalOcean (not staging).
2. Open the **s1r1us-labs** app that serves s1r1us.ai.
3. **Settings → App Spec → Edit**.
4. Set the `github` block to exactly:

```yaml
github:
  repo: S1R1US-AI/S1R1US-LaBs-public
  branch: main
  deploy_on_push: true
```

5. Save / **Upload File**. The app rebuilds.
6. If DigitalOcean asks to authorize GitHub, approve the DigitalOcean GitHub App on org **S1R1US-AI** for repo **S1R1US-LaBs-public**.
7. Confirm the encrypted auth secret and Grok sign-in client secret are still there after save.

New app (only if the production project has none): Create App → GitHub → `S1R1US-AI/S1R1US-LaBs-public` → branch `main` → Autodeploy **on** → Dockerfile · HTTP 8080 · 1 GB → then **Add from .env** (below) and attach s1r1us.ai.

## GoDaddy DNS (already set)

Nameservers stay on GoDaddy. Do not change them.

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `162.159.140.98` | ½ hour |
| A | `@` | `172.66.0.96` | ½ hour |
| A | `www` | `162.159.140.98` | ½ hour |
| A | `www` | `172.66.0.96` | ½ hour |

Delete leftover Vercel A `76.76.21.21` and `cname.vercel-dns.com`.

Then DigitalOcean **Settings → Domains → add s1r1us.ai** (and www). TLS issues only after a **green** deploy + that attach.

## Env on DigitalOcean (dashboard, not GitHub)

**Add from .env:** Settings → **web** → Environment Variables → Edit → **Add from .env**. Paste the filled `.env` (never GitHub). After import:

1. Encrypt the auth secret and the Grok sign-in client secret.
2. Replace the client-secret placeholder with the real secret from **Grok App Settings → Auth**.
3. Confirm the Grok sign-in client id is complete (no ellipsis). Do not encrypt the client id so you can read it.
4. If the auth secret is already encrypted on the host, keep that row — do not overwrite it.
5. Save. Autodeploy on `main` picks up later pushes.

The setting names, their values and the filled `.env` stay in the private deploy notes, never in git.

X sign-in on https://s1r1us.ai/login uses **Continue with X** (Grok broker → X). Production needs the Grok sign-in pair above. The preview sign-in client is for preview hosts only.

Admin sign-in is for the site owner only. Other X accounts are users only.

Do not add Google DNS. No external database is required (PGLite).

## Required secret: YubiKey tap limit

`S1R1US_YUBI_TAP_KEY` is **required**. Set it on DigitalOcean (Settings → web → Environment Variables) as an **encrypted** secret at **run time** scope **before** the deploy that includes the per-admin YubiKey tap limit. Never commit its value and never use a `VITE_` prefix.

| Setting | Type | Scope | Value |
|---|---|---|---|
| `S1R1US_YUBI_TAP_KEY` | SECRET (encrypted) | RUN_TIME | at least 32 random bytes, generated by the site owner (e.g. `openssl rand -base64 48`); typed only into the dashboard |

App Spec: the setting is one entry in the `web` service's `envs` list with `type: SECRET` and `scope: RUN_TIME`. Leave the value out of any spec file you save; type it in the dashboard, which stores it encrypted.

- Missing or shorter than 32 bytes (after trimming spaces): `scripts/do-start.mjs` logs one startup warning that names the setting (never a value), and every admin YubiKey tap is refused (outgoing approvals, YubiKey confirm and password renew). Taps fail closed; the server still starts.
- Rotating it resets every admin's failed-tap count (the stored key is an HMAC under this secret). No other data depends on it.

## iOS

Same URL. Safari → Share → Add to Home Screen.


## System-admin settings (server-only)

Set on DigitalOcean (encrypted, run time) before deploy:

- The admin X identity settings (three) and the copy-admin secret. Their names are in the private deploy notes, not in this public file.

## Server-only settings added 2026-10-08

Set these on DigitalOcean (Settings → web → Environment Variables, **encrypted**, run time) **before** this change deploys. Never commit their values and never use a `VITE_` prefix.

| Key | Value | Notes |
|---|---|---|
| Reset mailbox setting (name in the private deploy notes) | the site owner's reset mailbox | Admin password renew mail goes here. Unset = no renew mail is sent. A role mailbox on the project domain is recommended. |
| Preview sign-in secret (name in the private deploy notes) | leave **unset** on production | Preview sign-in only. Production never uses the preview broker. |
