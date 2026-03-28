import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.{test,spec}.js'],
    alias: {
      '../../vendor/purify.es.mjs': path.resolve(__dirname, 'node_modules/dompurify/dist/purify.es.mjs'),
      '../../../vendor/sql-wasm.js': path.resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.js'),
      '../../../vendor/fflate.js': path.resolve(__dirname, 'node_modules/fflate/esm/browser.js')
    }
  },
})
