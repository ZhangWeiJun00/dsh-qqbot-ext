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
            void ctx.emit('qqbot/sticker-candidate', {
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
