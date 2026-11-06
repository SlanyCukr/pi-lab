// ext-fresh: a long-lived pi process (pi-web) loads changed extension code for its next session.
//
// pi 1.2.0 (the copy pi-web runs) keeps loaded extension modules in a process-wide cache per working directory
// (core/extensions/loader.js, extensionCache). It is cleared only on /reload or when a session with another cwd
// loads. pi-web is one process that runs for weeks, so every new ~/pi-lab session reused the modules loaded at the
// last cwd switch (11-02 18:38): the 11-05 compact-on-return change never ran there, and a 22 h return at 389k
// tokens re-wrote the cache for $3.15 (harness review 2026-11-06).
//
// This extension loads the host's loader.js (found on its factory's call stack, so it is the module instance that
// holds the cache) and clears the cache whenever a code or config file under ~/.pi/agent/extensions or
// ~/.pi/agent/local-packages changes (logs such as divergence.jsonl change on every session start: ignored).
// Sessions already open keep their code; the next session created loads the files as they are on disk.
// The first install in a process also clears once, since modules cached before it may already be stale.
// Bundled pi (the 1.4 CLI) has no separate loader.js: inert there.
import { existsSync, type FSWatcher, watch } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const KEY = Symbol.for("ext-fresh.watchers");
const CODE = /\.(ts|mts|js|mjs|cjs|json)$/;
const DEBUG = !!process.env.PI_EXT_FRESH_DEBUG;
const log = (msg: string) => DEBUG && console.error(`[ext-fresh] ${msg}`);
// jiti rewrites import() in the files it transpiles; Node's own require (require(esm), Node >= 22.12) shares
// Node's module cache with the host, so it returns the instance that holds the cache.
const nativeLoad = (file: string) => createRequire(file)(file);

/** The host's loader.js, from the stack of the call that runs this extension's factory. */
export function hostLoaderPath(stack = new Error().stack ?? ""): string | undefined {
	const m = stack.match(/(?:file:\/\/)?(\/[^\s()]*\/pi-coding-agent\/dist\/core\/)[^\s()]*\.js/);
	return m ? join(m[1], "extensions", "loader.js") : undefined;
}

/** Watches `dirs` and clears the host's extension cache on a code change; returns the watchers. */
export function install(loader: string | undefined, dirs: string[], clearNow: boolean): FSWatcher[] {
	if (!loader || !existsSync(loader)) {
		log(`no separate loader.js (${loader}): inert`);
		return [];
	}
	let clear: unknown;
	try {
		clear = nativeLoad(loader)?.clearExtensionCache;
	} catch (e: any) {
		log(`load ${loader} failed: ${e?.message}`);
		return [];
	}
	if (typeof clear !== "function") return [];
	const clearCache = clear as () => void;
	if (clearNow) clearCache();
	const watchers: FSWatcher[] = [];
	for (const dir of dirs.filter((d) => existsSync(d))) {
		try {
			// persistent: false, so the watcher never keeps a finished `pi -p` alive
			const w = watch(dir, { recursive: true, persistent: false }, (_event, file) => {
				if (file && !CODE.test(String(file))) return;
				log(`${dir}/${file} changed: cache cleared`);
				clearCache();
			});
			w.on("error", (e: any) => log(`watch ${dir}: ${e?.message}`));
			watchers.push(w);
		} catch (e: any) {
			log(`watch ${dir} failed: ${e?.message}`);
		}
	}
	log(`watching ${dirs.join(", ")} via ${loader}`);
	return watchers;
}

// Module scope: true once this evaluation of the module has installed its watchers. pi calls the factory once per
// session; a new evaluation (this file changed) replaces the previous evaluation's watchers.
let installed = false;

export default function (_pi: ExtensionAPI) {
	if (installed) return;
	installed = true;
	const g = globalThis as any;
	const previous: FSWatcher[] | undefined = g[KEY];
	for (const w of previous ?? []) w.close();
	const base = join(homedir(), ".pi", "agent");
	g[KEY] = install(hostLoaderPath(), [join(base, "extensions"), join(base, "local-packages")], previous === undefined);
}
