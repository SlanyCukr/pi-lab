// Lets a finished pi exit when an LSP server stopped in the middle of a message.
//
// vscode-jsonrpc's ReadableStreamMessageReader (bundled in pi-lens) arms a 10 s "partial message" timer when a
// message arrives incomplete. Its callback re-arms it for as long as the message stays incomplete (the token it
// compares never changes), and nothing clears it when the stream closes. So once an LSP server stops mid-message,
// that ref'd timer keeps the process alive forever. It only fires an event that no pi code listens to.
// Seen as the find-gaps exit hang: pi answered, then idled until the runner stopped it 45 s later (51 cycles by
// 2026-10-27; the one hang the runner's event-loop probe saw, c403, was this timer; harness review 2026-10-27).
// pi-lens's bundled copy calls the global setTimeout at call time (`require_ril` in its dist/index.js).
//
// Fix: unref exactly that timer, so it no longer holds the process open. While pi runs it fires as before.
// The match is vscode-jsonrpc's call shape, setTimeout(callback, timeout, token, timeout), plus the field name in
// the callback's source; every other timer is untouched. Test: `node wip/lsp-exit/test.mjs`.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const INSTALLED = Symbol.for("pi-lab.lsp-exit");

export default function (_pi: ExtensionAPI) {
	const g = globalThis as any;
	if (g[INSTALLED]) return; // once per process: pi-web loads extensions for every session
	const original = g.setTimeout;
	const wrapped = function (this: unknown, callback: unknown, ms?: number, ...args: unknown[]) {
		const timer = original.call(this, callback, ms, ...args);
		if (args.length === 2 && ms === args[1] && typeof callback === "function" && String(callback).includes("partialMessageTimer")) {
			timer?.unref?.();
		}
		return timer;
	};
	// keep util.promisify(setTimeout) working: it reads a symbol property of setTimeout
	for (const key of Object.getOwnPropertySymbols(original)) {
		Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(original, key)!);
	}
	g.setTimeout = wrapped;
	g[INSTALLED] = true;
}
