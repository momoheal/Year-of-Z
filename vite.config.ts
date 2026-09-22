import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
    // 允许沙箱预览域名访问（预览环境为 https://{port}-{sandbox}.e2b.app）
    allowedHosts: true
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          cannon: ['cannon-es'],
          lucide: ['lucide']
        }
      }
    }
  }
});
