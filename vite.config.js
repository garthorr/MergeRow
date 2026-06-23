import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Pure-logic suite (normalize / diff / sync) — no DOM needed.
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
