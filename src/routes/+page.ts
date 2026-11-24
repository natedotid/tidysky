// The landing page is the front door: prerender it so the tagline and feature
// text exist in the HTML without JavaScript. It opts back into SSR despite the
// root layout's SPA default.
export const prerender = true;
export const ssr = true;
