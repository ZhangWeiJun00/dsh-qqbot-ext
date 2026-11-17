// Agent 插件：dsh-qqbot-ext/agent
// 被 qqbot-ext 预设引用，在 agent 作用域里装载 features/agent/* ——
// 自定义工具、提示词段等，只在选了「QQ 机器人扩展」预设的会话里生效。
import { loadFeatures } from './load.js'

export const name = 'dsh-qqbot-ext/agent'
export const inject = ['tools', 'systemPrompt']

export async function apply(ctx) {
  await loadFeatures(ctx, new URL('../features/agent/', import.meta.url))
}
