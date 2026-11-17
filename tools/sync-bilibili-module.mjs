// Synchronize only this feature's files; never run package manager or touch config.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
const source = fileURLToPath(new URL('../dsh-qqbot-ext/', import.meta.url))
const target = join(homedir(), '.dsh/profiles/desktop/node_modules/dsh-qqbot-ext')
const files = ['lib/bilibili.js', 'lib/qq-card-links.js', 'lib/qq-card-inbox.js', 'features/host/06-bilibili-video.js', 'lib/components.js', 'README.md']
for (const file of files) {
  const body = await readFile(join(source, file), 'utf8')
  try { await readFile(join(target, file), 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
  await writeFile(join(target, file), body)
  console.log('Synced', file)
}
