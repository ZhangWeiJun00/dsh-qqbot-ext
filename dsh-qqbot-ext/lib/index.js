// 宿主插件：dsh-qqbot-ext
// 装载 features/host/* —— 全局生效的工具 / 服务（任何 Agent 预设都带）。
// 硬依赖只有 tools + systemPrompt（宿主层一定有，参照 dsh-scrape-webpage）；
// 其他服务（webServer / sessionProjections 等）在各自 feature 里按需 ctx.get 取、缺失就降级。
import { loadFeatures } from './load.js'

export const name = 'dsh-qqbot-ext'
export const inject = ['tools', 'systemPrompt']

export async function apply(ctx) {
  await loadFeatures(ctx, new URL('../features/host/', import.meta.url))
}
