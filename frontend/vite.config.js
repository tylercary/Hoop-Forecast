import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy target; DEV_BACKEND_URL in frontend/.env.local overrides it when
// the backend runs on another port
export default defineConfig(({ mode }) => {
  const backend = loadEnv(mode, process.cwd(), '').DEV_BACKEND_URL || 'http://localhost:5001';
  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            'vendor-charts': ['recharts'],
            'vendor-motion': ['framer-motion'],
          },
        },
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
          secure: false,
          timeout: 30000,
          retry: 3
        },
        '/images/players': {
          target: backend,
          changeOrigin: true,
          secure: false,
          timeout: 10000
        }
      }
    }
  };
});
