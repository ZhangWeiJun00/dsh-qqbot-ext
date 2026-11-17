// Official QQ seam: keep bounded card references, read raw only on explicit tool call.
import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2), flag = args.indexOf('--profile')
const profile = resolve(flag >= 0 ? args[flag + 1] : process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh/profiles/desktop'))
const target = join(profile, 'node_modules/@tencent-connect/dsh-qqbot/lib/gateway/middleware-setup.js')
let source = await readFile(target, 'utf8')
const original = source
// Migrate the old automatic content-enrichment seam.
source = source.replace(/^import \{ preserveBilibiliCardLinks \} from [^\n]+\n/m, '')
source = source.replace(/    \/\/ qqbot-ext: preserve original Bilibili card links\n[\s\S]*?        await next\(\);\n    \}\);\n/, '')
const marker = '// qqbot-ext: on-demand card raw access'
if (!source.includes(marker)) {
  const anchor = '    // 4. 群历史缓冲'
  if (!source.includes(anchor)) throw new Error('History anchor missing; no files changed')
  const block = `    ${marker}
    const cardInbox = createCardInbox();
    manager.ctx.provide('qqbotExtCardReader', {
        read(agent, messageId) {
            const record = manager.findByAgent(agent);
            if (!record?.sessionKey) throw new Error('无法确定当前QQ会话');
            return cardInbox.read(record.sessionKey, messageId);
        },
    });
    bot.use(async (mCtx, next) => {
        const msg = mCtx.message;
        const scope = msg.kind === 'group' ? 'group' : 'c2c';
        const peer = scope === 'group' ? msg.groupOpenid : msg.senderId;
        if (peer) cardInbox.capture('qqbot:' + config.appId + ':' + scope + ':' + peer, msg);
        await next();
    });
`
  source = "import { createCardInbox } from '../../../../dsh-qqbot-ext/lib/qq-card-inbox.js';\n" + source.replace(anchor, block + anchor)
}
if (args.includes('--dry-run')) console.log(JSON.stringify({ target, changed: source !== original }))
else {
  for (const file of ['qq-card-links.js', 'qq-card-inbox.js']) {
    const dest = join(profile, 'node_modules/dsh-qqbot-ext/lib', file)
    try { await readFile(dest, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
    await copyFile(fileURLToPath(new URL('../dsh-qqbot-ext/lib/' + file, import.meta.url)), dest)
  }
  if (source !== original) await writeFile(target, source, 'utf8')
  console.log('Applied on-demand card seam:', target)
}
