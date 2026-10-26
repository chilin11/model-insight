import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5188, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8188' }, '/media': { target: 'http://127.0.0.1:8188' }, '/rss.xml': { target: 'http://127.0.0.1:8188' } } },
})
