# ShangHao account system v1

The desktop renderer never receives Supabase access or refresh tokens. Registration, email login,
token refresh, and password reset go directly from the Electron main process to Supabase HTTPS.
Username login uses the Supabase-hosted `shanghao-username-login` Edge Function, so passwords never
cross a plain ShangHao HTTP relay. The main process stores the session with `safeStorage` and adds
only the current access token to the signaling WebSocket handshake.

The ten bundled registration avatars are local SVG assets. The renderer rasterizes the selected
preset to WebP and applies the same 512 KB limit as a custom upload before sending it to the relay;
raw SVG is never uploaded to the public avatar bucket.

## Server setup

1. Create or select the Supabase project.
2. Apply `supabase/migrations/202608240001_accounts_v1.sql` in the Supabase SQL editor or migration
   pipeline.
3. Deploy `supabase/functions/shanghao-username-login` and set its `SUPABASE_SECRET_KEY` and
   `SUPABASE_PUBLISHABLE_KEY` secrets. Supabase provides `SUPABASE_URL` automatically.
4. Set the four account environment variables documented in `.env.example` on the relay server.
   Never place `SUPABASE_SECRET_KEY` in the desktop build, renderer environment, repository, logs,
   or screenshots.
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
