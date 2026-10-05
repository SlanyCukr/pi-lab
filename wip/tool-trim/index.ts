/**
 * tool-trim — shorter tool definitions on the wire.
 *
 * Tool schemas ride along on every request. Most of their size was usage lectures and
 * optional parameters this setup never uses (0 calls in 169 sessions: video frames, proxies,
 * browser-cookie auth, LSP call hierarchy, analyzer tuning, todo dependencies, sub-agent
 * model/thinking overrides). This rewrites the request payload only:
 *   - replaces tool descriptions and some parameter descriptions with plain, short ones;
 *   - hides unused optional parameters (the tool itself still accepts them; the model
 *     just no longer sees them);
 *   - drops the system prompt's "Available tools:" list, which repeats the tool
 *     descriptions the API already carries;
 *   - drops the pi-lens skills from the skills list (they competed with the tools).
 * The rewrite is a pure function of the payload, so the cached prefix stays byte-stable.
 * Unknown tools and unknown parameters pass through untouched.
 *
 * Handles Anthropic (`tools[].input_schema`), OpenAI chat (`tools[].function.parameters`)
 * and OpenAI responses (`tools[].parameters`) shapes. Env: PI_TOOL_TRIM=0 turns it off.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Trim {
	description?: string;
	/** Rewrites a description that has dynamic parts; returns undefined to keep the original. */
	rewrite?: (original: string) => string | undefined;
	drop?: string[];
	params?: Record<string, string>;
}

const subagentRewrite = (original: string): string | undefined => {
	const lines = original.split("\n");
	const start = lines.findIndex((l) => l.trim() === "Custom agents:");
	if (start < 0) return undefined;
	const agents: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (!line.startsWith("- ")) break;
		agents.push(line);
	}
	if (agents.length === 0) return undefined;
	return [
		"Run a sub-agent with fresh context on a self-contained task. Agent types:",
		...agents,
		"Foreground calls run one at a time; run_in_background: true returns an id at once and you are notified when it finishes.",
		"get_subagent_result reads a result, steer_subagent redirects a running agent, resume continues one. Results come back as text.",
	].join("\n");
};

const TRIMS: Record<string, Trim> = {
	// find-gaps sessions passed space-separated lists ("frontend backend/x") 17 times in a day: "Path not found".
	grep: { params: { path: "One directory or file to search (a single path, not a list; default: current directory). Narrow with glob." } },
	find: { params: { path: "One directory to search in (a single path, not a list; default: current directory)." } },
	read: {
		description:
			"Read a file. Text: at most 2000 lines or 50 KB per call; continue with offset/limit. Images (jpg, png, gif, webp, bmp) come back as attachments.",
	},
	bash: {
		description:
			"Run a bash command in the working directory. Returns stdout and stderr, the last 2000 lines or 50 KB; when cut, the full output is saved to a temp file. timeout is in seconds. " +
			"background: true returns at once and the result arrives as a message when the command exits (in a sub-agent it is ignored; a command still running after 240 s returns its output so far, continue with `pi-bg-wait <id>`). " +
			"monitor: true (main session) sends each stdout line as a message, batched about 1 s, until timeout (default 300 s, max 3600 s), or with persistent: true until `pi-bg-stop <id>` or the session ends. " +
			"`pi-bg-stop <id>` stops a background command, watch or loop without a message.",
	},
	edit: {
		description:
			"Edit one file by exact text replacement. Each edits[].oldText must match one unique region of the original file (edits are not applied one after another) and must not overlap another. Several changes to one file go in one call; merge nearby changes into one edit and keep oldText short.",
		params: { edits: "Replacements, each {oldText, newText}, all matched against the original file." },
	},
	schedule_wakeup: {
		description:
			"Wake yourself later with a prompt: to continue a self-paced /loop, or to re-check external state no command can report (CI run, deploy, review). One wake-up is pending at a time; a new call replaces it, stop: true cancels it and ends the loop. " +
			"Pick the delay from how fast the state changes (one check at ~480 s for an 8-minute CI run; 1200-1800 s when nothing specific). Each wake-up is a full turn. Background commands and monitors wake you themselves.",
		params: {
			prompt: "Task to run when woken (the same text each time for a /loop).",
			stop: "Cancel the pending wake-up and end the loop.",
		},
	},
	loop: {
		description:
			'Recurring prompts in this session. create: run prompt every interval (minimum 60 s, ends after 7 days), first run after one interval unless runNow. list: loops and wake-ups. cancel: by id or "all". Each run is a full turn: use the longest interval that works, and a bash monitor when a command can report the event.',
	},
	web_search: {
		description:
			"Search the web (OpenAI, Exa) and return source-linked results. For research, pass 2-4 queries with different angles in queries. includeContent also fetches the full pages in the background.",
		drop: ["provider", "workflow", "proxy"],
		params: {
			query: "One search query.",
			queries: "2-4 queries with different angles, searched concurrently.",
		},
	},
	fetch_content: {
		description:
			"Fetch URL(s). mode: readable (default; markdown), raw (exact body), answer (answers prompt from the page only). Handles GitHub repositories, PDFs, images and YouTube transcripts.",
		drop: ["forceClone", "answerModel", "timestamp", "frames", "model", "auth", "proxy"],
		params: {
			prompt: "Question for answer mode or a video.",
			mode: "readable (default), raw or answer.",
		},
	},
	lens_diagnostics: {
		description:
			'pi-lens diagnostics for paths or the workspace. source "session" reads the cache (empty is not proof of clean); source "lsp" probes the files now. Example: {source: "lsp", scope: "paths", paths: ["src/app.ts"]}.',
		drop: ["analysisRoot", "refreshRunners", "concurrency", "includeGenerated", "maxLspFiles", "maxProjectFiles", "serverScope"],
		params: {
			severity: "Lowest severity shown: error, warning, information, hint, all (default).",
			source: "session (cache) or lsp (active probe).",
			mode: "delta (this turn), all (cache), full (LSP scan of paths).",
			scope: "paths or workspace.",
		},
	},
	lsp_navigation: {
		drop: ["callHierarchyItem", "command", "commandArguments", "apply", "newFilePath", "kinds", "topLevelOnly", "endLine", "endCharacter"],
		params: {
			operation:
				"definition, typeDefinition, declaration, references, hover, signatureHelp, documentSymbol, findSymbol, workspaceSymbol, implementation, rename (preview), codeAction, workspaceDiagnostics.",
		},
	},
	advisor: {
		description: "Ask a stronger reviewer model for guidance, then continue. Your whole conversation is forwarded automatically; no parameters.",
	},
	subagent: {
		rewrite: subagentRewrite,
		drop: ["model", "thinking", "max_turns"],
		params: {
			description: "3-5 word label shown in the UI.",
			run_in_background: "Return an id at once; you are notified when it finishes.",
			inherit_context: "Fork this conversation into the agent instead of a fresh context.",
			resume: "Agent id to continue.",
		},
	},
	get_subagent_result: { description: "Status and result of a background sub-agent." },
	steer_subagent: { description: "Send a message to a running background sub-agent; it arrives after its current tool call." },
	todo: {
		description:
			"Task list for multi-step work. Actions: create, update (status or fields), list, get, delete, clear. Status: pending, in_progress, completed (or deleted).",
		drop: ["metadata", "owner", "includeDeleted", "blockedBy", "addBlockedBy", "removeBlockedBy"],
		params: {
			status: "pending, in_progress, completed or deleted; with list, a filter.",
			activeForm: "Spinner label while in_progress, e.g. 'writing tests'.",
		},
	},
};

/** A provider request payload or a part of it: untyped JSON from pi-ai, shape checked at each use. */
interface Json {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
}

/** Where name, description and JSON schema live for each API's tool shape. */
const toolParts = (tool: Json): { holder: Json; schemaKey: string } | undefined => {
	if (tool?.function && typeof tool.function === "object") return { holder: tool.function, schemaKey: "parameters" };
	if (tool && typeof tool.name === "string") return { holder: tool, schemaKey: tool.input_schema ? "input_schema" : "parameters" };
	return undefined;
};

export const trimTool = (tool: Json): Json => {
	const parts = toolParts(tool);
	const trim = parts ? TRIMS[String(parts.holder.name).toLowerCase()] : undefined;
	if (!parts || !trim) return tool;
	const holder: Json = { ...parts.holder };
	if (trim.description) holder.description = trim.description;
	else if (trim.rewrite && typeof holder.description === "string") holder.description = trim.rewrite(holder.description) ?? holder.description;
	const schema = holder[parts.schemaKey];
	if (schema?.properties && typeof schema.properties === "object") {
		const properties: Json = {};
		for (const [key, value] of Object.entries<Json>(schema.properties)) {
			if (trim.drop?.includes(key)) continue;
			const text = trim.params?.[key];
			properties[key] = text && value && typeof value === "object" && "description" in value ? { ...value, description: text } : value;
		}
		const required = Array.isArray(schema.required) ? schema.required.filter((k: string) => k in properties) : schema.required;
		holder[parts.schemaKey] = { ...schema, properties, ...(schema.required !== undefined ? { required } : {}) };
	}
	return tool.function ? { ...tool, function: holder } : holder;
};

// "Available tools:" list rendered into the system prompt: one "- name: snippet" line per tool
const TOOL_LIST = /\n?Available tools:\n(?:- [^\n]*\n)+\n?(?:In addition to the tools above[^\n]*\n\n?)?/;
// Skills the model should not see. pi-lens re-adds its skills from its extension
// (`resources_discover`), which pi merges without any settings filter
// (resource-loader.js extendResources), so they are dropped here instead. They pushed
// ast-grep and LSP over the tools the prompt names; `/skill:<name>` still works.
const HIDDEN_SKILL = /\n[ \t]*<skill>\s*<name>pi-lens-[^<]*<\/name>[\s\S]*?<\/skill>/g;
// pi's built-in guideline lines, matched exactly. "" drops the line. The edit lines repeat the
// edit tool description; "use read instead of cat or sed" contradicted the append's
// "filter with grep/head/tail" (ignored in 2078 bash calls a week), while the rule that matters
// is pi-lens's read-before-edit guard (10 refused edits a week). The last two come from the
// pi-permission-system patch and repeat the append's style rules.
const GUIDELINES: Record<string, string> = {
	"- Use bash for file operations like ls, rg, find": "",
	"- Use read to examine files instead of cat or sed.":
		"- Read the part of a file you will change with `read` first (offset/limit is enough); an edit to unread lines is refused. For a quick look, grep, head or sed -n in bash are fine.",
	"- Use edit for precise changes (edits[].oldText must match exactly)": "",
	"- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls": "",
	"- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.": "",
	"- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.": "",
	"- Be concise in your responses": "",
	"- Show file paths clearly when working with files": "",
};
const rewriteGuidelines = (text: string): string =>
	text
		.split("\n")
		.flatMap((line) => {
			const next = GUIDELINES[line];
			if (next === undefined) return [line];
			return next ? [next] : [];
		})
		.join("\n");
export const trimSystemText = (text: string): string =>
	rewriteGuidelines(text.replace(TOOL_LIST, "\n").replace(HIDDEN_SKILL, ""));

const trimSystem = (payload: Json): Json => {
	if (Array.isArray(payload.system)) {
		return { ...payload, system: payload.system.map((b: Json) => (typeof b?.text === "string" ? { ...b, text: trimSystemText(b.text) } : b)) };
	}
	if (typeof payload.system === "string") return { ...payload, system: trimSystemText(payload.system) };
	if (typeof payload.instructions === "string") return { ...payload, instructions: trimSystemText(payload.instructions) };
	const first = payload.messages?.[0];
	if (first && (first.role === "system" || first.role === "developer")) {
		const content =
			typeof first.content === "string"
				? trimSystemText(first.content)
				: Array.isArray(first.content)
					? first.content.map((c: Json) => (typeof c?.text === "string" ? { ...c, text: trimSystemText(c.text) } : c))
					: first.content;
		return { ...payload, messages: [{ ...first, content }, ...payload.messages.slice(1)] };
	}
	return payload;
};

export default function (pi: ExtensionAPI) {
	if (process.env.PI_TOOL_TRIM === "0") return;
	pi.on("before_provider_request", (event: any) => {
		const payload = event.payload;
		if (!payload || typeof payload !== "object") return undefined;
		const withTools = Array.isArray(payload.tools) ? { ...payload, tools: payload.tools.map(trimTool) } : payload;
		return trimSystem(withTools);
	});
}
