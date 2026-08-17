// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // When building on Vercel, use Vercel's Nitro preset so the output lands in
  // .output/ — the format Vercel natively understands for serverless deployment.
  // Without this, Nitro defaults to cloudflare-module which has no index.html.
  nitro: process.env.VERCEL ? { preset: "vercel" } : {},
  vite: {
    base: "/",
    server: {
      watch: {
        ignored: ["**/.git/**", "**/node_modules/**", "**/.output/**", "**/.nitro/**", "**/artifacts/**"],
      },
    },
    build: {
      target: "esnext",
      minify: "esbuild",
      sourcemap: false,
    },
  },
});
