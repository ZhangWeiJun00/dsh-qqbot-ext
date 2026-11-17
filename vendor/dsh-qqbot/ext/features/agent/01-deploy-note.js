// 示例：提示词段 —— 往 agent 系统提示词里注入一段部署备注。
// text 可以是字符串，也可以是 () => string（每次生成时求值，适合带时间戳的动态内容）。
// order 控制在提示词里的先后（越大越靠后；官方自带段落占 -1000~10200，给 9000 夹在工具段后面）。
export function register(ctx) {
  ctx.systemPrompt.section({
    name: 'qqbot-ext-deploy-note',
    order: 9000,
    text: () =>
      `【dsh-qqbot-ext】扩展部署备注：${new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
      })} 时，扩展组件（ext_echo / /qqbot-ext/status）已装载。`,
  })
}
