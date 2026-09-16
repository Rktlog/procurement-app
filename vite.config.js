import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      zlib: 'browserify-zlib',
      stream: 'stream-browserify',
    },
  },
  optimizeDeps: {
    include: ['@react-pdf/renderer'],
  },
  define: {
    'process.env': {},
  },
  build: {
    // Raises the warning limit to 1000 kB (1 MB)
    chunkSizeWarningLimit: 1000,
  },
});