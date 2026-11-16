// Source patch for @tencent-connect/dsh-qqbot/lib/gateway/bootstrap.js.
// Inserted after the `mediaSender` declaration and before DeliverablesDeliverer.
//
// The inbound sticker hook lives in middleware-setup.js instead (it must sit
// before the concurrency guard), so this block only exposes the sender.
// Filename-constrained sender: no caller-provided paths and no exposed bot object.
// The library directory follows the extension's own config.json so a user-moved
// library keeps working without another upstream edit.
ctx.provide('qqbotExtStickerSender', {
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
