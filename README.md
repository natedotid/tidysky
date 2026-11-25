# TidySky

TidySky is a set of free, private tools to understand and tidy the accounts
you follow on Bluesky. It runs entirely in your browser: there is no
TidySky server, and nothing you do is sent anywhere except to Bluesky.

- Live: [https://tidysky.io](https://tidysky.io)
- Try it without signing in (demo mode, fake data):
  [https://tidysky.io/insights?demo=1](https://tidysky.io/insights?demo=1)

## What it does

- **Insights**: two pages of charts: about the accounts you follow (who
  fills your feed, who has gone quiet or is gone, who follows you back, when
  you last interacted with each account) and about you (how often you post,
  what you post, how your posts land, who follows you).
- **Clean up**: bulk-unfollow the accounts that match your filters: start
  from a preset (gone, quiet, one-way, …) or build your own filter chips,
  each editable in place. Tapping a name previews the account, and there are
  keyboard shortcuts on desktop (press ?). Every action can be undone, and
  you can mute or move to a list instead of unfollowing.
- **Lists as feeds**: turn the result of any filter into a Bluesky list,
  and pin a list as a feed in the Bluesky app.
- **Interactions**: for each account, when you last liked, reposted,
  replied to, quoted or mentioned it, read from your own records. This is
  what powers "Who you interact with" and the "Your regulars" list preset.

How the numbers are computed, and what TidySky can and cannot see, is
documented on the
[methodology page](https://tidysky.io/methodology).

## Privacy

There is no TidySky backend: your scan, lists, snapshots and history are
stored only in this browser (IndexedDB). To work, your browser talks directly
to Bluesky: your Bluesky server, Bluesky's public AppView, its image server,
and the handle resolver. Sign-in is atproto OAuth with granular scopes; the
app asks for exactly these nine and nothing more:

- `atproto`: identify your account and read it: your profile, your follow
  list, your lists
- `repo:app.bsky.graph.follow?action=create&action=delete`: unfollow
  accounts, and follow them again if you undo
- `repo:app.bsky.graph.list`: create and delete lists on your account
- `repo:app.bsky.graph.listitem`: add and remove members of your lists
- `rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview`:
  read one profile at a time through the AppView
- `rpc:app.bsky.actor.getProfiles?aud=did:web:api.bsky.app%23bsky_appview`:
  read profiles in batches (how a scan checks many follows at once)
- `rpc:app.bsky.graph.getFollowers?aud=did:web:api.bsky.app%23bsky_appview`:
  read your followers, for the "Who follows you" card
- `rpc:app.bsky.graph.muteActor?aud=did:web:api.bsky.app%23bsky_appview`:
  mute the accounts you choose
- `rpc:app.bsky.graph.unmuteActor?aud=did:web:api.bsky.app%23bsky_appview`:
  unmute an account when you undo a mute

The same list, in plain words next to the exact strings, is on the
[privacy page](https://tidysky.io/privacy).

## Running it locally

Requires Node 26 (see `.nvmrc`).

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The dev server binds `127.0.0.1`, not
`localhost`, because the loopback OAuth flow only works against an IP
origin: on some machines `localhost` resolves to IPv6 only and sign-in
would fail. Sign in with your Bluesky account, or skip it entirely with
demo mode (fake data, no account): <http://127.0.0.1:5173/insights?demo=1>.

`npm run preview` serves the production build the same way.

## Checks

The gate, run before every commit:

```sh
npm run check # svelte-check
npm run check:sw # the service worker's TypeScript
npm run lint # prettier + eslint
npm run test:unit -- --run
```

Plus a production build and a layout check in real browsers:

```sh
npm run build
npm run check:layout # Chromium and WebKit; first: npx playwright install chromium webkit
```

The unit tests run offline; none of them touch a real Bluesky account.

## Deploying

`npm run build` produces a static site in `build/` (with `200.html` as the
SPA fallback), so any static host works: serve the contents of `build/` and
make every unknown path serve `200.html`.

### S3 + CloudFront

`deploy.sh` deploys to S3 behind CloudFront. One-time setup. The resource
IDs are yours and stay in a local `deploy.env`, never in this repo:

1. A **private S3 bucket** (all public access blocked).
2. A **CloudFront distribution**: the bucket as origin through an Origin
   Access Control, `index.html` as the default root object, HTTP→HTTPS
   redirect, your domain(s) as alternate domain names with an ACM
   certificate.
3. The **viewer-request function** from [`cloudfront/viewer-request.js`](cloudfront/viewer-request.js)
   (runtime `cloudfront-js-2.0`) on the default behavior: it redirects
   `www` to the apex with a 301 and maps clean URLs to the right file:
   the prerendered pages, the real files, and the `200.html` fallback.
   [`cloudfront/README.md`](cloudfront/README.md) has the function's test
   events.
4. A **response headers policy** on the default behavior with the security
   headers:

   | Header                      | Value                                      |
   | --------------------------- | ------------------------------------------ |
   | `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`      |
   | `X-Frame-Options`           | `DENY`                                     |
   | `Content-Security-Policy`   | `frame-ancestors 'none'`                   |
   | `X-Content-Type-Options`    | `nosniff`                                  |
   | `Referrer-Policy`           | `strict-origin-when-cross-origin`          |
   | `Permissions-Policy`        | `camera=(), microphone=(), geolocation=()` |

   The `Content-Security-Policy` header holds only `frame-ancestors`
   (clickjacking protection); the other directives live in each page's
   `content-security-policy` meta tag, and a browser enforces both
   together.

Then deploy:

```sh
cp deploy.env.example deploy.env # fill in BUCKET and DIST_ID
AWS_PROFILE=... ./deploy.sh
```

`deploy.sh` runs the gate, builds, syncs the hashed assets with a one-year
immutable cache (the hash in the name is the validity) and everything else
with revalidation, fixes the content-types on the two metadata files, and
invalidates the distribution. The site is live when the invalidation
completes (a minute or two). To roll back, check out a previous tag and
re-run it.

## A map of `src/lib`

- `atproto/`: OAuth sign-in, the client, the public AppView, the scopes
- `scan/` (the scan engine): reads your follows, checks activity and
  interactions per account, and persists everything; `demo.ts` is the
  offline demo data source
- `insights/`: the numbers behind the Insights pages, and the snapshot
  history that "Since your last scan" compares
- `filters/`: filter chips, presets and the options they offer
- `cleanup/`: the Clean up page state, the filter targets, CSV export
- `actions/` (the write side): unfollow, mute, lists, undo
- `db/`: the IndexedDB store
- `net/`: error mapping and the request queue
- `charts/`: the chart components and their scales
- `ui/` (shared UI): rows, sheets, the virtual list, progress
- `analytics.ts`: the Fathom events (production host only)
- `config.ts`: the app's constants

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through
[SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).
