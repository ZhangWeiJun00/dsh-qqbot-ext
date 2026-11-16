# dsh-qqbot-ext

[DSH](https://github.com/deepseek-ai)（DeepSeek Harness）QQ 机器人扩展包。

挂在官方 [`@tencent-connect/dsh-qqbot`](https://www.npmjs.com/package/@tencent-connect/dsh-qqbot) 的标准扩展点上，
不改上游源码就能加自己的工具、提示词段、Web 配置页和 Agent 预设。

零依赖、免构建：不 import 任何 `@deepseek-ai/*` 内部包，纯对象注册。

## 主要功能

### 表情包图库

自动把群友发的 QQ 表情收进本地图库，之后可以自己发出去。

- **两种收集方式**
  - **全收**：过了过滤条件（大小、尺寸、长宽比、格式）直接入图库
  - **模型判断**：先落暂存区，看过图觉得有意思才收进图库
- **后台自动判断**：配好视觉模型后，新表情自动排队交给模型逐张看，
  按你写的判定提示词决定收还是丢。**审美标准不写死在代码里**，全在提示词里，
  接人格/人设模块只改那段文字即可
- **视觉模型自动探测**：从宿主 `llm` 服务读出已注册的 provider 和模型，
  只把声明了图片输入的列进下拉框，不用手抄 model id
- **Web 配置页**：图库路径（带系统目录选择器和「打开目录」）、阈值、收集方式、
  判定提示词全都能在面板里改，保存即生效不用重启
- 同一张图按 SHA-256 去重；图库有张数上限

### 工具

| 工具 | 作用 |
| --- | --- |
| `qq_list_stickers` | 列出图库里的表情 |
| `qq_send_sticker` | 把图库里某张表情发到当前会话 |
| `qq_sticker_status` | 看收集开关、模式、张数和统计 |
| `qq_sticker_pending` | 列出暂存区里等判断的表情 |
| `qq_sticker_keep` | 把暂存的表情收进图库 |
| `qq_sticker_drop` | 丢掉暂存的表情 |

## 安装

```bash
# 1. clone 到任意位置
git clone <本仓库地址> dsh-qqbot-ext-repo

# 2. 在 DSH profile 的 package.json 里加依赖和 bundle
#    dependencies:      "dsh-qqbot-ext": "file:<你 clone 的路径>/dsh-qqbot-ext"
#    dsh.profile.bundles: 加上 "dsh-qqbot-ext"

# 3. 在 profile 目录安装并重启 DSH
pnpm install
```

细节与目录结构见 [`dsh-qqbot-ext/README.md`](dsh-qqbot-ext/README.md)。

> **注意**：表情包的**收集**需要给上游 `dsh-qqbot` 打一个入站接缝补丁——
> 在 `contentSanitizer` 之后、`concurrencyGuard` 之前插一个钩子。
> 不打补丁的话图库、发送、面板都能用，但不会自动收新表情。
> 原因见 [`tools/PATCHES.md`](tools/PATCHES.md)。

## 打补丁（可选）

```bash
# 默认改 ~/.dsh/profiles/desktop；别的 profile 用 --profile 指定
node tools/apply-qqbot-sticker-collector-patch.mjs --profile ~/.dsh/profiles/myprofile
```

脚本是幂等的，重复运行只会把已有块替换成最新版，不会叠加。
**上游插件升级/重装会覆盖这些文件，需要重跑。**

## 自检

```bash
node tools/verify-qqbot-ext-panel.mjs
```

53 项检查，覆盖面板渲染、配置接口、视觉模型探测、打开目录的安全边界、
表情收集与去重、暂存区生命周期、判定提示词解析等。

脚本会读写真实的 `~/.dsh-qqbot-ext/config.json`（配置读写本来就该测真的），
所以它开头备份、结尾逐字节还原，断言失败也会走还原钩子。

## 关于补丁的取舍

为什么不 fork 上游：`dsh-qqbot` 还在频繁更新，fork 之后每次同步都是场灾难。
所以功能全部放在本扩展里，只有**躲不开的内部接缝**才打最小补丁，
补丁内容以完整文件形式存在 `tools/patched-files/`，便于审阅和重放。

## License

[MIT](LICENSE)
