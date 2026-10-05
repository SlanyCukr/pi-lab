import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

// Warn at startup when a sub-agent or the advisor points at a model with no login.
// Why: @gotgenes/pi-subagents silently falls back for frontmatter models. It first
// fuzzy-matches another logged-in model, then uses the parent's model. Without a
// Copilot login, Explore would quietly run on the main (Anthropic) model instead.

function configuredModels(): Array<{ who: string; model: string }> {
	const out: Array<{ who: string; model: string }> = [];
	const agentsDir = join(getAgentDir(), "agents");
	let files: string[] = [];
	try {
		files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
	} catch {
		// no agents folder: nothing to check
	}
	for (const f of files) {
		const text = readFileSync(join(agentsDir, f), "utf8");
		const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
		const model = /^model:\s*(\S+)\s*$/m.exec(front)?.[1];
		if (model) out.push({ who: `agent ${f.replace(/\.md$/, "")}`, model });
	}
	try {
		const cfg = JSON.parse(readFileSync(join(homedir(), ".config/rpiv-advisor/advisor.json"), "utf8"));
		if (typeof cfg.modelKey === "string") out.push({ who: "advisor", model: cfg.modelKey });
	} catch {
		// no advisor config: nothing to check
	}
	return out;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		// Children (sub-agents) get ask_parent/notify_parent; only the main session warns.
		const tools = pi.getActiveTools();
		if (tools.includes("ask_parent") || tools.includes("notify_parent")) return;

		const available = new Set(ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`.toLowerCase()));
		const missing = configuredModels().filter(({ model }) => !available.has(model.toLowerCase()));
		if (missing.length === 0) return;

		const providers = [...new Set(missing.map(({ model }) => model.split("/")[0]))].join(", ");
		const msg =
			`model-check: no login for ${missing.map(({ who, model }) => `${who} (${model})`).join(", ")}. ` +
			`Sub-agents will silently fall back to another model, usually the main one. Run /login for: ${providers}.`;
		if (ctx.hasUI) ctx.ui.notify(msg, "warning");
		else console.error(msg);
	});
}
