import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Tools to keep out of the model's active tool set. pi-lens refuses to disable
// its activator via its own config (required for its lazy-mode contract); with
// lazy mode off it has nothing to activate, so hide it here instead.
const HIDDEN = new Set(["pi_lens_activate_tools"]);

export default function (pi: ExtensionAPI) {
	const hide = () => {
		const active = pi.getActiveTools();
		const next = active.filter((name) => !HIDDEN.has(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	};
	pi.on("session_start", hide);
	pi.on("session_switch", hide);
}
