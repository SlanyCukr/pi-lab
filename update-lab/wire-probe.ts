import { appendFileSync } from "node:fs";

// Scratch probe: log what actually goes over the wire to Anthropic /v1/messages,
// after every extension and transport wrapper has shaped the request.
// Output file: $WIRE_PROBE_OUT (one JSON line per request). No headers are logged.
const out = process.env.WIRE_PROBE_OUT;
const orig = globalThis.fetch;
if (out && !(globalThis as any).__wireProbe) {
	(globalThis as any).__wireProbe = true;
	globalThis.fetch = async (input: any, init?: any) => {
		try {
			const url = typeof input === "string" ? input : input?.url ?? String(input);
			if (url.includes("/v1/messages") && typeof init?.body === "string") {
				const p = JSON.parse(init.body);
				const sys = Array.isArray(p.system) ? p.system : [{ text: String(p.system ?? "") }];
				appendFileSync(
					out,
					JSON.stringify({
						t: Date.now(),
						model: p.model,
						systemBlocks: sys.map((b: any) => ({ len: (b.text ?? "").length, cache: Boolean(b.cache_control), head: (b.text ?? "").slice(0, 160) })),
						systemText: sys.map((b: any) => b.text ?? "").join("\n----BLOCK----\n"),
						tools: (p.tools ?? []).map((x: any) => x.name),
						messages: (p.messages ?? []).length,
					}) + "\n",
				);
			}
		} catch (e) {
			appendFileSync(out, JSON.stringify({ err: String(e) }) + "\n");
		}
		return orig(input, init);
	};
}

export default function () {}
