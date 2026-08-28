# ShangHao account system v1

The active account provider is selected by configuration. The CloudBase path uses Auth v2 from the
Electron main process: phone verification, phone registration, username/phone/password login,
session restoration, and native user profile fields. The renderer never receives administrator
credentials, and the main process stores the CloudBase session with `safeStorage`.

When the relay is configured with `SHANGHAO_ACCOUNT_PROVIDER=cloudbase`, it verifies the CloudBase
access token before accepting the signaling connection and derives the relay identity from the
verified token. The desktop sends only the current access token during the WebSocket handshake;
client-provided uid or username values are not trusted.

During the migration, `supabase` remains an explicit fallback provider for existing deployments.
It is not used by the CloudBase path and can be removed after the CloudBase client, relay, and
production configuration have been validated together.

The ten bundled registration avatars are local SVG assets. The renderer rasterizes the selected
preset to WebP and applies the same 512 KB limit as a custom upload before sending it to the relay;
raw SVG is never uploaded to the public avatar bucket.

## CloudBase server setup

1. Enable CloudBase Auth v2 phone SMS verification and username/password login in environment
   `shanghao-d3ga95tc8224e727a` (`ap-shanghai`).
2. Configure the relay with the following variables. `CLOUDBASE_PUBLISHABLE_KEY` is publishable
   configuration only; never place a CloudBase SecretId, SecretKey, or administrator credential in
   the desktop build, renderer environment, repository, logs, or screenshots.

   ```env
   SHANGHAO_ACCOUNT_PROVIDER=cloudbase
   CLOUDBASE_ENV_ID=shanghao-d3ga95tc8224e727a
   CLOUDBASE_REGION=ap-shanghai
   CLOUDBASE_PUBLISHABLE_KEY=replace-with-cloudbase-publishable-key
   # Optional; defaults to https://<CLOUDBASE_ENV_ID>.api.tcloudbasegateway.com/auth/v1
   CLOUDBASE_AUTH_BASE_URL=https://your-env-id.api.tcloudbasegateway.com/auth/v1
   ```

3. The relay only needs `CLOUDBASE_ENV_ID` and `CLOUDBASE_REGION` to verify bearer access tokens;
   `CLOUDBASE_PUBLISHABLE_KEY` is optional on the relay and is exposed only as public client
   configuration when present. Start the local desktop and relay against the same provider. The
   desktop receives public CloudBase configuration from the relay; its local
   `VITE_CLOUDBASE_PUBLISHABLE_KEY` is the renderer-side development configuration.
4. Keep the existing Supabase variables only while the fallback deployment is needed. Once phone
   registration, login/session restoration, relay authentication, room entry, logout, and a fresh
   login have been validated with CloudBase, remove the fallback runtime path and its relay secrets.

## Direct Tencent Relay sync without GitHub

The repository includes `scripts/sync-cloudbase-relay.ps1` for the current migration. It uploads
only the CloudBase relay verifier, provider selection, and the remote apply script; it does not
push GitHub and it never overwrites the remote `.env`.

Run it from the repository root with the private key that matches the public key installed on the
server:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-cloudbase-relay.ps1 `
  -IdentityFile C:\path\to\matching-private-key
```

The script makes a timestamped remote backup, builds the signaling package, restarts the existing
PM2 or systemd service, and checks the local relay health endpoint. A public SSH key alone cannot
authenticate this command; the matching private key must remain outside the repository.

## Supabase fallback / legacy setup

1. Create or select the Supabase project.
2. Apply `supabase/migrations/202608240001_accounts_v1.sql` in the Supabase SQL editor or migration
   pipeline.
3. Deploy `supabase/functions/shanghao-username-login`. Prefer setting the named-key JSON maps
   `SUPABASE_SECRET_KEYS` and `SUPABASE_PUBLISHABLE_KEYS`; this application reads their `default`
   entries first. Existing deployments may keep using the singular `SUPABASE_SECRET_KEY` and
   `SUPABASE_PUBLISHABLE_KEY` variables as a fallback. Supabase provides `SUPABASE_URL` automatically.
4. Set the account environment variables documented in `.env.example` on the relay server.
   Never place any `SUPABASE_SECRET_KEYS`/`SUPABASE_SECRET_KEY` value in the desktop build, renderer
   environment, repository, logs, or screenshots.
5. Put the relay behind Caddy using `deploy/Caddyfile.example` and configure the desktop official
   address as `wss://your-domain`. Account password endpoints intentionally reject remote plain
   HTTP/WS transport.
6. Set `SHANGHAO_ALLOW_GUESTS=false` in production. Guest mode is intended only for local
   development.

For the temporary public `ws://` test relay only, set both
`SHANGHAO_DEPLOYMENT_MODE=development` and `ALLOW_INSECURE_DEV_CONNECTION=true`. This permits
short-lived access tokens on profile and room identity requests. It never permits password or
refresh-token routes over HTTP. Omit both variables in production; the secure default remains on.

The database trigger creates the public profile and the private username-to-email mapping inside
the same `auth.users` insert transaction. A duplicate username or mapping failure aborts the user
creation instead of leaving a half-created account.
