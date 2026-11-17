// 示例：宿主层全局工具 ext_now —— 任何预设都可用（不管选没选 QQ 机器人扩展）。
// 形状照抄线上 dsh-scrape-webpage 的 ctx.tools.register 纯对象写法，零依赖。
export function register(ctx) {
  ctx.tools.register({
    name: 'ext_now',
    description:
      '返回服务器当前时间与时区。dsh-qqbot-ext 扩展提供的全局示例工具。',
    parameters: {
      type: 'object',
      properties: {},
    },
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }],
    },
    async execute() {
      return {
        text: new Date().toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          dateStyle: 'full',
          timeStyle: 'medium',
        }),
      }
    },
  })
}
