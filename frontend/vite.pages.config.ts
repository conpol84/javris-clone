// M2 full-page workbench only. No server proxy, real identity or production entry.
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const root = path.resolve(import.meta.dirname, '..');
const client = path.join(root, 'tests/firbo/pages/mock-client.ts');
const isolate: Plugin = {
  name: 'firbo-m2-isolated-data', enforce: 'pre',
  resolveId(source, importer) {
    if (importer && /lib[\\/]company[\\/]/.test(importer) && source === './client') return client;
    if (/lib\/company\/client$/.test(source)) return client;
    return null;
  },
};
export default defineConfig({
  root: path.join(root, 'tests/firbo/pages'),
  plugins: [isolate, react(), tailwindcss()],
  resolve: { alias: { '@': path.join(root,'frontend/src'), 'react-dom': path.join(root,'frontend/node_modules/react-dom'), 'react': path.join(root,'frontend/node_modules/react') } },
  define: { 'import.meta.env.VITE_COMPANY_SUPABASE_URL': JSON.stringify('https://firbo.invalid'), 'import.meta.env.VITE_API_URL': JSON.stringify(''), 'import.meta.env.VITE_OMNIROUTE_URL': JSON.stringify('https://gateway.invalid'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('') },
  server: { host:'127.0.0.1', port:5211, strictPort:true, fs:{allow:[root]} },
  build: {outDir:path.join(root,'frontend/dist-m2'),emptyOutDir:true},
});
