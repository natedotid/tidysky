# CloudFront function: tidysky.io

`viewer-request.js` runs at the **viewer request** step (runtime
`cloudfront-js-2.0`) on the default behavior of the tidysky.io distribution.
It rewrites the request URI before CloudFront looks the object up in S3:

0. **`www.tidysky.io` requests are redirected to the apex** with a 301,
   preserving the URI and query string. Sign-in on `www` would fail: OAuth
   state is stored per origin and the only allowed redirect URI is
   `https://tidysky.io/`, so `www` must never run the app.
1. **Known prerendered routes** map to their files: `/` → `/index.html`,
   `/methodology` → `/methodology.html`, `/privacy` → `/privacy.html`. A
   trailing slash is stripped first, so `/privacy/` works too.
2. **Anything with a `.` in the URI is a real file** (assets under `/_app/`,
   the icons, `client-metadata.json`, `manifest.webmanifest`, …) and passes
   through unchanged.
3. **Everything else**, the SPA's client-side routes (`/insights`,
   `/cleanup`, `/lists`, `/settings`, `/dev/*`, any deeper path), maps to
   the fallback `/200.html`. The fallback contains no server-rendered route,
   so the app boots from it and routes to the requested page client-side.

The app has no dynamic routes and none of its route paths contain a dot, so
the `.` test is a safe "is this a file" check. Query strings are not part of
`request.uri` and are preserved by CloudFront.

## Creating it

1. CloudFront console → **Functions** → **Create function**: name it e.g.
   `tidysky-viewer-request`, runtime `cloudfront-js-2.0`, paste
   `viewer-request.js`.
2. Run the test events below in the **Test** tab.
3. Save, create a function version, then associate it as **viewer request**
   on the distribution's default behavior (CloudFront → your distribution →
   Behaviors → default behavior → Edit → Viewer request → select the
   function version).

## Test events

Use the console's default test request and change the `host` header, URI and
query string as shown.

| Host             | URI                     | Query         | Expected                                       |
| ---------------- | ----------------------- | ------------- | ---------------------------------------------- |
| `www.tidysky.io` | `/`                     | -             | 301 → `https://tidysky.io/`                    |
| `www.tidysky.io` | `/cleanup`              | `preset=gone` | 301 → `https://tidysky.io/cleanup?preset=gone` |
| `tidysky.io`     | `/`                     | -             | uri `/index.html`                              |
| `tidysky.io`     | `/methodology`          | -             | uri `/methodology.html`                        |
| `tidysky.io`     | `/privacy/`             | -             | uri `/privacy.html`                            |
| `tidysky.io`     | `/insights`             | -             | uri `/200.html`                                |
| `tidysky.io`     | `/cleanup`              | -             | uri `/200.html`                                |
| `tidysky.io`     | `/theme.js`             | -             | unchanged                                      |
| `tidysky.io`     | `/client-metadata.json` | -             | unchanged                                      |
| `tidysky.io`     | `/_app/immutable/x.js`  | -             | unchanged                                      |
