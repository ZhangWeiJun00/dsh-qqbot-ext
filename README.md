# dsh-qqbot-ext

[DSH](https://github.com/deepseek-ai)（DeepSeek Harness）QQ 机器人扩展。

> **当前形态：本地维护的统一包。** 扩展功能已整合进本地维护的官方插件发行包
> `vendor/dsh-qqbot`（`@tencent-connect/dsh-qqbot@0.5.5-local.1`，`link:` 安装），
> 功能按域拆成**独立插件组件**，在 DSH 插件页逐个显示、逐个开关（与 mnemon 记忆系统同构）。
> 本目录 `dsh-qqbot-ext/` 是功能源码，`vendor/dsh-qqbot/ext/` 由 `tools/integrate-qqbot.mjs`
> 生成（逐字节一致）。本机维护、安装与上游合并见 [`tools/LOCAL-QQBOT.md`](tools/LOCAL-QQBOT.md)。
> 下面的独立安装流程（install.mjs）仅适用于其他机器/profile 的遗留方式。

挂在官方 [`@tencent-connect/dsh-qqbot`](https://www.npmjs.com/package/@tencent-connect/dsh-qqbot)
的标准扩展点上。零依赖、免构建：不 import 任何 `@deepseek-ai/*` 内部包，纯对象注册。

## 组件结构（统一包）

| 组件 | 内容 |
| --- | --- |
| `im-qqbot` | 官方收发主插件（上游原样） |
| `ext-sticker` | 表情图库：自动收集 + 检索/发送 + 后台判断 + 图片理解 + 暂存整理 |
| `ext-roleplay` | 人物扮演：人设卡注入、切换自动轮换会话 |
| `ext-bilibili` | B站视频只读浏览 + 分享卡片按需取链 |
| `ext-memory` | Mnemon QQ 记忆来源：按会话召回、成功回合后自动提炼、成员档案工具 |
| `ext-routes` | Web 配置页的本地路由（`/qqbot-ext/*`） |

每个组件有自己的 GUI 标题/简介与开关；网关服务一律惰性 `ctx.get`，网关未绑定时组件照常加载。
**Agent 预设已移除**——核心功能全是全局组件，不依赖预设；原预设独有的暂存整理工具与提示词段
并入 `ext-sticker` 全局生效。上游 `lib/index.js` 保持原样，对上游的改动只有 5 个接缝文件
（见 [`tools/PATCHES.md`](tools/PATCHES.md)）。

## 主要功能

### 表情包图库

自动把群友发的 QQ 表情收进本地图库，之后可以自己发出去。

- **两种收集方式**：全收（过过滤条件直接入库）／模型判断（先落暂存区，看过才收）
- **后台自动判断**：配好视觉模型后新表情排队逐张看，按你写的判定提示词决定收丢；审美标准全在提示词里
- **视觉模型自动探测**：从宿主 `llm` 服务读已注册模型，只列声明图片输入的，不用手抄 model id
- **检索发送**：按图中文字/情绪/场景搜表情，带同图冷却与连续发送间隔
- **Web 配置页**：图库路径、阈值、收集方式、判定提示词面板里改，总开关实时生效
- SHA-256 去重、张数上限

### 人物扮演

导入/编辑人设卡（原生 JSON 与 Tavern v1/v2/v3），设默认角色或按群/私聊绑定；
「启用角色扮演」总开关实时生效；切换开关或角色卡时自动轮换受影响会话，旧人设历史不残留。

### B站视频浏览

只读读取标题/UP主/简介/分P/公开字幕/热评/弹幕；支持链接、BV/av 号、整条分享卡片；
卡片链接按需读取（不默认展开 raw）；搜索候选需确认。不做画面/语音识别，登录限制如实标注。

### 错误拦截 + 熔断

模型回合出错给原会话友好短提示（可配/留空静默），技术详情转发管理员私聊；
连续错误自动熔断停发，**无冷却不自动恢复**，仅管理员 `/resume` 人工合闸（`/resume status` 查状态）。

### 记忆联动（ext-memory）

让机器人拥有跨会话/跨归档的长期记忆，按 QQ 会话（peer）作用域隔离：

- **真正的 Mnemon Source**：注册 `qq-peer-memory` 来源，由 Mnemon View 投影当前 QQ 会话的成员档案与长期事实，提供检索与写入 Action；没有安装/启用 Mnemon 时组件等待依赖，不伪装联动成功。
- **自动沉淀**：成功回合后只读取本轮用户文本，调用一次当前会话模型提炼至多 3 条长期偏好/事实；要求原文依据，忽略秘密与临时内容。失败不落库，不把原始聊天记录存入记忆文件。可关闭 `captureEnabled` 或指定提炼模型。
- **成员档案与显式写回**：`qq_member_note` 管理外号/偏好；`qq_remember` 管理精炼事实。服务端根据真实 Agent 绑定确定群/私聊，参数不能指定其他会话。
- **权限边界**：QQ 组件自己的 `writeEnabled` 控制工具及自动提炼全部写入口；Mnemon View Action 还受 Mnemon 的写入总策略控制。仅关闭 Mnemon 的写入开关不会关闭 QQ 独立工具/后台沉淀，需同时关闭 QQ 写入或禁用组件。
- **隔离与组合**：组件使用 Mnemon `selection` 扩展，QQ View 仅选择 QQ 来源，不混入桌面全局记忆；非 QQ 回合保留其他已支持来源。它占用唯一 selection 槽，与另一 selection/scoped 扩展同时启用会报组合冲突。非 QQ 回合也走 Mnemon 的显式选择组合，提示与预算分配可能变化。
- 持久化在 `~/.dsh-qqbot-ext/memory.json`，事务串行、原子替换；损坏文件明确报错，不覆盖空库。此来源不把数据自动镜像到现有 Mnemon Native/OpenViking 记忆空间。

## 工具

| 工具 | 作用 |
| --- | --- |
| `qq_list_stickers` | 列出图库里的表情 |
| `qq_search_stickers` | 按文字/情绪/场景搜表情 |
| `qq_send_sticker` | 把图库里某张表情发到当前会话 |
| `qq_sticker_status` | 看收集开关、模式、张数和统计 |
| `qq_sticker_pending` | 列出暂存区里等判断的表情 |
| `qq_sticker_keep` | 把暂存的表情收进图库 |
| `qq_sticker_drop` | 丢掉暂存的表情 |
| `qq_card_video_links` | 按需读取当前会话分享卡片的 B站链接 |
| `qq_video_read` | 只读浏览 B站视频元信息/字幕/热评/弹幕 |
| `qq_video_search` | 搜索 B站视频候选 |
| `qq_member_note` | 记/查/删当前会话成员档案（外号/喜好/雷点） |
| `qq_remember` | 存/删/列当前会话的长期事实 |

## 安装（统一包，本机）

```bash
# vendor 需自带依赖（link: 不装依赖）：用 DSH 自带 pnpm 11 + 工作区 store
node <dsh-runtimes>/dependencies/pnpm/bin/pnpm.cjs install --prod --ignore-scripts --store-dir <repo>/.pnpm-store
# 替换安装：先 remove_bundle 再 install_bundle 裸目录，然后重启 DSH
```

详见 [`tools/LOCAL-QQBOT.md`](tools/LOCAL-QQBOT.md)。**禁用 `file:` 协议**（pnpm 11 hoisted 会搬空 vendor 源码）。

## 发布包 / GitHub 一键安装

统一包**本身就是自包含、补丁已内置的可发布包**：5 个接缝补丁直接写在 `lib/` 里（安装时无需再打），
`ext/` 功能、`assets/`、locale、依赖声明全部随包携带，结构与官方包一致。

仓库**根目录已是一个可安装的 bundle**（根 `package.json`/`cordis.patch.yml` 由
`tools/make-root-package.mjs` 生成、委托到 `vendor/dsh-qqbot`，integrate 时自动同步）。
所以在「添加插件」里**直接输仓库地址即可，无需子目录**：

```
github:ZhangWeiJun00/dsh-qqbot-ext
# 或
https://github.com/ZhangWeiJun00/dsh-qqbot-ext
```

pnpm 会安装根包并自动装它声明的依赖；`@deepseek-ai/*` peer 由 DSH 宿主提供，不用手装。
（仍兼容 `#path:vendor/dsh-qqbot` 指向子目录的写法。）

**或打 tarball 分发**：在仓库根或 `vendor/dsh-qqbot` 跑 `pnpm pack`，产物 `*.tgz` 可在添加插件里以
路径/URL 安装。已用隔离目录验证：根包与子目录包均安装成功（37 个包、`ws` 可解析、补丁与 ext 均在包内）。

> 本机维护仍推荐 `link:`（改源码即生效）；GitHub/tarball 方式适合分发到其他机器。

## 安装（独立 bundle，遗留方式）

```bash
git clone git@github.com:ZhangWeiJun00/dsh-qqbot-ext.git
cd dsh-qqbot-ext
node install.mjs --dry-run   # 先看看它会做什么
node install.mjs             # 真正安装
```

自动找 profile、加依赖/bundle、跑 `pnpm install`、给上游打表情收集补丁；幂等。
常用参数：`--profile <目录>`、`--no-patch`、`--dry-run`。之后重启 DSH。

> 表情**收集**需要给上游 `dsh-qqbot` 打入站接缝钩子（`contentSanitizer` 后、`concurrencyGuard` 前）。
> 不打补丁则图库/发送/面板可用但不自动收。见 [`tools/PATCHES.md`](tools/PATCHES.md)。

## 自检

```bash
node tools/verify-qqbot-ext-panel.mjs        # 面板 53 项
node --experimental-vm-modules tools/test-integrated-qqbot.mjs   # 统一包接线/组件
```

另有 sticker/roleplay/error-guard/归档轮换/card-links/bilibili 等隔离测试套件。
面板脚本读写真实 `~/.dsh-qqbot-ext/config.json`，开头备份、结尾逐字节还原。

## 上游合并

取 pristine 新版 → `tools/integrate-qqbot.mjs` 重放（组件行/导出/locale 自动生成、接缝补丁、
客户端单注册合并）→ provision 依赖 → 全套测试 + 对上游 5 文件 diff → remove/install → 重启验收。
不直接覆盖 vendor，保留 MIT LICENSE 与上游来源。详见 [`tools/LOCAL-QQBOT.md`](tools/LOCAL-QQBOT.md)。

## License

[MIT](LICENSE)。上游 `@tencent-connect/dsh-qqbot`  likewise MIT，来源与版本见
[`vendor/dsh-qqbot/LOCAL-MAINTENANCE.md`](vendor/dsh-qqbot/LOCAL-MAINTENANCE.md)。