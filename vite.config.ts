import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3010',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (err, _req, res: any) => {
            console.error('[proxy] API 서버(3010) 연결 실패:', err.message);
            if (res?.writeHead && !res.headersSent) {
              res.writeHead(502, { 'content-type': 'application/json' });
            }
            res?.end?.(JSON.stringify({
              body: { return_code: -1, return_msg: `프록시 오류: ${err.message}` }
            }));
          });
        }
      },
      '/ws': { target: 'ws://localhost:3010', ws: true }
    }
  },
  build: { target: 'es2022', outDir: 'dist' }
});
