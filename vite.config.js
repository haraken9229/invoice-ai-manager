import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Provide fallbacks for Canvas/Firebase Studio globals
    __firebase_config: JSON.stringify(process.env.FIREBASE_CONFIG || '{}'),
    __app_id: JSON.stringify(process.env.APP_ID || 'invoice-manager-001'),
    __initial_auth_token: JSON.stringify(process.env.INITIAL_AUTH_TOKEN || ''),
  },
})
