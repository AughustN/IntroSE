# Deploying TixHub

Topology, and why it is shaped this way: [ADR 0003](../adr/0003-deployment-topology.md).

```
browser --HTTPS--> Cloudflare edge --HTTP--> nginx:80 --HTTP--> node:4000 --> Neon
                                              |
                    tixhub.fit      -> static /var/www/tixhub/dist
                    api.tixhub.fit  -> reverse proxy to 127.0.0.1:4000
```

The API host serves three things, all on `api.tixhub.fit`: `/api/*`, `/uploads/*` (avatars), and
`/socket.io/*` (the live seat channel). Proxy `/`, not `/api/`.

Files here:

| File | What it is |
|---|---|
| `nginx.conf` | Both server blocks, plus the `http {}`-level maps and Cloudflare ranges |
| `tixhub-api.service` | systemd unit for the API |

---

## First deploy

**1. Code and dependencies**

```bash
sudo mkdir -p /var/www/tixhub && sudo chown tixhub:tixhub /var/www/tixhub
sudo -u tixhub git clone <repo> /var/www/tixhub
cd /var/www/tixhub
sudo -u tixhub npm ci
```

**2. Environment**

```bash
sudo -u tixhub cp .env.example .env
sudo -u tixhub $EDITOR .env
sudo chmod 600 .env          # SEC-11 — holds JWT_SECRET, the Neon URL, the VNPay secret
```

Production values that differ from the example, each with a specific failure if missed:

| Variable | Production value | If wrong |
|---|---|---|
| `NODE_ENV` | `production` | Refresh cookie ships **without `Secure`** (`secure: config.isProd`) |
| `APP_URL` | `https://tixhub.fit` | Password-reset and verification links point at localhost |
| `CORS_ORIGINS` | `https://tixhub.fit` | Inheriting the default leaves `http://localhost:3000` allowed to make credentialed calls |
| `VITE_API_URL` | `https://api.tixhub.fit` | Read at **build** time, not runtime — see step 4 |
| `VNPAY_RETURN_URL` | `https://tixhub.fit/vnpay-return` | Buyer lands on localhost after paying |
| `DATABASE_URL` | Neon **main** branch | — |

`TEST_DATABASE_URL` is only needed to run the suite; the server does not read it outside vitest.

**3. Database**

```bash
sudo -u tixhub npm run db:migrate
```

Check `DATABASE_URL` first. `server/src/db/guards.ts` refuses to run destructive jobs against
`DEMO_DATABASE_URL`, but nothing stops a migration against the wrong branch.

**4. Build the SPA**

```bash
sudo -u tixhub npm run build      # → dist/
```

`VITE_API_URL` is inlined into the bundle at build time. Changing it later requires a **rebuild**;
restarting the API does nothing.

**5. uploads/**

```bash
sudo -u tixhub mkdir -p /var/www/tixhub/uploads/avatars
```

Nginx never touches this directory — Express serves it (`app.use("/uploads", express.static(...))`)
and resolves it from `process.cwd()`, which is why the systemd unit sets `WorkingDirectory`.

**6. API service**

```bash
sudo cp docs/deploy/tixhub-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tixhub-api
sudo systemctl status tixhub-api
```

**7. Nginx**

Copy the two server blocks from `nginx.conf` into `/etc/nginx/sites-available/tixhub`, and the
`map` directives + `set_real_ip_from` lines into the `http {}` block of `/etc/nginx/nginx.conf`
(they are not valid inside a `server`).

```bash
sudo ln -s /etc/nginx/sites-available/tixhub /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**8. Cloudflare**

- DNS: `tixhub.fit` and `api.tixhub.fit` → VPS IP, both **proxied** (orange cloud). Grey cloud
  exposes the origin IP and bypasses everything below.
- SSL/TLS → Overview: currently **Flexible**. See the warning below.
- SSL/TLS → Edge Certificates → **Always Use HTTPS: on**. This is what redirects http→https.
  Doing it in Nginx instead causes an infinite loop under Flexible (`nginx.conf` explains why).

**9. VNPay**

Register the IPN URL in the merchant portal as
`https://api.tixhub.fit/api/payments/vnpay/ipn`. The wallet is credited by the IPN, not by the
browser redirect — an unregistered or unreachable IPN leaves every top-up stuck in `initiated`
until the reconciliation sweep queries VNPay (`TOPUP_RECONCILE_AFTER_MS`, default 15 min).

The IPN is a **server-to-server** callback from VNPay, which is not a browser and will not solve a
challenge. If Cloudflare's Bot Fight Mode, a security level above Medium, or a WAF rule intercepts
it, VNPay gets a challenge page instead of the endpoint and the top-up silently never settles. Add a
Cloudflare rule for `api.tixhub.fit/api/payments/vnpay/ipn` that disables Security and Bot
Protection, or verify the path returns the app's own response from outside the network. The
signature check (`hasValidVnpaySignature`) is what makes the endpoint safe to expose this way.

---

## Redeploy

```bash
cd /var/www/tixhub
sudo -u tixhub git pull
sudo -u tixhub npm ci
sudo -u tixhub npm run db:migrate     # if there are new migrations
sudo -u tixhub npm run build          # if the frontend changed
sudo systemctl restart tixhub-api     # if the backend changed
```

Nginx needs no reload for either — `dist/` is read per request and the API port is unchanged.

---

## Two open security items

**Flexible SSL leaves the Cloudflare→VPS leg in plaintext.** Session cookies, passwords, and access
tokens cross it unencrypted. This is the gap SEC-01 exists to close. Fix: create a Cloudflare Origin
Certificate, switch to **Full (strict)**, and follow the upgrade steps at the bottom of `nginx.conf`.

**The origin firewall is part of the security model, not hardening.** Cloudflare only protects
requests that go through Cloudflare. If the VPS accepts `:80`/`:443` from anywhere, the origin IP is
a direct route past the WAF, the rate limiting, and the DDoS absorption — and past the `real_ip`
rewrite the throttle depends on. Allow only the Cloudflare ranges listed in `nginx.conf`
(`ufw allow from <cidr> to any port 80`, one per range, then deny the rest).

---

## When something is wrong

| Symptom | Cause |
|---|---|
| `ERR_TOO_MANY_REDIRECTS` | A `return 301 https` in Nginx under Flexible mode. Remove it; use Cloudflare's Always Use HTTPS |
| CORS error in console | `CORS_ORIGINS` does not contain `https://tixhub.fit` exactly (scheme included, no trailing slash) |
| Login works, refresh 401s after 15 min | Refresh cookie not stored. Check `NODE_ENV=production` and that the browser is on `https://tixhub.fit`, not the bare IP |
| Seat map static, `/socket.io/` polling in Network tab | WebSocket upgrade not proxied — the `map $http_upgrade` block or the two `proxy_set_header` lines are missing |
| Avatar upload → 413 | `client_max_body_size` below 3m on the API server block |
| Avatars 404 after upload | `WorkingDirectory` wrong in the unit, or the API block only proxies `/api/` |
| Whole regions rate-limited at once | `set_real_ip_from`/`real_ip_header` missing — every visitor shares the Cloudflare edge IP's throttle bucket |
| Top-ups stuck `initiated` | IPN URL wrong in the VNPay portal, or Cloudflare is challenging the callback — see below |

Logs: `journalctl -u tixhub-api -f` and `/var/log/nginx/error.log`.
