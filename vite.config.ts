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
    // 双入口：正传 index.html 与独立切片 zone.html（域外探索）
    rollupOptions: {
      input: { main: 'index.html', zone: 'zone.html' },
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
