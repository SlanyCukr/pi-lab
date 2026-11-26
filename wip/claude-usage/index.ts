import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Records the Claude subscription's real usage from Anthropic's response headers
// (anthropic-ratelimit-unified-*: 7d-utilization 0..1, 7d-reset epoch seconds, status, ...)
// into one JSON file, so the find-gaps runner can pace its cycles and leave room in the
// week for the user (2026-11-25). Every pi process on this host writes the same file; the
// newest response wins, which is right because all of them use the same account.
// Writes files only; the prompt and the request stay unchanged.
//
// History (2026-11-26): each change of a limit's value is also appended to claude-usage.log,
// one JSON line {at, reset, <limit>: value, ...} (limit = the header name without "-utilization":
// "7d" for all models, "7d_oi" on Fable responses only). The JSON file alone could not say who
// used the week: from 11-25 12:10 to 11-26 05:00 it went from 56 % to 69 % while this host's
// sessions used $1 at list prices. `wip/find-gaps/account-usage.py` reads the log.
const PREFIX = "anthropic-ratelimit-unified-";
const FILE = process.env.CLAUDE_USAGE_FILE || join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "claude-usage.json");
const HISTORY = `${FILE.replace(/\.json$/, "")}.log`;
const SUFFIX = "-utilization";

/** The newest value of each limit in the history's tail: another pi process may have appended since. */
function recorded(): Record<string, string> {
	const out: Record<string, string> = {};
	let text = "";
	try {
		text = readFileSync(HISTORY, "utf8").slice(-8192);
	} catch {
		return out; // no history yet
	}
	for (const line of text.split("\n")) {
		try {
			for (const [k, v] of Object.entries(JSON.parse(line))) if (k !== "at" && k !== "reset" && k !== "src") out[k] = String(v);
		} catch {
			// the cut first line of the tail, or an empty one
		}
	}
	return out;
}

export default function (pi: ExtensionAPI) {
	const last: Record<string, string> = {}; // what this process knows to be in the history
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
			const use: Record<string, string> = {};
			for (const [k, v] of Object.entries(out)) if (k.endsWith(SUFFIX)) use[k.slice(0, -SUFFIX.length)] = String(v);
			const changed = () => Object.entries(use).some(([k, v]) => last[k] !== v);
			if (!changed()) return;
			Object.assign(last, recorded());
			if (!changed()) return;
			const row: Record<string, number> = { at: out.at as number, reset: Number(out["7d-reset"]) || 0 };
			for (const [k, v] of Object.entries(use)) row[k] = Number(v);
			appendFileSync(HISTORY, `${JSON.stringify(row)}\n`);
			Object.assign(last, use);
		} catch {
			// a full disk or a read-only home must not break the session
		}
	});
}
