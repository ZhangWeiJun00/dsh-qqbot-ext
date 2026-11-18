import z from '@deepseek-ai/schemastery'
import { register as memoryLink } from '../features/host/07-memory-link.js'

export const name = 'qqbot-ext-memory'
export const inject = ['tools', 'mnemonMemory', 'agents']
export const Config = z.object({
  writeEnabled: z.boolean().default(true).description('允许 QQ 工具及自动提炼写入 QQ 记忆；Mnemon View Action 仍另受 Mnemon 写入策略限制。'),
  captureEnabled: z.boolean().default(true).description('成功回合后自动提炼明确长期事实。每回合至多额外调用一次会话模型，不保存聊天原文。'),
  captureProvider: z.string().default('').description('提炼模型服务商，留空跟随当前会话。'),
  captureModel: z.string().default('').description('提炼模型，留空跟随当前会话。'),
})

export function apply(ctx, config) {
  // Let the Loader expose registration failures instead of showing a false active state.
  return memoryLink(ctx, { config })
}
