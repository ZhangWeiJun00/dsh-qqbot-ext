// 独立插件组件：B站视频浏览（只读工具 + 卡片按需取链）。
// qqbotExtCardReader 由 im-qqbot 中间件提供，工具执行时惰性取，缺失时降级。
import { register as bilibili } from '../features/host/06-bilibili-video.js'

export const name = 'qqbot-ext-bilibili'
export const inject = ['tools', 'systemPrompt']

export async function apply(ctx) {
  try {
    await bilibili(ctx)
  } catch (err) {
    console.error('[qqbot-ext-bilibili] 加载失败:', err)
  }
}