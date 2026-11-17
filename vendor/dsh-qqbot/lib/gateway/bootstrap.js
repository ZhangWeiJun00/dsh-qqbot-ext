import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { SessionManager } from "../session/index.js";
import { handleInbound, createOutboundHandler } from "../transport/index.js";
import { parseStreamFrame } from "../transport/events.js";
import { ReplyLimiter } from "../transport/reply-limiter.js";
import { cacheMsgId, cacheEventId } from "../transport/msgid-cache.js";
import { resolveReplyTarget, sendResolvedMarkdown } from "../transport/reply-target.js";
import { QuestionChannel } from "../features/question-channel.js";
import { ApprovalChannel } from "../features/approval-channel.js";
import { decodeButtonData } from "../features/button-utils.js";
import { buildUserAgent } from "../shared/index.js";
import { setupMiddlewares } from "./middleware-setup.js";
import { startMediaCleanup } from "../media/media-cleaner.js";
import { ensureVisionInputModal, registerDescribeImageTool } from "../media/vision-tool.js";
import { registerSendFileTool } from "../media/send-file-tool.js";
import { DeliverablesDeliverer } from "../transport/deliverables.js";
/**
 * interaction 统一分发器：按 button_data 的顶层 `t` 判别字段，路由到对应
 * channel（question / approval）。QQ 只有一个 interaction 入口，集中路由
 * 避免多通道各自 try 导致误判。
 */
function dispatchInteraction(event, manager) {
    const raw = event.data?.resolved?.button_data;
    if (!raw)
        return false;
    const button = decodeButtonData(raw);
    if (!button)
        return false;
    if (button.t === 'question')
        return manager.questionChannel?.handleInteraction(event) ?? false;
    if (button.t === 'approval')
        return manager.approvalChannel?.handleInteraction(event) ?? false;
    return false;
}
export async function bootstrapGateway(ctx, agents, config, logger) {
    const manager = new SessionManager(ctx, agents, config, logger);
    // ── 初始化 QQ Bot SDK ──
    const userAgent = buildUserAgent();
    const bot = new QQBot({
        appId: config.appId,
        appSecret: config.appSecret,
        transport: 'websocket',
        baseUrl: process.env.QQBOT_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
        tokenBaseUrl: process.env.QQBOT_TOKEN_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
        userAgent,
        logger,
    });
    logger.info(`QQBot SDK initialized (UA: ${userAgent})`);
    // ── 中间件链 ──
    setupMiddlewares(bot, config, manager, logger);
    // ── 入站：经过中间件链后的消息交给 dsh agent ──
    bot.on('message', async (mCtx) => {
        const msg = mCtx.message;
        // 记录最近 msgId，供无上下文的出站发送（文件发送显式 target、主动推送等）获取被动回复目标
        cacheMsgId(mCtx.replyTarget.scope, mCtx.replyTarget.targetId, mCtx.replyTarget.msgId);
        if (config.debug) {
            logger.debug(`← message (post-middleware): ${JSON.stringify(msg, null, 2).slice(0, 500)}`);
        }
        await handleInbound(mCtx, manager, config, logger);
    });
    // ── 出站：dsh session/event → QQ 消息 ──
    // 获取 tools 服务（工具结果结构化展示），可选
    let toolsRegistry;
    try {
        toolsRegistry = ctx.get('tools');
    }
    catch {
        toolsRegistry = undefined;
    }
    // 发送适配器：将 QQBot 实例适配为 QQBotSender（openStream 参数形态不同）。
    // sendMarkdown 统一做被动回复限额管控：同一 msgId 超限/过期时降级主动推送。
    const replyLimiter = new ReplyLimiter({ limit: 4 });
    const sender = {
        sendMarkdown: (target, content, opts) => sendResolvedMarkdown(bot, resolveReplyTarget(target, replyLimiter, true), content, opts),
        openStream: (target) => bot.openStream({
            target: {
                scope: target.scope,
                targetId: target.targetId,
                msgId: target.msgId,
            },
        }),
    };
    // ── 附件发送适配器（qqbot_send_file 工具与交付物投递共用） ──
    // 包装 bot：让文件发送也走 msgId 兜底 + 被动回复限额管控。
    // 注意：SDK 文件发送暂不支持 event_id，故 allowEvent=false，跳过 event 候选。
    const mediaSender = {
        sendImage: (target, source) => bot.sendImage(resolveReplyTarget(target, replyLimiter, false), source),
        sendVideo: (target, source) => bot.sendVideo(resolveReplyTarget(target, replyLimiter, false), source),
        sendVoice: (target, source) => bot.sendVoice(resolveReplyTarget(target, replyLimiter, false), source),
        sendFile: (target, source, opts) => bot.sendFile(resolveReplyTarget(target, replyLimiter, false), source, opts),
    };
// Source patch for @tencent-connect/dsh-qqbot/lib/gateway/bootstrap.js.
// Inserted after the `mediaSender` declaration and before DeliverablesDeliverer.
//
// The inbound sticker hook lives in middleware-setup.js instead (it must sit
// before the concurrency guard), so this block only exposes the sender.
// Filename-constrained sender: no caller-provided paths and no exposed bot object.
// The library directory follows the extension's own config.json so a user-moved
// library keeps working without another upstream edit.
ctx.provide('qqbotExtStickerSender', {
    conversationKey(agent) {
        const entry = manager.findByAgent(agent);
        if (!entry?.replyTarget) throw new Error('qqbotExtStickerSender: 无法确定当前 QQ 会话目标');
        // Use the manager's stable session key, including QQ scope/peer.
        return entry.sessionKey;
    },
    async send(agent, filename) {
        if (typeof filename !== 'string' || !/^[a-f0-9]{40}\.(png|jpe?g|gif|webp)$/.test(filename)) {
            throw new Error('qqbotExtStickerSender: 非法图库文件名');
        }
        const { existsSync, readFileSync, statSync } = await import('node:fs');
        const { basename, dirname, join, resolve } = await import('node:path');
        const { homedir } = await import('node:os');
        const home = join(homedir(), '.dsh-qqbot-ext');
        let library = join(home, 'stickers');
        try {
            const parsed = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
            if (typeof parsed.libraryDir === 'string' && parsed.libraryDir.trim() !== '') {
                library = resolve(parsed.libraryDir
                    .replace(/^~(?=$|[\\/])/, homedir())
                    .replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole));
            }
        } catch {
            // Missing or malformed config keeps the default location.
        }
        const localPath = join(library, filename);
        // Containment by dirname comparison, never by string prefix: joining a
        // separator onto a Windows path and comparing prefixes silently produces
        // a doubled backslash and reports existing files as missing.
        const contained = basename(localPath) === filename
            && dirname(resolve(localPath)) === resolve(library);
        let isFile = false;
        try {
            isFile = existsSync(localPath) && statSync(localPath).isFile();
        } catch {
            isFile = false;
        }
        if (!contained || !isFile) {
            throw new Error(`qqbotExtStickerSender: 图库里没有这个文件：${localPath}`);
        }
        const target = manager.findByAgent(agent)?.replyTarget;
        if (!target) throw new Error('qqbotExtStickerSender: 无法确定当前 QQ 会话目标');
        return mediaSender.sendImage(target, { localPath });
    },
});
// Local maintenance: roleplay-change session rotation (consumed by the ext-routes
// roleplay save route). Exposes known-key enumeration and per-key rotation only;
// no agent, bot, or arbitrary session target is exposed.
ctx.provide('qqbotExtSessionRotator', {
    knownKeys() { return manager.knownSessionKeys(); },
    async rotate(key) { await manager.removeByKey(key); },
});

    // 交付物投递：present 声明的文件在轮末发送到当前会话（outbound 路由触发）
    const deliverablesDeliverer = new DeliverablesDeliverer(sender, mediaSender, config, logger);
    const outbound = createOutboundHandler(manager, sender, config, logger, toolsRegistry, deliverablesDeliverer);
    ctx
        .on('session/event', outbound.routeSessionEvent);
    // ── 出站流式：agent/assistant-stream → 流式帧路由 ──
    // 实时流式走瞬态 agent/assistant-stream（chunk 不进 session log）。
    // 该事件按 agent 作用域派发，根作用域监听器不带 global 会被过滤（同
    // approval/request），帧到达后自行按 agent.id 路由，非 QQ 会话在 router 内忽略。
    ctx
        .on('agent/assistant-stream', (payload) => {
        const parsed = parseStreamFrame(payload);
        if (parsed !== undefined)
            outbound.routeStreamFrame(parsed.agentId, parsed.delta);
    }, { global: true });
    // ── 问答通道（ask_user_question → QQ 文本 + 按钮） ──
    const questionChannel = new QuestionChannel(manager, sender, config, logger);
    manager.questionChannel = questionChannel;
    questionChannel.install(ctx);
    // ── 审批通道（approval/request → QQ 两按钮审批） ──
    const approvalChannel = new ApprovalChannel(manager, sender, config, logger);
    manager.approvalChannel = approvalChannel;
    approvalChannel.install(ctx);
    // ── 按钮点击回调（interaction）：统一分发到问答/审批通道 ──
    bot.on('interaction', async (_iCtx, event) => {
        // scope/targetId 推导对齐消息事件（inbound.ts）：按 scene 判定类型，群用 group_openid，私聊用 user_openid
        const scope = event.scene === 'group' ? 'group' : 'c2c';
        const targetId = scope === 'group' ? (event.group_openid ?? event.user_openid) : event.user_openid;
        // 记录互动事件 id，作为后续被动回复候选（event_id）
        cacheEventId(scope, targetId, event.id);
        const matched = dispatchInteraction(event, manager);
        await bot.acknowledgeInteraction(event.id, matched ? 0 : 3).catch(() => { });
    });
    bot.on('error', (err) => {
        logger.error(`bot error: ${err instanceof Error ? err.message : String(err)}`);
    });
    // 掉线可观测：willReconnect=false 表示不会再重连（随后 bot.start() 的 Promise 会失败）。
    // disconnected 事件为 SDK 1.0.5+ 新增：旧版 handlers 表缺该键，bot.on 会抛
    // TypeError（profiles 增量安装可能残留旧版 SDK）——降级为跳过监听而非崩溃
    try {
        bot.on('disconnected', (event) => {
            const detail = `code=${event.code}${event.reason ? ` reason=${event.reason}` : ''}`;
            if (event.willReconnect) {
                logger.warn(`Bot disconnected (${detail}), reconnecting...`);
            }
            else {
                logger.error(`Bot disconnected permanently (${detail}), giving up`);
            }
        });
    }
    catch (err) {
        logger.warn(`qqbot-nodejs SDK 不支持 disconnected 事件（请升级 @tencent-connect/qqbot-nodejs 至 1.0.5+）: ${err instanceof Error ? err.message : String(err)}`);
    }
    bot.on('ready', () => {
        console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
    });
    // ── 富媒体过期清理 ──
    if (config.media.enabled) {
        startMediaCleanup(ctx, config.media.ttlHours, logger);
    }
    // ── 视觉工具注册（qqbot_describe_image，复用 dsh llm + attachments） ──
    ensureVisionInputModal(config.vision, logger);
    registerDescribeImageTool(ctx, config.vision, logger);
    // ── 附件发送工具注册（qqbot_send_file，发送器见上方 mediaSender） ──
    registerSendFileTool(ctx, mediaSender, manager, config, logger);
    // ── 生命周期 ──
    ctx
        .effect(() => {
        logger.info(`Starting bot (appId=${config.appId})`);
        bot.start().catch((err) => {
            logger.error(`Bot start failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return async () => {
            logger.info('Shutting down');
            await manager.disposeAll();
            bot.stop();
        };
    }, 'im-qqbot.lifecycle');
}
//# sourceMappingURL=bootstrap.js.map