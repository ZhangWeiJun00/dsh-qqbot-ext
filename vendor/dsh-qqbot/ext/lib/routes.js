// 路由插件：dsh-qqbot-ext/routes
// 装载 features/routes/* —— 注册 webServer 路由。
// 硬依赖 webServer：服务没起来这行就等着，不会拖累别的组件。
import { loadFeatures } from './load.js'

export const name = 'dsh-qqbot-ext/routes'
export const inject = ['webServer']

export async function apply(ctx) {
  await loadFeatures(ctx, new URL('../features/routes/', import.meta.url))
}
