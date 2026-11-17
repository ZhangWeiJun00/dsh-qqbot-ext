// 独立插件组件：人物扮演（QQ 人设卡注入 + 会话轮换联动）。
// system-prompt/assemble 瀑布挂在组件自己的 ctx 上；Cordis 事件总线按名字全局派发
// （无 thisArg 过滤器），跨插件可达。会话轮换服务 qqbotExtSessionRotator 惰性取。
import { register as roleplay } from '../features/host/05-roleplay.js'

export const name = 'qqbot-ext-roleplay'
export const inject = ['systemPrompt']

export async function apply(ctx) {
  try {
    await roleplay(ctx)
  } catch (err) {
    console.error('[qqbot-ext-roleplay] 加载失败:', err)
  }
}