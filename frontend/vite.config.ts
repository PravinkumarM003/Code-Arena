import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    // Vite automatically injects <link rel="modulepreload"> for all entry
    // chunks at build time — this polyfill makes it work in older browsers too.
    modulePreload: { polyfill: true },
    // Keep CSS in a single file so the modulepreload hint covers it correctly.
    cssCodeSplit: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Monaco is ~5 MB — only load on CompilerPage (dynamic import it)
          if (id.includes('@monaco-editor') || id.includes('monaco-editor')) {
            return 'monaco';
          }
          // Firebase Auth only needed after login — lazy chunk
          if (id.includes('firebase')) {
            return 'firebase';
          }
          // All remaining react-ecosystem packages in ONE vendor chunk
          // (avoids circular chunk deps that cause useState to be undefined)
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
});

