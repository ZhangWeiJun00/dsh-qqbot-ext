# dsh-qqbot-ext

DSH / dsh-qqbot 扩展包。给官方 `@tencent-connect/dsh-qqbot` 挂自定义工具、提示词段、Web 配置页和 Agent 预设。
**想到啥加啥，不碰上游仓库**（dsh-qqbot 更新随便同步，扩展全在自己包里）。

零依赖：不 import 任何 `@deepseek-ai/*`，纯对象注册，`type: module` 免构建。

## 目录

```
dsh-qqbot-ext/
├── package.json          # dsh.bundle.patch 自动挂载 cordis.patch.yml；dsh.client 声明 Web 面板
├── cordis.patch.yml      # 独立装载：宿主 / 路由 / 预设三行；统一包拆成 7 个独立组件（见 tools/LOCAL-QQBOT.md）
├── client.js             # 浏览器端：「QQ 机器人扩展」总页（设置栏目 + 左侧主面板）
├── icon.svg / locale/    # 插件列表显示用的图标与标题；locale/<组件>/ 为各独立组件的 GUI 标题
├── lib/
│   ├── load.js           # 功能文件装载器（扫目录、按名排序、逐个 register）
│   ├── config.js         # 表情图库配置（~/.dsh-qqbot-ext/config.json，单一事实源）
│   ├── components.js     # 面板的组件清单（加功能补一行 = 多一个页签）
│   ├── index.js          # 独立装载时的宿主插件入口（统一包不再使用）
│   ├── plugin-sticker.js # 统一包独立组件：表情图库（收集+工具+判断+索引）
│   ├── plugin-roleplay.js# 统一包独立组件：人物扮演
│   ├── plugin-bilibili.js# 统一包独立组件：B站视频浏览
│   ├── plugin-tools.js   # 统一包独立组件：示例工具
│   ├── agent.js          # agent 插件 → features/agent/*（被预设引用）
│   ├── routes.js         # 路由插件 → features/routes/*
│   ├── preset.js         # 注册「QQ 机器人扩展」预设，dsh-qqbot /preset 自动列出
│   └── preset-plugins.js # 预设组件清单（标准全量复刻 + 自定义行）
└── features/
    ├── host/00-now-tool.js      # 示例：全局工具 ext_now
    ├── host/01-sticker-auto-collect.js # 自动收集 QQ 表情消息图片
    ├── host/02-sticker-library-tools.js # 表情图库查询 / 发送 / 状态
    ├── host/_sticker-judge.js   # 后台自动判断（调视觉模型决定收不收）
    ├── host/03-sticker-judge-boot.js # 判断器挂载与防抖触发
    ├── agent/00-echo-tool.js    # 示例：工具 ext_echo（只在本预设会话）
    ├── agent/01-deploy-note.js  # 示例：systemPrompt 提示词段
    ├── agent/02-sticker-curation-tools.js # 暂存表情的查看 / 采纳 / 丢弃
    ├── routes/00-status.js      # 示例：GET /qqbot-ext/status
    ├── routes/01-sticker-config.js # GET/POST /qqbot-ext/config（面板数据 + 图库配置）
    ├── routes/02-vision-models.js  # GET /qqbot-ext/vision-models（自动探测可用视觉模型）
    └── routes/03-open-folder.js    # POST /qqbot-ext/open-folder（在文件管理器里打开图库）
```

## 人物扮演（QQ 人设卡）

打开「QQ 机器人扩展 → 人物扮演」，新增角色或上传/粘贴 `.txt`、`.md`、`.json` 人设卡。编辑角色名称及正文、选择默认角色后点「保存全部配置」；「启用角色扮演」总开关切换即实时生效、无需保存。QQ 下一轮对话会使用选中角色。支持原生 `{ "name": "角色名", "content": "人设正文" }` 和 Tavern v1/v2/v3 JSON 的 description、personality、scenario、first_mes、mes_example、system_prompt、post_history_instructions 叙事字段。`{{char}}` 在生成提示词时替换为角色名，`{{user}}` 替换为“当前对话者”（指当前消息的实际发言者），兼容大小写及括号内空格。其他双花括号宏转为全角括号文本展示，不执行宏，也不交给 DSH 模板引擎解析；保存的原始角色卡不变。开场白只作示例，不自动发出。暂不支持 PNG 内嵌卡片、世界书、脚本和正则扩展。

- 人物扮演默认关闭；可保存多张卡，切换角色无需改工作区默认人设。
- 默认角色应用于可识别的 QQ 会话；会话绑定优先，可为不同群和私聊选不同角色，也可为某个会话选择停用。删除绑定后恢复默认角色。
- 本扩展只对接官方 QQ 机器人。私聊标识为 `qqbot:<appId>:c2c:<用户openid>`，群聊为 `qqbot:<appId>:group:<群openid>`。AppID 来自 QQ 开放平台；用户 openid 来自私聊事件 `author.user_openid`，群 openid 来自群事件 `group_openid`，不能用 QQ 号或群号代替。会话识别复用官方网关的受限 sender 服务，需要已部署表情发送接缝。
- 挂载在宿主 `system-prompt/assemble`，适用于不同 QQ Agent 预设。仅根据官方网关对当前 Agent 的真实会话映射识别目标，不从会话 ID 或消息文字推断。普通 Web 会话和子代理不会继承人设。`/new` 后仍按群/私聊目标绑定。
- 保存只在下一次提示词组装时读取，不回写已有聊天历史。总开关切换或更换角色卡（默认卡/绑定变化）会自动退役受影响的 QQ 会话并新建（含 prefs 存量映射），消除旧人设历史影响；卡片内容编辑（同一张卡）不触发轮换，模型表现仍可能受旧历史或更高优先级指令影响。
- 人设仅控制角色表现，不改变 QQ 平台规则、工具权限、管理员身份和收发策略。启用模块不会绕过 QQ 入站预筛、@门控或自动发送消息。
- 配置独立保存在 `~/.dsh-qqbot-ext/roleplay.json`，不修改表情配置。导入先进入草稿，点击保存才写入；「启用角色扮演」总开关例外：切换时基于上次已保存快照单独持久化 `enabled`、实时生效，不带入未保存草稿，失败回滚开关并提示未生效。保存原子替换，错误数据会被拒绝，读取损坏文件会报错而不覆写卡片。

开发验证：`node tools/test-roleplay.mjs`（24 项后端检查，临时目录隔离，不修改真实角色卡及图库）和 `node tools/test-roleplay-ui.mjs`（11 项 VM 界面交互检查，无真实网络请求）。首次安装新代码需同步 profile 依赖并重启 DSH，之后编辑角色配置无需重启。

## 按聊天语境使用表情（图片理解与检索）

设置页新增独立的「图片理解」开关和模型，默认关闭，避免未经配置调用模型。provider/model 留空时分别沿用后台判断模型。启用并保存后，启动、收图、采纳暂存图和配置变化都会触发串行补齐缺失索引；失败保留原图，管理区可重试。识别提示可编辑，输出包含图中文字、画面含义、情绪、适用/不适用场景和置信度。GIF 当前传原图给模型，未抽取多帧，提示明确要求说明静态识别限制。

`qq_search_stickers({query, limit})` 使用中文分词与二字片段，在 OCR、情绪、场景和画面描述上加权检索，默认返回 5 张；无匹配返回空，不随机选图。返回描述与当前会话剩余冷却；模型根据人设和上下文决定是否调用 `qq_send_sticker`。扩展预设增加了相应提示，其他预设也可通过全局工具描述发现检索能力。

- `sameStickerCooldownSeconds`：同一会话同图冷却，默认 600 秒，0 关闭。
- `stickerSendIntervalSeconds`：同一会话任意表情的连续发送间隔，默认 15 秒，0 关闭。
- 两项保存立即生效；发送前重查，串行防止并发重复，QQ 返回消息 ID 后才记录。按 QQ 会话目标 sessionKey 隔离，同一群或私聊切新 DSH 会话仍保留冷却；使用记录落盘，重启保留。
- 索引与使用记录存在扩展配置目录、按图库路径区分，不往图库里放其他文件。人工修正不会被后台识别覆盖；管理区支持编辑 JSON、补齐、刷新和重试非人工描述。

发送能力需要最新受限接缝，运行 `node tools/apply-qqbot-sticker-collector-patch.mjs` 后重启 DSH。源码改动需同步安装目录；单独修改设置不需要重启。验证：`node tools/test-sticker-search-send.mjs`，测试复制模块到临时目录，完全不写真实配置及图库。

## B站视频浏览（只读）

「QQ 机器人扩展 → B站视频浏览」展示 `bilibili-video` 组件及工具说明，不提供可编辑配置。本功能只访问 B站公开接口，不接入 OneBot / NapCat，不提供 cookie 配置，也不会发消息、点赞或执行其他写操作。

- `qq_video_read({ url, page?, max_chars? })`：`url` 接受 B站视频链接、短链接、BV号、av号，或含这些信息的整条 QQ 分享卡片；`page` 指定分P，`max_chars` 限制字幕正文长度。
- 仅标题卡片返回 `status: missing_link`，不发起网络请求，也不自动按标题搜索；提示先调用 `qq_card_video_links`，取到链接后再调用 `qq_video_read`。`preview` 只是封面，当前文本没有链接不代表原始卡片没有链接；原始卡片实际是否包含链接仍待真实新事件确认。
- `qq_card_video_links({ message_id? })`：显式读取当前 Agent 对应 QQ 会话的指定卡片 `raw`，只返回精简 B站链接；省略 `message_id` 时选最近卡片。只能访问当前 Agent 经官方网关映射的 QQ 会话，不能指定其他会话或跨会话检索；无对应 QQ 会话、卡片过期或不存在时不能取链。取到的链接供 `qq_video_read` 使用，工具结果不代表已阅读视频内容。
- 入站接缝在 `accessPolicy` 之后、`history` 之前仅按 QQ 会话保留最近 20 条卡片消息对象引用：只检查 `content` 是否为卡片/B站及 `messageId`，不读取或自动解析 `raw`。引用缓存 TTL 为 10 分钟，最多 100 个会话；不修改 `content`、不注入上下文、不持久化 `raw`。只有显式调用 `qq_card_video_links` 时才读取所选卡片的 `raw`。
- `qq_video_search({ query })`：显式按关键词搜索，返回视频标题、UP主、链接等候选供确认。搜索候选不能当作原卡片目标；核对后用确认的链接调用 `qq_video_read`，不能据搜索列表声称已经阅读视频内容。
- 在仓库根目录运行 `node tools/apply-qqbot-card-links-patch.mjs` 重放卡片引用接缝，同步扩展代码并重启 DSH 后重新发送卡片验证；尚未取得原用户卡片的真实新事件，不能声称已从该卡片取到链接。详见 [`tools/PATCHES.md`](../tools/PATCHES.md)。
- 读取范围是公开元信息（标题、UP主、简介、分P等）、可获取的字幕、热评和弹幕。字幕、评论、弹幕均是来源文本，不等于已观看完整视频；不做视频画面视觉识别、音频转写或语音识别。
- 未登录时，字幕、评论、弹幕或搜索可能受到登录、风控、地区、权限或接口限制；工具按来源如实标注失败或不可用原因，保留可读取的部分，不把获取失败表述为“视频没有字幕/评论/弹幕”。
- `qq_video_read` 使用 5 分钟、最多 32 项的内存缓存，过期会重新读取，容量达到上限会淘汰旧条目；单次网络请求超时 10 秒，总读取超时 30 秒，单个响应上限 2 MB。`max_chars` 默认 6000、最大 16000，用于限制字幕正文长度。缓存中的内容可能在有效期内稍有滞后。

新增工具代码需同步 profile 依赖并重启 DSH 才生效；本只读组件没有保存或 cookie 设置项。

## 错误拦截与熔断

打开「QQ 机器人扩展 → 错误拦截」。模型回合出错时：

- 原会话只发一条友好短提示（正文可配，默认「服务器繁忙，等会儿再试试～」；留空则静默），不再显示错误码和技术详情。
- 错误详情（会话、时间、错误码、消息）全部转发管理员私聊；管理员 openid 可配，留空回退官方配置 c2c 白名单第一个。
- 全局熔断：连续错误回合达到阈值（默认 3，0 = 不熔断）自动跳闸停发，新消息不进模型，每会话 60 秒至多一条提示。**无冷却、不自动恢复**——只能由管理员人工合闸；跳闸事件通知管理员。
- 未跳闸时成功回合清零计数；跳闸后在途回合成功也不自动恢复。请求级瞬时重试由宿主 llm-retry 负责，熔断计的是最终失败的回合。斜杠命令与待答问题不受熔断影响。
- 人工恢复（唯一恢复途径）：熔断期间在 QQ 发 `/resume` 立即人工合闸，`/resume status` 查看状态（跳闸时间、连续错误数）；**仅限管理员**（errorForwardOpenid，留空为官方 c2c 白名单第一个；其他人触发会被拒绝），`/bot-help` 会列出该命令。保留 `/breaker` 别名。
- 「启用错误拦截」总开关切换即实时生效、无需保存（只持久化 errorGuardEnabled，不带未保存草稿，失败回滚并提示未生效）；关闭后回到上游行为（原会话直接显示技术报错）。其余配置存 `~/.dsh-qqbot-ext/config.json`，点保存后生效。

## 安装（一次性）

1. 找到你的 DSH profile 目录（默认 `~/.dsh/profiles/<名字>`，例如 `~/.dsh/profiles/desktop`），
   编辑它的 `package.json`：

   - `dependencies` 加 `"dsh-qqbot-ext": "file:<本仓库 dsh-qqbot-ext 目录的绝对路径>"`
   - `dsh.profile.bundles` 数组加 `"dsh-qqbot-ext"`

2. 在该 profile 目录跑 `pnpm install`
3. 重启 DSH（改插件必须重启才生效）
4. QQ 里 `/preset` 选「QQ 机器人扩展」，试 `ext_echo` / `ext_now`
5. 验证路由：浏览器开 `http://127.0.0.1:<web端口>/qqbot-ext/status`（或本机 curl）

> 表情包**收集**需要给上游 `dsh-qqbot` 打一个入站接缝补丁，见
> [`tools/patched-files/`](../tools/patched-files/) 与 [`tools/PATCHES.md`](../tools/PATCHES.md)。

## 加功能 = 丢一个文件

| 目录 | 作用域 | 干什么 | 生效时机 |
| --- | --- | --- | --- |
| `features/host/` | 全局（所有预设） | 工具、服务 | 重启后 |
| `features/agent/` | 选了「QQ 机器人扩展」预设的会话 | 工具、提示词段 | 重启后 |
| `features/routes/` | webServer | HTTP 路由 | 重启后 |

> 统一包（vendor/dsh-qqbot）里 host 功能按域拆成独立插件组件（plugin-sticker/roleplay/bilibili/tools），
> 新 host 文件要加进对应包装器的显式 import 列表；agent/routes 仍按目录自动装载。
> 独立装载（lib/index.js + loadFeatures）保留扫目录语义，仅作遗留兼容。

每个文件长这样（`_` 开头的文件会被跳过，文件名排序 = 加载顺序）：

```js
export function register(ctx) {
  // 宿主/agent 层注册工具（纯对象，形状照抄 dsh-scrape-webpage）：
  ctx.tools.register({
    name: 'ext_xxx',
    description: '……',
    parameters: { type: 'object', properties: { /* … */ }, required: [] },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { /* … */ } },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) { return { /* output 形状 */ } },
  })

  // 提示词段（text 可以是 () => string 动态求值）：
  // ctx.systemPrompt.section({ name: 'xxx', order: 9000, text: () => '...' })

  // 路由（routes 目录里）：
  // ctx.webServer.register({ kind: 'exact', path: '/qqbot-ext/x', handler: (req, res) => { ... } })
}
```

单个功能加载失败不影响其他功能，错误打在 DSH 日志里（`[dsh-qqbot-ext] feature 加载失败: ...`）。

## 预设组件清单

`lib/preset-plugins.js`：前半段是 `dsh-web-app/presets/standard.patch.yml` 的逐行复刻
（dsh 0.2.1-rc.2，2026-11）。**千万别删标准行**——预设是整体替换语义，只写增量会丢 bash/pwsh/工具箱。
末尾 `{ id: 'dsh-qqbot-ext-agent', name: 'dsh-qqbot-ext/agent' }` 才是自定义组件入口。

想再加 agent 作用域的独立插件行：往清单末尾补 `{ id, name, config? }` 就行。

## 踩坑备忘（issue #470 等）

- **别把本包 cordis.patch.yml 的 insert 块复制进 profile 的 cordis.patch.yml**——
  重复 entry id 会把 Settings 保存搞坏。本包 patch 由 `dsh.bundle.patch` 自动挂载，不用手动引。
- profile 顶层 `- id: X` 行只做覆盖，而且**整块替换该行 config**（不是合并）。
- 想停用某个组件，在 profile 的 cordis.patch.yml 加顶层覆盖行：
  `- id: dsh-qqbot-ext-routes` + `disabled: true`。
- `file:` 目录依赖是**拷贝**不是软链（已用 fsutil 验证）：
  改本包源码后要重跑 `pnpm install` + 重启 DSH 才生效。
- 「自动收集」总开关切换即实时生效、无需保存（只持久化 enabled，不带未保存草稿，失败回滚并提示未生效）；收集方式、过滤条件、图片理解等其余设置仍要点「保存」。
- 自动表情图库默认保存在 `%USERPROFILE%\.dsh-qqbot-ext\stickers`，可改成任意绝对路径（存 `~/.dsh-qqbot-ext/config.json`，保存即生效，不用重启）。仅扩展内部收到带签名的 QQ 表情候选（面向本机相连官方机器人消息）才会收集，并要求同消息恰有一张已下载图片。工具：`qq_list_stickers`、`qq_send_sticker`、`qq_sticker_status`。
- **两种收集方式**（配置项 `collectMode`，面板上有二选一分段控件）：
  - `auto`｜**全收**：过了过滤条件直接进图库。（默认）
  - `curated`｜**模型判断**：先落到暂存区 `<图库目录>.pending`（在图库同级、不在图库里面，免得被 `qq_list_stickers` 列成正式表情），看过图觉得有意思才收进图库。暂存超过 `pendingLimit` 自动丢最旧的。
  - 判断有两种路径：**后台自动判**（下面那组配置，推荐）或**会话里手动判**（模型用 `qq_sticker_pending` / `qq_sticker_keep` / `qq_sticker_drop` 三个工具）。
- **后台自动判断**（`judgeEnabled` 等一组配置，只在 `curated` 模式下生效）：
  - 新表情进暂存区后防抖 3 秒排一次队，逐张调视觉模型看图，按 `judgePrompt` 决定收还是丢。模型回复第一行要 `KEEP` / `DROP`；判不出来就**留在暂存区**，绝不误删。
  - **视觉模型自动探测**：面板直接读出宿主 `llm` 服务里已注册的 provider 和模型，只把 `inputModalities` 含 `image` 的列成候选，用户在两个下拉框里选就行，不用手抄 id。数据来自 `GET /qqbot-ext/vision-models`（`llm.listProviders()` + `llm.listModels(provider)`），本地不存清单。换 provider 时自动挑第一个能看图的模型。探测不到模型、或该 provider 没广告模型时退回手填输入框；宿主没提供 `llm` 服务时返回可读原因而不是崩掉。
  - **审美标准不写死在代码里**，全在 `judgePrompt`。以后接人格/人设模块，只改这段提示词即可。
  - 开了开关却没填 provider/model 会被**写入校验拦住并报错**，不会静默产生一堆失败调用。这条校验只在写入侧（`assertWritable`），不放进 `normalizeConfig`——否则一份写坏的配置会让 `readConfig` 整份退回默认值，把用户其它设置一起弄丢。
  - 走的是官方 `qqbot_describe_image` 同一条通道（宿主 `llm` 服务 + `attachments.saveImage`）；宿主没提供这两个服务时只报错跳过，不影响收集。
- **配置页是「QQ 机器人扩展」总页**（设置里有同名栏目，左侧主面板也有入口）。页面是组件式的：概览统计 + 组件切换，**表情包图库只是其中第一个组件**，另有人物扮演、B站视频浏览和示例工具；B站视频浏览与示例工具只展示只读说明。组件清单在 `lib/components.js`，加功能补一行就多一个页签。数据走 `GET/POST /qqbot-ext/config`（旧的 `/qqbot-ext/sticker-config` 保留为别名）。
- **每个配置项都有独立的「恢复默认」按钮**（当前值已等于默认值时自动禁用），底栏另有「全部恢复」；默认值由接口的 `defaults` 字段下发（`lib/config.js` 的 `CONFIG_DEFAULTS` 是唯一事实源，改默认值只改那一处）。恢复默认只是填回表单，仍要点「保存」才落盘。
- **图库位置用「选择目录」按钮挑**：跟官方原生选择器同一套调法——优先 `globalThis.__DSH_DIRECTORY_PICKER__`（Desktop preload 注入），否则 `ctx.uiWorkspace.pickDirectory()`。成功返回绝对路径字符串，取消返回 null。
- **`uiWorkspace` 绝对不能写进 `inject` 硬依赖**（踩过两次坑）：官方 picker 插件那样写是它自己的组合假设；这里一旦声明，服务没就绪会连带整个面板不激活，页面直接消失，比"选不了目录"严重得多。只声明 `inject: ['slots']`，`uiWorkspace` 在点击时惰性 `ctx.get` 并缓存。也别用 `ctx.get('remote.directoryPicker')`，那条路拿不到东西。
- 选择失败时的提示就近显示在路径输入框下方，带诊断信息（`desktop=… uiWorkspace=…`），按钮等待时显示「选择中…」；保存时路径还不存在就顺手建目录。
- **「打开目录」按钮**（在「选择目录」右边）：浏览器打不开本地文件夹，所以交给宿主 `POST /qqbot-ext/open-folder` 调系统文件管理器。安全约束：**只允许打开当前配置的图库目录和它的暂存区，不接受任意路径**；同源校验 + 只收 POST（GET 被 405 挡掉，防止被别的网页顺手点开）。Windows 用 `explorer.exe`、macOS 用 `open`、Linux 用 `xdg-open`，全程 `execFile` 传数组参数、不拼命令行（路径里的空格和中文才不会出问题）。目录不存在会先建出来；设 `QBE_NO_SHELL_OPEN=1` 可让它只做路径解析、不真弹窗（自检脚本靠这个避免每次跑测试都弹窗）。
- 面板自检：`node tools/verify-qqbot-ext-panel.mjs`（在仓库根目录跑）（53 项，覆盖插槽注册、标题、组件页签、表单、逐项恢复默认、收集模式分段控件、后台判断配置项、视觉模型探测与筛选、打开目录按钮/同源/方法/目标、选择器优先级与降级、配置读写、路径校验、同源防护、收集去重、URL 抓取与超限拒绝、curated 暂存/采纳/丢弃/上限淘汰、KEEP/DROP 解析、判断器零调用与失败保留）。**这个脚本会读写真实 `config.json`，所以它开头备份、结尾逐字节还原，断言失败也走还原钩子**；早期版本没做这件事，把用户的 `libraryDir` 覆盖成默认值，导致表情被收进默认目录多出一份副本（已修）。
- 收集钩子挂在 `contentSanitizer` 之后、`concurrencyGuard` **之前**：`concurrencyGuard` 的 `merge` 策略每批只放行一个 survivor，挂链尾会在机器人忙时漏收整批表情。那时附件还没下载，所以事件传 CDN `url`，由本包自己 `fetch`（20s 超时 + 双重大小校验）。
- 官方 `@tencent-connect/dsh-qqbot` 的入站接缝改动记录在 `tools/PATCHES.md`，重装/升级后运行 `node tools/apply-qqbot-sticker-collector-patch.mjs` 重放（脚本幂等）。
- 改 dsh-qqbot 上游需要记 `tools/PATCHES.md`，本包自有功能不用。
- dev 快速试：`pnpm dsh web --patch <yml>`，行里 `name` 直接写本包绝对路径的 `lib/*.js`。
