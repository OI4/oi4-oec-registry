// The build of the Registry Web UI (ADR-0029 §9, C-089). JSX goes through
// esbuild (no @vitejs/plugin-react); nothing is inlined as a data: URI, no
// module-preload polyfill and no source maps, so the bundle complies with the
// CSP `default-src 'self'` of the registry. The @license comments of the
// shipped packages are kept at the end of the bundle.
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  publicDir: "public",
  esbuild: { jsx: "automatic", legalComments: "eof" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    sourcemap: false,
    reportCompressedSize: false,
  },
});
