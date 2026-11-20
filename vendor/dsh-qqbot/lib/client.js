const __qqUpstreamReg = {
	id: "@tencent-connect/dsh-qqbot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/shared/bind-protocol.ts
		/**
		* 端内绑定协议 —— 宿主路由与客户端面板的共享契约
		*
		* 类型与路径常量的唯一事实源：宿主（setup/bind-routes.ts）与浏览器
		* （client/bind-page.ts）各自 import，杜绝两端协议漂移。
		* 本模块必须保持纯类型 + 纯常量（零 node 依赖、零副作用）：
		* 客户端 tsdown 构建会将其内联进 bundle。
		*/
		/** 状态查询（绑定页轮询） */
		const BIND_STATE_PATH = "/qqbot/im-qqbot/bind";
		/** 刷新二维码（绑定页按钮） */
		const BIND_REFRESH_PATH = "/qqbot/im-qqbot/bind/refresh";
		/** 手动填写/编辑凭据（绑定页表单） */
		const BIND_MANUAL_PATH = "/qqbot/im-qqbot/bind/manual";
		/** 解绑：移除已保存凭据，回到绑定流程 */
		const BIND_UNBIND_PATH = "/qqbot/im-qqbot/bind/unbind";
		/** 配置读写（设置面板表单） */
		const BIND_CONFIG_PATH = "/qqbot/im-qqbot/config";
		//#endregion
		//#region src/client/bind-page.ts
		/**
		* 端内绑定面板 — 扫码 / 手动填写 / 已绑定编辑
		*
		* 宿主插件注册 /qqbot/im-qqbot/bind 路由（待绑定与已绑定 fiber 均常驻）：
		* - 未绑定：waiting（二维码）/ starting / saving / failed 相位 + manual 提交
		* - 已绑定：bound 相位（回显脱敏 appId，secret 不回传）+ manual 更换 + 解绑
		* 扫码成功或手动保存均写入 profile patch 并经 HMR 重载生效。
		*
		* 样式为注入式 CSS 类（imqb-* 命名空间，随面板挂载注入一次）：
		* hover/过渡/focus 样式无法用 inline style 表达，统一走类；
		* 颜色尽量取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
		*
		* 同一组件复用于两种展示位（侧栏绑定页 / 设置页 QQ Bot 栏目）。
		* 运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走同源 fetch，
		* Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
		*/
		/** 轮询间隔（毫秒）：活跃轮询 / 失败退避 */
		const ACTIVE_POLL_MS = 2e3;
		const RETRY_POLL_MS = 3e3;
		/** 样式注入标记（幂等） */
		const STYLE_ID$1 = "im-qqbot-bind-panel-styles";
		/**
		* 注入面板样式（全局一次，幂等）。交互态（hover/active/focus）无法用 inline
		* style 表达，统一收敛到类；DSW 主题变量缺失时用中性值兜底。
		* 插件激活时即安装：插件详情按钮渲染在面板之外，需提前可见；
		* 安装后不再随挂载移除，避免多个展示位互相清掉样式。
		*/
		function installPanelStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID$1) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID$1;
			style.textContent = `
.imqb-panel {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 24px; min-height: 320px; text-align: center; font-size: 14px;
}
.imqb-title { margin: 0; font-size: 16px; font-weight: 600; }
.imqb-hint { margin: 0; opacity: 0.75; line-height: 1.6; }
.imqb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.imqb-link { font-size: 13px; opacity: 0.85; color: var(--dsw-alias-brand, #4d6bfe); text-decoration: none; }
.imqb-link:hover { text-decoration: underline; }
.imqb-icon { font-size: 32px; line-height: 1; }
.imqb-qr { border-radius: 10px; background: #fff; padding: 10px; max-width: 100%; }
.imqb-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.imqb-btn, .imqb-pill {
  font: inherit; cursor: pointer; color: inherit;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease;
}
.imqb-btn:disabled, .imqb-pill:disabled { opacity: 0.5; cursor: default; }
.imqb-btn {
  padding: 7px 18px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  background: transparent;
}
.imqb-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
.imqb-btn--primary {
  border-color: transparent;
  background: var(--dsw-alias-brand, #4d6bfe); color: #fff; font-weight: 500;
}
.imqb-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-brand-strong, #3b5cf0); }
.imqb-btn--danger { color: var(--dsw-alias-danger, #f26d6d); border-color: var(--dsw-alias-danger, rgba(242, 109, 109, 0.5)); }
.imqb-btn--danger:hover:not(:disabled) { background: var(--dsw-alias-danger, rgba(242, 109, 109, 0.12)); }
.imqb-ghost {
  border: none; background: transparent; opacity: 0.65; padding: 4px 8px;
  font: inherit; font-size: 13px; cursor: pointer; color: inherit;
}
.imqb-ghost:hover { opacity: 1; text-decoration: underline; }
/* 插件详情「设置」按钮：30px，略高于旁边的 sm 次要按钮 */
.imqb-pluginOpen {
  display: inline-flex; align-items: center; justify-content: center;
  box-sizing: border-box; height: 30px; padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit); font: inherit;
  font-size: 13px; line-height: 20px; cursor: pointer;
}
.imqb-pluginOpen:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
.imqb-pluginOpen:focus-visible { outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 3px; }
@media (pointer: coarse) { .imqb-pluginOpen { height: 44px; } }
/* 主面板页面容器（layout.selectPanel 目标）：滚动 + 留白 */
.imqb-pluginPage {
  height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 24px clamp(16px, 4vw, 48px) 32px;
  color: var(--dsw-alias-label-primary, #1f2329);
}
.imqb-pluginPageContent { max-width: 1080px; margin: 0 auto; }
.imqb-pill {
  padding: 5px 16px; border-radius: 999px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4)); background: transparent;
}
.imqb-pill:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
.imqb-btn:focus-visible, .imqb-pill:focus-visible, .imqb-input:focus-visible, .imqb-ghost:focus-visible {
  outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 1px;
}
.imqb-form { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); box-sizing: border-box; }
.imqb-field { display: flex; flex-direction: column; gap: 5px; text-align: left; font-size: 13px; }
.imqb-input {
  padding: 8px 10px; border-radius: 8px; box-sizing: border-box; width: 100%;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  background: var(--dsw-alias-bg-input, rgba(128, 128, 128, 0.08));
  color: inherit; font: inherit; font-size: 13px; outline: none;
}
.imqb-input:focus { border-color: var(--dsw-alias-brand, #4d6bfe); }
.imqb-error { margin: 0; font-size: 12px; color: var(--dsw-alias-danger, #f26d6d); }
/* 紧凑状态视图（已绑定 / 过渡态）：设置行风格，无居中大卡留白 */
.imqb-status { display: flex; flex-direction: column; text-align: left; font-size: 14px; }
.imqb-status-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb-status-icon { font-size: 24px; line-height: 1; flex: none; }
.imqb-qqicon {
  flex: none; display: block; border-radius: 8px; /* 透明底，QQ 蓝徽标在明暗主题下均清晰 */
}
.imqb-status-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.imqb-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.imqb-status-sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); opacity: .85; }
.imqb-status-actions { display: flex; align-items: center; gap: 8px; padding: 4px 0 12px; }
/* 扫码成功后的连接过渡：二维码模糊变暗 + 覆盖层 */
.imqb-scanned { position: relative; display: inline-block; }
.imqb-scanned-qr {
  display: block; border-radius: 10px; background: #fff; padding: 10px;
  filter: blur(6px) saturate(0.6); opacity: 0.55;
}
.imqb-scanned-veil {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; text-align: center;
}
.imqb-scanned-title { margin: 0; font-size: 15px; font-weight: 600; }
.imqb-scanned-sub { margin: 0; font-size: 12px; opacity: 0.75; line-height: 1.6; }
    `;
			document.head.appendChild(style);
		}
		function usePanelStyles() {
			(0, react.useEffect)(() => {
				installPanelStyles();
			}, []);
		}
		/**
		* 绑定状态轮询 hook。
		*
		* 404 语义分两种：从未拿到过路由 = 插件未启用（终态）；
		* 曾经拿到过 = HMR 重载窗口期（manual/unbind 保存后路由短暂消失），
		* 低频等待恢复而不是判定终态——否则保存成功提示会被
		* 「插件未启用」覆盖且无法自愈。
		*
		* bound 为稳定态：轮询大幅降频（30s）。因此解绑等本地动作后必须
		* 调用 recheck() 立即重置节拍——否则视图最长停留 30s+ 才收敛到
		* 新相位（如解绑后的 waiting 二维码）。
		*
		* @returns 轮询快照与 recheck：state 为宿主相位（null = 加载中），
		*          gone 表示插件未启用（从未注册过路由），recheck 废弃当前
		*          定时器并立即重新轮询（新轮询链取代旧链，不产生双计时器）。
		*/
		function useBindState(enabled = true) {
			const [state, setState] = (0, react.useState)(null);
			const [gone, setGone] = (0, react.useState)(false);
			const recheckRef = (0, react.useRef)(() => {});
			(0, react.useEffect)(() => {
				if (!enabled) return;
				let stopped = false;
				let sawRoute = false;
				let generation = 0;
				let running = false;
				let restartAfterFlight = false;
				let urgentUntil = 0;
				let timer;
				const schedule = (ms) => {
					timer = setTimeout(() => {
						tick();
					}, ms);
				};
				const intervalFor = (phase) => {
					const base = phase === "saving" ? 500 : phase === "bound" ? 3e4 : ACTIVE_POLL_MS;
					return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
				};
				const tick = async () => {
					if (stopped || running) return;
					running = true;
					const myGeneration = generation;
					const alive = () => myGeneration === generation && !stopped;
					try {
						const res = await fetch(BIND_STATE_PATH, { cache: "no-store" });
						if (res.status === 404) {
							if (!stopped && !sawRoute) setGone(true);
							else if (alive()) schedule(Date.now() < urgentUntil ? 1e3 : 3e3);
							return;
						}
						if (!res.ok) {
							if (alive()) schedule(RETRY_POLL_MS);
							return;
						}
						sawRoute = true;
						const body = await res.json();
						if (!alive()) return;
						setState(body);
						schedule(intervalFor(body.phase));
						return;
					} catch {} finally {
						running = false;
						if (restartAfterFlight && !stopped) {
							restartAfterFlight = false;
							tick();
						}
					}
					if (alive()) schedule(RETRY_POLL_MS);
				};
				recheckRef.current = () => {
					generation += 1;
					urgentUntil = Date.now() + 15e3;
					if (timer !== void 0) clearTimeout(timer);
					if (running) {
						restartAfterFlight = true;
						return;
					}
					tick();
				};
				tick();
				return () => {
					stopped = true;
					if (timer !== void 0) clearTimeout(timer);
				};
			}, []);
			return {
				state,
				gone,
				recheck: (0, react.useCallback)(() => {
					recheckRef.current();
				}, [])
			};
		}
		/** 手动提交凭据（填写 / 更换共用） */
		async function submitManualCredentials(appId, appSecret) {
			try {
				const res = await fetch(BIND_MANUAL_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						appId,
						appSecret
					})
				});
				const body = await res.json().catch(() => ({}));
				if (res.ok && body.ok) return {
					ok: true,
					message: body.message
				};
				return {
					ok: false,
					error: body.error ?? `保存失败（HTTP ${res.status}）`
				};
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
		/**
		* 手动凭据表单（填写 / 更换共用）。
		*
		* appSecret 永不回显（占位符提示），提交成功后展示保存结果；
		* 宿主写入 profile patch 并经 HMR 重载，状态轮询随后收敛为 bound。
		*/
		function ManualForm({ initialAppId }) {
			const [appId, setAppId] = (0, react.useState)(initialAppId ?? "");
			const [appSecret, setAppSecret] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy) return;
				const trimmedId = appId.trim();
				const trimmedSecret = appSecret.trim();
				if (trimmedId.length === 0 || trimmedSecret.length === 0) {
					setResult({
						ok: false,
						error: "appId 与 appSecret 均为必填"
					});
					return;
				}
				setBusy(true);
				submitManualCredentials(trimmedId, trimmedSecret).then((outcome) => {
					setResult(outcome);
					setBusy(false);
				});
			}, [
				appId,
				appSecret,
				busy
			]);
			if (result !== null && result.ok) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "✅"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, result.message ?? "凭据已保存"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "插件将自动重载；稍后即可开始对话"))));
			return (0, react.createElement)("form", {
				className: "imqb-form",
				onSubmit: submit
			}, (0, react.createElement)("label", { className: "imqb-field" }, "AppID", (0, react.createElement)("input", {
				className: "imqb-input",
				value: appId,
				placeholder: "QQ 机器人 AppID",
				onChange: (event) => {
					setAppId(event.currentTarget.value);
				},
				autoComplete: "off",
				spellCheck: false
			})), (0, react.createElement)("label", { className: "imqb-field" }, "AppSecret", (0, react.createElement)("input", {
				className: "imqb-input",
				type: "password",
				value: appSecret,
				placeholder: initialAppId === void 0 ? "QQ 机器人 AppSecret" : "输入新的 AppSecret（不回显）",
				onChange: (event) => {
					setAppSecret(event.currentTarget.value);
				},
				autoComplete: "new-password"
			})), result !== null && !result.ok ? (0, react.createElement)("p", { className: "imqb-error" }, result.error) : null, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				type: "submit",
				disabled: busy
			}, busy ? "正在保存…" : "保存"));
		}
		/** QQ 机器人 logo 路径（assets/icons/qqbot_logo.svg，内嵌以保持 bundle 自包含） */
		const QQ_BOT_LOGO_PATH = "M19.3862 15.5001C19.3861 11.4203 16.0789 8.11296 11.999 8.11292C7.91915 8.11292 4.61203 11.4203 4.61182 15.5001V17.0001C4.61182 18.5949 5.90429 19.8873 7.49902 19.8873H16.499C18.0937 19.8873 19.3862 18.5949 19.3862 17.0001V15.5001ZM10.6118 14.0001C10.6118 14.6145 10.1129 15.1134 9.49853 15.1134C8.8843 15.1132 8.38672 14.6144 8.38672 14.0001V12.0006C8.38672 11.3863 8.8843 10.8875 9.49853 10.8873C10.1129 10.8873 10.6118 11.3862 10.6118 12.0006V14.0001ZM15.6113 14.0001C15.6113 14.6143 15.1136 15.1131 14.4995 15.1134C13.8851 15.1134 13.3862 14.6145 13.3862 14.0001V12.0006C13.3862 11.3862 13.8851 10.8873 14.4995 10.8873C15.1136 10.8876 15.6113 11.3864 15.6113 12.0006V14.0001ZM14.2607 3.04895C14.2607 3.89351 13.7957 4.62474 13.1108 5.0133V5.95374C17.8958 6.50514 21.6112 10.5676 21.6113 15.5001V17.0001C21.6113 19.8237 19.3225 22.1124 16.499 22.1124H7.49902C4.67546 22.1124 2.38672 19.8237 2.38672 17.0001V15.5001C2.38691 10.568 6.10139 6.50571 10.8857 5.95374V5.01185C10.2017 4.62305 9.73583 3.89286 9.73583 3.04895C9.73609 1.79961 10.7496 0.787231 11.999 0.787231C13.2484 0.787297 14.2605 1.79966 14.2607 3.04895Z";
		/** QQ 机器人图标（logo 矢量渲染，透明底，随 size 缩放） */
		function QqBotIcon({ size = 28 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true,
				className: "imqb-qqicon"
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "#0085FF"
			}));
		}
		/** 已绑定视图：回显 appId + 更换凭据 / 解绑入口 */
		function BoundView({ appId, recheck }) {
			const [editing, setEditing] = (0, react.useState)(false);
			const [unbindResult, setUnbindResult] = (0, react.useState)(null);
			const unbind = (0, react.useCallback)(() => {
				if (!window.confirm("确定解绑吗？\n解绑后机器人立即下线，插件将重新进入扫码绑定流程。")) return;
				fetch(BIND_UNBIND_PATH, { method: "POST" }).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok === true) {
						setUnbindResult({
							ok: true,
							message: body.message ?? "已解绑，插件将重载并重新进入绑定流程"
						});
						recheck();
						return;
					}
					setUnbindResult({
						ok: false,
						message: body.error ?? `解绑失败（HTTP ${res.status}）`
					});
				}).catch((err) => {
					setUnbindResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				});
			}, [recheck]);
			if (unbindResult !== null) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, unbindResult.ok ? "👋" : "⚠️"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, unbindResult.message)), unbindResult.ok ? (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: recheck
			}, "刷新状态") : (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setUnbindResult(null);
				}
			}, "返回")));
			if (editing) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "更换凭据")), (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setEditing(false);
				}
			}, "返回")), (0, react.createElement)(ManualForm, { initialAppId: appId }));
			return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)(QqBotIcon, { size: 28 }), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "已绑定"), (0, react.createElement)("p", { className: "imqb-status-sub imqb-mono" }, `AppID ${appId} · 私聊与群聊已接入`))), (0, react.createElement)("div", { className: "imqb-status-actions" }, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				onClick: () => {
					setEditing(true);
				}
			}, "更换凭据"), (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--danger",
				onClick: unbind
			}, "解绑")));
		}
		/** 未绑定视图：扫码 / 手动填写切换 */
		function UnboundView({ state }) {
			const [mode, setMode] = (0, react.useState)("qr");
			const refresh = (0, react.useCallback)(() => {
				fetch(BIND_REFRESH_PATH, { method: "POST" }).catch(() => {});
			}, []);
			const [imgFailed, setImgFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setImgFailed(false);
			}, [state.qrSvg]);
			if (mode === "manual") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-title" }, "手动填写凭据"), (0, react.createElement)(ManualForm, {}), (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setMode("qr");
				}
			}, "改用扫码绑定"));
			if (state.qrSvg === void 0 || imgFailed) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "⚠️"), (0, react.createElement)("p", { className: "imqb-title" }, "二维码暂时无法显示"), (0, react.createElement)("p", { className: "imqb-hint" }, "可重启应用后重试，或任选下面一种方式继续"), (0, react.createElement)("a", {
				href: state.url,
				target: "_blank",
				rel: "noreferrer noopener",
				className: "imqb-link"
			}, "在浏览器中打开链接扫码"), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)("button", {
				className: "imqb-pill",
				onClick: () => {
					setMode("manual");
				}
			}, "手动填写凭据")));
			return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("img", {
				src: state.qrSvg,
				alt: "QQ 扫码二维码",
				width: 220,
				height: 220,
				className: "imqb-qr",
				onError: () => {
					setImgFailed(true);
				}
			}), (0, react.createElement)("p", { className: "imqb-title" }, "扫码绑定 QQ 机器人"), (0, react.createElement)("p", { className: "imqb-hint" }, "使用手机 QQ 扫描二维码完成绑定"), (0, react.createElement)("a", {
				href: state.url,
				target: "_blank",
				rel: "noreferrer noopener",
				className: "imqb-link"
			}, "二维码显示异常？在浏览器中打开"), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)("button", {
				className: "imqb-pill",
				onClick: refresh
			}, "刷新二维码"), (0, react.createElement)("button", {
				className: "imqb-pill",
				onClick: () => {
					setMode("manual");
				}
			}, "手动填写")));
		}
		/** 依据宿主相位渲染面板主体（可注入共享轮询结果避免双计时器） */
		function BindPanelBody(props) {
			usePanelStyles();
			const injected = props?.state !== void 0;
			const internal = useBindState(!injected);
			const state = injected ? props.state : internal.state;
			const gone = injected ? props.gone ?? false : internal.gone;
			const recheck = injected ? props.recheck ?? (() => {}) : internal.recheck;
			const [lastQr, setLastQr] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (state === null) return;
				if (state.phase === "waiting") {
					if (state.qrSvg !== void 0) setLastQr(state.qrSvg);
				} else if (state.phase === "bound") setLastQr(null);
			}, [state]);
			if (gone) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "❔"), (0, react.createElement)("p", { className: "imqb-hint" }, "插件未启用，或当前版本不支持端内配置"));
			if (state === null || state.phase === "starting") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-hint" }, "正在获取绑定状态…"));
			if (state.phase === "saving") {
				if (lastQr !== null) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-scanned" }, (0, react.createElement)("img", {
					src: lastQr,
					alt: "QQ 扫码二维码",
					width: 220,
					height: 220,
					className: "imqb-scanned-qr"
				}), (0, react.createElement)("div", { className: "imqb-scanned-veil" }, (0, react.createElement)("p", { className: "imqb-scanned-title" }, "✅ 扫码成功"), (0, react.createElement)("p", { className: "imqb-scanned-sub" }, "正在连接机器人，稍候…"))));
				return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "🎉"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "扫码成功"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "凭据已保存，插件正在重载，稍后即可开始对话"))));
			}
			if (state.phase === "failed") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "⚠️"), (0, react.createElement)("p", { className: "imqb-title" }, "绑定失败"), (0, react.createElement)("p", { className: "imqb-hint" }, state.reason), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				onClick: () => {
					window.location.reload();
				}
			}, "重试")));
			if (state.phase === "bound") return (0, react.createElement)(BoundView, {
				appId: state.appId,
				recheck
			});
			return (0, react.createElement)(UnboundView, { state });
		}
		//#endregion
		//#region src/client/config-panel.ts
		/**
		* QQ 机器人配置面板 — 必要配置的 UI 编辑
		*
		* UI 复刻 DSW 通用设置（settings-form 原语）的视觉风格：
		* 左对齐设置列、0.5px 行分隔、label 13px/500、控件右置；
		* Switch 为 36×20 aria-checked 结构（thumb translateX 动画）；
		* 三值选择用分段控件（滑动指示器按段数/索引的 CSS 变量定位）；
		* 保存按钮为 DSW 反色主按钮（label-primary 底 + bg-layer-3 字）。
		*
		* 数据流：GET /qqbot/im-qqbot/config 回显当前生效配置（appSecret
		* 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
		* 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
		*
		* 字段策略：只开放用户必要的配置；cwd 只读展示；超时与性能调优
		* 类字段走 profile patch / 环境变量。
		*/
		/** 样式注入标记（幂等） */
		const STYLE_ID = "im-qqbot-config-panel-styles";
		/** DSW 通用设置风格（settings-form / Switch / SegmentedControl 原语复刻） */
		function useConfigPanelStyles() {
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				if (document.getElementById(STYLE_ID) !== null) return;
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = `
.imqb2-form { display: flex; flex-direction: column; width: 100%; }
.imqb2-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em;
}
.imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb2-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
/* Switch（aria-checked 驱动，视觉态与无障碍态同源） */
.imqb2-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto;
  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;
  background: var(--dsw-alias-border-l3); cursor: pointer; font: inherit;
}
.imqb2-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.imqb2-switch:disabled { cursor: default; opacity: 0.5; }
.imqb2-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.imqb2-switch-thumb {
  display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #ffffff);
  transition: transform 120ms ease;
}
.imqb2-switch[aria-checked='true'] .imqb2-switch-thumb {
  background: var(--dsw-alias-label-primary-foreground, #ffffff);
  transform: translateX(16px);
}
/* 输入（官方 fields.input 复刻） */
.imqb2-input {
  box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); outline: none;
}
.imqb2-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.imqb2-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.imqb2-textarea { height: auto; min-height: 68px; padding: 8px 12px; resize: vertical; line-height: 1.5; }
/* 分段控件（官方 SegmentedControl 复刻：指示器按段数/索引定位） */
.imqb2-seg {
  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  gap: 2px; padding: 4px; border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-interactive-bg-hover);
}
.imqb2-seg-indicator {
  position: absolute; top: 4px; left: 4px;
  width: calc((100% - 8px - 2px * (var(--imqb2-seg-count) - 1)) / var(--imqb2-seg-count));
  height: calc(100% - 8px);
  border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));
  transform: translateX(calc(var(--imqb2-seg-index) * (100% + 2px)));
  transition: transform 160ms ease;
  pointer-events: none;
}
.imqb2-seg-tab {
  box-sizing: border-box; position: relative; z-index: 1; height: 28px; padding: 0 16px;
  border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px;
  font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease;
}
.imqb2-seg-tab:hover, .imqb2-seg-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }
.imqb2-seg-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
/* 底栏（官方 SettingsForm.footer 复刻） */
.imqb2-footer { display: flex; align-items: center; gap: 8px; padding-top: 16px; }
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
.imqb2-save {
  appearance: none; flex: none; border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px;
  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);
}
.imqb2-save:disabled { opacity: 0.4; cursor: default; }
.imqb2-save:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
/* cwd 只读行 */
.imqb2-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
    `;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, []);
		}
		/** 开关（官方 Switch 原语结构：aria-checked 驱动视觉态） */
		function Switch({ checked, label, onChange }) {
			return (0, react.createElement)("button", {
				type: "button",
				role: "switch",
				"aria-checked": checked,
				"aria-label": label,
				className: "imqb2-switch",
				onClick: () => {
					onChange(!checked);
				}
			}, (0, react.createElement)("span", { className: "imqb2-switch-thumb" }));
		}
		/** 访问模式分段选择（官方 SegmentedControl 结构：CSS 变量定位滑动指示器） */
		function Segmented({ value, options, onChange, label }) {
			const index = Math.max(0, options.findIndex((o) => o.value === value));
			const trackStyle = {
				"--imqb2-seg-count": options.length,
				"--imqb2-seg-index": index
			};
			return (0, react.createElement)("div", {
				className: "imqb2-seg",
				role: "tablist",
				"aria-label": label,
				style: trackStyle
			}, (0, react.createElement)("span", { className: "imqb2-seg-indicator" }), options.map((o) => (0, react.createElement)("button", {
				key: o.value,
				type: "button",
				role: "tab",
				"aria-selected": o.value === value,
				className: "imqb2-seg-tab",
				onClick: () => {
					onChange(o.value);
				}
			}, o.label)));
		}
		/** 开关行（label 左 + Switch 右 + 可选 help） */
		function SwitchRow({ label, help, checked, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(Switch, {
				checked,
				label,
				onChange
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-help" }, help));
		}
		/** 文本行（label 上 + 输入下，与官方 fields 布局一致） */
		function FieldRow({ label, help, value, placeholder, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)("input", {
				className: "imqb2-input",
				value,
				placeholder,
				spellCheck: false,
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 多行文本行 */
		function AreaRow({ label, help, value, rows, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)("textarea", {
				className: "imqb2-input imqb2-textarea",
				value,
				rows: rows ?? 3,
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 访问模式分段选择行 */
		function SegmentedRow({ label, help, value, options, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(Segmented, {
				value,
				options,
				onChange,
				label
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		const MODE_OPTIONS = [
			{
				value: "open",
				label: "所有人"
			},
			{
				value: "allowlist",
				label: "白名单"
			},
			{
				value: "disabled",
				label: "禁用"
			}
		];
		/** 深比较（表单值与初始回显值的 dirty 判断） */
		function shallowEqual(a, b) {
			return JSON.stringify(a) === JSON.stringify(b);
		}
		/**
		* 配置面板主体。
		*
		* 保存仅提交变更键（服务端按白名单合并），保存成功后提示
		* HMR 重载语义（进行中的机器人会话将重置）。
		*/
		function ConfigPanel(props) {
			useConfigPanelStyles();
			const [initial, setInitial] = (0, react.useState)(null);
			const [form, setForm] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const bindPhase = props?.bindPhase;
			(0, react.useEffect)(() => {
				let stopped = false;
				fetch(BIND_CONFIG_PATH, { cache: "no-store" }).then(async (res) => {
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const body = await res.json();
					if (stopped) return;
					setInitial(body.config);
					setForm(body.config);
				}).catch((err) => {
					if (!stopped) setLoadError(err instanceof Error ? err.message : String(err));
				});
				return () => {
					stopped = true;
				};
			}, [bindPhase]);
			const patch = (0, react.useCallback)((key, value) => {
				setForm((current) => current === null ? current : {
					...current,
					[key]: value
				});
				setResult(null);
			}, []);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy || initial === null || form === null) return;
				const changed = {};
				for (const key of Object.keys(form)) if (!shallowEqual(form[key], initial[key])) changed[key] = form[key];
				if (Object.keys(changed).length === 0) return;
				if (changed.access !== void 0) {
					const a = changed.access;
					changed.access = {
						...a,
						c2cAllow: a.c2cAllow.map((s) => s.trim()).filter(Boolean),
						groupAllow: a.groupAllow.map((s) => s.trim()).filter(Boolean)
					};
				}
				setBusy(true);
				fetch(BIND_CONFIG_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(changed)
				}).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok === true) {
						setResult({
							ok: true,
							message: body.message ?? "配置已保存，插件将自动重载"
						});
						setInitial(form);
						return;
					}
					setResult({
						ok: false,
						message: body.error ?? `保存失败（HTTP ${res.status}）`
					});
				}).catch((err) => {
					setResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				}).finally(() => {
					setBusy(false);
				});
			}, [
				busy,
				form,
				initial
			]);
			if (loadError !== null) return (0, react.createElement)("p", {
				className: "imqb2-hint",
				style: { padding: "12px 0" }
			}, `配置加载失败：${loadError}`);
			if (initial === null || form === null) return (0, react.createElement)("p", {
				className: "imqb2-hint",
				style: { padding: "12px 0" }
			}, "正在加载配置…");
			const dirty = Object.keys(form).some((key) => !shallowEqual(form[key], initial[key]));
			const access = form.access ?? {
				c2cMode: "open",
				c2cAllow: [],
				groupMode: "open",
				groupAllow: []
			};
			return (0, react.createElement)("form", {
				className: "imqb2-form",
				onSubmit: submit
			}, (0, react.createElement)("div", { className: "imqb2-group-title" }, "服务范围"), (0, react.createElement)(SegmentedRow, {
				label: "私聊",
				value: access.c2cMode,
				options: MODE_OPTIONS,
				onChange: (v) => {
					patch("access", {
						...access,
						c2cMode: v
					});
				}
			}), access.c2cMode === "allowlist" ? (0, react.createElement)(AreaRow, {
				label: "私聊白名单",
				help: "请输入用户 openid，多个请换行输入",
				rows: 3,
				value: access.c2cAllow.join("\n"),
				onChange: (v) => {
					patch("access", {
						...access,
						c2cAllow: v.split("\n").map((s) => s.trim())
					});
				}
			}) : null, (0, react.createElement)(SegmentedRow, {
				label: "群聊",
				value: access.groupMode,
				options: MODE_OPTIONS,
				onChange: (v) => {
					patch("access", {
						...access,
						groupMode: v
					});
				}
			}), access.groupMode === "allowlist" ? (0, react.createElement)(AreaRow, {
				label: "群聊白名单",
				help: "请输入群 openid，多个请换行输入",
				rows: 3,
				value: access.groupAllow.join("\n"),
				onChange: (v) => {
					patch("access", {
						...access,
						groupAllow: v.split("\n").map((s) => s.trim())
					});
				}
			}) : null, (0, react.createElement)("div", { className: "imqb2-group-title" }, "基础设置"), (0, react.createElement)(SwitchRow, {
				label: "群聊仅回复 @机器人的消息",
				checked: form.requireMention ?? true,
				help: "开启后，机器人仅可回复 @机器人的群聊消息",
				onChange: (v) => {
					patch("requireMention", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "流式输出",
				checked: form.streaming ?? true,
				help: "回复内容分段实时推送到聊天",
				onChange: (v) => {
					patch("streaming", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "显示工具调用结果",
				checked: form.showToolResults ?? false,
				help: "在聊天中展示 agent 工具调用的结构化结果",
				onChange: (v) => {
					patch("showToolResults", v);
				}
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "模型"), (0, react.createElement)(FieldRow, {
				label: "Provider",
				value: form.provider ?? "",
				placeholder: "留空继承宿主默认",
				onChange: (v) => {
					patch("provider", v);
				}
			}), (0, react.createElement)(FieldRow, {
				label: "Model",
				value: form.model ?? "",
				placeholder: "留空继承宿主默认",
				onChange: (v) => {
					patch("model", v);
				}
			}), (0, react.createElement)(FieldRow, {
				label: "Preset",
				value: form.preset ?? "",
				placeholder: "Agent preset id",
				onChange: (v) => {
					patch("preset", v);
				}
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "个性化提示词"), (0, react.createElement)(AreaRow, {
				label: "群聊额外 system prompt",
				value: form.groupPrompt ?? "",
				onChange: (v) => {
					patch("groupPrompt", v);
				}
			}), (0, react.createElement)(AreaRow, {
				label: "私聊额外 system prompt",
				value: form.directPrompt ?? "",
				onChange: (v) => {
					patch("directPrompt", v);
				}
			}), form.cwd !== void 0 ? (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, "Agent 工作目录"), (0, react.createElement)("span", { className: "imqb2-hint" }, "只读")), (0, react.createElement)("p", { className: "imqb2-readonly" }, form.cwd)) : null, (0, react.createElement)("div", { className: "imqb2-footer" }, result !== null ? (0, react.createElement)("p", { className: `imqb2-note${result.ok ? " imqb2-note--ok" : " imqb2-note--error"}` }, (result.ok ? "" : "⚠️ ") + result.message) : dirty ? (0, react.createElement)("p", { className: "imqb2-note" }, "保存后插件将重载，进行中的机器人会话将重置") : (0, react.createElement)("p", { className: "imqb2-note" }), (0, react.createElement)("button", {
				className: "imqb2-save",
				type: "submit",
				disabled: busy || !dirty
			}, busy ? "正在保存…" : "保存")));
		}
		//#endregion
		//#region src/client/index.ts
		const name = "im-qqbot-client";
		const inject = [
			"slots",
			"sidebarRight",
			"sidebarRightTabs"
		];
		/** 侧栏 Tab 类型（ui-sidebar-right 契约的局部投影） */
		const TAB_KIND = "qqbot-bind";
		/** 席位注册 key（Tab 类型 id，席位按其分发；只需全局唯一，与包名解耦） */
		const TAB_ID = "im-qqbot/bind";
		/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
		const PACKAGE_NAME = "@tencent-connect/dsh-qqbot";
		/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
		const IM_MAIN_PANEL_ID = "im-qqbot";
		/** 绑定入口图标（QQ 机器人，跟随主题图标色变量） */
		function BindGuideIcon() {
			return (0, react.createElement)("svg", {
				width: 24,
				height: 24,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: "M9.50039 11.1504C9.96983 11.1504 10.3504 11.5309 10.3504 12.0004V14.0004C10.3504 14.4698 9.96983 14.8504 9.50039 14.8504C9.03095 14.8504 8.65039 14.4698 8.65039 14.0004V12.0004C8.65039 11.5309 9.03095 11.1504 9.50039 11.1504Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}), (0, react.createElement)("path", {
				d: "M14.5004 11.1504C14.9698 11.1504 15.3504 11.5309 15.3504 12.0004V14.0004C15.3504 14.4698 14.9698 14.8504 14.5004 14.8504C14.0309 14.8504 13.6504 14.4698 13.6504 14.0004V12.0004C13.6504 11.5309 14.0309 11.1504 14.5004 11.1504Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}), (0, react.createElement)("path", {
				fillRule: "evenodd",
				clipRule: "evenodd",
				d: "M12.8504 5.3109C13.5299 4.99138 14.0004 4.30063 14.0004 3.5C14.0004 2.39543 13.1049 1.5 12.0004 1.5C10.8958 1.5 10.0004 2.39543 10.0004 3.5C10.0004 4.30065 10.4708 4.99141 11.1504 5.31092V6.18851C6.38487 6.61795 2.65039 10.6231 2.65039 15.5004V17.0004C2.65039 19.679 4.82181 21.8504 7.50039 21.8504H16.5004C19.179 21.8504 21.3504 19.679 21.3504 17.0004V15.5004C21.3504 10.6231 17.6159 6.61795 12.8504 6.18851V5.3109ZM12.0004 7.85039C7.77541 7.85039 4.35039 11.2754 4.35039 15.5004V17.0004C4.35039 18.7401 5.76069 20.1504 7.50039 20.1504H16.5004C18.2401 20.1504 19.6504 18.7401 19.6504 17.0004V15.5004C19.6504 11.2754 16.2254 7.85039 12.0004 7.85039Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}));
		}
		/** 设置页栏目：共享一份绑定状态轮询，驱动绑定面板与配置刷新 */
		function QQBotSettingsSection() {
			const { state, gone, recheck } = useBindState();
			return (0, react.createElement)("div", null, (0, react.createElement)(BindPanelBody, {
				state,
				gone,
				recheck
			}), (0, react.createElement)(ConfigPanel, { bindPhase: state?.phase }));
		}
		/** 主面板页面：与设置栏目同一内容，包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
		function QQBotPage() {
			return (0, react.createElement)("div", { className: "imqb-pluginPage" }, (0, react.createElement)("div", { className: "imqb-pluginPageContent" }, (0, react.createElement)(QQBotSettingsSection)));
		}
		/** 左侧栏入口图标（宿主传入 size：展开 18 / 收起 16；currentColor 跟随侧栏配色与选中态） */
		function QqBotSidebarIcon({ size = 16 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "currentColor"
			}));
		}
		/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示 */
		function OpenQqBotAction({ subject, packageName, onOpen }) {
			if (subject?.kind !== "bundle" && subject?.kind !== "row") return null;
			if (subject.pkg?.name !== packageName) return null;
			if (subject.kind === "row" && subject.row?.moduleName !== packageName) return null;
			return (0, react.createElement)("button", {
				type: "button",
				className: "imqb-pluginOpen",
				onClick: onOpen
			}, "设置");
		}
		function apply(ctx) {
			installPanelStyles();
			const tabs = ctx.sidebarRightTabs;
			const right = ctx.sidebarRight;
			const slots = ctx.slots;
			const disposers = [];
			if (slots !== void 0) disposers.push(slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "qqbot",
				order: 7,
				label: "QQ 机器人"
			}, QQBotSettingsSection)));
			if (tabs !== void 0 && slots !== void 0) {
				disposers.push(tabs.register({
					id: TAB_ID,
					kind: TAB_KIND,
					title: () => "QQ 机器人绑定",
					guide: [{
						id: "bind",
						order: 90,
						title: () => "QQ 机器人绑定",
						description: () => "扫码或手动填写，绑定 QQ 机器人",
						icon: BindGuideIcon
					}]
				}));
				disposers.push(slots.inject("sidebar.right.pane.tab", () => slots.register({
					name: "sidebar.right.pane.tab",
					key: TAB_ID
				}, BindPanelBody)));
				disposers.push(watchAndPrompt(right));
			}
			const ctxInject = ctx.inject;
			if (typeof ctxInject === "function") ctxInject.call(ctx, ["layout"], (pageCtx) => {
				const pageSlots = pageCtx.slots;
				const layout = pageCtx.layout;
				if (pageSlots === void 0 || layout === void 0) return void 0;
				const stopMain = pageSlots.inject("main", () => pageSlots.register({
					name: "main",
					key: IM_MAIN_PANEL_ID
				}, QQBotPage));
				const stopActions = pageSlots.inject("plugins.detail.actions", () => pageSlots.register({
					name: "plugins.detail.actions",
					id: "im-qqbot-open",
					order: 20,
					inject: () => ({
						packageName: PACKAGE_NAME,
						onOpen: () => layout.selectPanel(IM_MAIN_PANEL_ID)
					})
				}, OpenQqBotAction));
				const stopSidebar = pageSlots.inject("sidebar.panellist", () => pageSlots.register({
					name: "sidebar.panellist",
					id: IM_MAIN_PANEL_ID,
					order: 10,
					label: "QQ 机器人"
				}, QqBotSidebarIcon));
				return () => {
					stopActions();
					stopSidebar();
					stopMain();
				};
			});
			ctx.effect(() => () => {
				for (const dispose of disposers.reverse()) dispose();
			}, "im-qqbot-client.binding");
		}
		/**
		* 轮询绑定状态：待绑定时自动打开绑定页。
		*
		* - 页面隐藏时降频轮询（可见时立即恢复节拍）
		* - 404（已绑定/未安装）时退避到 30s，保持低成本常驻探测
		* - 每次页面加载至多打开一次（用户手动关闭后不打扰）；
		*   打开失败（如启动早期 Session surface 尚未挂载）不消费机会，
		*   由下一轮轮询（3s）自动重试
		*/
		function watchAndPrompt(right) {
			let stopped = false;
			let opened = right === void 0;
			let timer;
			const schedule = (ms) => {
				timer = setTimeout(() => {
					tick();
				}, ms);
			};
			const tick = async () => {
				if (stopped) return;
				if (typeof document !== "undefined" && document.visibilityState === "hidden") {
					schedule(5e3);
					return;
				}
				try {
					const res = await fetch(BIND_STATE_PATH, { cache: "no-store" });
					if (res.ok) {
						if ((await res.json()).phase === "waiting" && !opened && right !== void 0) try {
							right.openTab(TAB_KIND);
							opened = true;
						} catch (err) {
							console.error("[im-qqbot] 打开绑定页失败，稍后重试", err);
						}
						schedule(3e3);
						return;
					}
					schedule(3e4);
					return;
				} catch {}
				schedule(1e4);
			};
			tick();
			return () => {
				stopped = true;
				if (timer !== void 0) clearTimeout(timer);
			};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
};

//# sourceMappingURL=client.js.map

// Local QQ extension settings and library panel (captured; merged below)
const __qqExtReg = {
  id: 'dsh-qqbot-ext',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API_PATH = '/qqbot-ext/config'
    const VISION_PATH = '/qqbot-ext/vision-models'
    const OPEN_FOLDER_PATH = '/qqbot-ext/open-folder'
    const STICKER_INDEX_PATH = '/qqbot-ext/sticker-index'
    const INDEX_DEFAULTS = {
      indexEnabled: false, indexProvider: '', indexModel: '', indexPrompt: '',
      indexMaxTokens: 1200, indexTimeoutMs: 60000,
      sameStickerCooldownSeconds: 600, stickerSendIntervalSeconds: 15,
    }
    const STICKER_FIELDS = ['enabled', 'collectMode', 'libraryDir', 'minBytes', 'maxBytes', 'minEdge', 'maxEdge', 'maxAspect', 'maxLibrary', 'pendingLimit', 'judgeEnabled', 'judgeProvider', 'judgeModel', 'judgePrompt', 'judgeMaxTokens', 'judgeTimeoutMs', ...Object.keys(INDEX_DEFAULTS)]
    const withIndexDefaults = (config) => config == null ? null : Object.fromEntries(STICKER_FIELDS.map((key) => [key, config[key] ?? INDEX_DEFAULTS[key]]))
    const STYLE_ID = 'qqbot-ext-panel-styles'
    const NS = 'dsh-qqbot-ext'
    const PANEL_ID = 'qqbot-ext'
    const TITLE = 'QQ 机器人扩展'

    /** 侧栏入口图标（currentColor 跟随主题与选中态）。 */
    function PanelIcon({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
      },
        h('path', {
          d: 'M12 2.6c4.6 0 8.4 3.4 8.4 7.6 0 1.6-.5 3-1.4 4.2 1.5.5 2.5 1.7 2.5 3.1 0 1.9-1.7 3.4-3.8 3.4-1 0-1.9-.3-2.6-.9-1 .5-2 .7-3.1.7-4.6 0-8.4-3.4-8.4-7.6S7.4 2.6 12 2.6Z',
          fill: 'currentColor', fillOpacity: 0.16,
        }),
        h('path', {
          d: 'M6.2 10.6c0-3.1 2.6-5.6 5.8-5.6 2.8 0 5.1 1.9 5.7 4.4.8-.2 1.5-.8 1.9-1.5.2-.4.9-.3 1 .2.2 1.9-.9 3.6-2.7 4.2-.4 2.4-2.6 4.2-5.4 4.2-3.5 0-6.3-2.6-6.3-5.9Z',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
        h('circle', { cx: 9.9, cy: 10.1, r: 0.9, fill: 'currentColor' }),
        h('path', {
          d: 'M11.4 14.4c.9.3 1.9.3 2.8 0',
          stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round',
        }))
    }

    function useStyles() {
      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined
        if (document.getElementById(STYLE_ID) !== null) return undefined
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = `

.qbe-configPanel[hidden] { display: none; }
.qbe-configTabs { position: sticky; top: 0; z-index: 2; padding: 10px 0;
  background: var(--dsw-alias-bg-layer-3, #202024); }
.qbe-configPanel { padding-bottom: 16px; }
.qbe-configPanel > .qbe-group { border-top: 0; padding-top: 8px; }
.qbe-advanced { margin: 12px 0; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 10px 12px; }
.qbe-advanced > summary { cursor: pointer; font-size: 13px; font-weight: 500; padding: 3px 0; }
.qbe-fieldGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 20px; }
.qbe-fieldGrid > .qbe-field { border-top: 0; }
.qbe-form > .qbe-footer { position: sticky; bottom: 0; z-index: 3; padding: 12px 0;
  background: var(--dsw-alias-bg-layer-3, #202024); }
@media (max-width: 600px) { .qbe-fieldGrid { grid-template-columns: 1fr; } .qbe-configTabs { gap: 2px; } .qbe-configTabs .qbe-tab { padding: 4px 8px; } }
.qbe-root { display: flex; flex-direction: column; min-width: 0; gap: 16px; }
.qbe-page { height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 24px clamp(16px, 4vw, 48px) 32px; color: var(--dsw-alias-label-primary); }
.qbe-pageInner { max-width: 960px; margin: 0 auto; }
.qbe-title { margin: 0; font-size: 18px; font-weight: 600; line-height: 26px; }
.qbe-subtitle { margin: 4px 0 0; font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-secondary); }
.qbe-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px; margin-top: 16px; }
.qbe-stat { border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.qbe-stat b { font-size: 16px; font-weight: 600; line-height: 22px; font-variant-numeric: tabular-nums; }
.qbe-stat span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.qbe-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2); padding-bottom: 10px; }
.qbe-tab { appearance: none; border: 0.5px solid transparent; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px;
  line-height: 20px; padding: 4px 12px; cursor: pointer; }
.qbe-tab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.qbe-tab[aria-selected='true'] { background: var(--dsw-alias-interactive-bg-active);
  border-color: var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); font-weight: 500; }
.qbe-tab:focus-visible, .qbe-save:focus-visible, .qbe-mini:focus-visible, .qbe-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
  var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.qbe-card { border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg, 12px);
  padding: 4px 16px 16px; margin-top: 12px; }
.qbe-cardHead { display: flex; align-items: flex-start; gap: 8px; padding: 14px 0 4px; }
.qbe-cardHead > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.qbe-cardHead h2 { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
.qbe-cardHead p { margin: 0; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); }
.qbe-form { display: flex; flex-direction: column; width: 100%; }
.qbe-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.qbe-field + .qbe-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.qbe-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.qbe-label { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary); }
.qbe-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.qbe-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere; }
.qbe-hint--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
.qbe-switch { box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px;
  padding: 2px; border: 0; border-radius: 999px; background: var(--dsw-alias-border-l3);
  cursor: pointer; font: inherit; }
.qbe-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.qbe-switch:disabled { cursor: default; opacity: .5; }
.qbe-thumb { display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #fff); transition: transform 120ms ease; }
.qbe-switch[aria-checked='true'] .qbe-thumb { transform: translateX(16px); }
.qbe-reset { flex: none; appearance: none; border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 11px; line-height: 16px; padding: 1px 9px; cursor: pointer;
  white-space: nowrap; }
.qbe-reset:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); }
.qbe-reset:disabled { opacity: .35; cursor: default; }
.qbe-reset:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid
  var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.qbe-input { box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); outline: none; }
.qbe-input:focus { border-color: var(--dsw-alias-state-business-primary); }
.qbe-select { appearance: none; padding-right: 28px; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 15px) calc(50% + 1px), calc(100% - 10px) calc(50% + 1px);
  background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; }
.qbe-select:disabled { opacity: .55; cursor: default; }
.qbe-label--sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.qbe-textarea { height: auto; padding: 8px 12px; resize: vertical; font-family: inherit;
  line-height: 1.6; min-height: 84px; }
.qbe-group { display: flex; flex-direction: column; gap: 14px; padding: 14px 0 2px;
  border-top: 0.5px solid var(--dsw-alias-border-l2); }
.qbe-groupHead { font-size: 12px; line-height: 18px; font-weight: 600;
  color: var(--dsw-alias-label-secondary); }
.qbe-pathRow { display: flex; gap: 8px; align-items: center; }
.qbe-pathRow .qbe-input { flex: 1; min-width: 0; }
.qbe-segmented { display: flex; gap: 0; border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 8px); overflow: hidden; width: fit-content; max-width: 100%; }
.qbe-segment { appearance: none; border: 0; border-left: 0.5px solid var(--dsw-alias-border-l2);
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px;
  line-height: 1.5; padding: 6px 14px; cursor: pointer; }
.qbe-segment:first-child { border-left: 0; }
.qbe-segment:hover:not(:disabled):not(.qbe-segment--on) { background: var(--dsw-alias-interactive-bg-hover); }
.qbe-segment--on { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.qbe-segment:disabled { opacity: .5; cursor: default; }
.qbe-mini { flex: none; height: 34px; padding: 0 12px; border-radius: var(--dsw-radius-md, 8px);
  border: 0.5px solid var(--dsw-alias-border-l2); background: transparent; color: inherit;
  font: inherit; font-size: 13px; cursor: pointer; }
.qbe-mini:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.qbe-mini:disabled { opacity: .5; cursor: default; }
.qbe-footer { display: flex; align-items: center; gap: 8px; padding-top: 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2); margin-top: 2px; }
.qbe-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-tertiary); }
.qbe-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
.qbe-save { appearance: none; flex: none; border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px; font: inherit; font-size: 13px;
  line-height: 1.5; cursor: pointer; background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3); }
.qbe-save:disabled { opacity: .4; cursor: default; }
.qbe-toolList { display: flex; flex-direction: column; }
.qbe-tool { display: flex; flex-direction: column; gap: 2px; padding: 10px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2); }
.qbe-tool:first-child { border-top: 0; }
.qbe-tool code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  color: var(--dsw-alias-label-primary); }
.qbe-tool span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.qbe-empty { padding: 24px 0; text-align: center; font-size: 13px;
  color: var(--dsw-alias-label-tertiary); }
`
        document.head.appendChild(style)
        return () => { style.remove() }
      }, [])
    }

    function Switch({ checked, label, onChange, disabled }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
        className: 'qbe-switch', disabled: disabled === true,
        onClick: () => onChange(!checked),
      }, h('span', { className: 'qbe-thumb' }))
    }

    /** 单个字段的「恢复默认」按钮：已经是默认值时禁用。 */
    function ResetButton({ isDefault, onReset, disabled, label }) {
      return h('button', {
        type: 'button',
        className: 'qbe-reset',
        title: isDefault === true ? '已经是默认值' : '恢复这一项的默认值',
        'aria-label': `恢复默认：${label}`,
        disabled: disabled === true || isDefault === true,
        onClick: onReset,
      }, '恢复默认')
    }

    /** 数值字段（label + 恢复默认 + 输入 + 说明）。 */
    function NumberField({ label, help, value, defaultValue, disabled, onChange, onReset }) {
      const isDefault = String(value ?? '') === String(defaultValue ?? '')
      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h(ResetButton, { isDefault, onReset, disabled, label })),
        h('input', {
          className: 'qbe-input', value: String(value ?? ''), inputMode: 'numeric', spellCheck: false,
          disabled: disabled === true,
          onChange: (event) => onChange(event.currentTarget.value),
        }),
        help === undefined ? null : h('p', { className: 'qbe-hint' }, help))
    }

    /** 二选一分段控件：用于收集模式这类互斥选项。 */
    function Segmented({ label, help, value, defaultValue, options, disabled, onChange, onReset }) {
      const isDefault = value === defaultValue
      const current = options.find((option) => option.value === value)
      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h(ResetButton, { isDefault, onReset, disabled, label })),
        h('div', { className: 'qbe-segmented', role: 'radiogroup', 'aria-label': label },
          options.map((option) => h('button', {
            key: option.value,
            type: 'button',
            role: 'radio',
            'aria-checked': option.value === value,
            className: `qbe-segment${option.value === value ? ' qbe-segment--on' : ''}`,
            disabled: disabled === true,
            onClick: () => onChange(option.value),
          }, option.label))),
        current === undefined || current.help === undefined
          ? null
          : h('p', { className: 'qbe-hint' }, current.help))
    }

    /** 单行文本字段。 */
    function TextField({ label, help, value, defaultValue, disabled, onChange, onReset, placeholder }) {
      const isDefault = String(value ?? '') === String(defaultValue ?? '')
      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h(ResetButton, { isDefault, onReset, disabled, label })),
        h('input', {
          className: 'qbe-input', value: String(value ?? ''), spellCheck: false,
          placeholder: placeholder ?? '', disabled: disabled === true,
          onChange: (event) => onChange(event.currentTarget.value),
        }),
        help === undefined ? null : h('p', { className: 'qbe-hint' }, help))
    }

    /** 多行文本字段（判定提示词这种长文本用）。 */
    function TextAreaField({ label, help, value, defaultValue, disabled, onChange, onReset, placeholder }) {
      const isDefault = String(value ?? '') === String(defaultValue ?? '')
      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h(ResetButton, { isDefault, onReset, disabled, label })),
        h('textarea', {
          className: 'qbe-input qbe-textarea', value: String(value ?? ''), spellCheck: false,
          rows: 4, placeholder: placeholder ?? '', disabled: disabled === true,
          onChange: (event) => onChange(event.currentTarget.value),
        }),
        help === undefined ? null : h('p', { className: 'qbe-hint' }, help))
    }

    function ToolList({ tools }) {
      if (!Array.isArray(tools) || tools.length === 0) return null
      return h('div', { className: 'qbe-toolList' }, tools.map((tool) =>
        h('div', { className: 'qbe-tool', key: tool.name },
          h('code', null, tool.name),
          h('span', null, tool.description || '—'))))
    }

    /**
     * 视觉模型选择：自动探测宿主已注册的 provider / 能看图的模型。
     * 探测失败或该 provider 没广告模型时退回手填，功能不至于不可用。
     */
    function VisionModelPicker({ form, defaults, disabled, patch, resetTo, prefix = 'judge' }) {
      const providerKey = `${prefix}Provider`
      const modelKey = `${prefix}Model`
      const label = prefix === 'index' ? '索引视觉模型' : '视觉模型'
      const [catalog, setCatalog] = React.useState(null)
      const [note, setNote] = React.useState(null)

      const load = () => {
        setNote(null)
        setCatalog(null)
        fetch(VISION_PATH, { headers: { accept: 'application/json' } })
          .then((res) => res.json())
          .then((body) => {
            setCatalog(body)
            if (body?.ok !== true) setNote(body?.error ?? '没能读取模型列表，可以手填')
          })
          .catch((error) => {
            setCatalog({ ok: false, providers: [] })
            setNote(error instanceof Error ? error.message : String(error))
          })
      }

      React.useEffect(() => { load() }, [])

      const providers = Array.isArray(catalog?.providers) ? catalog.providers : []
      const providerId = form[providerKey] ?? ''
      const current = providers.find((item) => item.id === providerId)
      const candidates = (current?.models ?? []).filter((model) => model.vision === true)
      const allVision = providers.flatMap((item) => (item.models ?? []).filter((m) => m.vision === true))
      const loading = catalog === null
      const noVision = catalog !== null && allVision.length === 0

      const pickProvider = (event) => {
        const next = event.currentTarget.value
        patch(providerKey, next)
        // 换 provider 时原 model 多半不再适用，自动挑第一个能看图的
        const target = providers.find((item) => item.id === next)
        const firstVision = target?.models?.find((model) => model.vision === true)
        patch(modelKey, firstVision?.id ?? '')
      }

      return h('div', { className: 'qbe-field' },
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label' }, label),
          h('button', {
            type: 'button', className: 'qbe-mini', disabled: disabled === true,
            title: '重新读取宿主已注册的 provider 与模型',
            onClick: load,
          }, loading ? '读取中…' : '重新检测')),
        providers.length > 0
          ? h('div', { className: 'qbe-pathRow' },
            h('select', {
              className: 'qbe-input qbe-select', value: providerId, disabled: disabled === true,
              'aria-label': `${label} provider`, onChange: pickProvider,
            },
            h('option', { value: '' }, '— 选择 provider —'),
            providers.map((item) => h('option', { key: item.id, value: item.id }, item.id))),
            h('select', {
              className: 'qbe-input qbe-select', value: form[modelKey] ?? '',
              disabled: disabled === true,
              'aria-label': `${label} model`, onChange: (event) => patch(modelKey, event.currentTarget.value),
            },
            h('option', { value: '' }, '— 选择模型 —'),
            candidates.map((model) => h('option', { key: model.id, value: model.id },
              model.name === model.id ? model.id : `${model.name}（${model.id}）`))))
          : null,
        note === null ? null : h('p', { className: 'qbe-hint qbe-hint--error' }, `⚠️ ${note}`),
        h('div', { className: 'qbe-pathRow' },
            h('input', {
              className: 'qbe-input', value: providerId, spellCheck: false, disabled: disabled === true,
              placeholder: prefix === 'index' ? `留空沿用判断 provider：${form.judgeProvider || '未设置'}` : '手动填 provider，例如 easy-cliproxyapi',
              'aria-label': `${label} provider（手填）`,
              onChange: (event) => patch(providerKey, event.currentTarget.value),
            }),
            h('input', {
              className: 'qbe-input', value: form[modelKey] ?? '', spellCheck: false, disabled: disabled === true,
              placeholder: prefix === 'index' ? `留空沿用判断 model：${form.judgeModel || '未设置'}` : '手动填能看图的 model',
              'aria-label': `${label} model（手填）`,
              onChange: (event) => patch(modelKey, event.currentTarget.value),
            })),
        h('p', { className: 'qbe-hint' }, loading
          ? '正在从宿主读取已注册的模型…'
          : noVision
            ? '没探测到声明了图片输入的模型。在 settings 里补上 input: [text, image] 后再点「重新检测」，也可以直接手填。'
            : `不支持看图的模型已隐藏。当前：${form[providerKey] || (prefix === 'index' ? form.judgeProvider : '') || '—'} / ${form[modelKey] || (prefix === 'index' ? form.judgeModel : '') || '—'}`),
        h('div', { className: 'qbe-head' },
          h('span', { className: 'qbe-label qbe-label--sub' }, '不选的话也可以手动指定'),
          h(ResetButton, {
            isDefault: `${form[providerKey] ?? ''}|${form[modelKey] ?? ''}` === `${defaults[providerKey] ?? ''}|${defaults[modelKey] ?? ''}`,
            onReset: () => { resetTo(providerKey)(); resetTo(modelKey)() },
            disabled: disabled, label,
          })))
    }

    /** 数据源：概览 + 组件清单 + 表情图库配置，一次拉齐。 */
    function useExtensionData() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      React.useEffect(() => {
        let stop = false
        fetch(API_PATH, { cache: 'no-store' }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const body = await res.json()
          if (body?.ok !== true) throw new Error(body?.error ?? '读取失败')
          if (!stop) { setData(body); setError(null) }
        }).catch((err) => { if (!stop) setError(err instanceof Error ? err.message : String(err)) })
        return () => { stop = true }
      }, [])
      return { data, setData, error }
    }

    /**
     * 调宿主的目录选择器（系统文件夹对话框）。
     *
     * 官方原生选择器（dsh-client-ui-directory-picker-native）的调法：
     * 优先 globalThis.__DSH_DIRECTORY_PICKER__（Desktop preload 注入），
     * 否则 ctx.uiWorkspace.pickDirectory()。这里依次尝试并把用了哪条路记下来，
     * 方便失败时看清到底缺什么，而不是只给一句“没有选择器”。
     */
    async function pickDirectory(getWorkspace) {
      const tried = []
      const desktop = globalThis.__DSH_DIRECTORY_PICKER__
      let workspace
      try {
        workspace = typeof getWorkspace === 'function' ? getWorkspace() : getWorkspace
      } catch (error) {
        tried.push(`uiWorkspace 取值抛错：${error instanceof Error ? error.message : String(error)}`)
        workspace = undefined
      }

      const candidates = [
        ['__DSH_DIRECTORY_PICKER__', typeof desktop?.pick === 'function' ? () => desktop.pick() : undefined],
        ['uiWorkspace.pickDirectory', typeof workspace?.pickDirectory === 'function' ? () => workspace.pickDirectory() : undefined],
      ]
      tried.push(`desktop=${desktop === undefined ? '无' : typeof desktop}, uiWorkspace=${workspace === undefined ? '无' : typeof workspace}`)

      for (const [name, pick] of candidates) {
        if (pick === undefined) continue
        try {
          const path = await pick()
          return {
            available: true,
            ok: true,
            via: name,
            path: path === null || path === undefined || path === '' ? null : String(path),
          }
        } catch (error) {
          return { available: true, ok: false, via: name, error: error instanceof Error ? error.message : String(error) }
        }
      }
      return { available: false, tried: tried.join('；') }
    }

    /** 图库索引管理与配置保存相互独立。 */
    function StickerIndexManager({ libraryDir }) {
      const [items, setItems] = React.useState([])
      const [status, setStatus] = React.useState(null)
      const [selected, setSelected] = React.useState('')
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const metadataOf = (item) => Object.fromEntries(
        ['text', 'description', 'emotions', 'scenes', 'avoid', 'confidence'].map((key) =>
          [key, item[key] ?? (['emotions', 'scenes', 'avoid'].includes(key) ? [] : key === 'confidence' ? 0 : '')]))
      const selectItem = (filename, list = items) => {
        setSelected(filename)
        const item = list.find((entry) => entry.filename === filename)
        setDraft(item ? JSON.stringify(metadataOf(item), null, 2) : '')
      }
      const request = async (body) => {
        const res = await fetch(STICKER_INDEX_PATH, body === undefined
          ? { cache: 'no-store', headers: { accept: 'application/json' } }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const result = await res.json().catch(() => ({}))
        if (!res.ok || result.ok !== true) throw new Error(result.error ?? `索引请求失败（HTTP ${res.status}）`)
        return result
      }
      const refresh = async (filename) => {
        const result = await request()
        const list = Array.isArray(result.items) ? result.items : []
        setItems(list)
        setStatus(result.status ?? null)
        selectItem(list.some((item) => item.filename === filename) ? filename : list[0]?.filename ?? '', list)
      }
      const perform = async (action) => {
        if (busy) return
        setBusy(true)
        setNote(null)
        try {
          let metadata
          if (action === 'update') {
            metadata = JSON.parse(draft)
            if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('元数据必须是 JSON 对象')
            for (const key of ['text', 'description']) {
              if (typeof metadata[key] !== 'string') throw new Error(`${key} 必须是字符串`)
            }
            for (const key of ['emotions', 'scenes', 'avoid']) {
              if (!Array.isArray(metadata[key]) || metadata[key].some((value) => typeof value !== 'string')) throw new Error(`${key} 必须是字符串数组`)
            }
            if (typeof metadata.confidence !== 'number' || !Number.isFinite(metadata.confidence) || metadata.confidence < 0 || metadata.confidence > 1) throw new Error('confidence 必须是 0 到 1 的数字')
            metadata = metadataOf(metadata)
          }
          if (action) await request({ action, ...(action === 'run' ? {} : { filename: selected }), ...(metadata ? { metadata } : {}) })
          await refresh(selected)
          setNote({ ok: true, message: action === 'update' ? '修正已保存' : action === 'retry' ? '已请求重新索引；可刷新查看进度' : action === 'run' ? '已请求补齐缺失索引；可刷新查看进度' : '列表已刷新' })
        } catch (error) {
          setNote({ ok: false, message: error instanceof Error ? error.message : String(error) })
        } finally { setBusy(false) }
      }
      React.useEffect(() => {
        let stopped = false
        setBusy(true)
        setNote(null)
        request().then((result) => {
          if (stopped) return
          const list = Array.isArray(result.items) ? result.items : []
          setItems(list)
          setStatus(result.status ?? null)
          selectItem(list[0]?.filename ?? '', list)
        }).catch((error) => {
          if (!stopped) setNote({ ok: false, message: error instanceof Error ? error.message : String(error) })
        }).finally(() => { if (!stopped) setBusy(false) })
        return () => { stopped = true }
      }, [libraryDir])
      return h('div', { className: 'qbe-group' },
        h('div', { className: 'qbe-groupHead' }, '图库索引管理'),
        h('p', { className: 'qbe-hint' }, '操作使用已保存的配置。刷新或切换图片会重新载入元数据，请先保存修正。'),
        h('div', { className: 'qbe-pathRow' },
          h('button', { type: 'button', className: 'qbe-mini', disabled: busy, onClick: () => perform() }, busy ? '处理中…' : '刷新列表'),
          h('button', { type: 'button', className: 'qbe-mini', disabled: busy, onClick: () => perform('run') }, '补齐缺失索引')),
        status === null ? null : h('pre', { className: 'qbe-hint', style: { whiteSpace: 'pre-wrap' } }, typeof status === 'string' ? status : JSON.stringify(status, null, 2)),
        note === null ? null : h('p', { role: note.ok ? 'status' : 'alert', className: `qbe-hint${note.ok ? '' : ' qbe-hint--error'}` }, note.message),
        h('label', { className: 'qbe-label', htmlFor: 'qbe-index-items' }, `图库图片（${items.length}）`),
        h('select', { id: 'qbe-index-items', className: 'qbe-input', size: 8,
          style: { height: 'auto', minHeight: '150px' }, value: selected, disabled: busy || items.length === 0,
          onChange: (event) => { selectItem(event.currentTarget.value); setNote(null) } },
          items.map((item) => h('option', { key: item.filename, value: item.filename }, `${item.filename}${item.manual ? ' · 人工修正' : ''}${item.description ? ` · ${item.description}` : ''}`))),
        items.length === 0 ? h('p', { className: 'qbe-hint' }, '暂无图片，请刷新或检查图库目录。') : null,
        h('label', { className: 'qbe-label', htmlFor: 'qbe-index-metadata' }, '所选图片元数据（JSON）'),
        h('textarea', { id: 'qbe-index-metadata', className: 'qbe-input qbe-textarea', rows: 14,
          style: { fontFamily: 'ui-monospace, monospace' }, value: draft, spellCheck: false,
          disabled: busy || !selected, onChange: (event) => { setDraft(event.currentTarget.value); setNote(null) } }),
        h('div', { className: 'qbe-pathRow' },
          h('button', { type: 'button', className: 'qbe-mini', disabled: busy || !selected, onClick: () => perform('update') }, '保存修正'),
          h('button', { type: 'button', className: 'qbe-mini', disabled: busy || !selected, onClick: () => perform('retry') }, '重新索引所选图片')))
    }

    /** 表情包图库组件：唯一可编辑的组件。 */
    function StickerLibrarySection({ data, setData, getWorkspace }) {
      const [initial, setInitial] = React.useState(() => withIndexDefaults(data.config))
      const [form, setForm] = React.useState(() => withIndexDefaults(data.config))
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [pickNote, setPickNote] = React.useState(null)
      const [opening, setOpening] = React.useState(false)
      const [tab, setTab] = React.useState('collect')

      React.useEffect(() => {
        setInitial(withIndexDefaults(data.config))
        setForm(withIndexDefaults(data.config))
      }, [data.config])

      const patch = (key, value) => {
        setForm((current) => ({ ...current, [key]: value }))
        setResult(null)
      }

      // 总开关实时生效：只持久化 enabled（不带未保存草稿），失败回滚并提示未生效。
      // 不整体替换 data.config——上方 useEffect 会因此重置整份表单丢掉草稿；
      // 只同步概览的 autoCollect 展示，initial/form 就地改 enabled 保持其余草稿。
      const toggleEnabled = (enabled) => {
        if (busy) return
        const previous = form.enabled === true
        patch('enabled', enabled)
        setBusy(true)
        fetch(API_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config: { enabled } }),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (res.ok && body.ok === true) {
            const next = body.config?.enabled === true
            setInitial((cur) => ({ ...cur, enabled: next }))
            setForm((cur) => ({ ...cur, enabled: next }))
            setData((current) => current === null ? current : {
              ...current,
              capabilities: { ...current.capabilities, autoCollect: next },
            })
            setResult({ ok: true, message: next ? '已开启自动收集，实时生效。' : '已关闭自动收集，实时生效。' })
            return
          }
          throw new Error(body.error ?? `保存失败（HTTP ${res.status}）`)
        }).catch((err) => {
          setForm((cur) => ({ ...cur, enabled: previous }))
          setResult({ ok: false, message: `开关保存失败（未生效）：${err instanceof Error ? err.message : String(err)}` })
        }).then(() => { setBusy(false) })
      }

      const submit = (event) => {
        event.preventDefault()
        if (busy || form === null) return
        setBusy(true)
        fetch(API_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config: form }),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (res.ok && body.ok === true) {
            setInitial(withIndexDefaults(body.config))
            setForm(withIndexDefaults(body.config))
            setData((current) => current === null ? current : {
              ...current,
              config: body.config,
              libraryDir: body.libraryDir,
              count: body.count,
              capabilities: { ...current.capabilities, stickerCount: body.count },
            })
            setResult({ ok: true, message: body.message ?? '设置已保存' })
            return
          }
          setResult({ ok: false, message: body.error ?? `保存失败（HTTP ${res.status}）` })
        }).catch((err) => {
          setResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
        }).then(() => { setBusy(false) })
      }

      // 打开系统文件夹选择器，选中即填回输入框（不直接落盘，仍需点保存）
      // 结果就近显示在路径下方，避免提示跑到表单最底部看不见。
      const chooseDir = () => {
        if (busy) return
        setBusy(true)
        setPickNote(null)
        pickDirectory(getWorkspace).then((picked) => {
          if (picked.available === false) {
            setPickNote({
              ok: false,
              message: `没能连上目录选择器，请直接手填路径。诊断：${picked.tried ?? '未知'}`,
            })
            return
          }
          if (picked.ok !== true) {
            setPickNote({ ok: false, message: `选择目录失败（${picked.via}）：${picked.error}` })
            return
          }
          if (picked.path === null || picked.path === undefined || picked.path === '') {
            setPickNote({ ok: true, message: '已取消选择' })
            return
          }
          patch('libraryDir', picked.path)
          setPickNote({ ok: true, message: `已选择：${picked.path}` })
        }).catch((error) => {
          setPickNote({ ok: false, message: `选择目录异常：${error instanceof Error ? error.message : String(error)}` })
        }).then(() => { setBusy(false) })
      }

      // 让宿主在系统文件管理器里打开图库目录（浏览器自己做不到）。
      // 打开的是已保存的生效目录，不是输入框里还没保存的值——避免"点了没反应"的错觉。
      const openFolder = () => {
        if (busy || opening) return
        setOpening(true)
        setPickNote(null)
        fetch(OPEN_FOLDER_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target: 'library' }),
        }).then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (res.ok && body.ok === true) {
            setPickNote({ ok: true, message: `已在文件管理器打开：${body.dir}` })
            return
          }
          setPickNote({ ok: false, message: body.error ?? `打开失败（HTTP ${res.status}）` })
        }).catch((error) => {
          setPickNote({ ok: false, message: `打开目录异常：${error instanceof Error ? error.message : String(error)}` })
        }).then(() => { setOpening(false) })
      }

      if (form === null) return h('div', { className: 'qbe-empty' }, '正在读取配置…')
      const dirty = JSON.stringify(form) !== JSON.stringify(initial)
      const defaults = { ...INDEX_DEFAULTS, ...data.defaults }
      const resetTo = (key) => () => {
        if (defaults[key] === undefined) return
        patch(key, defaults[key])
      }

      const sections = [['collect', '收集设置'], ['index', '图片理解'], ['send', '发送设置'], ['library', '图库管理']]
      const panel = (id, ...children) => h('div', { key: id, id: `qbe-panel-${id}`, role: 'tabpanel', 'aria-labelledby': `qbe-tab-${id}`, hidden: tab !== id, className: 'qbe-configPanel' }, ...children)
      return h('form', { className: 'qbe-form', onSubmit: submit },
        h('div', { className: 'qbe-tabs qbe-configTabs', role: 'tablist', 'aria-label': '图库设置分类' },
          sections.map(([id, label]) => h('button', { key: id, id: `qbe-tab-${id}`, type: 'button', role: 'tab',
            className: 'qbe-tab', 'aria-selected': tab === id, 'aria-controls': `qbe-panel-${id}`,
            onClick: () => setTab(id) }, label))),
        panel('collect',
        h('div', { className: 'qbe-field' },
          h('div', { className: 'qbe-head' },
            h('span', { className: 'qbe-label' }, '自动收集别人发的表情包'),
            h(ResetButton, {
              isDefault: (form.enabled === true) === (defaults.enabled === true),
              onReset: resetTo('enabled'), disabled: busy, label: '自动收集',
            }),
            h(Switch, { checked: form.enabled === true, label: '自动收集', disabled: busy, onChange: (v) => toggleEnabled(v) })),
          h('p', { className: 'qbe-help' }, '只收 QQ 明确标成表情、且同一条消息只有一张图片的；普通照片不收。开关实时生效，无需点保存。')),
        h(Segmented, {
          label: '收集方式',
          value: form.collectMode ?? 'auto',
          defaultValue: defaults.collectMode ?? 'auto',
          disabled: busy,
          onChange: (v) => patch('collectMode', v),
          onReset: resetTo('collectMode'),
          options: [
            {
              value: 'auto',
              label: '全收',
              help: '过了过滤条件就直接进图库，不问模型。',
            },
            {
              value: 'curated',
              label: '模型判断',
              help: '先放进暂存区，看过图觉得有意思才收进图库。暂存超过上限会自动丢最旧的。',
            },
          ],
        }),
        h('div', { className: 'qbe-field' },
          h('div', { className: 'qbe-head' },
            h('span', { className: 'qbe-label' }, '图库保存位置'),
            h(ResetButton, {
              isDefault: (form.libraryDir ?? '') === (defaults.libraryDir ?? ''),
              onReset: resetTo('libraryDir'), disabled: busy, label: '图库保存位置',
            })),
          h('div', { className: 'qbe-pathRow' },
            h('input', {
              className: 'qbe-input', value: form.libraryDir ?? '', spellCheck: false,
              placeholder: defaults.libraryDir ?? '',
              onChange: (event) => patch('libraryDir', event.currentTarget.value),
            }),
            h('button', {
              type: 'button', className: 'qbe-mini', disabled: busy,
              title: '打开系统文件夹选择框',
              onClick: chooseDir,
            }, busy ? '选择中…' : '选择目录'),
            h('button', {
              type: 'button', className: 'qbe-mini', disabled: busy || opening,
              title: '在文件管理器里打开图库目录',
              onClick: openFolder,
            }, opening ? '打开中…' : '打开目录')),
          pickNote === null ? null : h('p', {
            className: `qbe-hint${pickNote.ok ? '' : ' qbe-hint--error'}`,
          }, (pickNote.ok ? '' : '⚠️ ') + pickNote.message),
          h('p', { className: 'qbe-hint' },
            `当前生效：${data.libraryDir ?? '—'}（${data.count ?? 0} 张${data.libraryExists === false ? '，目录还没建' : ''}）。支持 ~ 与 %VAR%，保存后立即生效，不用重启。`)),
        h(NumberField, {
          label: '张数上限', value: form.maxLibrary, defaultValue: defaults.maxLibrary,
          onChange: (v) => patch('maxLibrary', v), onReset: resetTo('maxLibrary'), disabled: busy,
          help: '图库到达上限后不再收新的。',
        }),
        h(NumberField, {
          label: '暂存上限', value: form.pendingLimit, defaultValue: defaults.pendingLimit,
          onChange: (v) => patch('pendingLimit', v), onReset: resetTo('pendingLimit'), disabled: busy,
          help: '只在「模型判断」模式下有用：暂存区满了丢最旧的，0 表示不留。',
        }),
        h('details', { className: 'qbe-advanced' },
          h('summary', null, '模型筛选设置（仅模型判断模式）'),
          h('div', { className: 'qbe-field' },
            h('div', { className: 'qbe-head' },
              h('span', { className: 'qbe-label' }, '开启后台自动判断'),
              h(ResetButton, {
                isDefault: (form.judgeEnabled === true) === (defaults.judgeEnabled === true),
                onReset: resetTo('judgeEnabled'), disabled: busy, label: '开启后台自动判断',
              }),
              h(Switch, {
                checked: form.judgeEnabled === true, label: '后台自动判断',
                onChange: (v) => patch('judgeEnabled', v),
              })),
            h('p', { className: 'qbe-help' },
              '开启后，新表情会排队交给视觉模型逐张看，按下面的判定提示词决定收还是丢。关着就完全不调用模型。')),
          h(VisionModelPicker, {
            form, defaults, disabled: busy, patch, resetTo,
          }),
          h(TextAreaField, {
            label: '判定提示词', value: form.judgePrompt, defaultValue: defaults.judgePrompt,
            onChange: (v) => patch('judgePrompt', v), onReset: resetTo('judgePrompt'), disabled: busy,
            placeholder: '留空则用内置默认提示词',
            help: '模型的审美标准就写在这里。以后接了人格/人设模块，改这段文字就行，不用动代码。要求模型第一行回 KEEP 或 DROP。',
          }),
          h(NumberField, {
            label: '判断输出 token 上限', value: form.judgeMaxTokens, defaultValue: defaults.judgeMaxTokens,
            onChange: (v) => patch('judgeMaxTokens', v), onReset: resetTo('judgeMaxTokens'), disabled: busy,
          }),
          h(NumberField, {
            label: '判断超时（毫秒）', value: form.judgeTimeoutMs, defaultValue: defaults.judgeTimeoutMs,
            onChange: (v) => patch('judgeTimeoutMs', v), onReset: resetTo('judgeTimeoutMs'), disabled: busy,
            help: '单张图最多等这么久，超时就跳过、留在暂存区下次再判。',
          })),
          h('details', { className: 'qbe-advanced' }, h('summary', null, '高级过滤设置'),
            h('div', { className: 'qbe-fieldGrid' },
        h(NumberField, {
          label: '最小字节', value: form.minBytes, defaultValue: defaults.minBytes,
          onChange: (v) => patch('minBytes', v), onReset: resetTo('minBytes'), disabled: busy,
          help: '太小的是图标，挡掉。',
        }),
        h(NumberField, {
          label: '最大字节', value: form.maxBytes, defaultValue: defaults.maxBytes,
          onChange: (v) => patch('maxBytes', v), onReset: resetTo('maxBytes'), disabled: busy,
          help: '太大的是照片或动图，挡掉。',
        }),
        h(NumberField, {
          label: '最小长边（像素）', value: form.minEdge, defaultValue: defaults.minEdge,
          onChange: (v) => patch('minEdge', v), onReset: resetTo('minEdge'), disabled: busy,
        }),
        h(NumberField, {
          label: '最大长边（像素）', value: form.maxEdge, defaultValue: defaults.maxEdge,
          onChange: (v) => patch('maxEdge', v), onReset: resetTo('maxEdge'), disabled: busy,
        }),
        h(NumberField, {
          label: '最大长宽比', value: form.maxAspect, defaultValue: defaults.maxAspect,
          onChange: (v) => patch('maxAspect', v), onReset: resetTo('maxAspect'), disabled: busy,
          help: '2 表示长边最多是短边的两倍，太长的截图会被挡掉。',
        })))),
        panel('index',
        h('div', { className: 'qbe-group' },
          h('div', { className: 'qbe-groupHead' }, '图片内容索引（全收与模型判断模式均可使用）'),
          h('div', { className: 'qbe-field' },
            h('div', { className: 'qbe-head' },
              h('span', { className: 'qbe-label' }, '开启图片索引'),
              h(ResetButton, { isDefault: form.indexEnabled === defaults.indexEnabled,
                onReset: resetTo('indexEnabled'), disabled: busy, label: '图片索引' }),
              h(Switch, { checked: form.indexEnabled === true, label: '图片索引', disabled: busy,
                onChange: (value) => patch('indexEnabled', value) })),
            h('p', { className: 'qbe-help' }, '为图库图片生成文字、描述和场景标签，独立于收集模式。默认关闭。')),
          h(VisionModelPicker, { form, defaults, disabled: busy, patch, resetTo, prefix: 'index' }),
          h('p', { className: 'qbe-hint' }, '索引 provider 与 model 分别留空时，沿用后台判断的对应配置。'),
          h(TextAreaField, { label: '索引提示词', value: form.indexPrompt, defaultValue: defaults.indexPrompt,
            onChange: (value) => patch('indexPrompt', value), onReset: resetTo('indexPrompt'), disabled: busy,
            placeholder: '留空使用内置索引提示词' }),
          h(NumberField, { label: '索引输出 token 上限', value: form.indexMaxTokens, defaultValue: defaults.indexMaxTokens,
            onChange: (value) => patch('indexMaxTokens', value), onReset: resetTo('indexMaxTokens'), disabled: busy }),
          h(NumberField, { label: '索引超时（毫秒）', value: form.indexTimeoutMs, defaultValue: defaults.indexTimeoutMs,
            onChange: (value) => patch('indexTimeoutMs', value), onReset: resetTo('indexTimeoutMs'), disabled: busy }))),
        panel('send',
        h('div', { className: 'qbe-group' },
          h('div', { className: 'qbe-groupHead' }, '表情发送冷却'),
          h(NumberField, { label: '同一张表情冷却（秒）', value: form.sameStickerCooldownSeconds,
            defaultValue: defaults.sameStickerCooldownSeconds, disabled: busy,
            onChange: (value) => patch('sameStickerCooldownSeconds', value), onReset: resetTo('sameStickerCooldownSeconds'),
            help: '默认 600 秒，0 表示关闭同图冷却。' }),
          h(NumberField, { label: '表情发送间隔（秒）', value: form.stickerSendIntervalSeconds,
            defaultValue: defaults.stickerSendIntervalSeconds, disabled: busy,
            onChange: (value) => patch('stickerSendIntervalSeconds', value), onReset: resetTo('stickerSendIntervalSeconds'),
            help: '默认 15 秒，0 表示关闭发送间隔限制。' }))),
        panel('library', h(StickerIndexManager, { libraryDir: data.libraryDir })),
        h('div', { className: 'qbe-footer' },
          result !== null
            ? h('p', { className: `qbe-note${result.ok ? '' : ' qbe-note--error'}` }, (result.ok ? '' : '⚠️ ') + result.message)
            : h('p', { className: 'qbe-note' }, dirty ? '有改动还没保存' : ''),
          h('button', {
            type: 'button', className: 'qbe-mini', disabled: busy,
            title: '把所有项都恢复成默认值',
            onClick: () => { setForm({ ...defaults }); setResult(null) },
          }, '全部恢复'),
          h('button', { className: 'qbe-save', type: 'submit', disabled: busy || !dirty },
            busy ? '保存中…' : '保存')))
    }

    /** 角色配置在本地草稿中编辑，保存时一次提交整个 config；
     * 「启用角色扮演」总开关例外：切换即单独持久化、实时生效。 */
    function RoleplaySection() {
      const path = '/qqbot-ext/roleplay'
      const [config, setConfig] = React.useState(null)
      const [saved, setSaved] = React.useState('')
      const [revision, setRevision] = React.useState('')
      const [selected, setSelected] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      const [note, setNote] = React.useState(null)
      const [importName, setImportName] = React.useState('')
      const [importContent, setImportContent] = React.useState('')
      const [loadVersion, setLoadVersion] = React.useState(0)
      const fileInput = React.useRef(null)
      const dirty = config !== null && JSON.stringify(config) !== saved
      const hasDraft = dirty || importName !== '' || importContent !== ''
      const newId = () => typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID() : `card-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const message = (error) => error instanceof Error ? error.message : String(error)
      const request = async (payload) => {
        const response = await fetch(path, payload === undefined
          ? { headers: { accept: 'application/json' } }
          : { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(payload) })
        const body = await response.json()
        if (response.status === 409) throw new Error('另一页面已更新角色配置，请先备份当前草稿并重新打开配置。')
        if (!response.ok || body?.ok !== true) throw new Error(body?.error || `请求失败（${response.status}）`)
        return body
      }

      React.useEffect(() => {
        let alive = true
        setLoading(true)
        setNote(null)
        request().then((body) => {
          if (!body.config || !Array.isArray(body.config.cards) || !Array.isArray(body.config.bindings)) {
            throw new Error('角色配置格式无效')
          }
          if (!alive) return
          setConfig(body.config)
          setRevision(body.revision)
          setSaved(JSON.stringify(body.config))
          setSelected(body.config.cards[0]?.id ?? '')
        }).catch((error) => {
          if (alive) setNote({ ok: false, text: `读取角色配置失败：${message(error)}` })
        }).finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
      }, [loadVersion])

      React.useEffect(() => {
        if (!hasDraft) return undefined
        const warn = (event) => { event.preventDefault(); event.returnValue = '' }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
      }, [hasDraft])

      const patch = (update) => { setConfig((previous) => update(previous)); setNote(null) }
      const editCard = (key, value) => patch((previous) => ({ ...previous,
        cards: previous.cards.map((card) => card.id === selected ? { ...card, [key]: value } : card) }))
      const appendCard = (card) => {
        // 导入可能带入已有 id；保留旧卡，给新草稿分配独立 id。
        patch((previous) => ({ ...previous, cards: [...previous.cards, card] }))
        setSelected(card.id)
      }
      const removeCard = () => {
        const card = config.cards.find((item) => item.id === selected)
        if (!card || !window.confirm(`删除角色「${card.name || '未命名'}」？关联会话将改为禁用默认角色；保存后生效。`)) return
        const remaining = config.cards.filter((item) => item.id !== selected)
        patch((previous) => ({ ...previous, cards: remaining,
          defaultCardId: previous.defaultCardId === selected ? '' : previous.defaultCardId,
          bindings: previous.bindings.map((binding) => binding.cardId === selected
            ? { ...binding, cardId: '' } : binding) }))
        setSelected(remaining[0]?.id ?? '')
      }
      const parseImport = async (name, content) => {
        if (!content.trim()) throw new Error('请先选择文件或粘贴角色内容')
        const body = await request({ action: 'import', name, content })
        if (!body.card || typeof body.card.name !== 'string' || typeof body.card.content !== 'string') {
          throw new Error('导入接口未返回有效角色卡')
        }
        const id = typeof body.card.id === 'string' && body.card.id && !config.cards.some((card) => card.id === body.card.id)
          ? body.card.id : newId()
        appendCard({ ...body.card, id })
        setImportName('')
        setImportContent('')
        setNote({ ok: true, text: '角色卡已并入草稿，点击保存后生效。' })
      }
      const importPaste = async () => {
        setBusy(true)
        setNote(null)
        try { await parseImport(importName, importContent) }
        catch (error) { setNote({ ok: false, text: `导入失败：${message(error)}` }) }
        finally { setBusy(false) }
      }
      const importFile = async (event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (!file) return
        if (file.size > 3 * 1024 * 1024) {
          setNote({ ok: false, text: '文件不能超过 3 MB' }); return
        }
        if (!/\.(txt|md|json)$/i.test(file.name)) {
          setNote({ ok: false, text: '请选择 txt、md 或 json 文件' }); return
        }
        setBusy(true)
        setNote(null)
        try {
          const content = await file.text()
          // 解析失败时保留文件文本，方便修正后重新导入。
          setImportName(file.name.replace(/\.(txt|md|json)$/i, ''))
          setImportContent(content)
          await parseImport(file.name.replace(/\.(txt|md|json)$/i, ''), content)
        } catch (error) { setNote({ ok: false, text: `导入失败：${message(error)}` }) }
        finally { setBusy(false) }
      }
      const save = async (event) => {
        event.preventDefault()
        if (busy || !dirty) return
        const keys = new Set()
        const ids = new Set(config.cards.map((card) => card.id))
        for (const binding of config.bindings) {
          if (typeof binding.conversationKey !== 'string' || !binding.conversationKey.trim()) {
            setNote({ ok: false, text: '会话标识不能为空，请填写或删除空绑定。' }); return
          }
          if (keys.has(binding.conversationKey)) {
            setNote({ ok: false, text: `会话绑定重复：${binding.conversationKey}` }); return
          }
          keys.add(binding.conversationKey)
          if (binding.cardId && !ids.has(binding.cardId)) {
            setNote({ ok: false, text: '会话绑定的角色不存在，请重新选择。' }); return
          }
        }
        if (config.defaultCardId && !ids.has(config.defaultCardId)) {
          setNote({ ok: false, text: '默认角色不存在，请重新选择。' }); return
        }
        setBusy(true)
        setNote(null)
        try {
          const body = await request({ config, revision })
          const next = body.config ?? config
          setConfig(next)
          setRevision(body.revision)
          setSaved(JSON.stringify(next))
          setNote({ ok: true, text: body.message || '已保存，QQ 会话下一轮生效。' })
        } catch (error) { setNote({ ok: false, text: `保存失败，草稿已保留：${message(error)}` }) }
        finally { setBusy(false) }
      }

      // 总开关实时生效：基于「上次已保存快照」只持久化 enabled，不带入页面未保存
      // 草稿（卡片正文/绑定等仍走统一保存）。失败回滚开关并明确提示未生效。
      const toggleEnabled = async (enabled) => {
        if (busy || config === null) return
        let base
        try { base = JSON.parse(saved) } catch {
          setNote({ ok: false, text: '开关保存失败：已保存配置快照无效，请重新打开配置。' }); return
        }
        const previousEnabled = config.enabled === true
        patch((previous) => ({ ...previous, enabled }))
        setBusy(true)
        try {
          const body = await request({ config: { ...base, enabled }, revision })
          const next = body.config ?? { ...base, enabled }
          setSaved(JSON.stringify(next))
          setRevision(body.revision)
          setConfig((previous) => ({ ...previous, enabled: next.enabled === true }))
          const rotated = typeof body.rotated === 'number' ? body.rotated : 0
          setNote({ ok: true, text: (enabled ? '已开启人物扮演' : '已关闭人物扮演') + '，实时生效（QQ 下一轮）'
            + (rotated > 0 ? `；${rotated} 个相关 QQ 会话已自动换新。` : '。') })
        } catch (error) {
          setConfig((previous) => ({ ...previous, enabled: previousEnabled }))
          setNote({ ok: false, text: `开关保存失败（未生效）：${message(error)}` })
        } finally { setBusy(false) }
      }

      if (loading) return h('div', { className: 'qbe-empty' }, '正在读取角色配置…')
      if (config === null) return h('div', { className: 'qbe-field' },
        h('p', { className: 'qbe-note qbe-note--error', role: 'alert' }, note?.text),
        h('button', { type: 'button', className: 'qbe-mini', onClick: () => setLoadVersion((v) => v + 1) }, '重试'))
      const card = config.cards.find((item) => item.id === selected)
      const options = (emptyLabel, value) => [
        h('option', { key: '', value: '' }, emptyLabel),
        ...config.cards.map((item) => h('option', { key: item.id, value: item.id }, item.name || '未命名角色')),
        value && !config.cards.some((item) => item.id === value)
          ? h('option', { key: value, value }, `角色不存在：${value}`) : null,
      ]
      return h('form', { className: 'qbe-form', onSubmit: save },
        h('p', { className: 'qbe-help' }, '仅对 QQ 会话生效。「启用角色扮演」总开关实时生效、无需保存；其余改动点底部「保存全部配置」后从下一轮开始应用。总开关切换或更换角色卡后，相关 QQ 会话会自动换新，消除旧人设历史影响。'),
        h('p', { className: 'qbe-hint' }, '切换角色卡或扩展组件会保留此页草稿；除总开关外全部配置统一保存。刷新或关闭页面前请保存。'),
        h('fieldset', { disabled: busy, style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
          h('div', { className: 'qbe-field' },
            h('div', { className: 'qbe-head' },
              h('span', { className: 'qbe-label' }, '启用角色扮演'),
              h(Switch, { label: '启用角色扮演', checked: config.enabled === true, disabled: busy,
                onChange: (enabled) => { void toggleEnabled(enabled) } })),
            h('p', { className: 'qbe-hint' }, '总开关实时生效（QQ 下一轮），无需点保存；切换开关或更换角色卡后相关 QQ 会话自动换新。')),
          h('label', { className: 'qbe-field' },
            h('span', { className: 'qbe-label' }, '默认角色'),
            h('select', { className: 'qbe-input qbe-select', value: config.defaultCardId,
              onChange: (event) => { const value = event.currentTarget.value; patch((previous) => ({ ...previous, defaultCardId: value })) } },
              options('不使用默认角色', config.defaultCardId))),
          h('div', { className: 'qbe-field' },
            h('div', { className: 'qbe-head' },
              h('span', { className: 'qbe-label' }, '角色卡'),
              h('button', { type: 'button', className: 'qbe-mini', onClick: () => appendCard({ id: newId(), name: '新角色', content: '' }) }, '新增'),
              h('button', { type: 'button', className: 'qbe-mini', disabled: !card, onClick: removeCard }, '删除当前角色')),
            h('select', { className: 'qbe-input qbe-select', 'aria-label': '切换编辑的角色卡', value: selected,
              onChange: (event) => setSelected(event.currentTarget.value) },
              config.cards.length ? config.cards.map((item) => h('option', { key: item.id, value: item.id }, item.name || '未命名角色'))
                : h('option', { value: '' }, '暂无角色卡，请新增或导入')),
            card ? h(React.Fragment, null,
              h('label', { className: 'qbe-field' }, h('span', { className: 'qbe-label' }, '角色名称'),
                h('input', { className: 'qbe-input', value: card.name, onChange: (event) => editCard('name', event.currentTarget.value) })),
              h('label', { className: 'qbe-field' }, h('span', { className: 'qbe-label' }, '角色正文'),
                h('textarea', { className: 'qbe-input qbe-textarea', rows: 12, spellCheck: false,
                  value: card.content, onChange: (event) => editCard('content', event.currentTarget.value) }))) : null),
          h('details', { className: 'qbe-advanced' },
            h('summary', null, '导入角色卡（txt / md / json）'),
            h('p', { className: 'qbe-hint' }, '文件与粘贴内容交给接口解析，仅加入草稿，不会直接保存。'),
            h('input', { type: 'file', accept: '.txt,.md,.json,text/plain,text/markdown,application/json',
              ref: fileInput, hidden: true, onChange: importFile }),
            h('button', { type: 'button', className: 'qbe-mini', onClick: () => {
              if ((importName || importContent) && !window.confirm('选择文件将替换尚未导入的粘贴内容，继续？')) return
              fileInput.current?.click()
            } }, '上传文件'),
            h('label', { className: 'qbe-field' }, h('span', { className: 'qbe-label' }, '导入名称（可选）'),
              h('input', { className: 'qbe-input', value: importName, onChange: (event) => setImportName(event.currentTarget.value) })),
            h('label', { className: 'qbe-field' }, h('span', { className: 'qbe-label' }, '粘贴文本或 JSON'),
              h('textarea', { className: 'qbe-input qbe-textarea', rows: 6, value: importContent,
                onChange: (event) => setImportContent(event.currentTarget.value) })),
            h('button', { type: 'button', className: 'qbe-mini', disabled: !importContent.trim(), onClick: importPaste }, '解析并加入草稿')),
          h('div', { className: 'qbe-field' },
            h('div', { className: 'qbe-head' }, h('span', { className: 'qbe-label' }, '会话绑定'),
              h('button', { type: 'button', className: 'qbe-mini', onClick: () => patch((previous) => ({ ...previous,
                bindings: [...previous.bindings, { conversationKey: '', cardId: '' }] })) }, '新增绑定')),
            h('p', { className: 'qbe-help' }, '给某个 QQ 群或私聊指定专用角色。该聊天优先使用绑定角色，其他未绑定的聊天继续使用默认角色。'),
            h('div', { className: 'qbe-advanced' },
              h('div', { className: 'qbe-groupHead' }, '如何添加绑定'),
              h('ol', { className: 'qbe-help', style: { paddingLeft: 20, margin: '8px 0' } },
                h('li', null, '先在上方新增或导入角色卡，并打开“启用角色扮演”。'),
                h('li', null, '点击“新增绑定”，按下面的格式填写完整会话标识，再选择要使用的角色。'),
                h('li', null, '点击底部“保存全部配置”。从该 QQ 聊天的下一轮消息开始生效。')),
              h('div', { className: 'qbe-groupHead' }, '官方 QQ 机器人的会话标识'),
              h('p', { className: 'qbe-help' }, '私聊格式：', h('code', null, 'qqbot:appId:c2c:用户openid'), '；群聊格式：', h('code', null, 'qqbot:appId:group:群openid'), '。'),
              h('p', { className: 'qbe-help' }, 'appId：填写 QQ 开放平台中该机器人应用的 AppID。用户 openid：填写官方私聊消息事件中的 author.user_openid。群 openid：填写官方群消息事件中的 group_openid。可从官方机器人网关日志或消息事件记录查找对应字段。'),
              h('p', { className: 'qbe-help' }, '例如机器人 AppID 为 123456789，群消息中的 group_openid 为 ABCDEF，完整标识为 ', h('code', null, 'qqbot:123456789:group:ABCDEF'), '；私聊消息中的 user_openid 为 UVWXYZ，则填写 ', h('code', null, 'qqbot:123456789:c2c:UVWXYZ'), '。这里的 AppID 和 openid 都是示例，请替换为实际值。'),
              h('p', { className: 'qbe-hint' }, 'openid 是官方平台分配的标识，不能用 QQ 号、群号、昵称或群名称代替，也不要填写 DSH 会话 ID。保留 qqbot 前缀、c2c / group 和半角冒号，不要照填占位词。同一个会话标识只能绑定一次。'),
              h('div', { className: 'qbe-groupHead', style: { marginTop: 12 } }, '生效规则与例子'),
              h('p', { className: 'qbe-help' }, '例如默认角色为“小鲸鱼”，将 qqbot:123456789:group:ABCDEF 绑定为“旅行者”：该群使用“旅行者”，其他没有绑定的聊天继续使用“小鲸鱼”。群绑定对整个群生效，暂不支持同一群按成员分别绑定。'),
              h('p', { className: 'qbe-help' }, '选择“禁用默认角色”：该聊天不注入本模块的任何角色；工作区原有的人设仍可能生效。删除绑定：该聊天恢复使用默认角色；如果没有默认角色，就不注入本模块人设。'),
              h('p', { className: 'qbe-hint' }, '绑定跟随 QQ 群或私聊目标，会话自动换新后仍然保留。切换差异较大的角色保存后，相关 QQ 会话会自动换新，减少旧角色历史的影响。关闭顶部总开关会立即停用全部默认角色和绑定角色（实时生效，无需保存）。')),
            config.bindings.length === 0 ? h('p', { className: 'qbe-hint' }, '暂无绑定，QQ 会话使用默认角色。') : null,
            config.bindings.map((binding, index) => h('div', { className: 'qbe-field', key: index },
              h('label', null, h('span', { className: 'qbe-label' }, `会话标识 ${index + 1}`),
                h('input', { className: 'qbe-input', value: binding.conversationKey, spellCheck: false, placeholder: 'qqbot:实际AppID:group:实际群openid',
                  onChange: (event) => { const value = event.currentTarget.value; patch((previous) => ({ ...previous,
                    bindings: previous.bindings.map((item, i) => i === index ? { ...item, conversationKey: value } : item) })) } })),
              h('div', { className: 'qbe-pathRow' },
                h('select', { className: 'qbe-input qbe-select', 'aria-label': `会话 ${index + 1} 绑定角色`, value: binding.cardId,
                  onChange: (event) => { const value = event.currentTarget.value; patch((previous) => ({ ...previous,
                    bindings: previous.bindings.map((item, i) => i === index ? { ...item, cardId: value } : item) })) } },
                  options('禁用默认角色', binding.cardId)),
                h('button', { type: 'button', className: 'qbe-mini', onClick: () => {
                  if (!window.confirm('删除此绑定？保存后该会话将恢复默认角色。')) return
                  patch((previous) => ({ ...previous, bindings: previous.bindings.filter((_, i) => i !== index) }))
                } }, '删除绑定')))))),
        h('div', { className: 'qbe-footer' },
          h('p', { className: `qbe-note${note && !note.ok ? ' qbe-note--error' : ''}`, role: note && !note.ok ? 'alert' : 'status', 'aria-live': 'polite' },
            note?.text || (dirty ? '有改动还没保存' : '配置已保存'),
            importContent || importName ? ' 另有导入内容尚未加入草稿。' : ''),
          h('button', { type: 'submit', className: 'qbe-save', disabled: busy || !dirty }, busy ? '处理中…' : '保存全部配置')))
    }

    function GeneralSettings({ initialOpenid, inputRef }) {
      const [saved, setSaved] = React.useState(initialOpenid)
      const [value, setValue] = React.useState(initialOpenid)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const save = async (event) => {
        event.preventDefault()
        if (busy || value === saved) return
        setBusy(true)
        setNote(null)
        try {
          const response = await fetch(API_PATH, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: { adminOpenid: value } }),
          })
          const body = await response.json()
          if (!response.ok || body?.ok !== true) throw new Error(body?.error ?? `保存失败（HTTP ${response.status}）`)
          setSaved(body.config.adminOpenid)
          setValue(body.config.adminOpenid)
          setNote({ ok: true, text: '管理员 OpenID 已保存，立即生效。' })
        } catch (error) {
          setNote({ ok: false, text: `保存失败，草稿已保留。${error.message ?? error}` })
        } finally { setBusy(false) }
      }
      const helpId = React.useId()
      return h('div', { className: 'qbe-card' },
        h('div', { className: 'qbe-cardHead' }, h('h2', null, '总配置')),
        h('form', { className: 'qbe-form', onSubmit: save },
          h('label', { className: 'qbe-field' },
            h('span', { className: 'qbe-label' }, '管理员 OpenID'),
            h('input', { className: 'qbe-input', ref: inputRef, value, disabled: busy, maxLength: 128,
              'aria-describedby': helpId, onChange: (event) => { setValue(event.target.value); setNote(null) } }),
            h('span', { id: helpId, className: 'qbe-hint' }, '用于接收错误与熔断通知，以及授权 /resume。留空时使用 QQ 机器人私聊白名单的首位用户。')),
          h('div', { className: 'qbe-footer' },
            h('p', { className: `qbe-note${note && !note.ok ? ' qbe-note--error' : ''}`, role: note && !note.ok ? 'alert' : 'status' },
              note?.text ?? (value !== saved ? '有改动还没保存' : '配置已保存')),
            h('button', { type: 'submit', className: 'qbe-save', disabled: busy || value === saved }, busy ? '保存中…' : '保存管理员 OpenID'))))
    }

    /** 错误拦截组件独立保存友好提示与熔断参数。 */
    function ErrorGuardSection({ focusAdmin }) {
      const path = '/qqbot-ext/config'
      const FIELDS = ['errorGuardEnabled', 'errorNoticeText', 'breakerThreshold']
      const pick = (config) => Object.fromEntries(FIELDS.map((key) => [key, config?.[key]]))
      const [form, setForm] = React.useState(null)
      const [defaults, setDefaults] = React.useState(null)
      const [saved, setSaved] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const [loadVersion, setLoadVersion] = React.useState(0)
      const dirty = form !== null && JSON.stringify(form) !== saved
      React.useEffect(() => {
        let alive = true
        fetch(path, { headers: { accept: 'application/json' } }).then((response) => response.json()).then((body) => {
          if (!alive) return
          if (body?.ok !== true) throw new Error(body?.error ?? '读取失败')
          const subset = pick(body.config)
          setForm(subset)
          setDefaults(pick(body.defaults))
          setSaved(JSON.stringify(subset))
          setNote(null)
        }).catch((error) => { if (alive) setNote({ ok: false, text: `读取错误拦截配置失败：${error.message ?? error}` }) })
        return () => { alive = false }
      }, [loadVersion])
      const patch = (key, value) => { setForm((previous) => ({ ...previous, [key]: value })); setNote(null) }
      const resetTo = (key) => () => patch(key, defaults?.[key])
      // 总开关实时生效：只持久化 errorGuardEnabled（不带未保存草稿），失败回滚并提示未生效。
      const toggleEnabled = (enabled) => {
        if (busy || form === null) return
        const previous = form.errorGuardEnabled === true
        patch('errorGuardEnabled', enabled)
        setBusy(true)
        fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ config: { errorGuardEnabled: enabled } }) })
          .then(async (response) => {
            const body = await response.json().catch(() => ({}))
            if (!response.ok || body?.ok !== true) throw new Error(body?.error ?? `保存失败（${response.status}）`)
            const next = body.config?.errorGuardEnabled === true
            setForm((cur) => ({ ...cur, errorGuardEnabled: next }))
            setSaved((cur) => { try { return JSON.stringify({ ...JSON.parse(cur), errorGuardEnabled: next }) } catch { return cur } })
            setNote({ ok: true, text: next ? '已开启错误拦截，实时生效。' : '已关闭错误拦截，实时生效（回到上游技术报错行为）。' })
          })
          .catch((error) => {
            setForm((cur) => ({ ...cur, errorGuardEnabled: previous }))
            setNote({ ok: false, text: `开关保存失败（未生效）：${error.message ?? error}` })
          })
          .then(() => { setBusy(false) })
      }
      const save = async (event) => {
        event.preventDefault()
        if (busy || !dirty) return
        setBusy(true)
        setNote(null)
        try {
          const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ config: form }) })
          const body = await response.json()
          if (!response.ok || body?.ok !== true) throw new Error(body?.error ?? `保存失败（${response.status}）`)
          const subset = pick(body.config)
          setForm(subset)
          setSaved(JSON.stringify(subset))
          setNote({ ok: true, text: '已保存，下一轮生效。' })
        } catch (error) { setNote({ ok: false, text: `保存失败，草稿已保留：${error.message ?? error}` }) }
        finally { setBusy(false) }
      }
      if (form === null) return h('div', { className: 'qbe-field' },
        h('p', { className: 'qbe-note qbe-note--error', role: 'alert' }, note?.text ?? '正在读取错误拦截配置…'),
        note ? h('button', { type: 'button', className: 'qbe-mini', onClick: () => setLoadVersion((v) => v + 1) }, '重试') : null)
      const d = defaults ?? {}
      return h('form', { className: 'qbe-form', onSubmit: save },
        h('p', { className: 'qbe-help' }, '模型回合出错时：原会话只发友好短提示（正文留空则静默），技术详情全部转发管理员私聊；连续错误达到阈值自动熔断停发。无冷却、不自动恢复——只能由管理员在 QQ 发 /resume 人工合闸（/resume status 查状态，仅限管理员）。斜杠命令与待答问题不受熔断影响。'),
        h('fieldset', { disabled: busy, style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
          h('div', { className: 'qbe-field' },
            h('div', { className: 'qbe-head' },
              h('span', { className: 'qbe-label' }, '启用错误拦截'),
              h(Switch, { label: '启用错误拦截', checked: form.errorGuardEnabled === true, disabled: busy,
                onChange: (value) => toggleEnabled(value) })),
            h('p', { className: 'qbe-hint' }, '开关实时生效，无需点保存。关闭后回到上游行为：原会话直接显示技术报错，不转发、不熔断。')),
          h(TextAreaField, { label: '友好提示正文', value: form.errorNoticeText, defaultValue: d.errorNoticeText,
            disabled: busy, onReset: resetTo('errorNoticeText'), onChange: (value) => patch('errorNoticeText', value),
            placeholder: '留空 = 出错时原会话静默', help: '熔断期间也复用这条提示（每会话 60 秒至多一条）。' }),
          h('div', { className: 'qbe-field' },
            h('button', { type: 'button', className: 'qbe-mini', onClick: focusAdmin }, '前往总配置设置管理员 OpenID')),
          h(NumberField, { label: '熔断阈值（连续错误回合）', value: form.breakerThreshold, defaultValue: d.breakerThreshold,
            disabled: busy, onReset: resetTo('breakerThreshold'), onChange: (value) => patch('breakerThreshold', value),
            help: '0 = 不熔断。未跳闸时成功回合清零计数；跳闸后不自动恢复，只能管理员 /resume 人工合闸。请求级瞬时重试由宿主 llm-retry 负责。' })),
        h('div', { className: 'qbe-footer' },
          h('p', { className: `qbe-note${note && !note.ok ? ' qbe-note--error' : ''}`, role: note && !note.ok ? 'alert' : 'status', 'aria-live': 'polite' },
            note?.text || (dirty ? '有改动还没保存' : '配置已保存')),
          h('button', { type: 'submit', className: 'qbe-save', disabled: busy || !dirty }, busy ? '处理中…' : '保存')))
    }

    /** 只读组件页：说明 + 用到的工具。 */
    function ReadonlySection({ component }) {
      return h('div', null,
        h('div', { className: 'qbe-field' }, h('p', { className: 'qbe-help' }, component.summary)),
        h(ToolList, { tools: component.toolInfo }))
    }

    /** 总页：概览 + 组件切换。设置页与主面板共用同一份。 */
    function ExtensionPanel({ embedded, getWorkspace }) {
      useStyles()
      const { data, setData, error } = useExtensionData()
      const [active, setActive] = React.useState('sticker-library')
      const adminInput = React.useRef(null)

      if (error !== null) {
        return h('div', { className: 'qbe-root' },
          h('p', { className: 'qbe-note qbe-note--error' }, `读取扩展状态失败：${error}`))
      }
      if (data === null) return h('div', { className: 'qbe-empty' }, '正在读取扩展状态…')

      const components = Array.isArray(data.components) ? data.components : []
      const current = components.find((item) => item.id === active) ?? components[0]

      const overview = embedded === true ? null : h('div', null,
        h('h1', { className: 'qbe-title' }, TITLE),
        h('p', { className: 'qbe-subtitle' },
          'QQ 机器人扩展：人物扮演、表情包图库、错误拦截和调试工具。各功能总开关实时生效，其余配置保存后生效。'),
        h('div', { className: 'qbe-stats' },
          h('div', { className: 'qbe-stat' },
            h('b', null, String(data.capabilities?.stickerCount ?? 0)),
            h('span', null, `图库张数（上限 ${data.capabilities?.stickerLimit ?? '—'}）`)),
          h('div', { className: 'qbe-stat' },
            h('b', null, data.capabilities?.autoCollect === true ? '开' : '关'),
            h('span', null, '自动收集')),
          h('div', { className: 'qbe-stat' },
            h('b', null, String(components.length)),
            h('span', null, '组件个数')),
          h('div', { className: 'qbe-stat' },
            h('b', null, String(data.version ?? '—')),
            h('span', null, '版本'))))

      return h('div', { className: 'qbe-root' },
        overview,
        h(GeneralSettings, { initialOpenid: data.config?.adminOpenid ?? '', inputRef: adminInput }),
        h('div', { className: 'qbe-tabs', role: 'tablist', 'aria-label': '扩展组件' },
          components.map((item) => h('button', {
            key: item.id, type: 'button', role: 'tab',
            'aria-selected': item.id === (current?.id ?? ''),
            className: 'qbe-tab',
            onClick: () => setActive(item.id),
          }, item.title))),
        current === undefined
          ? h('div', { className: 'qbe-empty' }, '这个扩展还没有可配置的组件')
          : h('div', { className: 'qbe-card' },
            h('div', { className: 'qbe-cardHead' },
              h('div', null,
                h('h2', null, current.title),
                h('p', null, current.summary))),
            current.id === 'roleplay' || current.id === 'error-guard'
              ? null
              : current.editable === true
                ? h(StickerLibrarySection, { data, setData, getWorkspace })
                : h(ReadonlySection, { component: current }),
            components.some((item) => item.id === 'roleplay')
              ? h('div', { key: 'roleplay', hidden: current.id !== 'roleplay', className: 'qbe-configPanel' }, h(RoleplaySection))
              : null,
            components.some((item) => item.id === 'error-guard')
              ? h('div', { key: 'error-guard', hidden: current.id !== 'error-guard', className: 'qbe-configPanel' }, h(ErrorGuardSection, { focusAdmin: () => adminInput.current?.focus() }))
              : null))
    }

    /** 主面板页面容器（layout.selectPanel 目标）。 */
    function ExtensionPage({ getWorkspace }) {
      return h('div', { className: 'qbe-page' },
        h('div', { className: 'qbe-pageInner' },
          h(ExtensionPanel, { embedded: false, getWorkspace })))
    }

    /** 设置页栏目（外壳已有标题，不再重复大标题）。 */
    function ExtensionSettingsSection({ getWorkspace }) {
      return h(ExtensionPanel, { embedded: true, getWorkspace })
    }

    return {
      // 只声明 slots：面板必须无条件加载。
      // uiWorkspace 不能写进硬依赖——它是可选服务（官方 picker 的 inject 依赖它，
      // 但那是那个插件自己的组合假设）；这里若声明，服务缺失就整个面板不激活，
      // 页面直接消失，比“选不了目录”严重得多。改为点击时惰性取。
      name: NS + '-panel',
      inject: ['slots'],
      apply(ctx) {
        let workspaceCache
        let workspaceProbed = false
        const getWorkspace = () => {
          if (workspaceProbed) return workspaceCache
          workspaceProbed = true
          try {
            workspaceCache = ctx.get('uiWorkspace')
          } catch {
            workspaceCache = undefined
          }
          return workspaceCache
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'qqbot-ext',
          order: 60,
          label: () => TITLE,
          inject: () => ({ getWorkspace }),
        }, ExtensionSettingsSection))

        const inject = ctx.inject
        if (typeof inject !== 'function') return
        inject.call(ctx, ['layout'], (pageCtx) => {
          const pageSlots = pageCtx.slots
          if (pageSlots === undefined) return undefined
          const stopMain = pageSlots.inject('main', () => pageSlots.register({
            name: 'main',
            key: PANEL_ID,
            inject: () => ({ getWorkspace }),
          }, ExtensionPage))
          let stopEntry
          try {
            stopEntry = pageSlots.inject('sidebar.panellist', () => pageSlots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 40,
              label: () => TITLE,
            }, PanelIcon))
          } catch (error) {
            stopMain()
            throw error
          }
          return () => {
            stopEntry()
            stopMain()
          }
        })
      },
    }
  },
}

// Single package-id registration: run both factories, union inject, chain apply/cleanup.
window.__ModuleLoader__.load({
  ...__qqUpstreamReg,
  factory: (require) => {
    const upstream = __qqUpstreamReg.factory(require)
    const ext = __qqExtReg.factory(require)
    const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])]
    return {
      ...upstream,
      inject: union(upstream.inject, ext.inject),
      apply(ctx) {
        const cleanups = []
        for (const mod of [upstream, ext]) {
          if (typeof mod.apply !== 'function') continue
          const cleanup = mod.apply(ctx)
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        }
        return () => {
          for (const cleanup of cleanups.reverse()) {
            try { cleanup() } catch (err) { console.error('[local-qqbot] client cleanup failed', err) }
          }
        }
      },
    }
  },
})
