# QQBot 官方插件本地维护版

本文约定将原独立 `dsh-qqbot-ext` 的能力整合进官方 QQBot 插件的本地维护副本，并记录已验证的安装与上游合并流程。

## 来源与版本

- 工作区：`D:/DsRebot/dsh-qqbot-ext-repo`。
- 本地维护目标：`vendor/dsh-qqbot`，基于官方 `@tencent-connect/dsh-qqbot` **0.5.5** 的本地副本。
- 统一包名：`@tencent-connect/dsh-qqbot`；集成后的本地版本：`0.5.5-local.1`。后续本地修订递增 `local` 序号，上游升级时同步调整基础版本（`integrate-qqbot.mjs` 现在从上游版本动态生成 `<上游版本>-local.1`）。
- 上游来源：https://github.com/tencent-connect/dsh-qqbot 。保留包内上游来源信息，并记录每次引入的上游版本、可获得的提交或发布包来源。pristine 0.5.5 参考副本与 tarball 在 `vendor/upstream/`。
- 上游采用 MIT 许可证。保留 `vendor/dsh-qqbot/LICENSE` 中的完整许可与 Tencent Connect 版权声明；复制、修改和分发时继续附带。不得将本地集成描述成上游官方发布。
- 功能源码仍在仓库 `dsh-qqbot-ext/`；`vendor/dsh-qqbot/ext/` 是集成脚本生成的副本（与源码逐字节一致）。改功能先改源码，再重放集成。

## 集成边界与兼容约定

本地扩展集中放入 `vendor/dsh-qqbot/ext/`，由同一个官方包名的本地维护版加载，覆盖以下能力：

- 人物扮演与相关提示词加载。
- 表情收集、索引、检索及发送冷却控制。
- B站视频按需读取与 QQ 分享卡片链接提取；需要讨论视频时才读取，封面与标题不当作视频全文。
- 扩展设置面板。
- `qqbot-ext` 预设及其配套组件。

兼容已有数据与引用：继续使用原 `~/.dsh-qqbot-ext` 配置路径，保留 `/qqbot-ext/*` 路由与原有预设 ID（包括 `qqbot-ext`）。不要因统一包名重置配置、改变数据目录或另造预设 ID。

旧独立 `dsh-qqbot-ext` bundle 已从 profile 移除（依赖与 bundle 条目均删除，`plugin_manager remove_bundle dsh-qqbot-ext`，2026-11-17）。停用不等于删除原配置和图库；仓库 `dsh-qqbot-ext/` 源码保留可恢复。

对上游 `lib/` 的改动只有五个文件（与 pristine 上游逐字节 diff 验证）：

- `lib/index.js` **保持上游原样**。功能不再塞进 im-qqbot 的 apply：拆成独立插件组件（mnemon 同构），GUI 逐组件显示与开关——`ext-sticker`（收集+图库工具+判断+索引+暂存整理+提示）、`ext-roleplay`、`ext-bilibili`、`ext-routes`，加 im-qqbot 共 5 个组件（示例工具 ext-tools、qqbot-ext 预设均已按用户要求移除；原预设独有的暂存整理工具/提示词段并入 ext-sticker 全局生效）。包装器在 `ext/lib/plugin-*.js`，显式 import 各功能并逐个 try/catch（沿用 loadFeatures 隔离语义）；网关服务一律惰性 ctx.get，不硬 inject（Cordis 事件总线按名字全局派发，无 thisArg 过滤器，跨插件可达——已核 cordis 4.1.0 src/events.ts `_resolve`）。子路径插件的 GUI 标题走各自 `./ext-<comp>/locale/*.json` 导出（host-plugin.md：子路径插件不读 package.json）。
- `lib/gateway/middleware-setup.js`：卡片消息对象引用缓存（`qqbotExtCardReader`，入站不读 raw）+ `qqbot/sticker-candidate` 事件钩子 + **熔断闸门**（均在 contentSanitizer 之后、concurrencyGuard 之前；闸门在斜杠命令/待答问题之后，熔断期间命令仍可用）。
- `lib/gateway/bootstrap.js`：`qqbotExtStickerSender`（只接受图库文件名，`conversationKey(agent)` 会话隔离）+ `qqbotExtSessionRotator`（`knownKeys()`/`rotate(key)`，供 ext-routes 人设保存路由轮换会话；不暴露 agent/bot/任意目标）。
- `lib/client.js`：上游客户端与扩展面板**合并为一次包名 id 的 `.load` 注册**（`tools/merge-qqbot-client.mjs`）。Web boot graph 每包只有一个条目（entry name == package name），简单拼接会产生第二个 `id:'dsh-qqbot-ext'` 注册——没有 boot 条目、永不激活，面板不显示（2026-11-17 实测踩坑）。合并方式：捕获两份注册对象，单 factory 依次执行上游/扩展 factory，inject 并集，apply 串联、cleanup 逆序。
- `lib/transport/outbound.js`：**模型错误拦截**（`tools/patch-error-guard.mjs`）。回合错误不再往原会话甩 `⚠️ 本轮异常结束 code: message`，改为 `ext/lib/error-guard.js` 统一处理；拦截自身异常时回退上游报错文案。成功回合（reason.kind=complete）清零熔断计数。
- `lib/session/session-manager.js`：**归档会话自动换新**（`tools/patch-archived-rotation.mjs`，2026-11-17 紧急修复）。宿主 `archived-session-gate` 拒绝归档会话的一切模型步（turn 以 blocked 结束、零请求），官方插件原本不感知归档：会话在 GUI 被归档/回档后，`getOrCreate` 仍复用缓存 record、`openSession` 仍 resume 归档 id，机器人永久静音。修复：`isArchivedSession()` 懒取 `workspaceRegistry.archivedSessionIds`（缺失/异常按未归档）；`getOrCreate` 命中归档 record 时静默 `remove()` 退役（cancel+dispose+清待答/待批+铸造新 prefs id）再走新建；`openSession` 候选归档时直接铸造新 id，不 resume。全程不往 QQ 发提示。同补丁还把 `remove()` 重构为 `removeByKey(key)`（人设轮换复用，顺带清待答/待批）并新增 `knownSessionKeys()`（活跃+prefs 存量并集）。隔离测试 `tools/test-archived-session-rotation.mjs`（10 项，需 `--experimental-vm-modules`）。

## 人设切换自动轮换会话（2026-11-17）

用户要求：总开关切换、启用状态下更换角色卡后自动新建会话，消除旧人设的上下文影响。

- `lib/roleplay.js` 新增 `affectedRoleplayKeys(previous, next, keys)`：逐 key 比较变更前后 `resolveRoleplayCard` 的卡 id，覆盖总开关、默认卡、绑定卡切换/禁用；同卡内容编辑不触发。
- `features/routes/05-roleplay.js`：保存成功后取 `ctx.get('qqbotExtSessionRotator')`（跨插件服务，同 vision-models 取 llm 的方式），对受影响 key 逐个 `rotate()`；响应带 `rotated` 计数与文案。轮换失败/服务缺失（网关未启动）不影响保存。
- `lib/gateway/bootstrap.js` 提供 `qqbotExtSessionRotator`；`SessionManager.removeByKey` 退役活跃记录并铸造新 prefs id，无活跃记录的存量 key 只改 prefs（下次消息自然新建）。绑定存在 roleplay.json 按 conversationKey 索引，轮换后保留。
- 客户端：总开关即时保存与统一保存的成功提示展示轮换计数；帮助文案改为「自动换新」。
- 测试：`tools/test-roleplay-rotation.mjs`（9 项：单元+路由集成，含降级/冲突/导入不轮换）、`test-roleplay-ui.mjs`（16 项）、`test-archived-session-rotation.mjs`（10 项）。
- **宿主 JS 改动，需重启 DSH 生效**（profile 未开模块 HMR）。

## 模型错误拦截与熔断（2026-11-17）

用户要求：错误消息全部转发管理员 QQ；原会话友好短提示；重试 3 次后自动熔断停止。

- 状态机 `dsh-qqbot-ext/lib/error-guard.js`（模块级单进程状态，配置实时读 `~/.dsh-qqbot-ext/config.json`，测试可传 cfg 覆盖）：
  - `interceptTurnError`：详情（会话 key/时间/code/message）转发管理员 c2c → 原会话发 `errorNoticeText`（留空静默）→ 连续错误计数；达到 `breakerThreshold`（默认 3）跳闸并通知管理员。跳闸中在途错误照常上报，不重复跳闸。
  - `noteTurnSuccess`：未跳闸时清零；跳闸中不做任何事（在途成功不自动恢复）。
  - `breakerGate`：跳闸后一律返回 true 拦截入站；每会话 60s 至多发一条友好提示。**无冷却、不自动恢复**（用户明确要求），只能管理员 `/resume` 合闸。
- 管理员 openid：`errorForwardOpenid`，留空回退官方配置 `access.c2cAllow[0]`（当前即大王）。
- 接线：`outbound.js` onTurnEnd（错误→interceptTurnError；complete→noteTurnSuccess；拦截异常回退上游文案）；`middleware-setup.js` 闸门在斜杠命令/待答问题/表情钩子之后、concurrencyGuard 之前。请求级瞬时重试仍由宿主 llm-retry 负责，熔断计的是「最终失败的回合」。
- 面板：新增「错误拦截」组件（总开关/提示正文/管理员 openid/阈值），独立读取、合并保存（只提交本组件字段，normalizeConfig 合并不丢其他配置）。
- 人工恢复命令：`/resume` 无参数直接合闸、`/resume status` 查状态（manualResetBreaker/breakerStatus/breakerCommand；保留 /breaker 别名与 reset 参数兼容）。**仅限管理员**：adminOnlyAuth 同步判定（SDK authorized 不 await），管理员 = errorForwardOpenid 留空回退 c2cAllow[0]，解析不出管理员 fail-closed。middleware-setup 把命令 push 进 buildCommandList 的同一数组（/bot-help 闭包可见）；命令在闸门之前，跳闸期间可用。
- 补丁重放：`tools/patch-error-guard.mjs`（outbound import+onTurnEnd 块、middleware import+闸门+命令注册，锚点漂移即抛错，幂等）；已接进 integrate；pristine 全链路重放与 vendor 逐字节一致。
- 测试：`tools/test-error-guard.mjs`（15 项）、面板 53 项（含新组件渲染/25 个恢复默认按钮）、集成测试（闸门位置+/resume 注册断言）。
- **宿主 JS 改动，需重启 DSH 生效**。

## 功能总开关实时生效（2026-11-17）

用户要求：所有功能总开关实时生效，不用二次点保存。三个总开关统一模式——切换即单独持久化该字段（服务端合并写入，不带未保存草稿），成功更新本地基线，失败回滚开关并提示「开关保存失败（未生效）」：

- 人设「启用角色扮演」：基于已保存快照 POST 全量 config（roleplay 路由是全量+revision 语义），附带会话自动轮换。
- 表情「自动收集」：POST `{config:{enabled}}`；不替换 data.config 对象（useEffect 会重置表单丢草稿），只同步 capabilities.autoCollect。
- 错误拦截「启用错误拦截」：POST `{config:{errorGuardEnabled}}`，更新 saved 基线该字段。
- 子选项仍走草稿+统一保存。测试 `tools/test-master-switches.mjs`（5 项）。纯客户端改动，刷新页面生效。

`cordis.patch.yml` 追加 5 行独立组件插件行（sticker/roleplay/bilibili/routes，预设行已删）；`package.json` 增加 4 个组件的运行时导出 + 各自 `locale/*.json` 导出、`files` 含 `ext`、版本与描述本地化。

## 安装与生效检查（2026-11-17 已验证）

**依赖布局是关键**：profile 用 `link:` 指向 vendor，`link:` 不安装被链接包的依赖；DSH 加载器对本地 `link:`/`file:` 依赖直接从源目录导入模块。因此 vendor 必须自带 `node_modules`：

1. 在 `vendor/dsh-qqbot` 里用 **DSH 自带 pnpm 11**（`C:\Users\10340\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs`）装运行时依赖：

   ```powershell
   node <上述 pnpm.cjs> install --prod --ignore-scripts --store-dir D:\DsRebot\dsh-qqbot-ext-repo\.pnpm-store
   ```

   - `pnpm-workspace.yaml` 本地追加了 `nodeLinker: hoisted` 与 `autoInstallPeers: false`。**必须 hoisted**：isolated 布局下 Windows junction 的 realpath 行为会让 ESM 向上查找漏掉虚拟 store 里的兄弟依赖（实测 `qqbot-nodejs` 找不到 `ws`）。
   - `@deepseek-ai/*` 宿主包由 DSH 安装层拦截解析，不在本地装（避免宿主包双实例）。`silk-wasm`/`mpg123-decoder` 是 SDK 可选语音 peer，懒加载，需要语音编码时再装。
   - PATH 上的 pnpm 12 的全局 store 操作锁（`%LOCALAPPDATA%\pnpm-store-operation-locks`）在 workspace-write 沙箱下不可写且无法用配置改道；用 DSH 自带 pnpm 11 + 工作区 store 绕过，全部写入都在工作区内。
   - 改布局后重装要先删 `vendor/dsh-qqbot/node_modules`（pnpm 见 lockfile 未变会 "Already up to date" 不重建）。

2. 用 `plugin_manager` 安装本地目录（**裸目录路径 → `link:`**）：

   ```json
   { "action": "install_bundle", "target": "D:/DsRebot/dsh-qqbot-ext-repo/vendor/dsh-qqbot" }
   ```

   替换已有安装时先 `remove_bundle`（HMR 下 `install_bundle` 对已安装依赖直接拒 `already-installed`）。以 receipt 为准；本次 `application: applied`，im-qqbot 经 HMR 直接激活，无需重启。

3. **不要用 `file:` 协议**：pnpm 11 + hoisted 会把 `file:` 目录依赖的源码**整个搬进** profile 的 `node_modules`（按 `files` 打包后清空源目录）。本次实测 vendor 被清空，靠安装副本还原 + 上游 tarball 补齐开发文件才恢复。`link:` 不动源码。

4. 验收（本次结果）：
   - `list_plugins`：`include:im-qqbot` 与 6 个 `include:dsh-qqbot-ext-*` 组件均 `fiberPhase: active`。
   - `GET /qqbot/im-qqbot/bind` → `{"phase":"bound","appId":"1906376603"}`；`GET /qqbot/im-qqbot/config` 返回原 profile 配置（requireMention、access allowlist 等不变）。
   - `GET /qqbot-ext/config` 返回原 `~/.dsh-qqbot-ext/config.json`（图库 `D:\临时文件\picture`、判断/索引模型、冷却 30s/间隔 10s 等全部保留），组件 4 个（sticker-library/roleplay/bilibili-video/error-guard）。
   - `qq_list_stickers` 工具可调用（宿主功能装载正常）。
   - 隔离测试：`test-integrated-qqbot.mjs`（需 `--experimental-vm-modules`）、`test-archived-session-rotation.mjs`（10 项，需 `--experimental-vm-modules`）、`test-roleplay-rotation.mjs`（9 项）、`test-error-guard.mjs`（15 项）、`test-master-switches.mjs`（5 项）、`verify-qqbot-ext-panel.mjs`（53 项）、`test-sticker-search-send.mjs`（20 项）、`test-qq-card-links.mjs`（13 项）、`test-bilibili-video.mjs`（15 项）、`test-card-inbox.mjs`、`test-roleplay.mjs`（24 项）、`test-roleplay-ui.mjs`（16 项）、`check-sticker-layout.cjs` 全过。
   - **未验证**：真实 QQ 消息收发、表情收集/发送、卡片取链的真实新事件；浏览器面板渲染（无浏览器控制，客户端代码已拼接安装，GUI 刷新后实看）。安装 receipt 只证明安装与激活，不替代功能验收。

## 上游更新流程

1. 将新上游版本取到独立的新目录（`npm pack @tencent-connect/dsh-qqbot@<版本>`，沙箱下加 `--cache <工作区目录>`），保留当前可用维护副本。先比较上游版本差异，再比较本地补丁；不要直接覆盖当前 `vendor/dsh-qqbot`。
2. 在新副本上跑 `node tools/integrate-qqbot.mjs`（脚本拒绝已集成副本、校验上游锚点；锚点变了先修脚本差异，不把手工残缺结果当成集成成功）。脚本恢复 `ext/`、`lib/` 加载点、客户端拼接、bundle patch、导出、locale meta、本地 `pnpm-workspace.yaml` 设置与版本号，并重放归档轮换（patch-archived-rotation.mjs）与错误拦截/熔断（patch-error-guard.mjs）。
3. 按上节 provision 依赖；运行全部隔离测试；`lib/` 对 pristine 上游 diff 应只有五个集成文件。核对原配置路径、`/qqbot-ext/*` 路由无重复加载。预设已整体移除（2026-11-18），不再有标准行复刻漂移问题；若未来要恢复预设，须按新版 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 重新核对标准行。
4. 验证通过后才更新维护目标：`remove_bundle` 旧安装 → `install_bundle` 裸目录（link:）。按 receipt 执行重启或其他后续步骤，再检查实际运行结果。
5. 保留更新前的维护副本、集成脚本及配置备份，以便问题复现与回退。维护记录区分“文件已修改”“验证通过”“安装完成”和“运行验收通过”。