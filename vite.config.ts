import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Writes the list of built files into sw.js so the app works offline after the first visit.
function precache(): Plugin {
  return {
    name: 'abyss-precache',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const sw = Object.values(bundle).find((f) => f.fileName === 'sw.js');
      const files = Object.keys(bundle).filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const list = JSON.stringify(['./', ...files.map((f) => './' + f)]);
      if (sw && sw.type === 'asset') {
        sw.source = String(sw.source).replace('self.__PRECACHE__', list).replace('__VERSION__', String(Date.now()));
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), precache()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['libraw-wasm'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: false },
});
