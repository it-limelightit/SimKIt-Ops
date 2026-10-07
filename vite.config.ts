// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "simkit-local-server-env",
      config(_config, { command, mode }) {
        if (command !== "serve") return;
        // Vite exposes VITE_* to the browser, but server functions read process.env.
        // Load server values for normal local development without exposing them
        // through Vite's client define/env configuration. Deployment values win.
        const env = loadEnv(mode, process.cwd(), "");
        const serverKeys = [
          "SUPABASE_URL",
          "SUPABASE_PUBLISHABLE_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
          "TELEGRAM_BOT_TOKEN",
          "TELEGRAM_CHAT_ID",
          "SIMKIT_OPS_LINK",
          "RESEND_API_KEY",
          "SMTP_HOST",
          "SMTP_PORT",
          "SMTP_USER",
          "SMTP_PASS",
          "SMTP_FROM",
        ];
        for (const key of serverKeys) {
          if (process.env[key] === undefined && env[key] !== undefined) process.env[key] = env[key];
        }
      },
    },
  ],
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
        ignored: [
          "**/.git/**",
          "**/node_modules/**",
          "**/.output/**",
          "**/.nitro/**",
          "**/artifacts/**",
        ],
      },
    },
    build: {
      target: "esnext",
      minify: "esbuild",
      sourcemap: false,
    },
  },
});
