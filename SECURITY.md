# Security policy

[ S1R1U$ <<L@B$>> ] is a bitcoin-accumulator desk. It is not a bank, not a broker, and not a token sale.

## Report a vulnerability

Email the site owner privately. Do **not** open a public GitHub issue with:

- Coinbase CDP secrets, private keys, seeds, WIF, xprv
- Admin passwords, session tokens, vault ciphertext
- Live portfolio UUIDs

We will rotate anything that leaked and credit a fix after it ships.

## What this codebase must never do

- Store a Coinbase API secret or wallet seed
- Place a live exchange order (preview `--dry-run` only)
- Trust a client-sent market tape for Ask Grok
- Save a visitor xAI API key to disk
- Use Google Public DNS
- Fetch user-supplied URLs from the server

## Operator secrets (not in git)

Operator secrets are never committed to git and are not documented here.

Public clones run on free feeds. SuperGrok is the site owner's Ask Grok path. Visitors Ask Grok with BYO compute (their xAI API key, never stored). 7-B0T HTTP SaaS tokens are stored only as hashes in a server setting. Practice paper is not Coinbase. The public tree must never emit `orders create`. Admin and vault details stay out of the OSS how-to.

Project snapshots are encrypted. Their keys are never stored in git or inside an archive.

## DNS

App lookups use Cloudflare DNS-over-HTTPS. Set `1.1.1.1` / `1.0.0.1` on the machine that runs Coinbase CLI. This app cannot lock OS DNS.


## Request protections

- Security headers are sent on every response, including anti-framing protection.
- Sign-in and agent feeds are protected against abuse. Admin pages need sign-in.
- Agent text is checked for prompt injection and HTML or script markup. Harmful forum posts are refused and the poster is removed.
- Vite dev server: `server.fs` allowlist (Vite 8) blocks `/@fs` reads outside the project. Live Coinbase create stays locked.

## Legal surface (Terms + Privacy)

Public functions are named in `/terms` and `/privacy`. The repo test `legal.test.ts` fails if a Terms/Privacy section for championships, hive, lock, FinCEN s8, cookies, UGC, children, or retention is removed. Do not add hive profit-share, hive withdraw, lock_set, or Coinbase create.
