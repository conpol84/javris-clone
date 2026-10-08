// Isolated shared-component reflow tests only. Not merged into production Vite config.
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  root: path.resolve(import.meta.dirname, '../tests/firbo/mobile'),
  resolve: { alias: {
    '@': path.resolve(import.meta.dirname, 'src'),
    'react-dom': path.resolve(import.meta.dirname, 'node_modules/react-dom'),
    'react': path.resolve(import.meta.dirname, 'node_modules/react'),
  } },
  plugins: [react(), tailwindcss()],
  server: {host:'127.0.0.1',port:5210,strictPort:true,fs:{allow:[path.resolve(import.meta.dirname,'..')]}},
});
