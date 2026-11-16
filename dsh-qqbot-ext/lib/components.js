// 扩展组件清单：Web 配置页的左侧导航和宿主概览接口共用一份。
// 新加功能时在这里补一行，页面自动多一个组件页。
export const TOOL_INFO = {
  qq_list_stickers: '列出图库里的表情包（文件名、格式、大小）。',
  qq_search_stickers: '按图中文字、情绪和使用场景查找表情，返回图意与当前会话剩余冷却。',
  qq_send_sticker: '把图库里某张表情发到当前 QQ 会话。',
  qq_sticker_status: '看自动收集开关、收集模式、图库张数和本次累计统计。',
  qq_sticker_pending: '列出暂存区里还没判断过、等你看图决定收不收的表情。',
  qq_sticker_keep: '看过图觉得喜欢，把暂存的表情收进图库。',
  qq_sticker_drop: '觉得没意思，把暂存的表情丢掉。',
  ext_now: '报服务器当前时间与时区，用来确认扩展装载正常。',
  ext_echo: '原样回显一段文字，调试提示词用。',
}

export const COMPONENTS = [
  {
    id: 'sticker-library',
    title: '表情包图库',
    summary: '收集别人发的表情包，可全收，也可先让我看过再决定；设置存放位置和过滤条件。',
    editable: true,
    tools: [
      'qq_list_stickers', 'qq_search_stickers', 'qq_send_sticker', 'qq_sticker_status',
      'qq_sticker_pending', 'qq_sticker_keep', 'qq_sticker_drop',
    ],
  },
  {
    id: 'roleplay',
    title: '人物扮演',
    summary: '导入与编辑人设卡，为 QQ 群聊和私聊设置默认角色或单独绑定角色，保存后下一轮生效。',
    editable: true,
    tools: [],
  },
  {
    id: 'ext-tools',
    title: '示例工具',
    summary: '扩展自带的调试工具，用来确认插件真的装载了。',
    tools: ['ext_now', 'ext_echo'],
  },
]

/** 组件清单 + 每个组件用到的工具说明，供概览接口直接下发。 */
export function describeComponents() {
  return COMPONENTS.map((component) => ({
    ...component,
    toolInfo: component.tools.map((name) => ({ name, description: TOOL_INFO[name] ?? '' })),
  }))
}
