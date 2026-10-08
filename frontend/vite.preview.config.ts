// Dev-only: runs the real app against preview/mock-client.ts (sample data, no login). See preview/mock-client.ts.
import path from 'path';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import base from './vite.config';

const mock = path.resolve(import.meta.dirname, 'preview/mock-client.ts');
const useMock: Plugin = {
  name: 'firbo-mock-client',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer && /lib[\\/]company[\\/]/.test(importer) && source === './client') return mock;
    if (/lib\/company\/client$/.test(source)) return mock;
    return null;
  },
};
export default mergeConfig(base, defineConfig({ plugins: [useMock], server: { port: 5200 }, define: { 'import.meta.env.VITE_COMPANY_SUPABASE_URL': JSON.stringify('mock') }, build: { outDir: 'dist-preview' } }));
