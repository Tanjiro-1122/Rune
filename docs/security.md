# Jarvis Security Foundation

Jarvis is designed as a private owner-only workspace. It does not support public signup.

## Authentication

Production requires:

```env
APP_PASSWORD=your_private_login_password
SESSION_SECRET=a_long_random_secret_string
```

Optional:

```env
RUNE_SESSION_MAX_AGE_SECONDS=43200
```

The default session length is 12 hours. The hard maximum is 7 days.

Sessions are signed with HMAC and include a server-verified expiration timestamp. Legacy relaxed session cookies are rejected.

## Owner-only access

Only someone with `APP_PASSWORD` can sign in. Keep that password only in Vercel environment variables.

Do not commit passwords, API keys, Supabase service-role keys, seed tokens, Apple credentials, RevenueCat keys, or Vercel tokens to GitHub.

## Login protection

Jarvis blocks repeated failed login attempts from the same IP after 5 failures in 15 minutes.

## Security audit events

Run the latest `supabase/schema.sql` so Supabase has:

```sql
jarvis_security_events
```

Jarvis logs security events such as:

- successful login
- failed login
- login rate limit
- logout
- server auth misconfiguration

Security logging is best-effort and will never break chat/auth flow if Supabase is temporarily unavailable.

## Response hardening

Middleware adds security headers:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: same-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Robots-Tag: noindex, nofollow`

## Seed token cleanup

After initial memory seeding, rotate or remove `RUNE_MEMORY_SEED_TOKEN` in Vercel. If you keep it, treat it like a secret.
