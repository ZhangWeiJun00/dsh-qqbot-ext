#!/usr/bin/env node
// dsh-qqbot-ext 一键安装
//
//   node install.mjs                      # 自动找 DSH profile 并安装
//   node install.mjs --profile <目录>      # 指定 profile
//   node install.mjs --no-patch           # 不打上游补丁（只装扩展）
//   node install.mjs --dry-run            # 只报告将要做什么，不动手
//
// 做的事，按顺序：
//   1. 找到 DSH profile 目录（含 package.json 且 dsh.profile 的）
//   2. 往 dependencies 加 "dsh-qqbot-ext": "file:<本仓库绝对路径>"
//   3. 往 dsh.profile.bundles 加 "dsh-qqbot-ext"（去重、保持原顺序）
//   4. 在 profile 里跑 pnpm install
//   5. 给上游 @tencent-connect/dsh-qqbot 打表情收集补丁（可用 --no-patch 跳过）
//
// 幂等：重复运行不会重复加依赖/bundle，也不会叠加补丁。
// 每一步改动前都把原文件备份成 <文件>.qqbot-ext-backup，可随时还原。
import { readFile, writeFile, copyFile, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve, dirname, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = join(HERE, 'dsh-qqbot-ext')
const PKG_NAME = 'dsh-qqbot-ext'

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

const DRY = has('--dry-run')
const NO_PATCH = has('--no-patch')

const log = (msg) => console.log(msg)
const step = (msg) => console.log(`\n▶ ${msg}`)
const warn = (msg) => console.warn(`  ⚠ ${msg}`)
const okMsg = (msg) => console.log(`  ✓ ${msg}`)

function die(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

/** 展开 ~ 前缀。 */
function expandPath(raw) {
  const t = String(raw).trim()
  if (t === '~') return homedir()
  if (t.startsWith('~/') || t.startsWith('~\\')) return join(homedir(), t.slice(2))
  return t
}

/** 是不是一个 DSH profile 目录。 */
async function isProfile(dir) {
  try {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    return pkg?.dsh?.profile !== undefined
  } catch {
    return false
  }
}

/** 找 profile：--profile > DSH_PROFILE_DIR > 扫描 ~/.dsh/profiles/*。 */
async function findProfile() {
  const explicit = valueOf('--profile') ?? process.env.DSH_PROFILE_DIR
  if (explicit !== undefined && String(explicit).trim() !== '') {
    const dir = resolve(expandPath(explicit))
    if (!existsSync(join(dir, 'package.json'))) die(`指定的 profile 里没有 package.json：${dir}`)
    if (!await isProfile(dir)) warn(`${dir} 的 package.json 里没有 dsh.profile 字段，可能不是 profile 目录`)
    return dir
  }
  const root = join(homedir(), '.dsh', 'profiles')
  if (!existsSync(root)) die(`找不到 ${root}，请用 --profile 指定你的 DSH profile 目录`)
  const { readdir } = await import('node:fs/promises')
  const candidates = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    if (await isProfile(dir)) candidates.push(dir)
  }
  if (candidates.length === 0) die(`在 ${root} 下没找到任何 profile，请用 --profile 指定`)
  if (candidates.length === 1) return candidates[0]
  // 多个 profile 时优先 desktop，否则让用户选
  const desktop = candidates.find((d) => d.endsWith('desktop'))
  if (desktop !== undefined) {
    warn(`发现多个 profile，默认用 desktop：${desktop}`)
    warn(`要装到别的 profile 请加 --profile <目录>`)
    return desktop
  }
  die(`发现多个 profile，请用 --profile 选一个：\n${candidates.map((d) => `  - ${d}`).join('\n')}`)
}

/** 备份原文件（已备份过就不覆盖，保留最初那份）。 */
async function backup(file) {
  const target = `${file}.qqbot-ext-backup`
  if (existsSync(target)) return target
  await copyFile(file, target)
  return target
}

/**
 * 跑子进程，输出直通终端。
 *
 * 注意 shell 的用法：Windows 上要跑 pnpm（是个 .cmd），必须 shell: true；
 * 但跑 node 时绝对不能用 shell——node 的安装路径常带空格
 * （例如 nvm 的 "C:\Users\x\AppData\Local\Author Software\nvm\..."），
 * 交给 shell 拼命令行会被空格截断成 "C:\Users\x\AppData\Local\Author"。
 */
function run(cmd, args, cwd, { shell = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell })
    child.on('error', rejectPromise)
    child.on('close', (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`${cmd} 退出码 ${code}`))))
  })
}

/** pnpm 在 Windows 上是 .cmd，需要 shell；其它平台直接跑。 */
function runPnpm(args, cwd) {
  return run('pnpm', args, cwd, { shell: process.platform === 'win32' })
}

async function main() {
  log('dsh-qqbot-ext 一键安装')
  log(`  仓库位置：${HERE}`)

  // ── 前置检查 ──
  step('检查环境')
  if (!existsSync(join(PLUGIN_DIR, 'package.json'))) die(`仓库里找不到插件目录：${PLUGIN_DIR}`)
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (Number.isFinite(nodeMajor) && nodeMajor < 20) die(`需要 Node >= 20，当前 ${process.versions.node}`)
  okMsg(`Node ${process.versions.node}`)
  if (PLUGIN_DIR.includes('"') || PLUGIN_DIR.split(/[\\/]/).some((seg) => seg.includes(' '))) {
    warn(`仓库路径含空格，pnpm 的 file: 依赖可能出问题：${PLUGIN_DIR}`)
  }

  // ── 找 profile ──
  step('定位 DSH profile')
  const profileDir = await findProfile()
  okMsg(profileDir)

  // ── 改 package.json ──
  step('配置 profile 的 package.json')
  const pkgPath = join(profileDir, 'package.json')
  const original = await readFile(pkgPath, 'utf8')
  let pkg
  try {
    pkg = JSON.parse(original)
  } catch (error) {
    die(`profile 的 package.json 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const fileSpec = `file:${PLUGIN_DIR.replace(/\\/g, '/')}`
  pkg.dependencies ??= {}
  const prevSpec = pkg.dependencies[PKG_NAME]
  const depChanged = prevSpec !== fileSpec
  if (depChanged) {
    pkg.dependencies[PKG_NAME] = fileSpec
    okMsg(prevSpec === undefined ? `添加依赖 ${PKG_NAME}` : `更新依赖 ${PKG_NAME}: ${prevSpec} → ${fileSpec}`)
  } else {
    okMsg(`依赖已是 ${fileSpec}`)
  }

  pkg.dsh ??= {}
  pkg.dsh.profile ??= {}
  pkg.dsh.profile.bundles ??= []
  const bundles = pkg.dsh.profile.bundles
  let bundleChanged = false
  if (!bundles.includes(PKG_NAME)) {
    // 放在 @tencent-connect/dsh-qqbot 前面，跟本机既有顺序一致
    const qqIdx = bundles.indexOf('@tencent-connect/dsh-qqbot')
    if (qqIdx >= 0) bundles.splice(qqIdx, 0, PKG_NAME)
    else bundles.push(PKG_NAME)
    bundleChanged = true
    okMsg('添加 bundle')
  } else {
    okMsg('bundle 已存在')
  }

  if (depChanged || bundleChanged) {
    if (DRY) {
      warn('--dry-run：不写入 package.json')
    } else {
      const bak = await backup(pkgPath)
      await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
      okMsg(`已写入（备份：${bak}）`)
    }
  } else {
    okMsg('package.json 无需改动')
  }

  // ── pnpm install ──
  step('安装依赖')
  if (DRY) {
    warn('--dry-run：跳过 pnpm install')
  } else if (!depChanged && existsSync(join(profileDir, 'node_modules', PKG_NAME))) {
    // 依赖没变但源码可能变了：file: 是拷贝语义，强制重装一次才拿到新内容
    log('  依赖规格没变，但 file: 依赖是拷贝语义，源码改动需要重装才生效')
    try {
      await runPnpm(['install', '--ignore-scripts'], profileDir)
      okMsg('pnpm install 完成')
    } catch (error) {
      warn(`pnpm install 失败：${error instanceof Error ? error.message : String(error)}`)
      warn('继续尝试后续步骤；扩展可能没更新到最新代码')
    }
  } else {
    try {
      await runPnpm(['install', '--ignore-scripts'], profileDir)
      okMsg('pnpm install 完成')
    } catch (error) {
      die(`pnpm install 失败：${error instanceof Error ? error.message : String(error)}\n手动在 ${profileDir} 跑一次 pnpm install 看看报错。`)
    }
  }

  // ── 上游补丁 ──
  step('上游补丁（表情包收集接缝）')
  if (NO_PATCH) {
    warn('--no-patch：跳过。不打补丁的话图库能发不能自动收。')
  } else if (DRY) {
    warn('--dry-run：跳过打补丁')
  } else {
    const patchScript = join(HERE, 'tools', 'apply-qqbot-sticker-collector-patch.mjs')
    if (!existsSync(patchScript)) {
      warn(`找不到补丁脚本：${patchScript}，跳过`)
    } else {
      try {
        await run(process.execPath, [patchScript, '--profile', profileDir], HERE)
        okMsg('补丁已应用')
      } catch (error) {
        warn(`打补丁失败：${error instanceof Error ? error.message : String(error)}`)
        warn('扩展本身已装好，只是不会自动收表情。可稍后手动跑：')
        warn(`  node "${patchScript}" --profile "${profileDir}"`)
      }
    }
  }

  // ── 收尾 ──
  log('\n' + '─'.repeat(56))
  log('安装完成。')
  log('')
  log('接下来：')
  log('  1. 重启 DSH（改插件必须重启才生效）')
  log('  2. 打开设置里的「QQ 机器人扩展」，调图库位置和收集方式')
  log('  3. 验证：浏览器访问 <你的DSH地址>/qqbot-ext/status 应返回 JSON')
  if (DRY) log('\n（本次是 --dry-run，没有真正改动任何文件）')
  log('')
  log('卸载 / 回滚：')
  log(`  备份文件在 ${profileDir}/package.json.qqbot-ext-backup`)
  log('  把 dependencies 里的 dsh-qqbot-ext 和 bundles 里的同名项删掉，再 pnpm install 即可')
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error))
})
