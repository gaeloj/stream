import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),

      // Preserva a cópia dos assets para produção.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }

          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');

          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {
              recursive: true,
              force: true,
            });
          }
        },
      },
    ],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      // Preservado para o Google AI Studio.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },

    build: {
      target: 'es2020',
      minify: 'esbuild',
      sourcemap: false,

      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return;
            }

            if (
              id.includes('firebase') ||
              id.includes('@firebase')
            ) {
              return 'firebase';
            }

            if (
              id.includes('react-dom') ||
              id.includes('scheduler')
            ) {
              return 'react-vendor';
            }

            if (id.includes('react')) {
              return 'react-vendor';
            }
          },
        },
      },
    },
  };
});
