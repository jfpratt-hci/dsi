# Dandy Strength Index (DSI)

Static web app on Cloudflare Pages, data on Supabase.

- `site/` is the deployable site. No build step. Cloudflare Pages output directory: `site`.
- `supabase/migrations/` holds the schema, security, seed data and weekly programming.

Scoring lives in `site/js/dsi.js`. Auth is email magic link or 6 digit code.

## Mobile app (`mobile/`)

Expo (React Native) app for iPhone and Android, same Supabase backend as the site.
`cd mobile && npm install && npx expo start`, then scan the QR code with Expo Go.
Store builds run in the cloud with EAS: `npx eas-cli@latest build --platform all`.
