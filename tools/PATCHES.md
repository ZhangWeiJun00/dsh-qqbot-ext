# 上游补丁说明

## 2026-11-17：整合进本地维护版发行包（取代 node_modules 重放补丁）

官方 `@tencent-connect/dsh-qqbot` 的本地维护副本 `vendor/dsh-qqbot`（`0.5.5-local.1`）已把扩展功能与全部上游接缝整合进包内：`ext/` 功能模块、`lib/index.js` 的 `applyExtensions`、`lib/gateway/middleware-setup.js` 的卡片引用缓存与 `qqbot/sticker-candidate` 钩子、`lib/gateway/bootstrap.js` 的 `qqbotExtStickerSender`、`lib/client.js` 面板合并（单次包名 id 注册，见 `tools/merge-qqbot-client.mjs`；简单拼接第二个 `.load` 会因 boot graph 每包一条目而永不激活）、bundle patch 的 routes/preset 行。**profile 不再需要对本包跑 `apply-qqbot-*-patch.mjs` 重放脚本**；那些脚本仍保留，供尚未整合的 pristine 上游副本使用。

接缝未加载的根因与修复：profile 以 `link:` 指向 vendor，但 `link:` 不装被链接包的依赖，vendor 自身没有 `node_modules`，`im-qqbot` 导入 `@tencent-connect/qqbot-nodejs` 失败、fiber 停在 null，网关与全部接缝都没加载（routes/preset 零依赖所以照常活着）。修复：vendor 内用 DSH 自带 pnpm 11 + 工作区 store 装运行时依赖，`pnpm-workspace.yaml` 本地设 `nodeLinker: hoisted`（isolated 布局 Windows junction 下 ESM 找不到兄弟依赖 ws）与 `autoInstallPeers: false`（宿主包走 DSH 安装层拦截）。重装用 `plugin_manager install_bundle <裸目录>`（link:），替换先 `remove_bundle`；**禁用 `file:` 协议**——pnpm 11 hoisted 会把源码目录整个搬进 node_modules 并清空 vendor（本次实测，已还原）。

安装与验收结果、上游合并流程见 [`LOCAL-QQBOT.md`](LOCAL-QQBOT.md) 与包内 `LOCAL-MAINTENANCE.md`。配置路径 `~/.dsh-qqbot-ext`、`/qqbot-ext/*` 路由、`qqbot-ext` 预设 ID 与 raw 按需读取契约均不变；旧独立 `dsh-qqbot-ext` bundle 已从 profile 移除。

## 2026-11-18：修复 qqbot-ext 预设组件漂移（私聊会话创建抛异常的根因）

**现象**：私聊回「⚠️ 处理消息时出现异常，请稍后重试。」（handleInbound 兜底），群聊正常；新会话日志只有 header、无回合。熔断正常（/resume status 无跳闸）。

**根因**：preset-plugins.js 的标准行复刻自 dsh 0.2.1-rc.2，DSH 升 0.2.2-rc.3 后两处漂移：`@deepseek-ai/dsh-tool-subagent-control/list-agents` 子路径导出已删除（挂载即抛 ERR_PACKAGE_PATH_NOT_EXPORTED）；`modelSelectionSettings` 改名 `modelSelection`/`modelDiscovery`。私聊绑 qqbot-ext 预设 → composePreset 的 setup（presets.mount）抛错 → resume 失败且会话已在盘上不允许重建 → getOrCreate 抛 → 兜底文案。群聊用宿主默认预设（当前标准）不受影响。**与归档轮换无关**（归档判定代码群/私聊同路，已核宿主 archived-session-gate 源码）。

**修复**：按 0.2.2-rc.3 standard.patch.yml 重新对齐标准行——删 list-agents 行；subagent spawn 改 modelSelection/modelDiscovery:true；subagent-control 加 interrupt:false；tool-fs 加 applyPatch:false；补 tool-office；skill-filesystem 的 customSkillDirs 用 createRequire 安全解析（解析不到省略）。升级 DSH 后必须重新核对复刻（已写入注释与 LOCAL-QQBOT 合并流程）。

**验证**：test-integrated 增加漂移回归断言（无 list-agents/modelSelectionSettings、有 modelDiscovery）；全套隔离测试过；ext 双向同步（仅预设名替换差异）。需重启 DSH；重启后私聊 resume 现存会话会挂载修好的预设，应直接恢复。

## 2026-11-17：移除示例工具组件（ext-tools / ext_now）

**需求**：用户表示示例工具功能不再需要。

**实现**：删除 plugin-tools.js、features/host/00-now-tool.js、locale/tools（源码+vendor）；components.js 移除 ext-tools 页签与 ext_now/ext_echo 的 TOOL_INFO；bundle patch 与 exports 移除 ext-tools 行；integrate 脚本组件循环去掉 tools。GUI 组件 7→6（im-qqbot + sticker/roleplay/bilibili/routes/preset），面板页签 5→4。预设 agent 层 ext_echo（00-echo-tool.js）随后也按用户要求删除；01-deploy-note 提示文案同步去掉 ext_now/ext_echo。

**验证**：test-integrated 增加「ext-tools 行/导出已移除」断言；面板 53 项（4 组件）、其余全套隔离测试过；ext 双向同步。需重启 DSH 生效。

## 2026-11-17：功能拆成独立插件组件（mnemon 同构，GUI 逐组件开关）

**需求**：用户发现扩展功能不像记忆系统那样以独立插件组件进入 GUI，要求组件化。

**实现**：
- 新增 4 个组件包装器 `ext/lib/plugin-{sticker,roleplay,bilibili,tools}.js`：显式 import 对应 host 功能、逐个 try/catch（沿用 loadFeatures 隔离语义）；inject 只声明宿主服务（tools/systemPrompt），网关服务（qqbotExtStickerSender/CardReader/SessionRotator/Collector）一律惰性 ctx.get，网关未绑定组件照常加载。
- `lib/index.js` 还原上游 pristine（移除 applyExtensions 接缝与 inject 改动）；im-qqbot 不再承载扩展功能。
- bundle patch 追加 6 行组件插件行（sticker/roleplay/bilibili/tools/routes/preset）+ im-qqbot 共 7 个 GUI 组件；package.json 增加各组件运行时导出与 `./ext-<comp>/locale/*.json` 导出（子路径插件 GUI 标题走各自 locale，host-plugin.md 规则）；新增 12 个组件 locale 文件。
- 跨插件事件无需改线：cordis 4.1.0 events `_resolve` 对字符串名 + payload 的 emit 不带 thisArg 过滤器，监听器全局可达（sticker-candidate/sticker-pending/sticker-collected/config-updated/system-prompt/assemble 均验证）。
- 错误拦截不做独立组件（传输层接缝，outbound/middleware 静态引用状态机），保留配置总开关。
- integrate 脚本同步：不再改 index.js、导出/插件行/locale 自动生成；lib/ 对 pristine 差异降为 5 文件（client/bootstrap/middleware-setup/session-manager/outbound）。

**验证**：test-integrated 增加组件断言（6 插件行+导出+locale 导出、index pristine、4 包装器各自 apply 注册工具/服务/监听）；全套隔离测试过（master-switches 5、error-guard 15、roleplay 24+16+9、archived 10、sticker 20、card-links 13、bilibili 15、card-inbox、panel 53）；patch=pristine+append、exports 与 integrate 输出一致、ext 双向同步。**需 remove_bundle→install_bundle 重装 + 重启 DSH**；GUI 7 组件显示与开关待重启后目视验收。

## 2026-11-17：所有功能总开关实时生效（免二次保存）

**需求**：所有的功能总开关应该是实时的，不需要二次点击保存（人设总开关此前已改，本次补齐其余）。

**实现**（纯客户端，服务端 POST /qqbot-ext/config 本就支持单字段合并写入，无需改动）：
- 表情图库「自动收集」（StickerLibrarySection.toggleEnabled）：切换即 POST `{config:{enabled}}`；成功就地更新 initial/form 的 enabled 并同步概览 capabilities.autoCollect，**不替换 data.config 对象**（其 useEffect 会重置整份表单丢草稿）；失败回滚开关 + 「开关保存失败（未生效）」。
- 错误拦截「启用错误拦截」（ErrorGuardSection.toggleEnabled）：切换即 POST `{config:{errorGuardEnabled}}`；成功更新 form 与 saved 基线的该字段（其余草稿保持 dirty）；失败回滚 + 提示。
- 人设「启用角色扮演」：此前已实现（基于已保存快照单独持久化 + 会话自动轮换）。
- 子选项（收集方式/后台判断/图片索引/阈值/提示正文等）仍走草稿 + 统一保存；帮助文案与总览副标题注明「总开关实时生效」。

**验证**：新增 tools/test-master-switches.mjs 5 项（单字段落盘/草稿隔离/失败回滚 ×2 组件/概览同步且 data.config 引用不变）；面板 53、人设 UI 16、集成全过。**纯客户端改动，刷新页面即生效**（宿主 JS 未动）。

## 2026-11-17：模型错误拦截 + 全局熔断（outbound.js / middleware-setup.js）

**需求**：模型对话错误不再往原会话甩技术报错；错误详情全部转发管理员 QQ；原会话友好短提示；连续失败 3 次自动熔断停止。

**实现**：
- `dsh-qqbot-ext/lib/error-guard.js`（新）：模块级状态机。interceptTurnError（转发管理员→原会话提示→计数，达 breakerThreshold 跳闸+通知；跳闸中在途错误照常上报不重复跳闸）、noteTurnSuccess（未跳闸清零；跳闸中不做任何事）、breakerGate（跳闸后一律拦截入站+每会话 60s 节流提示；**无冷却**）。配置实时读 ext config，测试可传 cfg。
- `dsh-qqbot-ext/lib/config.js`：新增 errorGuardEnabled(true)/errorNoticeText('服务器繁忙，等会儿再试试～')/errorForwardOpenid(''=回退 c2cAllow[0])/breakerThreshold(3, 0=不熔断)，normalizeConfig 校验。**无冷却字段、不自动恢复，只能管理员 /resume 合闸**（用户 2026-11-17 明确要求，替代先前的 120s 冷却半开方案）。
- `vendor/dsh-qqbot/lib/transport/outbound.js`（tools/patch-error-guard.mjs）：onTurnEnd 错误走 interceptTurnError（含 STREAM_CLOSED），complete 走 noteTurnSuccess；拦截自身异常回退上游报错文案。
- `vendor/dsh-qqbot/lib/gateway/middleware-setup.js`（同补丁）：breakerGate 闸门，位于斜杠命令/待答问题/表情钩子之后、concurrencyGuard 之前——熔断期间命令仍可用。
- 面板新增「错误拦截」组件（lib/components.js + client.js ErrorGuardSection，独立读取、只提交本组件字段的合并保存）；注册表 5 组件。
- 请求级瞬时重试仍由宿主 llm-retry 负责；熔断计「最终失败回合」，全局计数（模型故障通常是全局的）。
- **人工恢复命令**（用户追加需求，唯一恢复途径；命令名按用户要求定为 /resume，且**仅限管理员触发**）：`/resume` 无参数直接人工合闸清零，`/resume status` 查状态（跳闸时间/连续错误/阈值）；保留 `/breaker` 别名与 reset/resume 参数兼容。error-guard.js 导出 manualResetBreaker/breakerStatus/breakerCommand/adminOnlyAuth；管理员 = errorForwardOpenid（留空回退官方 c2cAllow[0]），同步判定（SDK authorized 不 await），解析不出管理员一律拒绝（fail-closed），不再用整个白名单的 commandAllowlistAuth。middleware-setup 把命令 push 进 buildCommandList 返回的同一数组（helpCommand 闭包引用该数组，/bot-help 自动可见）。命令在闸门之前处理，跳闸期间可用。

**验证**：test-error-guard.mjs 15 项（拦截/回退管理员/静默/关闭/跳闸节流/无冷却不自动恢复/在途错误不重复跳闸/阈值0/清零/转发失败降级/配置校验/人工合闸/状态查询/关闭与0阈值文案/管理员专属鉴权 fail-closed）；面板 53 项（新组件渲染、25 恢复默认按钮、4 textarea、5 组件注册）；集成测试含闸门位置与 /resume 注册断言；pristine 全链路重放与 vendor 逐字节一致；lib/ diff 恰为 6 文件。**宿主 JS 改动需重启 DSH**；真实 QQ 错误转发/熔断/人工合闸验收待重启后确认。

## 2026-11-17：人设切换自动轮换会话（总开关/换卡即新建会话）

**需求**：总开关切换、启用状态下更换角色卡后，旧会话历史里的人设对话会带偏模型；用户要求这些操作自动新建会话。

**实现**：
- `dsh-qqbot-ext/lib/roleplay.js`：`affectedRoleplayKeys(previous, next, keys)` 逐 key 比较变更前后解析人设的卡 id（总开关/默认卡/绑定卡切换/禁用都覆盖；同卡内容编辑不触发）。
- `dsh-qqbot-ext/features/routes/05-roleplay.js`：保存成功后经 `ctx.get('qqbotExtSessionRotator')` 对受影响 key 逐个轮换；响应带 `rotated` 计数。轮换失败/网关未启动不影响保存。
- `vendor/dsh-qqbot/lib/gateway/bootstrap.js`（补丁源 `tools/patched-files/qqbot-sticker-collector-hook.js`）：新增 `qqbotExtSessionRotator` 服务（`knownKeys()`/`rotate(key)`）。
- `vendor/dsh-qqbot/lib/session/session-manager.js`（并入 `tools/patch-archived-rotation.mjs` 第 4 处）：`remove()` 重构为 `removeByKey(key)`（退役活跃记录+铸造新 prefs id+清待答/待批），新增 `knownSessionKeys()`（活跃+prefs 存量）。存量 key 无活跃记录时只改 prefs，下次消息自然新建。
- 客户端：总开关即时保存（上一轮改动）与统一保存的成功提示展示轮换计数；帮助文案更新。

**验证**：`test-roleplay-rotation.mjs` 9 项（单元+路由集成：开关/默认卡/绑定/内容编辑/导入不轮换/无服务降级/轮换失败保保存/版本冲突）、`test-roleplay-ui.mjs` 16 项、`test-archived-session-rotation.mjs` 10 项、`test-roleplay.mjs` 24 项、集成与面板 53 项全过。补丁模块对 pristine 重放与 vendor 手改逐字节一致。**宿主 JS 改动需重启 DSH**；真实 QQ 验收待重启后确认。

## 2026-11-17：归档会话自动换新（session-manager.js，紧急修复）

**症状**：QQ 会话在 GUI 被归档（回档）后机器人永久静音，插件不自动新建会话。

**根因**：宿主 `archived-session-gate`（dsh-api-session-controller）对归档会话的每个 `agent/pre-step` 拒成 `{kind:'reject'}`，turn 以 `blocked` 结束、一个模型请求都不发。官方插件不感知归档：`getOrCreate` 命中缓存 record 直接复用，`openSession` 对 prefs 里的归档 id 照常 resume（resume 成功但每步被拒）。与早年 dsh-onebot-qq 补丁 7 同一类问题。

**修法**（`vendor/dsh-qqbot/lib/session/session-manager.js`，重放模块 `tools/patch-archived-rotation.mjs`，已接进 `integrate-qqbot.mjs`）：
1. `isArchivedSession(sessionId)`：懒取 `ctx.get('workspaceRegistry')?.archivedSessionIds`，服务缺失/异常一律按未归档（fail-open，不影响无该服务的宿主）。
2. `getOrCreate`：缓存 record 的会话已归档 → 记日志 + `await this.remove(scope, peerId)` 静默退役（cancel agent、dispose handle、清待答问题/待批审批、prefs 铸造新 id），落入 openSession 新建。**不往 QQ 发任何提示**（归档是宿主 GUI 动作，群里/私聊都不该看到）。
3. `openSession`：候选 sessionId（prefs/重启恢复）已归档 → 直接 `mintSessionId()` 铸造新 id 并落 prefs，`candidateIsLegacy=false`，走既有 resume 失败→存在性求证→新建路径；**不 resume 归档 id**。覆盖重启后映射仍指向归档会话的情形。

**验证**：`node --experimental-vm-modules tools/test-archived-session-rotation.mjs` 7 项全过（复用/活跃归档轮换/重启归档候选/无 registry 降级/缺失会话沿用 id 回归//new 回归/连续归档不泄漏）。补丁模块对 pristine 0.5.5 重放产物与 vendor 手改逐字节一致、幂等。真实 QQ 归档→发消息验收待重启/热重载后确认。

## 2026-11-17：卡片引用缓存与显式 B站取链接缝

官方 QQ 入站消息已有 `message.raw` 透传，但只看模型侧的 `source/title/preview` 文本无法判断原始卡片是否含目标链接。入站只保留有界的消息对象引用，取链由显式工具调用触发。

- 目标为官方 `@tencent-connect/dsh-qqbot/lib/gateway/middleware-setup.js`，钩子位于 `accessPolicy` 之后、`history` 之前。入站仅检查 `content` 是否为卡片/B站及 `messageId`，按 QQ 会话保留最近 20 条卡片消息对象引用；10 分钟 TTL、最多 100 个会话。不读取或自动解析 `raw`，不修改 `content`，不注入上下文，不持久化或记录 `raw`。
- 缓存与取链逻辑位于 [`dsh-qqbot-ext/lib/qq-card-links.js`](../dsh-qqbot-ext/lib/qq-card-links.js)。显式工具 `qq_card_video_links({ message_id? })` 仅在调用时读取所选卡片 `raw` 并返回精简 B站链接；默认选择最近卡片。会话必须来自官方网关对当前 Agent 的真实 QQ 会话映射，不能由工具参数指定其他会话或跨会话读取；无对应会话、卡片过期或不存在时不能取链。返回链接供 `qq_video_read` 使用，不返回完整原始事件。
- 重放命令（仓库根目录）：`node tools/apply-qqbot-card-links-patch.mjs`；可用 `--profile <目录>` 指定 profile，`--dry-run` 检查改动。同步扩展代码并重放接缝后需重启 DSH。重复运行不会重复插入钩子；升级或重装后需重放，若先重放完整表情接缝文件，随后也需重放本接缝。
- 原始卡片实际是否包含链接仍待真实新事件确认。尚未取得原用户卡片的新原始事件，不能声称已经抓到其中链接，也不能断言其中没有链接。
- `qq_video_read` 对仅标题输入返回 `status: missing_link` 且不发起请求，提示先调用 `qq_card_video_links`。需要搜索时显式调用 `qq_video_search` 返回 `candidates`；即使标题精确匹配，候选也不能当作原卡片指定的视频。

验证入口：`node tools/test-qq-card-links.mjs`（卡片引用缓存、显式取链及会话隔离）与 `node tools/test-bilibili-video.mjs`（仅标题输入零请求、显式搜索候选及视频读取）；模拟检查不能代替重启后真实新卡片事件验证。

## 2026-11-16：图片理解、检索与发送冷却

受限发送服务新增 `conversationKey(agent)`，从 SessionManager 返回稳定的 QQ `sessionKey`，用于隔离各会话的发送冷却。不开放任意目标发送；更新补丁并重启 DSH 后生效。

扩展提供后台图意索引、按情绪和场景检索、人工修正、可配置同图冷却和连续发送间隔。仅解析视觉流最终正文，排除 reasoning；token 截断和 provider 错误明确报错。配置页拆为收集、图片理解、发送、图库管理四个页签。

验证：`node tools/test-sticker-search-send.mjs`（20 项隔离检查，不写真实配置和图库）、`node tools/check-sticker-layout.cjs`（页签切换保持表单）。


本仓库对官方 `@tencent-connect/dsh-qqbot` 的上游接缝包括表情包收集/受限发送和卡片消息对象引用缓存；B站链接仅由显式工具调用时提取。其他功能在 `dsh-qqbot-ext/` 扩展里实现。

表情包接缝补丁以完整文件形式存在 [`patched-files/`](patched-files/)，用 [`apply-qqbot-sticker-collector-patch.mjs`](apply-qqbot-sticker-collector-patch.mjs) 应用：

```bash
node tools/apply-qqbot-sticker-collector-patch.mjs --profile ~/.dsh/profiles/desktop
```

脚本幂等，重复运行只替换已有块。**上游插件升级或重装会覆盖这些文件，需要重跑。**

---
## 官方 dsh-qqbot：表情包自动收集事件接缝（bootstrap.js）

**补丁编号**：18（替代本轮已放弃的 QFace/原生小黄脸发送接口）。

**目标插件**：`@tencent-connect/dsh-qqbot@0.5.5`，不涉及 NapCat / `dsh-onebot-qq`。

**文件**：
- `~/.dsh/profiles/desktop/node_modules/@tencent-connect/dsh-qqbot/lib/gateway/middleware-setup.js`（入站钩子）
- `~/.dsh/profiles/desktop/node_modules/@tencent-connect/dsh-qqbot/lib/gateway/bootstrap.js`（发图服务）

**改动**：在 `contentSanitizer` 之后、`concurrencyGuard` 之前插入一段轻量钩子，把 QQ 新式表情标签已转成 `【表情: …】` 的单图消息经 Cordis 事件 `qqbot/sticker-candidate` 传给扩展。事件仅含表情名、图片 MIME、CDN `url`；不透传 sender、群/用户 id 或原始 event。bootstrap.js 里另提供一个只接受图库文件名的 `qqbotExtStickerSender`（不暴露 bot / 任意路径）；已放弃的原生小黄脸发送接口已删除。

**为什么钩子不在链尾**：`concurrencyGuard` 用 `merge` 策略，同 peer 的一批消息只会放行**一个 survivor** 继续 `next()`，其余停在原地。挂在链尾等于「机器人越忙、群里聊得越热闹，漏收越多」。放到 guard 之前，每条过了 mentionGate 的消息都会经过。代价是那时 `attachmentProcessor` 还没跑、附件没落盘，所以事件传的是 CDN `url`，由扩展自己 `fetch`（带 20s 超时、按 `content-length` 和实际字节双重上限校验）。扩展同时兼容旧的 `localPath` 字段。

**踩过的坑**：发送器的目录越界校验原来写成
`localPath.startsWith(library + (win32 ? '\\\\' : '/'))`——字符串里 `'\\\\'` 是两个反斜杠，
拼出来是 `...\stickers\\`，跟真实的 `...\stickers\文件` 永远不相等，于是文件明明在图库里也报
「图库文件不存在」。现在改成 `basename(localPath) === filename && dirname(resolve(localPath)) === resolve(library)`，
再加 `statSync().isFile()` 确认。**以后路径越界一律用 dirname 比较，别再拼分隔符做前缀。**

**收集规则**：扩展只在文本含 QQ 表情标记、同条消息恰有一张图片时收集；普通图片不触发。图片字节由扩展按事件里的 `url` 自行下载（20s 超时，超限即跳过），沿用 SHA-256 去重、1KB–6MB、长边 48–2048、长宽比 ≤2.0、图库上限 300。图库位置、开关与全部阈值来自扩展自己的 `~/.dsh-qqbot-ext/config.json`（Web 设置页「QQ 表情图库」可改，保存即生效）；`qqbotExtStickerSender` 发图时也读同一份配置定位图库，用户换目录后照样能发。扩展另提供 `qq_list_stickers` / `qq_send_sticker` / `qq_sticker_status`。

**重放**：
```powershell
node tools/apply-qqbot-sticker-collector-patch.mjs
```

补丁源：`tools/patched-files/qqbot-sticker-hook-middleware-setup.js`（入站钩子）+ `tools/patched-files/qqbot-sticker-collector-hook.js`（发图服务）。重放脚本幂等：重复运行会整体替换已有块，不会像早期版本那样把注释一层层叠上去。JS 修改后必须重启 DSH。

**注意**：`pnpm install` 不会因为 `file:` 依赖内容变化就重新拷贝（lockfile 认为没变）。改完扩展要显式把改动文件复制进 `node_modules/dsh-qqbot-ext`，或删掉该目录后重装。


---
