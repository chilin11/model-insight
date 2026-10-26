import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const root = process.cwd()
const temp = mkdtempSync(join(process.env.PI_SCRATCH_DIR || tmpdir(), 'model-insight-cms-'))
const binary = join(temp, 'model-insight')
const seed = join(temp, 'seed.json')
mkdirSync(join(temp, 'data'))
execFileSync(process.env.GO_BIN || 'go', ['build', '-trimpath', '-o', binary, '.'], { cwd: resolve(root, 'server'), stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0' } })
execFileSync(process.execPath, ['scripts/export-content.mjs', seed], { cwd: root, stdio: 'inherit' })
const server = spawn(binary, [], { cwd: root, stdio: 'inherit', env: { ...process.env, DATA_DIR: join(temp, 'data'), SEED_FILE: seed, WEB_DIR: resolve(root, 'dist'), LISTEN_ADDR: '127.0.0.1:8198', ADMIN_TOKEN: 'cms-browser-test-admin-token-not-for-production', API_TOKEN: 'cms-browser-test-ingest-token-not-for-production' } })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal))
server.on('exit', code => process.exit(code || 0))
