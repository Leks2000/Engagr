// Ensures the Mini App production build exists before `vite preview` runs.
// Building up-front keeps the webServer command a single fast `vite preview`.
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(here, '../../../frontend')
const distDir = resolve(frontendDir, 'dist')

if (!existsSync(distDir)) {
  console.log('[ensure-build] dist/ missing — building Mini App…')
  execSync('npx vite build', { cwd: frontendDir, stdio: 'inherit' })
} else {
  console.log('[ensure-build] dist/ already present — skipping build.')
}
process.exit(0)
