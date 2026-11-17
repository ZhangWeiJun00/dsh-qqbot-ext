// 本地维护补丁：归档会话自动换新（宿主 archived-session-gate 会拒绝归档会话的
// 一切模型步，turn 以 blocked 结束、一个请求都不发——官方插件原本不感知归档，
// 会话在 GUI 被归档/回档后机器人永久静音）。
// 三处改动，锚点必须与上游 0.5.5 的 lib/session/session-manager.js 完全一致；
// 上游变动时先解决差异，不允许静默跳过。幂等：已含标记则原样返回。
export const MARKER = '本地维护：归档会话'

const PATCHES = [
  // 1) getOrCreate：缓存命中但会话已归档 → 静默退役（remove 会铸造新 prefs id），
  //    落入 openSession 新建；不往 QQ 发任何提示。
  [
    `        const existing = this.sessions.get(key);
        if (existing) {
            existing.replyTarget = replyTarget;
            existing.lastActivity = Date.now();
            return existing;
        }`,
    `        const existing = this.sessions.get(key);
        if (existing) {
            // 本地维护：归档会话被宿主 archived-session-gate 拒绝一切模型步，
            // 继续复用会让机器人永久静音——静默退役并换新会话（不往 QQ 发提示）。
            if (this.isArchivedSession(existing.sessionId)) {
                this.logger.info(\`mapped session archived, rotating to fresh session: key=\${key} sessionId=\${existing.sessionId}\`);
                await this.remove(scope, peerId);
            }
            else {
                existing.replyTarget = replyTarget;
                existing.lastActivity = Date.now();
                return existing;
            }
        }`,
  ],
  // 2) openSession：候选会话（prefs/重启恢复）已归档 → 铸造新 id 走新建路径。
  //    resume 归档会话会成功但每步被 gate 拒绝，所以必须在 resume 之前拦截。
  [
    `        const candidateIsLegacy = this.modelResolver.getSessionId(key) === undefined;
        let sessionId = SessionId(this.currentSessionId(key));`,
    `        let candidateIsLegacy = this.modelResolver.getSessionId(key) === undefined;
        let sessionId = SessionId(this.currentSessionId(key));
        // 本地维护：候选会话已归档时不能 resume——resume 会成功但每个回合被
        // archived-session-gate 拒成 blocked。直接铸造新 id 走新建路径。
        if (this.isArchivedSession(sessionId)) {
            const fresh = SessionId(mintSessionId());
            this.logger.info(\`candidate session archived, minting fresh id: key=\${key} archived=\${sessionId} fresh=\${fresh}\`);
            this.modelResolver.setSessionId(key, fresh);
            sessionId = fresh;
            candidateIsLegacy = false;
        }`,
  ],
  // 3) 归档判定：懒取 workspaceRegistry（宿主可能未装），异常一律按未归档处理。
  [
    `    sessionKey(scope, peerId) {
        return \`qqbot:\${this.config.appId}:\${scope}:\${peerId}\`;
    }`,
    `    sessionKey(scope, peerId) {
        return \`qqbot:\${this.config.appId}:\${scope}:\${peerId}\`;
    }
    /** 本地维护：会话是否被宿主归档（workspaceRegistry 归档集）。服务缺失/异常按未归档处理。 */
    isArchivedSession(sessionId) {
        try {
            const archived = this.ctx.get('workspaceRegistry')?.archivedSessionIds;
            return Array.isArray(archived) && archived.includes(sessionId);
        }
        catch {
            return false;
        }
    }`,
  ],
  // 4) remove 重构为 removeByKey（人设切换轮换复用）+ knownSessionKeys（活跃 + prefs 存量）。
  //    removeByKey 顺带清理待答问题/待批审批，与 idle 回收一致。
  [
    `    async remove(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        const record = this.sessions.get(key);
        this.modelResolver.setSessionId(key, mintSessionId());
        if (!record)
            return;
        this.sessions.delete(key);
        record.agent.cancel({ kind: 'user' });
        await record.handle.dispose().catch(() => { });
        this.logger.info(\`session removed: key=\${key}\`);
    }`,
    `    async remove(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        await this.removeByKey(key);
    }
    /** 本地维护：按 sessionKey 退役并铸造新 id（人设切换轮换复用）；
     *  无活跃记录时只改写 prefs，下一条消息自然新建会话。 */
    async removeByKey(key) {
        const record = this.sessions.get(key);
        this.modelResolver.setSessionId(key, mintSessionId());
        if (!record)
            return;
        this.sessions.delete(key);
        record.agent.cancel({ kind: 'user' });
        await record.handle.dispose().catch(() => { });
        this.questionChannel?.cancelPending(key);
        this.approvalChannel?.cancelPending(key);
        this.logger.info(\`session removed: key=\${key}\`);
    }
    /** 本地维护：全部已知 QQ 会话 key（活跃 + prefs 存量），供人设切换轮换。 */
    knownSessionKeys() {
        const keys = new Set(this.sessions.keys());
        try {
            const stored = this.modelResolver?.prefs?.sessionIds;
            if (stored && typeof stored.keys === 'function') {
                for (const key of stored.keys())
                    keys.add(key);
            }
        }
        catch { /* prefs 不可用：只轮换活跃会话 */ }
        return [...keys];
    }`,
  ],
]

export function applyArchivedRotation(source) {
  if (source.includes(MARKER)) return source
  let next = source
  for (const [from, to] of PATCHES) {
    if (!next.includes(from)) throw new Error('Archived-session rotation anchor changed in upstream session-manager.js')
    next = next.replace(from, to)
  }
  return next
}