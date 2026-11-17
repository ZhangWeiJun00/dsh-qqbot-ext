// 后台自动判断的挂载点：收集器收到新表情后，空闲时自动跑一轮。
//
// 触发策略刻意保守：
//   - 只在新表情进暂存区后触发，加防抖（同一波消息只跑一次）
//   - 单次串行，跑着的时候不重入
//   - 配置没开或没填模型就完全不跑，零调用
//   - 每张判完都重读配置，页面上关掉立刻停
import { readConfig, judgeReady } from '../../lib/config.js'
import { createJudge } from './_sticker-judge.js'

const DEBOUNCE_MS = 3000

export function register(ctx) {
  const logger = ctx.logger ?? console

  const collector = () => {
    try { return ctx.get('qqbotExtStickerCollector') } catch { return undefined }
  }

  const judge = createJudge({
    ctx,
    collector: {
      listPending: () => collector()?.listPending?.() ?? Promise.resolve([]),
      approve: (filename) => {
        const service = collector()
        if (typeof service?.approve !== 'function') throw new Error('表情收集服务不可用')
        return service.approve(filename)
      },
      reject: (filename) => {
        const service = collector()
        if (typeof service?.reject !== 'function') throw new Error('表情收集服务不可用')
        return service.reject(filename)
      },
    },
    getConfig: readConfig,
    logger,
  })

  let timer

  /** 排一次判断；已有排程就复用，避免一波消息触发多次。 */
  const schedule = () => {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      void (async () => {
        const config = await readConfig()
        if (!judgeReady(config)) return
        await judge.runOnce()
      })().catch((error) => {
        logger.warn?.(`[dsh-qqbot-ext] 后台判断轮次失败：${error instanceof Error ? error.message : String(error)}`)
      })
    }, DEBOUNCE_MS)
    // 别让这个定时器拖住宿主退出
    if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') timer.unref()
  }

  // 新表情入暂存区就排一次判断
  ctx.on('qqbot-ext/sticker-pending', schedule)

  // 配置页保存后立刻排一次，免得刚配好模型还要等下一张表情才动
  ctx.on('qqbot-ext/config-updated', schedule)

  try {
    ctx.provide('qqbotExtStickerJudge', {
      get status() { return judge.status },
      /** 手动跑一轮（配置页「立即判断」按钮 / 工具调用）。 */
      runOnce: () => judge.runOnce(),
      /** 排程入口，供外部触发。 */
      schedule,
    })
  } catch {
    // 开发热重载时可能重复 provide，保留监听即可
  }

  ctx.effect(() => () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    judge.stop()
  }, 'dsh-qqbot-ext.sticker-judge')
}
