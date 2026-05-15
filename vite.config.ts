import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    // Single-file output so the extension is one self-contained HTML file
    rollupOptions: {
      output: {
        // Inline assets into HTML — Contentstack extensions are easier to host
        // when everything is in one file
        inlineDynamicImports: true,
        manualChunks: undefined,
        entryFileNames: 'extension.js',
        assetFileNames: 'extension.[ext]',
      },
    },
  },
});
