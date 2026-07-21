# quota-sidecar

A tiny, dependency-free service that lets **mdd-cli** show 9router subscription quota
using each user's **model API key** — without ever putting the dashboard password on a
user's machine.

## Why

The 9router **dashboard** endpoints (`/api/usage`, `/api/providers/client`) require a
dashboard login (password / OIDC session). The **model API key** only authorizes
`/v1/*` inference. So the CLI can't read quota with the API key directly.

This sidecar bridges that: it validates the caller's API key, then logs into the
dashboard **server-side** with a service account (password kept only here) and returns
the quota. Result:

- **No shared secret on user machines** — users authenticate with their own API key.
- **The dashboard password lives only in the sidecar's environment.**
- **Zero changes to 9router** and zero changes to mdd-cli — mdd already calls
  `GET /api/usage/me` with `Authorization: Bearer <apiKey>` and parses the response.

```
mdd-cli ──(Bearer: user's API key)──▶ quota-sidecar ──(service-account cookie)──▶ 9router dashboard
                                          │  validates key via /v1/models
                                          └─ returns { connections: [ … quotas … ] }
```

## Endpoint

```
GET /api/usage/me
Authorization: Bearer <9router model API key>
→ 200 { "connections": [ { "id","provider","name","testStatus","limitReached","quotas": { … } } ] }
→ 401 invalid/missing key   → 502 dashboard unreachable
```
Also `GET /health` → `{ ok: true }`.

## Configure (env)

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `DASHBOARD_PASSWORD` | ✅ | — | Service-account password. **Put it in your host's secret manager**, not in code. |
| `DASHBOARD_EMAIL` | — | (none) | Only if your login needs email + password. |
| `DASHBOARD_URL` | — | `https://ai-router.mdd.co.id` | Where `/api/auth/login` + `/api/usage` live. |
| `API_URL` | — | `https://ai-router.mdd.co.id/v1` | OpenAI-compatible base, used to validate the caller's key. |
| `QUOTA_TTL_MS` | — | `30000` | Cache the assembled quota (many users ≈ one dashboard hit). |
| `KEY_TTL_MS` | — | `300000` | Cache a key's validity to avoid re-checking every request. |
| `PORT` | — | `8080` | |

## Run

```bash
DASHBOARD_PASSWORD='…' node server.mjs
# deploy to Render/Railway/Fly/Cloud Run etc. — anything that runs a Node 20 process behind HTTPS
```

## Point mdd-cli at it

Once deployed behind HTTPS, tell mdd where quota lives (users already have their API key
from onboarding):

```bash
export MDD_ROUTER_URL='https://<your-sidecar-host>'
```

mdd then calls `https://<your-sidecar-host>/api/usage/me` with the user's API key and shows
the indicator. Nothing else to configure. (Disable with `MDD_NO_QUOTA`.)

## Notes / hardening

- **Serve over HTTPS.** The API key travels in the `Authorization` header.
- Scope the service account to the least it needs (read-only dashboard access if 9router
  supports it).
- The quota returned reflects the shared account's connections; the API-key check only
  proves the caller is a valid 9router user (per-user scoping would need 9router's key→user
  mapping, which the sidecar doesn't have).
- Rotate `DASHBOARD_PASSWORD` anytime — it changes in one place (the sidecar env).
