import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Records the Claude subscription's real usage from Anthropic's response headers
// (anthropic-ratelimit-unified-*: 7d-utilization 0..1, 7d-reset epoch seconds, status, ...)
// into one JSON file, so the find-gaps runner can pace its cycles and leave room in the
// week for the user (2026-11-25). Every pi process on this host writes the same file; the
// newest response wins, which is right because all of them use the same account.
// Writes a file only; the prompt and the request stay unchanged.
const PREFIX = "anthropic-ratelimit-unified-";
const FILE = process.env.CLAUDE_USAGE_FILE || join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "claude-usage.json");

export default function (pi: ExtensionAPI) {
	pi.on("after_provider_response", (e) => {
		const h = e.headers || {};
		const out: Record<string, string | number> = {};
		for (const [k, v] of Object.entries(h)) if (k.toLowerCase().startsWith(PREFIX)) out[k.toLowerCase().slice(PREFIX.length)] = v;
		if (!("7d-utilization" in out)) return;
		out.at = Math.floor(Date.now() / 1000);
		out.http = e.status;
		try {
			mkdirSync(dirname(FILE), { recursive: true });
			const tmp = `${FILE}.${process.pid}`;
			writeFileSync(tmp, `${JSON.stringify(out)}\n`);
			renameSync(tmp, FILE);
		} catch {
			// a full disk or a read-only home must not break the session
		}
	});
}
