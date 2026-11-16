// 应用 dsh-qqbot 的表情包收集接缝补丁：
//   1. middleware-setup.js —— 入站钩子（放在 concurrencyGuard 之前）
//   2. bootstrap.js        —— 受限的图库发图服务
//
// 幂等：重复运行会把已有块整体替换成最新版本，不会叠加注释。
//
// 用法（profile 路径按需指定，默认取 ~/.dsh/profiles/desktop）：
//   node tools/apply-qqbot-sticker-collector-patch.mjs
//   node tools/apply-qqbot-sticker-collector-patch.mjs --profile ~/.dsh/profiles/myprofile
//   DSH_PROFILE_DIR=/path/to/profile node tools/apply-qqbot-sticker-collector-patch.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** 解析 profile 目录：--profile 参数 > DSH_PROFILE_DIR > ~/.dsh/profiles/desktop。 */
function resolveProfileDir(argv) {
  const flag = argv.indexOf('--profile')
  const fromArg = flag >= 0 ? argv[flag + 1] : undefined
  const fromEnv = process.env.DSH_PROFILE_DIR
  const raw = (fromArg ?? fromEnv ?? join(homedir(), '.dsh', 'profiles', 'desktop')).trim()
  if (raw === '') throw new Error('profile 目录不能为空')
  const expanded = raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')
    ? join(homedir(), raw.slice(1).replace(/^[\\/]/, ''))
    : raw
  return resolve(expanded)
}

const PROFILE = resolveProfileDir(process.argv.slice(2))
const GATEWAY = join(PROFILE, 'node_modules', '@tencent-connect', 'dsh-qqbot', 'lib', 'gateway')
const SETUP = join(GATEWAY, 'middleware-setup.js')
const BOOTSTRAP = join(GATEWAY, 'bootstrap.js')
const here = (name) => fileURLToPath(new URL(`./patched-files/${name}`, import.meta.url))

if (!existsSync(SETUP)) {
  console.error(`找不到 ${SETUP}\n请用 --profile <你的 DSH profile 目录> 指定，或设 DSH_PROFILE_DIR。`)
  process.exit(1)
}

const HOOK_MARK = 'qqbot/sticker-candidate'

/** middleware-setup.js：把钩子插在 concurrencyGuard 之前。 */
async function patchSetup() {
    const source = await readFile(SETUP, 'utf8')
    const patch = (await readFile(here('qqbot-sticker-hook-middleware-setup.js'), 'utf8')).trimEnd()
    const guardAnchor = '    // 9. 并发串行 + 消息合并（同 peer 排队，避免 session 冲突）'

    if (!source.includes(guardAnchor)) throw new Error(`concurrencyGuard anchor not found in ${SETUP}; left unchanged`)

    let base = source
    if (base.includes(HOOK_MARK)) {
        const markIndex = base.indexOf(HOOK_MARK)
        const start = base.lastIndexOf('// Source patch for @tencent-connect/dsh-qqbot/lib/gateway/middleware-setup.js.', markIndex)
        const useIndex = base.indexOf('bot.use(async (mCtx, next) => {', start >= 0 ? start : 0)
        if (start < 0 || useIndex < 0) throw new Error('existing hook block boundary not found; left unchanged')
        const closeIndex = base.indexOf('\n});', useIndex)
        if (closeIndex < 0) throw new Error('existing hook block end not found; left unchanged')
        base = `${base.slice(0, start)}${base.slice(closeIndex + 5)}`
        base = base.replace(/\n{3,}/g, '\n\n')
    }

    const updated = base.replace(guardAnchor, `${patch}\n${guardAnchor}`)
    await writeFile(SETUP, updated, 'utf8')
    return SETUP
}

/** bootstrap.js：只放发送器，并清掉历史上重复堆积的注释。 */
async function patchBootstrap() {
    const source = await readFile(BOOTSTRAP, 'utf8')
    const patch = (await readFile(here('qqbot-sticker-collector-hook.js'), 'utf8')).trimEnd()
    const anchor = '    // 交付物投递：present 声明的文件在轮末发送到当前会话（outbound 路由触发）'
    const anchorIndex = source.indexOf(anchor)
    if (anchorIndex < 0) throw new Error(`deliverables anchor not found in ${BOOTSTRAP}; left unchanged`)

    const prefix = source.slice(0, anchorIndex)
    let kept = prefix
    const firstPatch = prefix.indexOf('// Source patch for @tencent-connect/dsh-qqbot/lib/gateway/bootstrap.js.')
    if (firstPatch >= 0) kept = prefix.slice(0, firstPatch)
    // 旧版把入站钩子也放在这里；现在归 middleware-setup.js 管，清掉。
    const lastUse = kept.lastIndexOf('bot.use(async (mCtx, next) => {')
    if (lastUse >= 0) kept = kept.slice(0, lastUse)

    const updated = `${kept.replace(/\n+$/, '\n')}${patch}\n${source.slice(anchorIndex)}`
    await writeFile(BOOTSTRAP, updated, 'utf8')
    return BOOTSTRAP
}

const a = await patchSetup()
const b = await patchBootstrap()
console.log(`Applied sticker hook to ${a}`)
console.log(`Applied sticker sender to ${b}`)
