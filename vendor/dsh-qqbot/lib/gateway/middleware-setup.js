import { createCardInbox } from '../../ext/lib/qq-card-inbox.js';
import { breakerGate, breakerCommand, adminOnlyAuth } from '../../ext/lib/error-guard.js';
import { errorHandler, messageFilter, accessPolicy, mentionGate, contentSanitizer, rateLimiter, slashCommand, concurrencyGuard, typingIndicator, quoteRef, historyBuffer, envelopeFormatter, } from '@tencent-connect/qqbot-nodejs';
import { buildCommandList } from "../commands/index.js";
import { attachmentProcessor } from "../middleware/attachment.js";
import { questionAnswer } from "../middleware/question-answer.js";
import { getHistoryStore, historyGroupKey } from "../features/history-store.js";
export function setupMiddlewares(bot, config, manager, logger) {
    // 1. 错误兜底（最外层洋葱皮）
    bot.use(errorHandler());
    // 2. 消息过滤：bot 回声 + 消息去重
    bot.use(messageFilter({ skipSelfEcho: false }));
    // 3. 访问控制（空名单 = 拒绝所有人，fail-closed）
    bot.use(accessPolicy({
        c2c: {
            mode: config.access.c2cMode,
            allow: config.access.c2cAllow,
        },
        group: {
            mode: config.access.groupMode,
            allow: config.access.groupAllow,
        },
        onBlock: (_mCtx, reason) => {
            if (config.debug) {
                logger.debug(`Access blocked: ${reason}`);
            }
        },
    }));
    // Local QQ: bounded references; raw is accessed by explicit tool calls only.
    const cardInbox = createCardInbox();
    manager.ctx.provide('qqbotExtCardReader', {
        read(agent, messageId) {
            const record = manager.findByAgent(agent);
            if (!record?.sessionKey) throw new Error('无法确定当前QQ会话');
            return cardInbox.read(record.sessionKey, messageId);
        },
    });
    bot.use(async (mCtx, next) => {
        const msg = mCtx.message;
        const scope = msg.kind === 'group' ? 'group' : 'c2c';
        const peer = scope === 'group' ? msg.groupOpenid : msg.senderId;
        if (peer) cardInbox.capture('qqbot:' + config.appId + ':' + scope + ':' + peer, msg);
        await next();
    });
    // 4. 群历史缓冲 — 放在门控之前，确保所有消息（含未 @bot）都计入上下文
    //    store 走共享单例（getHistoryStore），groupKey 带 appId 前缀，供回复后清空
    bot.use(historyBuffer({
        limit: config.historyLimit,
        store: getHistoryStore(),
        recordOnSkip: true,
        groupKey: (ctx) => {
            const gid = ctx.message.groupOpenid;
            if (ctx.message.kind !== 'group' || !gid)
                return undefined;
            return historyGroupKey(config.appId, gid);
        },
    }));
    // 5. 群聊 @bot 门控
    bot.use(mentionGate({
        requireMentionInGroup: config.requireMention,
    }));
    // 6. 内容清洗（去 @marker、表情标签、多余空白）
    bot.use(contentSanitizer({
        parseFaceTags: true,
    }));
    // 7. 三层限流（sender / group / global）
    bot.use(rateLimiter());
    // 8. 斜杠命令（在 concurrencyGuard 之前，命令匹配后不排队直接响应）
    // 本地维护：熔断人工合闸命令（/resume 立即恢复，/resume status 查状态）。
    const commandList = buildCommandList({ manager, config, logger });
    commandList.push(breakerCommand({ config, logger, authorized: adminOnlyAuth({ config, logger }) }));
    const slash = slashCommand({
        // 关闭 autoHelp：help 命令由 qqbot 注册为 /bot-help，
        // 避免 SDK 再自动注册一个无前缀的 /help 造成重复
        autoHelp: false,
        commands: commandList,
    });
    bot.use(slash.middleware);
    // 8.5. 待答问题截获（在 concurrencyGuard 之前，答案消息不排队直接作答）
    bot.use(questionAnswer(manager));
// Source patch for @tencent-connect/dsh-qqbot/lib/gateway/middleware-setup.js.
// Inserted between the content sanitizer and the concurrency guard.
//
// Why here and not at the end of the chain: concurrencyGuard uses the "merge"
// strategy, which buffers a burst of same-peer messages and only lets ONE
// survivor continue through next(). Everything else stops where it is, so a
// tail hook silently misses every sticker in a merged batch — exactly when the
// bot is busy and people are chatting most. Sitting before the guard sees every
// message that passed the mention gate.
//
// Attachments are not downloaded yet at this point (attachmentProcessor runs
// later), so the candidate carries the CDN URL and the extension fetches the
// bytes itself.
bot.use(async (mCtx, next) => {
    try {
        const msg = mCtx.message;
        const content = String(msg.content ?? '');
        const match = content.match(/【表情:\s*([^】]+)】/);
        const images = (msg.attachments ?? []).filter((att) => String(att.content_type ?? '').toLowerCase().startsWith('image/'));
        const url = images.length === 1 ? images[0].url : undefined;
        if (match && msg.senderIsBot !== true && images.length === 1 && typeof url === 'string' && url !== '') {
            void manager.ctx.emit('qqbot/sticker-candidate', {
                stickerTag: true,
                stickerName: match[1].trim(),
                contentType: images[0].content_type,
                url,
            }).catch((error) => logger.warn(`[dsh-qqbot-ext] sticker event failed: ${error instanceof Error ? error.message : String(error)}`));
        }
    } catch (error) {
        logger.warn(`[dsh-qqbot-ext] sticker candidate hook failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await next();
});

// Local maintenance: breaker gate — while tripped, new messages do not reach the
// model (slash commands and pending answers were handled earlier in the chain).
bot.use(async (mCtx, next) => {
    try {
        const msg = mCtx.message;
        const scope = msg.kind === 'group' ? 'group' : 'c2c';
        const peer = scope === 'group' ? msg.groupOpenid : msg.senderId;
        if (peer) {
            const blocked = await breakerGate({
                sessionKey: 'qqbot:' + config.appId + ':' + scope + ':' + peer,
                scope, peerId: peer,
                sendTo: (target, text) => bot.sendMarkdown(target, text),
                logger,
            });
            if (blocked) return;
        }
    } catch (error) {
        logger.warn(`[dsh-qqbot-ext] breaker gate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await next();
});

    // 9. 并发串行 + 消息合并（同 peer 排队，避免 session 冲突）
    bot.use(concurrencyGuard({
        strategy: 'merge',
        maxQueue: config.maxQueue,
        maxProcessingMs: config.processingTimeoutMs,
    }));
    // 10. C2C 输入状态指示
    bot.use(typingIndicator());
    // 11. 引用消息解析（记录 + 解析被引用原文）
    bot.use(quoteRef({
        maxSize: 500,
        preferMsgElements: true,
    }));
    // 11.5. 附件下载（file 附件下载到本地，供 @提及 / 工具访问）
    bot.use(attachmentProcessor(config, logger));
    // 12. 上下文组装（将 history + quote + sender 组成 envelope）
    bot.use(envelopeFormatter({
        historyLimit: config.historyLimit,
        includeQuote: true,
        includeSender: true,
    }));
}
//# sourceMappingURL=middleware-setup.js.map