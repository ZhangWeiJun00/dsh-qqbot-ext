// 独立插件组件：表情图库（自动收集 + 图库工具 + 后台判断 + 图片理解 + 暂存整理 + 使用提示）。
// 网关服务（qqbotExtStickerSender 等）由 im-qqbot 提供，这里一律惰性 ctx.get，
// 不硬 inject——网关未绑定时组件照常加载，消息到来时才取服务。
// 单个功能注册失败只打日志，不拖垮组件内其他功能（沿用 loadFeatures 的隔离语义）。
// 预设已移除：原 agent 层的暂存整理工具/提示词段并入本组件，全局生效。
import { register as autoCollect } from '../features/host/01-sticker-auto-collect.js'
import { register as libraryTools } from '../features/host/02-sticker-library-tools.js'
import { register as judgeBoot } from '../features/host/03-sticker-judge-boot.js'
import { register as indexBoot } from '../features/host/04-sticker-index-boot.js'
import { register as curationTools } from '../features/agent/02-sticker-curation-tools.js'
import { register as stickerUse } from '../features/agent/03-sticker-use.js'
import { register as deployNote } from '../features/agent/01-deploy-note.js'

export const name = 'qqbot-ext-sticker'
export const inject = ['tools', 'systemPrompt']

export async function apply(ctx) {
  const features = [['auto-collect', autoCollect], ['library-tools', libraryTools], ['judge-boot', judgeBoot], ['index-boot', indexBoot], ['curation-tools', curationTools], ['sticker-use', stickerUse], ['deploy-note', deployNote]]
  for (const [label, register] of features) {
    try {
      await register(ctx)
    } catch (err) {
      console.error(`[qqbot-ext-sticker] ${label} 加载失败:`, err)
    }
  }
}