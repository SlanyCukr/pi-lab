import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Per-prompt output-style reminder, like Claude Code's output-style turn reminder.
// The style rules live once at the top of the system prompt (APPEND_SYSTEM.md), and long
// sessions drift away from them. This adds one short hidden message after each user prompt.
// Cache-safe: the message is stored in the session right after the prompt (append-only),
// so earlier request bytes never change. Main session only: sub-agents report to a model.

const REMINDER =
	"<system-reminder>Output style: lead with the result. No narration of steps or tool notes. " +
	"Final message about 8 lines (15 for a large task): outcome, needed detail, `Open:` at most 3 lines, one next action.</system-reminder>";

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", () => {
		const tools = pi.getActiveTools();
		if (tools.includes("ask_parent") || tools.includes("notify_parent")) return;
		return { message: { customType: "style-reminder", content: REMINDER, display: false } };
	});
}
