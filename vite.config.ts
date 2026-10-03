import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import tailwindcss from '@tailwindcss/vite'

// Deployment target is chosen by Nitro at build time via NITRO_PRESET
// (node-server by default; e.g. bun, vercel, netlify, cloudflare-module).
// The application code does not change between targets.
export default defineConfig(({ mode }) => {
  // Expose .env to server code through process.env, where src/env.ts validates it.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    server: {
      port: 5173,
      strictPort: true,
      allowedHosts: ["podnoms.dev.fergl.ie"],
    },
    resolve: { tsconfigPaths: true },
    plugins: [
      tailwindcss(),
      tanstackStart(),
      nitro({
        // Shipped as plain node_modules rather than bundled. Bundling splits
        // @peculiar/x509 (and tsyringe) into a chunk that runs before the
        // `import 'reflect-metadata'` that @simplewebauthn/server puts ahead of
        // it, and tsyringe then throws on startup for want of the polyfill.
        traceDeps: ['@simplewebauthn/server', '@bull-board/ui'],
      }),
      viteReact(),
    ],
  }
})
