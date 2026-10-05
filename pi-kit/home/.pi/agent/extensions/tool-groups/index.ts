/**
 * tool-groups: collapse runs of consecutive file and shell tool calls in the pi TUI into one
 * summary line, the way Claude Code does ("Ran 3 commands, read 2 files, edited 1 file").
 *
 * Display only. The model's context, the session file and tool execution are untouched: whichever
 * of the built-in read/edit/write/grep/find/ls tools are active at session start, and still pi's
 * own (no other extension overrides them), are re-registered with pi's own definitions (stock
 * execute, prompt text and schema) plus renderers. bg-bash routes `bash` rendering here; the two
 * find each other on the session's own event bus (`pi.events`), so sub-agent sessions and /reload
 * never cross wires.
 *
 * - A group is a run of these calls with nothing visible between them (assistant text, a user
 *   message, a `!` command, a custom message or entry, a summary, a read that returned an image,
 *   or any other tool). A tool counts only while pi still resolves it to the renderer here.
 * - The first row of a group draws the summary; the other rows render nothing.
 * - Clicking a summary lists that group's calls; ctrl+o (app.tools.expand) switches every row back
 *   to pi's stock rendering.
 *
 * Main session only, it also asks Anthropic for `thinking.display: "omitted"` (pi hard-codes
 * "summarized"), so no thinking text is drawn between tool calls. Thinking still happens and is
 * billed the same. PI_THINKING_DISPLAY=summarized keeps the text; PI_TOOL_GROUPS=off disables
 * everything here.
 *
 * Known limits: after /reload, rows already on screen draw stock reads (pi redraws them before the
 * built-ins are taken over) until the next redraw; switching cache-miss notices off in /settings
 * keeps the extra group boundaries until /reload.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	getAgentDir,
	keyHint,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Handshake with bg-bash on the session's event bus (one bus per session; it survives /reload, and
 * pi drops a reloaded extension's subscriptions). Whichever loads second completes it:
 * - READY (tool-groups -> bg-bash): this Renderer; bg-bash draws bash rows through it and answers
 *   with `adoptBash`.
 * - BASH (bg-bash -> tool-groups): `{ description, connect(renderer) }`. `description` is bg-bash's
 *   bash description, to check pi really resolves `bash` to bg-bash's definition.
 */
const READY = "tool-groups:ready";
const BASH = "tool-groups:bash";
interface BashPeer {
	description: string;
	connect(renderer: Renderer): void;
}
interface Renderer {
	render(slot: "call" | "result", name: string, base: any, value: any, theme: any, context: any, options?: any): any;
	adoptBash(peer: BashPeer): void;
}
const THINKING_DISPLAY = process.env.PI_THINKING_DISPLAY ?? "omitted";

const FACTORIES: Record<string, (cwd: string, options?: any) => any> = {
	read: createReadToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition,
};

type Status = "running" | "ok" | "error";
interface Member {
	id: string;
	name: string;
}
interface Model {
	groupOf: Map<string, number>;
	groups: Member[][];
}

// A settings value as pi's SettingsManager resolves it: the trusted project's file over the global
// one. Like pi, a file that fails to parse keeps what it last parsed to; a missing file is empty.
// The cache is per file and process-wide, because /reload re-imports this module.
const parsed: Map<string, any> = ((globalThis as any)[Symbol.for("pi.tool-groups.settings")] ??= new Map());
function readSettings(path: string): any {
	try {
		const value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
		parsed.set(path, value);
		return value;
	} catch (error: any) {
		if (error?.code === "ENOENT") parsed.delete(path);
		return parsed.get(path);
	}
}
function setting(ctx: any, pick: (settings: any) => unknown): unknown {
	let trusted = false;
	try {
		trusted = ctx?.isProjectTrusted?.() === true;
	} catch {}
	const project = trusted && typeof ctx?.cwd === "string" ? pick(readSettings(join(ctx.cwd, ".pi", "settings.json"))) : undefined;
	return project ?? pick(readSettings(join(getAgentDir(), "settings.json")));
}

const hasImage = (content: unknown) => Array.isArray(content) && content.some((c: any) => c?.type === "image");

class Lines {
	constructor(private readonly lines: string[]) {}
	render(width: number): string[] {
		return this.lines.map((line) => truncateToWidth(line, Math.max(1, width)));
	}
	invalidate(): void {}
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_TOOL_GROUPS === "off") return;

	const isChild = () => {
		try {
			const active = pi.getActiveTools();
			return active.includes("notify_parent") || active.includes("ask_parent");
		} catch {
			return true;
		}
	};

	// Tools drawn here: the built-ins taken over below, and bash when bg-bash routes it here. Checked
	// against pi's registry on every rebuild: an extension ahead of this one may register the same
	// name later, and the first registration wins.
	const registered = new Set<string>();
	let ownPath: string | undefined; // sourceInfo.path of the definitions registered here
	let bash: BashPeer | undefined;
	const effectiveTools = (): Map<string, any> => {
		try {
			return new Map(pi.getAllTools().map((tool: any) => [tool.name, tool]));
		} catch {
			return new Map();
		}
	};
	const drawnHere = (name: string, tools: Map<string, any>) =>
		name === "bash"
			? bash !== undefined && tools.get("bash")?.description === bash.description
			: registered.has(name) && ownPath !== undefined && tools.get(name)?.sourceInfo?.path === ownPath;

	let session: any;
	let ui: any;
	let cwd = process.cwd();
	let streaming: any; // assistant message being streamed; not in the session until after message_end
	let shape = "";
	let version = 0;
	let cached: { version: number; model: Model } | undefined;
	const status = new Map<string, Status>();
	const args = new Map<string, any>();
	const rows = new Map<string, () => void>(); // toolCallId -> invalidate of its row
	const shown = new Map<string, string>(); // toolCallId -> what that row last drew
	const open = new Map<string, boolean>(); // toolCallId -> row clicked open (lists its group's calls)
	const images = new Set<string>(); // reads that returned an image: pi draws the image under the row
	// Rows pi built with stock renderers: /reload redraws the transcript before session_start, when
	// the built-ins are not taken over yet. They stay stock until the next redraw.
	const legacy = new Set<string>();
	// After a live compaction pi keeps the retained rows on screen and draws the summary below them,
	// while the context lists the compaction first; calls after it must not join the retained ones.
	let compacted: { id: string; retained: Set<string> } | undefined;
	let notices = false; // showCacheMissNotices: pi may draw a notice under any assistant message
	let lastCtx: any;
	const names = new Map<string, string>(); // toolCallId -> tool name, for rows drawn here
	const seenStates = new WeakSet<object>(); // renderer state of every row component seen
	const caches: { delete(id: string): unknown; keys(): Iterable<string> }[] = [status, args, rows, shown, open, images, legacy, names];

	const remember = (ctx: any) => {
		if (ctx) lastCtx = ctx;
		if (ctx?.sessionManager) session = ctx.sessionManager;
		if (ctx?.hasUI && ctx.ui) ui = ctx.ui;
		if (typeof ctx?.cwd === "string") cwd = ctx.cwd;
	};

	const visible = (block: any) =>
		(block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") ||
		(block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim() !== "");

	function build(): Model {
		const groups: Member[][] = [];
		const groupOf = new Map<string, number>();
		const live = new Set<string>(); // every tool call in the context, grouped or not
		const tools = effectiveTools();
		// Read per rebuild: /settings can switch notices on and pi redraws without a session event. Only
		// ever switched on here: pi keeps its in-memory value until a reload, whatever the file says.
		if (!notices && lastCtx && setting(lastCtx, (s) => s?.showCacheMissNotices) === true) notices = true;
		let current: Member[] | undefined;
		const cut = () => {
			current = undefined;
		};
		const visitAssistant = (message: any) => {
			const content: any[] = Array.isArray(message?.content) ? message.content : [];
			const calls = content.filter((b) => b?.type === "toolCall");
			// pi draws a message's text and thinking above its tool rows, and error/length notices too.
			if (content.some(visible) || message?.stopReason === "length" || (!calls.length && (message?.stopReason === "error" || message?.stopReason === "aborted"))) cut();
			for (const call of calls) {
				if (typeof call?.id === "string") live.add(call.id);
				if (!drawnHere(call.name, tools) || typeof call.id !== "string" || legacy.has(call.id) || images.has(call.id)) {
					cut();
					continue;
				}
				if (groupOf.has(call.id)) continue;
				if (!args.has(call.id)) args.set(call.id, call.arguments);
				if (message?.stopReason === "error" || message?.stopReason === "aborted") status.set(call.id, "error");
				if (!current) {
					current = [];
					groups.push(current);
				}
				current.push({ id: call.id, name: call.name });
				groupOf.set(call.id, groups.length - 1);
			}
			if (notices) cut();
		};

		let entries: any[] = [];
		try {
			entries = session?.buildContextEntries?.() ?? [];
		} catch {
			entries = [];
		}
		for (const entry of entries) {
			const message = entry?.type === "message" ? entry.message : undefined;
			if (message?.role === "toolResult" && hasImage(message.content)) images.add(message.toolCallId);
		}
		const late = compacted && entries[0]?.type === "compaction" && entries[0].id === compacted.id ? compacted : undefined;
		let pastRetained = false;
		for (const entry of entries) {
			if (late) {
				if (entry === entries[0]) continue;
				if (!pastRetained && !late.retained.has(entry?.id)) {
					pastRetained = true;
					cut();
				}
			}
			if (entry?.type === "message") {
				const message = entry.message;
				if (message?.role === "assistant") visitAssistant(message);
				else if (message?.role === "toolResult") {
					if (typeof message.toolCallId === "string") status.set(message.toolCallId, message.isError ? "error" : "ok");
				} else if (message?.role === "custom") {
					if (message.display) cut();
				} else cut();
			} else if (entry?.type === "custom_message") {
				if (entry.display) cut();
			} else if (entry?.type === "custom" || entry?.type === "compaction" || entry?.type === "branch_summary") cut();
		}
		if (streaming && !entries.some((entry) => entry?.message === streaming)) {
			if (late && !pastRetained) cut();
			visitAssistant(streaming);
		}
		// Forget calls that left the context (compaction, /tree, another session).
		if (session) for (const cache of caches) for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
		return { groupOf, groups };
	}

	const model = (): Model => {
		if (!cached || cached.version !== version) cached = { version, model: build() };
		return cached.model;
	};

	const shortPath = (value: unknown): string => {
		if (typeof value !== "string" || value === "") return ".";
		if (!isAbsolute(value)) return value;
		const rel = relative(cwd, value);
		if (rel === "") return ".";
		return !rel.startsWith("..") && !isAbsolute(rel) ? rel : value.replace(homedir(), "~");
	};

	const label = (member: Member): string => {
		const a = args.get(member.id) ?? {};
		switch (member.name) {
			case "bash": {
				// The model prefixes most commands with `cd <dir> &&`; show the directory only when it is
				// not the session's own.
				let command = String(a.command ?? "").split("\n")[0].trim();
				const cd = /^cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*/.exec(command);
				if (cd) {
					const dir = shortPath(cd[1].replace(/^["']|["']$/g, "").replace(/^~(?=\/|$)/, homedir()));
					command = `${dir === "." ? "" : `(${dir}) `}${command.slice(cd[0].length)}`;
				}
				return command || "…";
			}
			case "grep":
			case "find":
				return `"${a.pattern ?? ""}"${a.path ? ` in ${shortPath(a.path)}` : ""}`;
			default:
				return shortPath(a.path ?? a.file_path);
		}
	};

	const KINDS: Record<string, { verb: string; one: string; many: string; unique?: boolean }> = {
		bash: { verb: "ran", one: "command", many: "commands" },
		read: { verb: "read", one: "file", many: "files", unique: true },
		edit: { verb: "edited", one: "file", many: "files", unique: true },
		write: { verb: "wrote", one: "file", many: "files", unique: true },
		grep: { verb: "searched", one: "pattern", many: "patterns" },
		find: { verb: "globbed", one: "pattern", many: "patterns" },
		ls: { verb: "listed", one: "directory", many: "directories" },
	};
	const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	function summary(group: Member[], theme: any, open: boolean): string[] {
		const states = group.map((m) => status.get(m.id));
		const running = group.filter((_, i) => states[i] === "running" || states[i] === undefined);
		const failed = group.filter((_, i) => states[i] === "error");
		let text: string;
		if (group.length === 1) {
			const m = group[0];
			text = `${running.length ? "Running" : capital(KINDS[m.name].verb)} ${label(m)}`;
		} else {
			const order: string[] = [];
			const seen = new Map<string, Set<string>>();
			for (const m of group) {
				if (!seen.has(m.name)) {
					seen.set(m.name, new Set());
					order.push(m.name);
				}
				seen.get(m.name)!.add(KINDS[m.name].unique ? label(m) : m.id);
			}
			text = capital(
				order
					.map((name) => {
						const n = seen.get(name)!.size;
						const k = KINDS[name];
						return `${k.verb} ${n} ${n === 1 ? k.one : k.many}`;
					})
					.join(", "),
			);
			if (running.length) text += ` · running ${label(running[running.length - 1])}`;
		}
		const bullet = theme.fg(running.length ? "accent" : failed.length ? "error" : "success", "●");
		let line = ` ${bullet} ${theme.fg("toolTitle", text)}`;
		if (failed.length) line += theme.fg("error", ` · ${failed.length} failed`);
		if (!running.length && !open) line += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`)}`;
		const lines = [line];
		if (open) {
			for (const m of group) {
				const s = status.get(m.id);
				const glyph = s === "error" ? theme.fg("error", "✗") : s === "ok" ? theme.fg("success", "✓") : theme.fg("accent", "…");
				const what = m.name === "bash" ? `$ ${label(m)}` : `${m.name} ${label(m)}`;
				lines.push(`   ${glyph} ${theme.fg("toolOutput", what)}`);
			}
		}
		return lines;
	}

	// pi's stock rendering, framed the way pi frames it for a default-shell tool.
	function stock(slot: "call" | "result", base: any, value: any, theme: any, context: any, options?: any): any {
		const state = (context.state.__toolGroups ??= {});
		const stockContext = { ...context, lastComponent: state[slot] };
		let component: any;
		try {
			component =
				slot === "call" ? base.renderCall?.(value, theme, stockContext) : base.renderResult?.(value, options, theme, stockContext);
		} catch {
			component = undefined;
		}
		if (!component) {
			const text =
				slot === "call"
					? theme.fg("toolTitle", theme.bold(base.name))
					: (value?.content ?? [])
							.filter((c: any) => c?.type === "text")
							.map((c: any) => theme.fg("toolOutput", c.text))
							.join("\n");
			component = new Text(text, 0, 0);
		}
		state[slot] = component;
		if (base.renderShell === "self") return component;
		if (slot === "call") {
			const bg = (t: string) =>
				theme.bg(context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg", t);
			const box = new Box(1, 1, bg);
			box.addChild(component);
			state.box = box;
			return box;
		}
		state.box?.addChild(component);
		return new Container();
	}

	// What a row draws outside the ctrl+o view: "stock" (an image read, drawn by pi's renderer so the
	// image sits under its own call), "hidden" (a group member below the head), or the head's summary.
	// A row outside the model (its tool no longer resolves here, or the session is not bound yet
	// during /reload's redraw) still renders through this extension: a group of its own.
	function view(m: Model, id: string, theme: any): string | undefined {
		const index = m.groupOf.get(id);
		if (index === undefined) {
			if (images.has(id)) return "stock";
			const name = names.get(id);
			return name && KINDS[name] ? summary([{ id, name }], theme, open.get(id) === true).join("\n") : undefined;
		}
		const group = m.groups[index];
		return group[0].id !== id ? "hidden" : summary(group, theme, open.get(id) === true).join("\n");
	}

	function render(slot: "call" | "result", name: string, base: any, value: any, theme: any, context: any, options?: any): any {
		const id = context.toolCallId;
		rows.set(id, context.invalidate);
		names.set(id, name);
		// A new component for a call already drawn means pi rebuilt the transcript (a /settings
		// change among other things); settings it saves may land on disk just after, so look again.
		if (context.state && !seenStates.has(context.state)) {
			if (shown.has(id)) recheckSoon();
			seenStates.add(context.state);
		}
		if (slot === "call") {
			if (context.args !== undefined) args.set(id, context.args);
			open.set(id, Boolean(context.expanded));
		}
		if (ui?.getToolsExpanded?.()) {
			shown.set(id, "stock");
			return stock(slot, base, value, theme, context, options);
		}

		let m = model();
		if (!m.groupOf.has(id) && !images.has(id)) {
			version++;
			m = model();
		}
		const now = view(m, id, theme) ?? summary([{ id, name }], theme, open.get(id) === true).join("\n");
		shown.set(id, now);
		if (now === "stock") return stock(slot, base, value, theme, context, options);
		if (slot === "result" || now === "hidden") return new Container();
		return new Lines(now.split("\n"));
	}

	let lastTheme: any;
	let recheck: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const recheckSoon = () => {
		if (recheck || stopped) return;
		recheck = setTimeout(() => {
			recheck = undefined;
			if (!stopped) refresh();
		}, 100);
		(recheck as any).unref?.();
	};

	// Redraw the rows whose part of the picture changed: a row that became or stopped being the
	// head of its group or an image read, and heads whose summary (or opened call list) changed.
	function refresh() {
		version++;
		if (!lastTheme || ui?.getToolsExpanded?.()) return;
		const m = model();
		for (const [id, invalidate] of rows) {
			const now = view(m, id, lastTheme);
			if (now !== undefined && shown.get(id) !== now) invalidate();
		}
	}

	const api: Renderer = {
		render(slot, name, base, value, theme, context, options) {
			lastTheme = theme;
			return render(slot, name, base, value, theme, context, options);
		},
		adoptBash(peer) {
			bash = peer;
			version++;
		},
	};
	// At load: /reload redraws the transcript (bash rows included) before session_start.
	pi.events.on(BASH, (peer: BashPeer) => {
		api.adoptBash(peer);
		peer.connect(api);
	});
	pi.events.emit(READY, api);

	// Take over only the built-ins that are already active: registering a tool activates it, and
	// grep/find/ls are off by default, so registering them at load would lengthen the model's tool
	// list and system prompt. Skip any another extension already overrides (the first registration
	// of a name wins, whatever the load order). The definitions are pi's own, built with the same
	// options pi gives them, so the API payload stays byte-identical.
	let resize = true;
	const toolOptions = (name: string) => (name === "read" ? { autoResizeImages: resize } : undefined);
	const takeOver = (ctx: any) => {
		let active: string[];
		let tools: any[];
		try {
			active = pi.getActiveTools();
			tools = pi.getAllTools();
		} catch {
			return;
		}
		const toolCwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
		for (const [name, make] of Object.entries(FACTORIES)) {
			if (registered.has(name) || !active.includes(name)) continue;
			if (tools.find((tool) => tool?.name === name)?.sourceInfo?.source !== "builtin") continue;
			const base = make(toolCwd, toolOptions(name));
			pi.registerTool({
				...base,
				renderShell: "self",
				execute: (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) =>
					make(ctx.cwd, toolOptions(name)).execute(toolCallId, params, signal, onUpdate, ctx),
				renderCall: (value: any, theme: any, context: any) => api.render("call", name, base, value, theme, context),
				renderResult: (value: any, options: any, theme: any, context: any) =>
					api.render("result", name, base, value, theme, context, options),
			});
			registered.add(name);
			try {
				const info = pi.getAllTools().find((tool: any) => tool?.name === name)?.sourceInfo;
				if (info && info.source !== "builtin") ownPath ??= info.path;
			} catch {}
		}
	};

	// pi re-reads settings and rebuilds its tools on start and /reload, not on compaction or /tree.
	pi.on("session_start", (event: any, ctx: any) => {
		resize = setting(ctx, (s) => s?.images?.autoResize) !== false;
		notices = setting(ctx, (s) => s?.showCacheMissNotices) === true;
		takeOver(ctx);
		remember(ctx);
		legacy.clear();
		compacted = undefined;
		if (event?.reason === "reload") {
			try {
				for (const entry of session?.buildContextEntries?.() ?? [])
					for (const block of entry?.type === "message" && entry.message?.role === "assistant" ? entry.message.content ?? [] : [])
						if (block?.type === "toolCall" && block.name in FACTORIES && typeof block.id === "string") legacy.add(block.id);
			} catch {}
		}
		streaming = undefined;
		shape = "";
		refresh();
	});
	// The transcript is redrawn after these; rows re-register as they render.
	const reset = (event: any, ctx: any) => {
		remember(ctx);
		legacy.clear();
		compacted = undefined;
		if (event?.type === "session_compact") {
			try {
				const entries = session?.buildContextEntries?.() ?? [];
				if (entries[0]?.type === "compaction")
					compacted = { id: entries[0].id, retained: new Set(entries.slice(1).map((entry: any) => entry?.id)) };
			} catch {}
		}
		streaming = undefined;
		shape = "";
		refresh();
	};
	pi.on("session_compact", reset);
	pi.on("session_tree", reset);
	pi.on("session_shutdown", () => {
		stopped = true;
		if (recheck) clearTimeout(recheck);
		recheck = undefined;
	});

	const shapeOf = (message: any) =>
		(Array.isArray(message?.content) ? message.content : [])
			.map((b: any) => (b?.type === "toolCall" ? `T${b.id}` : `${b?.type}${visible(b) ? "+" : ""}`))
			.join(",") + `|${message?.stopReason ?? ""}`;

	pi.on("message_start", (event: any, ctx: any) => {
		remember(ctx);
		if (event.message?.role === "assistant") {
			streaming = event.message;
			shape = shapeOf(event.message);
		}
		refresh();
	});
	pi.on("message_update", (event: any, ctx: any) => {
		remember(ctx);
		if (event.message?.role !== "assistant") return;
		streaming = event.message;
		for (const block of event.message.content ?? []) if (block?.type === "toolCall") args.set(block.id, block.arguments);
		const next = shapeOf(event.message);
		if (next !== shape) {
			shape = next;
			refresh();
		}
	});
	pi.on("message_end", (event: any, ctx: any) => {
		remember(ctx);
		if (event.message?.role === "assistant") streaming = event.message; // persisted only after this event
		refresh();
	});
	pi.on("tool_execution_start", (event: any, ctx: any) => {
		remember(ctx);
		status.set(event.toolCallId, "running");
		refresh();
	});
	pi.on("tool_execution_end", (event: any, ctx: any) => {
		remember(ctx);
		status.set(event.toolCallId, event.isError ? "error" : "ok");
		if (hasImage(event.result?.content)) images.add(event.toolCallId);
		refresh();
	});

	pi.on("before_provider_request", (event: any) => {
		const payload = event.payload;
		const thinking = payload?.thinking;
		if (THINKING_DISPLAY !== "omitted" || !thinking || thinking.type !== "adaptive" || thinking.display === "omitted" || isChild())
			return undefined;
		return { ...payload, thinking: { ...thinking, display: "omitted" } };
	});
}
