// 让仓库根目录本身成为一个可安装的 bundle：根 package.json / cordis.patch.yml
// 委托到 vendor/dsh-qqbot（自包含、补丁已内置）。这样「添加插件」直接输
// github:ZhangWeiJun00/dsh-qqbot-ext（无需 #path:）即可安装。
// 由 integrate-qqbot.mjs 在生成 vendor 后调用，保持根清单与 vendor 同步、不漂移。
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const vendorDir = join(root, 'vendor', 'dsh-qqbot')
const vendor = JSON.parse(await readFile(join(vendorDir, 'package.json'), 'utf8'))
const P = 'vendor/dsh-qqbot/'
const prefix = (v) => P + String(v).replace(/^\.\//, '')

const exports = {}
for (const [key, val] of Object.entries(vendor.exports)) {
  if (typeof val === 'string') exports[key] = prefix(val)
  else exports[key] = Object.fromEntries(Object.entries(val).map(([k, v]) => [k, prefix(v)]))
}

const rootPkg = {
  name: vendor.name,
  version: vendor.version,
  description: vendor.description + '（仓库根即安装包，运行时文件在 vendor/dsh-qqbot）',
  icon: prefix(vendor.icon),
  type: 'module',
  main: prefix(vendor.main),
  types: prefix(vendor.types),
  exports,
  scripts: {},
  keywords: vendor.keywords,
  license: vendor.license,
  engines: vendor.engines,
  repository: { type: 'git', url: 'https://github.com/ZhangWeiJun00/dsh-qqbot-ext.git' },
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: vendor.dsh?.client ?? { platform: 'web' },
    ...(vendor.dsh?.compatibility ? { compatibility: vendor.dsh.compatibility } : {}),
  },
  dependencies: vendor.dependencies,
  peerDependencies: vendor.peerDependencies,
  peerDependenciesMeta: vendor.peerDependenciesMeta,
  private: true,
  files: [
    ...vendor.files.map((f) => P + f),
    'cordis.patch.yml',
    'README.md',
    'LICENSE',
  ],
}
await writeFile(join(root, 'package.json'), JSON.stringify(rootPkg, null, 2) + '\n')
await writeFile(join(root, 'cordis.patch.yml'), await readFile(join(vendorDir, 'cordis.patch.yml'), 'utf8'))
console.log('root package.json + cordis.patch.yml generated (root is now an installable bundle)')