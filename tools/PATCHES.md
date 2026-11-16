# 上游补丁说明

## 2026-11-16：图片理解、检索与发送冷却

受限发送服务新增 `conversationKey(agent)`，从 SessionManager 返回稳定的 QQ `sessionKey`，用于隔离各会话的发送冷却。不开放任意目标发送；更新补丁并重启 DSH 后生效。

扩展提供后台图意索引、按情绪和场景检索、人工修正、可配置同图冷却和连续发送间隔。仅解析视觉流最终正文，排除 reasoning；token 截断和 provider 错误明确报错。配置页拆为收集、图片理解、发送、图库管理四个页签。

验证：`node tools/test-sticker-search-send.mjs`（20 项隔离检查，不写真实配置和图库）、`node tools/check-sticker-layout.cjs`（页签切换保持表单）。


本仓库只包含一个上游补丁：给官方 `@tencent-connect/dsh-qqbot` 加表情包收集的入站接缝。
其余功能全部在 `dsh-qqbot-ext/` 扩展里实现，不需要改上游。

补丁以完整文件形式存在 [`patched-files/`](patched-files/)，用 [`apply-qqbot-sticker-collector-patch.mjs`](apply-qqbot-sticker-collector-patch.mjs) 应用：

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
