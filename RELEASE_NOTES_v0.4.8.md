# pi-desktop v0.4.8

## Highlights
- Added separate proxy settings for pi agent processes and desktop network requests.
- Desktop model discovery and provider connection tests can now use the desktop proxy.
- Reworked Settings into Basic, Proxy, and Developer tabs with clearer save feedback.
- New providers no longer write a default User-Agent header unless explicitly configured.

## Verification
- `npm run typecheck`
- `npm run build`
