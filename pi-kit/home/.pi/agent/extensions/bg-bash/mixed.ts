/**
 * `pi-bg-wait` / `pi-bg-stop` mixed into a longer bash command.
 *
 * Both are answered by the bash tool itself, not by a program, so `pi-bg-wait bg1; tail log` used to be refused
 * with "send each as the whole command". The find-gaps loop hit that 9 times on 2026-10-10 and 45 times over the run
 * (`pi-bg-wait bg1; date`, `cd … && pi-bg-wait bg1 && git status`, `git status && pi-bg-wait bg2 && pi-bg-stop bg1`),
 * each a wasted turn. `splitMixed` lifts them out: the waits and stops run first, in the order written, then the rest
 * of the command runs as one bash command. Waits only read, and every stop seen so far stood next to commands it does
 * not depend on, so running them first is safe.
 *
 * It splits only at top-level `&&`, `;` and newlines, outside quotes, parentheses, braces, `$(…)` and backticks.
 * It gives up (undefined: the caller keeps refusing) on a heredoc, on `||`, `&` or a pipe into a wait or stop, and on
 * any other pipe out of one than `| tail …` or `| head …` (dropped: the wait's own output is already capped).
 * Redirections after a wait or stop (`2>&1`, `>/dev/null`) are dropped. When only `cd`, `source`, `.` or `export`
 * would remain, nothing else runs. A wait or stop that is only quoted text (a commit message, a prompt, `echo`)
 * gives "plain": the command runs as it is.
 */

export type BgOp = { kind: "wait" | "stop"; id: string };

const OP = /^\s*pi-bg-(wait|stop)\s+((?:bg|loop)?\d+)((?:\s+(?:\d?>>?|&>|\d?>&)\s*\S+|\s+\d?>&\d)*)\s*$/;
const PIPE_TAIL = /^\s*(?:tail|head)(?:\s+-[a-zA-Z]*\s*\d*|\s+\d+)*\s*$/;
const SETUP_ONLY = /^\s*(?:cd|source|\.|export)(?:\s|$)/;

type Sep = "&&" | ";" | "||" | "|" | "&";

/** Top-level segments and the separators between them, or undefined when the command cannot be split safely. */
function segments(command: string): { segs: string[]; seps: Sep[] } | undefined {
	const segs: string[] = [];
	const seps: Sep[] = [];
	let cur = "";
	let quote: "'" | '"' | "`" | undefined;
	let depth = 0;
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		const next = command[i + 1];
		if (quote) {
			cur += c;
			if (c === "\\" && quote !== "'" && i + 1 < command.length) {
				cur += command[++i];
				continue;
			}
			if (c === quote) quote = undefined;
			continue;
		}
		if (c === "\\" && i + 1 < command.length) {
			cur += c + command[++i];
			continue;
		}
		if (c === "'" || c === '"' || c === "`") {
			quote = c;
			cur += c;
			continue;
		}
		if (c === "<" && next === "<") return undefined; // heredoc or here-string: leave it alone
		if (c === "(" || c === "{") depth++;
		if (c === ")" || c === "}") depth--;
		if (depth > 0 || c === "(" || c === "{" || c === ")" || c === "}") {
			cur += c;
			continue;
		}
		const prev = command[i - 1];
		let sep: Sep | undefined;
		if (c === "&" && next === "&") sep = "&&";
		else if (c === "|" && next === "|") sep = "||";
		else if (c === ";" || c === "\n") sep = ";";
		else if (c === "|" && prev !== ">") sep = "|";
		else if (c === "&" && prev !== ">" && prev !== "<" && next !== ">") sep = "&";
		if (!sep) {
			cur += c;
			continue;
		}
		if (sep === "&&" || sep === "||") i++;
		segs.push(cur);
		seps.push(sep);
		cur = "";
	}
	if (quote || depth !== 0) return undefined;
	segs.push(cur);
	return { segs, seps };
}

// a wait or stop in command position, as the caller's MIXED_WAIT tests it
const IN_COMMAND = /(^|&&|\|\||;|\||\(|\{|\n)\s*pi-bg-(wait|stop)\s+(bg|loop)?\d+\b/;
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;

/**
 * The waits and stops in a mixed command plus what is left to run in bash; "plain" when every mention is quoted
 * text, so bash can run the command as it is; undefined to keep refusing.
 */
export function splitMixed(command: string): { ops: BgOp[]; rest: string } | "plain" | undefined {
	const parsed = segments(command);
	if (!parsed) return undefined;
	if (!IN_COMMAND.test(command.replace(QUOTED, "''"))) return "plain";
	const { segs, seps } = parsed;
	const ops: BgOp[] = [];
	const drop = new Set<number>(); // indexes of segments that leave the bash command
	for (let i = 0; i < segs.length; i++) {
		const m = OP.exec(segs[i]);
		if (!m) continue;
		const before = seps[i - 1];
		const after = seps[i];
		if (before === "|" || before === "||" || before === "&" || after === "||" || after === "&") return undefined;
		if (after === "|") {
			// `pi-bg-wait bg1 2>&1 | tail -3`: the pipe only trims the output; any other consumer is real work
			if (!PIPE_TAIL.test(segs[i + 1] ?? "") || (seps[i + 1] !== undefined && seps[i + 1] !== "&&" && seps[i + 1] !== ";"))
				return undefined;
			drop.add(i + 1);
		}
		const id = m[2];
		if (m[1] === "wait" && id.startsWith("loop")) return undefined;
		ops.push({ kind: m[1] as BgOp["kind"], id: /^\d+$/.test(id) ? `bg${id}` : id });
		drop.add(i);
	}
	if (ops.length === 0) return undefined;
	// Rebuild the rest with the separators that stood between the kept segments.
	let rest = "";
	let kept = 0;
	const keptSegs: string[] = [];
	for (let i = 0; i < segs.length; i++) {
		if (drop.has(i) || !segs[i].trim()) continue;
		if (kept > 0) {
			// the separator right before this segment; a dropped neighbour's `|` never survives (checked above)
			let s: Sep = seps[i - 1] ?? ";";
			if (s === "|" && drop.has(i - 1)) s = ";";
			rest += s === ";" ? "; " : ` ${s} `;
		}
		rest += segs[i].trim();
		keptSegs.push(segs[i]);
		kept++;
	}
	if (keptSegs.every((s) => SETUP_ONLY.test(s))) rest = "";
	return { ops, rest };
}
