# Contributing

Thanks for taking a look. TidySky is a small project, and feedback is
welcome.

## Issues first

Please open an issue before a pull request, even for something small. It
keeps duplicate work low and gives a place to discuss what a change should
do.

## Before you send a pull request

Run the gate and the layout check:

```sh
npm run check && npm run check:sw && npm run lint && npm run test:unit -- --run
npm run build
npm run check:layout # Chromium and WebKit; first: npx playwright install chromium webkit
```

All tests run offline; none of them touch a real Bluesky account.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, …).
- Svelte 5 runes only; TypeScript strict, no `any`.
- Colors come from `src/styles/tokens.css`.
- Estimates are labeled as estimates in the UI, and the copy says how many
  accounts were scanned. Don't invent precision.

## New OAuth permission?

Any change that would add a scope to `src/lib/atproto/scopes.ts` changes
what the app asks Bluesky for, so discuss it in an issue first.

## And

Be kind in issues and reviews. This is a private-by-design tool for
regular people's social feeds, and the tone should stay that way.
