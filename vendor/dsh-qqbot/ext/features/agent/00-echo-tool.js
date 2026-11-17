// 示例：agent 层自定义工具 ext_echo —— 只在「QQ 机器人扩展」预设的会话里出现。
// 加新工具 = 抄这个文件改个名（文件名排序决定加载顺序，_ 开头的会被跳过）。
export function register(ctx) {
  ctx.tools.register({
    name: 'ext_echo',
    description:
      '把传入的 text 原样返回。dsh-qqbot-ext 扩展提供的示例工具，用于验证扩展链路已生效。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文本' },
      },
      required: ['text'],
    },
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          echo: { type: 'string' },
        },
        required: ['echo'],
      },
      render: (_args, value) => [{ type: 'text', text: value?.echo ?? '' }],
    },
    async execute(args) {
      return { echo: String(args?.text ?? '') }
    },
  })
}
