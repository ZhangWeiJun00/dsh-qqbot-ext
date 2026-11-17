// 独立插件组件：示例工具（ext_now 等调试工具，确认扩展真的装载了）。
import { register as nowTool } from '../features/host/00-now-tool.js'

export const name = 'qqbot-ext-tools'
export const inject = ['tools']

export async function apply(ctx) {
  try {
    await nowTool(ctx)
  } catch (err) {
    console.error('[qqbot-ext-tools] 加载失败:', err)
  }
}