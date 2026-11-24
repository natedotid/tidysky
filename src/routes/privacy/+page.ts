// This page is static: it prerenders to privacy.html and works without a
// sign-in, so it opts back into SSR despite the root layout's SPA default.
export const prerender = true;
export const ssr = true;
