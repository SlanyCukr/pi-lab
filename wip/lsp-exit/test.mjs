// node wip/lsp-exit/test.mjs: each case runs in a child node and reports whether it exited by itself.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ext = fileURLToPath(new URL("./index.ts", import.meta.url));
const jsonrpc = `${process.env.HOME}/.pi/agent/npm/node_modules/vscode-jsonrpc/lib/node/main.js`;
let failed = 0;

// Runs `body` (an ES module body) in a child; `shim` loads the extension first. Returns { exited, out }.
function run(body, { shim = true, waitMs = 2500 } = {}) {
	const src = `
		${shim ? `const ext = (await import(${JSON.stringify(ext)})).default; ext({});` : ""}
		const { StreamMessageReader } = (await import("node:module")).createRequire(import.meta.url)(${JSON.stringify(jsonrpc)});
		const { PassThrough } = await import("node:stream");
		const partial = (timeoutMs) => {
			const stream = new PassThrough();
			const reader = new StreamMessageReader(stream);
			reader.partialMessageTimeout = timeoutMs;
			reader.listen(() => {});
			stream.write('Content-Length: 500\\r\\n\\r\\n{"jsonrpc":"2.0",');
			stream.end();
			return reader;
		};
		${body}`;
	const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], { timeout: waitMs, encoding: "utf8" });
	// killed by the timeout = still alive; an exit with an error counts as neither (out holds the error)
	return { exited: r.error === undefined && r.status === 0, alive: r.error?.code === "ETIMEDOUT", out: (r.stdout + r.stderr).trim() };
}

function check(name, ok, detail = "") {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
	if (!ok) failed++;
}

// 1. The bug: without the extension a stream closed mid-message keeps the process alive (timer re-arms).
let r = run("partial(200);", { shim: false });
check("without lsp-exit, a closed partial message keeps node alive", r.alive, r.out);

// 2. The fix: the same process exits by itself, with vscode-jsonrpc's default 10 s timeout too.
r = run("partial(200); console.log('done');");
check("with lsp-exit, it exits (200 ms timeout)", r.exited && r.out === "done", r.out);
r = run("partial(10000); console.log('done');");
check("with lsp-exit, it exits (default 10 s timeout)", r.exited && r.out === "done", r.out);

// 3. While the process lives, the timer still fires its event.
r = run(`const reader = partial(150); let n = 0; reader.onPartialMessage(() => n++);
	setTimeout(() => console.log("events " + n), 700);`);
check("the partial-message event still fires while the process runs", r.exited && /^events [3-5]$/.test(r.out), r.out);

// 4. Other timers keep the process alive, also with the same call shape but another callback.
r = run("setTimeout(() => {}, 1500);", { waitMs: 800 });
check("a plain timer still keeps node alive", r.alive, r.out);
r = run("setTimeout((a, b) => {}, 1500, 1, 1500);", { waitMs: 800 });
check("a 4-argument timer without the marker still keeps node alive", r.alive, r.out);

// 5. setTimeout keeps its API: Timeout object, promisify, timers/promises; a second load does not wrap again.
r = run(`const { promisify } = await import("node:util");
	const t = setTimeout(() => {}, 10); const api = typeof t.refresh === "function" && typeof t.hasRef === "function"; clearTimeout(t);
	const v = await promisify(setTimeout)(20, "v");
	const w = await (await import("node:timers/promises")).setTimeout(20, "w");
	const before = setTimeout; ext({}); const same = before === setTimeout;
	console.log([api, v, w, same].join(" "));`);
check("Timeout API, promisify, timers/promises, idempotent load", r.exited && r.out === "true v w true", r.out);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
