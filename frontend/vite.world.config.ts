// Connected-world actual-page workbench only. No server proxy, real identity or production entry.
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const root = path.resolve(import.meta.dirname, '..');
const client = path.join(root, 'tests/firbo/connections/mock-client.ts');
const realClient = path.join(root, 'frontend/src/lib/company/client');
const isolate: Plugin = {
  name: 'firbo-world-isolated-data', enforce: 'pre',
  resolveId(source, importer) {
    if (importer && source.startsWith('.')) {
      const resolved = path.resolve(path.dirname(importer.split('?')[0]), source).replace(/\.tsx?$/, '');
      if (resolved === realClient) return client;
    }
    return null;
  },
};
export default defineConfig({
  root: path.join(root, 'tests/firbo/connections'),
  publicDir: path.join(root, 'frontend/public'),
  plugins: [isolate, react(), tailwindcss()],
  resolve: { alias: {
    '@': path.join(root,'frontend/src'),
    'react-dom': path.join(root,'frontend/node_modules/react-dom'),
    'react': path.join(root,'frontend/node_modules/react'),
    'react-router': path.join(root,'frontend/node_modules/react-router'),
    '@supabase/supabase-js': path.join(root,'frontend/node_modules/@supabase/supabase-js'),
  } },
  define: { 'import.meta.env.VITE_COMPANY_SUPABASE_URL': JSON.stringify('https://firbo.invalid'), 'import.meta.env.VITE_API_URL': JSON.stringify(''), 'import.meta.env.VITE_OMNIROUTE_URL': JSON.stringify('https://gateway.invalid'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('') },
  server: { host:'127.0.0.1', port:5213, strictPort:true, fs:{allow:[root]} },
  build: {outDir:path.join(root,'frontend/dist-world'),emptyOutDir:true},
});
