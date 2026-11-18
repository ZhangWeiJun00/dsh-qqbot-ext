// qqbot-ext 预设的组件清单。
//
// 前半段是 @deepseek-ai/dsh-web-app/presets/standard.patch.yml 的逐行复刻
// （dsh 0.2.2-rc.3，2026-11；升级 DSH 后必须重新核对复刻，组件漂移会让预设挂载炸掉）——
// 千万别删标准行：
// 预设是「整体替换」语义，只写增量会把 bash/pwsh/工具箱全丢掉。
// 后半段追加本扩展自己的组件行。
//
// 加自定义组件：往这里加一行 { id, name, config? }，
// 或者干脆整行换成 dsh-qqbot-ext/agent（它自动扫 features/agent/*）。
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// 标准预设给 skill-filesystem 挂内置技能目录；从 vendor 上下文解析不到就省略（不影响挂载）。
let standardSkillDirs
try {
  const req = createRequire(import.meta.url)
  standardSkillDirs = [join(dirname(req.resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills')]
} catch {
  standardSkillDirs = undefined
}

const isWin = process.platform === 'win32'

export const PRESET_PLUGINS = [
  {
    id: 'persona',
    name: '@deepseek-ai/dsh-persona',
    config: {
      prefix: 'You are a coding agent powered by the {{model}} model.',
    },
  },
  {
    id: 'agent-instructions',
    name: '@deepseek-ai/dsh-agent-instructions',
    config: { maxBytes: 65536 },
  },
  { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
  {
    id: 'tool-bash',
    name: '@deepseek-ai/dsh-tool-bash',
    disabled: isWin,
  },
  {
    id: 'tool-pwsh',
    name: '@deepseek-ai/dsh-tool-pwsh',
    disabled: !isWin,
  },
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', config: { applyPatch: false } },
  {
    id: 'tool-fs-search',
    name: '@deepseek-ai/dsh-tool-fs-search',
    config: { sampleOverCapGlobResults: false },
  },
  { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
  { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' },
  {
    id: 'skill-filesystem',
    name: '@deepseek-ai/dsh-skill-filesystem',
    ...(standardSkillDirs ? { config: { customSkillDirs: standardSkillDirs } } : {}),
  },
  { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
  { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
  { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
  {
    id: 'planning',
    name: 'cordis:group',
    group: true,
    isolate: { planMode: true },
    config: [
      {
        id: 'plan-mode',
        name: '@deepseek-ai/dsh-plan-mode',
        config: {
          section: `You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.`,
        },
      },
    ],
  },
  {
    id: 'compaction',
    name: 'cordis:group',
    group: true,
    isolate: { compaction: true, toolResultPruner: true },
    config: [
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      {
        id: 'tool-result-pruner',
        name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
        config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
      },
    ],
  },
  {
    id: 'delegation',
    name: 'cordis:group',
    group: true,
    isolate: { workflowEngine: true },
    config: [
      {
        id: 'tool-subagent-control',
        name: '@deepseek-ai/dsh-tool-subagent-control',
        config: { interrupt: false },
      },
      {
        id: 'tool-subagent',
        name: '@deepseek-ai/dsh-tool-subagent',
        config: {
          provider: 'spawn',
          toolName: 'subagent',
          modelSelection: true,
          modelDiscovery: true,
        },
      },
      {
        id: 'tool-subagent-fork',
        name: '@deepseek-ai/dsh-tool-subagent',
        config: { provider: 'fork', toolName: 'subagent_fork' },
      },
      {
        id: 'workflow-ptc',
        name: '@deepseek-ai/dsh-workflow-ptc',
        config: { provider: 'spawn' },
      },
      { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
    ],
  },
  { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
  {
    id: 'tool-todo',
    name: '@deepseek-ai/dsh-tool-todo',
    config: { allowParallelInProgress: true },
  },
  {
    id: 'tool-web',
    name: '@deepseek-ai/dsh-tool-web',
    config: { fetch: true, searchTimeoutMs: 60000 },
  },
  { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
  { id: 'tool-office', name: '@deepseek-ai/dsh-tool-office' },
  {
    id: 'tool-plugin-manager',
    name: '@deepseek-ai/dsh-plugin-manager/tools',
    disabled: true,
  },
  {
    id: 'tool-plugin-market',
    name: '@deepseek-ai/dsh-plugin-market/tools',
    disabled: true,
  },

  // ===== 以下为 dsh-qqbot-ext 自定义组件 =====
  // 自动扫 features/agent/*（工具、提示词段都在那加）
  {
    id: 'dsh-qqbot-ext-agent',
    name: 'dsh-qqbot-ext/agent',
  },
]
