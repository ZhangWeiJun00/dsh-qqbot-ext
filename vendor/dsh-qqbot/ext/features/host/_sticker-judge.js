// 后台自动判断：对暂存区里的表情逐张看图，让视觉模型按「人格提示词」决定收不收。
//
// 这里刻意不硬编码任何审美标准——判定文字来自 config.judgePrompt，
// 以后接人格/人设模块时只改那段提示词即可，不用碰代码。
//
// 调用通道与官方 qqbot_describe_image 一致：llm 服务 + attachments.saveImage。
// 视觉模型由用户自己在配置页填 provider/model，没填就完全不跑（不产生任何调用）。
import { readFile } from 'node:fs/promises'
import { collectVisionText } from '../../lib/vision-stream.js'
import { judgeReady } from '../../lib/config.js'

const DEFAULT_PROMPT = '你在 QQ 群里混。看这张表情包，判断你自己想不想把它存进自己的表情库，以后用来回群友的话。想就回 KEEP，不想就回 DROP，然后另起一行用一句口语说理由。'

/** 图片 magic bytes 嗅探（不信扩展名，官方工具也是这么做的）。 */
function sniff(bytes) {
  if (bytes.length < 12) return undefined
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mediaType: 'image/png', ext: '.png' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mediaType: 'image/jpeg', ext: '.jpg' }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return { mediaType: 'image/gif', ext: '.gif' }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mediaType: 'image/webp', ext: '.webp' }
  return undefined
}

/** 解析模型回复：KEEP / DROP。判不准就返回 undefined（保持暂存，下次再判）。 */
export function parseVerdict(text) {
  const head = String(text ?? '').trim().slice(0, 200)
  const upper = head.toUpperCase()
  const keep = upper.search(/\bKEEP\b/)
  const drop = upper.search(/\bDROP\b/)
  if (keep >= 0 && (drop < 0 || keep < drop)) return 'keep'
  if (drop >= 0) return 'drop'
  // 模型没照格式走时的兜底：认中英文表态
  if (/收进|想要|想存/.test(head) && !/不收|不想|别收/.test(head)) return 'keep'
  if (/不收|不想要|不想存|别收/.test(head)) return 'drop'
  return undefined
}

/**
 * 建一个后台判断器。
 * @param ctx 宿主插件上下文（用来取 llm / attachments 服务）
 * @param collector 收集器服务（提供 listPending / approve / reject）
 * @param getConfig 拉取当前配置
 * @param logger
 */
export function createJudge({ ctx, collector, getConfig, logger }) {
  const stats = { judgedKeep: 0, judgedDrop: 0, judgeFailed: 0, judgeSkipped: 0 }
  let running = false
  let stopped = false

  const service = (name) => {
    try { return ctx.get(name) } catch { return undefined }
  }

  /** 调一次视觉模型，返回模型原文。 */
  const ask = async (config, bytes, mediaType, filename) => {
    const llm = service('llm')
    const attachments = service('attachments')
    if (typeof llm?.stream !== 'function' || typeof attachments?.saveImage !== 'function') {
      throw new Error('宿主没有提供 llm / attachments 服务，无法调用视觉模型')
    }
    const ref = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.judgeTimeoutMs)
    try {
      const prompt = `${String(config.judgePrompt ?? '').trim() || DEFAULT_PROMPT}\n\n（文件名 ${filename}）`
      const message = {
        role: 'user',
        content: [
          { type: 'image', attachment: ref },
          { type: 'text', text: prompt },
        ],
      }
      const stream = llm.stream({
        provider: config.judgeProvider,
        model: config.judgeModel,
        messages: [message],
        maxTokens: config.judgeMaxTokens,
        signal: controller.signal,
      })
      return await collectVisionText(stream)
    } finally {
      clearTimeout(timer)
    }
  }

  /** 跑一轮：把暂存区里所有待判断的表情挨个判掉。 */
  const runOnce = async () => {
    if (running || stopped) return { skipped: true }
    running = true
    try {
      const config = await getConfig()
      if (!judgeReady(config)) return { skipped: true }
      const pending = await collector.listPending()
      if (pending.length === 0) return { judged: 0 }
      let judged = 0
      for (const item of pending) {
        if (stopped) break
        // 每张都重读配置：用户在页面上改了模型或关掉开关应当立刻生效。
        const live = await getConfig()
        if (!judgeReady(live)) break
        let bytes
        try {
          bytes = await readFile(item.path)
        } catch {
          stats.judgeSkipped += 1
          continue
        }
        const info = sniff(bytes)
        if (info === undefined) {
          stats.judgeSkipped += 1
          await collector.reject(item.filename).catch(() => {})
          continue
        }
        let answer
        try {
          answer = await ask(live, bytes, info.mediaType, item.filename)
        } catch (error) {
          stats.judgeFailed += 1
          logger.warn?.(`[dsh-qqbot-ext] 自动判断失败（${item.filename}）：${error instanceof Error ? error.message : String(error)}`)
          continue
        }
        const verdict = parseVerdict(answer)
        if (verdict === undefined) {
          // 判不出来就留在暂存区，别误删
          stats.judgeSkipped += 1
          continue
        }
        try {
          if (verdict === 'keep') {
            await collector.approve(item.filename)
            stats.judgedKeep += 1
          } else {
            await collector.reject(item.filename)
            stats.judgedDrop += 1
          }
          judged += 1
        } catch (error) {
          stats.judgeFailed += 1
          logger.warn?.(`[dsh-qqbot-ext] 应用判断结果失败（${item.filename}）：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return { judged }
    } finally {
      running = false
    }
  }

  return {
    get status() { return { ...stats, running } },
    runOnce,
    stop() { stopped = true },
  }
}
