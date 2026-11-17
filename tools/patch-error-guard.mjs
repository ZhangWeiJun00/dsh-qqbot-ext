// 本地维护补丁：模型对话错误拦截 + 全局熔断。
// outbound.js：回合错误不再往原会话甩技术报错——友好短提示（可配/可静默）、
//   详情转发管理员 c2c、连续错误计数；成功回合清零（跳闸中不自动恢复，只能管理员 /resume）。
// middleware-setup.js：concurrencyGuard 之前的熔断闸门（斜杠命令/待答问题在其之前，
//   不受熔断影响），跳闸冷却期内消息不进模型，按会话节流友好提示。
// 锚点必须与上游 0.5.5 完全一致；上游变动时先解决差异。幂等：已含标记原样返回。
export const MARKER = '本地维护：错误拦截'

const OUTBOUND_IMPORT_FROM = `import { parseEvent, extractTurnError, } from "./events.js";`
const OUTBOUND_IMPORT_TO = `import { parseEvent, extractTurnError, } from "./events.js";
// 本地维护：错误拦截与熔断（ext/lib/error-guard.js）。
import { interceptTurnError, noteTurnSuccess } from '../../ext/lib/error-guard.js';`

const OUTBOUND_BLOCK_FROM = `        const failure = extractTurnError(event.reason);
        void (async () => {
            await Promise.all([flushTask, pending]);
            if (failure !== undefined && !SILENT_TURN_ERROR_CODES.has(failure.code)) {
                await this.send(record, \`⚠️ 本轮异常结束\\n\\\`\${failure.code}\\\`: \${failure.message}\`, 'sendTurnEndError');
            }
            if (files.length > 0 && this.deliverer !== undefined) {
                await this.deliverer.deliver(record, files);
            }
            this.logger.debug(\`im-qqbot: turn/end sessionId=\${sessionId}\`);
        })();`

const OUTBOUND_BLOCK_TO = `        const failure = extractTurnError(event.reason);
        // 本地维护：错误拦截——原会话友好短提示、详情转发管理员、熔断计数。
        const guardSend = (target, text) => this.send({ replyTarget: target }, text, 'sendErrorGuard');
        const fallbackAdmin = this.config.access?.c2cAllow?.[0];
        void (async () => {
            await Promise.all([flushTask, pending]);
            if (failure !== undefined) {
                try {
                    await interceptTurnError({ failure, sessionKey: record.sessionKey, scope: record.replyTarget.scope, peerId: record.replyTarget.targetId, sendTo: guardSend, fallbackAdmin, logger: this.logger });
                }
                catch (guardErr) {
                    this.logger.error(\`im-qqbot: error guard failed: \${guardErr instanceof Error ? guardErr.message : String(guardErr)}\`);
                    if (!SILENT_TURN_ERROR_CODES.has(failure.code)) {
                        await this.send(record, \`⚠️ 本轮异常结束\\n\\\`\${failure.code}\\\`: \${failure.message}\`, 'sendTurnEndError');
                    }
                }
            }
            else if (event.reason?.kind === 'complete') {
                try {
                    await noteTurnSuccess({ sendTo: guardSend, fallbackAdmin, logger: this.logger });
                }
                catch { /* 计数失败不影响回复 */ }
            }
            if (files.length > 0 && this.deliverer !== undefined) {
                await this.deliverer.deliver(record, files);
            }
            this.logger.debug(\`im-qqbot: turn/end sessionId=\${sessionId}\`);
        })();`

const MIDDLEWARE_IMPORT_FROM = `import { createCardInbox } from '../../ext/lib/qq-card-inbox.js';`
const MIDDLEWARE_IMPORT_TO = `import { createCardInbox } from '../../ext/lib/qq-card-inbox.js';
import { breakerGate } from '../../ext/lib/error-guard.js';`

// /resume 命令：仅限管理员（adminOnlyAuth，同步判定）；push 进 buildCommandList 返回的同一数组，
// helpCommand 的闭包引用该数组，/bot-help 自动可见。
const COMMAND_IMPORT_FROM = `import { breakerGate } from '../../ext/lib/error-guard.js';`
const COMMAND_IMPORT_TO = `import { breakerGate, breakerCommand, adminOnlyAuth } from '../../ext/lib/error-guard.js';`

const SLASH_FROM = `    const slash = slashCommand({
        // 关闭 autoHelp：help 命令由 qqbot 注册为 /bot-help，
        // 避免 SDK 再自动注册一个无前缀的 /help 造成重复
        autoHelp: false,
        commands: buildCommandList({ manager, config, logger }),
    });`
const SLASH_TO = `    // 本地维护：熔断人工合闸命令（/resume 立即恢复，/resume status 查状态）。
    const commandList = buildCommandList({ manager, config, logger });
    commandList.push(breakerCommand({ config, logger, authorized: adminOnlyAuth({ config, logger }) }));
    const slash = slashCommand({
        // 关闭 autoHelp：help 命令由 qqbot 注册为 /bot-help，
        // 避免 SDK 再自动注册一个无前缀的 /help 造成重复
        autoHelp: false,
        commands: commandList,
    });`

const GATE_ANCHOR = `    // 9. 并发串行`
const GATE_BLOCK = `// Local maintenance: breaker gate — while tripped, new messages do not reach the
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
        logger.warn(\`[dsh-qqbot-ext] breaker gate failed: \${error instanceof Error ? error.message : String(error)}\`);
    }
    await next();
});

`

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Error-guard anchor changed: ${label}`)
  return source.replace(from, to)
}

export function applyErrorGuard({ outbound, middleware }) {
  let nextOutbound = outbound
  let nextMiddleware = middleware
  if (!nextOutbound.includes(MARKER)) {
    nextOutbound = replaceOnce(nextOutbound, OUTBOUND_IMPORT_FROM, OUTBOUND_IMPORT_TO, 'outbound import')
    nextOutbound = replaceOnce(nextOutbound, OUTBOUND_BLOCK_FROM, OUTBOUND_BLOCK_TO, 'outbound onTurnEnd')
  }
  if (!nextMiddleware.includes('breakerGate')) {
    nextMiddleware = replaceOnce(nextMiddleware, MIDDLEWARE_IMPORT_FROM, MIDDLEWARE_IMPORT_TO, 'middleware import')
    nextMiddleware = replaceOnce(nextMiddleware, GATE_ANCHOR, GATE_BLOCK + GATE_ANCHOR, 'middleware gate')
  }
  if (!nextMiddleware.includes('breakerCommand')) {
    nextMiddleware = replaceOnce(nextMiddleware, COMMAND_IMPORT_FROM, COMMAND_IMPORT_TO, 'command import')
    nextMiddleware = replaceOnce(nextMiddleware, SLASH_FROM, SLASH_TO, 'slash command list')
  }
  return { outbound: nextOutbound, middleware: nextMiddleware }
}