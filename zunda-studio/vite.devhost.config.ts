import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/** テスト用ホスト(src/devhost)を Node 向けに1ファイルへまとめる。依存パッケージは外部のまま。 */
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: {
    ssr: 'src/devhost/main.ts',
    outDir: 'out/devhost',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    rollupOptions: { output: { format: 'es', entryFileNames: 'main.js' } }
  }
})
