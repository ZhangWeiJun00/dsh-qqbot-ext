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
  qq_card_video_links: '显式读取当前 Agent 对应 QQ 会话的卡片 raw，返回精简 B站链接；可传 message_id 指定卡片，默认最近卡片。入站仅保留最近 20 条卡片消息对象引用，10 分钟 TTL、最多 100 会话；不读取 raw、不修改 content、不注入上下文、不持久化 raw。工具只在调用时读取所选卡片 raw，不能跨会话；原始卡片实际是否包含链接仍待真实新事件确认。',
  qq_video_read: '只读浏览 B站视频：url 接受链接、BV号、av号或整条分享卡片，可指定 page、max_chars；仅标题输入返回 missing_link 且不发请求，先调用 qq_card_video_links 取得当前 QQ 会话卡片链接，再调用本工具；需要搜索时显式调用 qq_video_search，候选不能当作原卡片目标。读取公开元信息、字幕、热评和弹幕，不做画面视觉或语音识别；登录限制如实标注，无 cookie 配置。结果有 5 分钟有界缓存，网络请求有超时及响应大小上限。',
  qq_video_search: '按 query 搜索 B站视频，返回标题、UP主和视频链接等候选供确认；搜索结果不代表已读视频，确认后调用 qq_video_read。',
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
    id: 'bilibili-video',
    title: 'B站视频浏览',
    summary: '只读浏览 B站公开元信息、字幕、热评和弹幕；支持链接、BV/av号及分享卡片，搜索候选需确认。无画面视觉或语音识别，登录限制如实标注，无 cookie 配置。',
    editable: false,
    tools: ['qq_card_video_links', 'qq_video_read', 'qq_video_search'],
  },
  {
    id: 'error-guard',
    title: '错误拦截',
    summary: '模型回合出错时给原会话友好短提示，技术详情转发管理员私聊；连续错误自动熔断停发，无自动恢复，管理员 /resume 人工合闸。',
    editable: true,
    tools: [],
  },
]

/** 组件清单 + 每个组件用到的工具说明，供概览接口直接下发。 */
export function describeComponents() {
  return COMPONENTS.map((component) => ({
    ...component,
    toolInfo: component.tools.map((name) => ({ name, description: TOOL_INFO[name] ?? '' })),
  }))
}
