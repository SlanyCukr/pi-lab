/**
 * `pi-bg-wait` / `pi-bg-stop` mixed into a longer bash command.
 *
 * Both are answered by the bash tool itself, not by a program, so `pi-bg-wait bg1; tail log` used to be refused
 * with "send each as the whole command". The find-gaps loop hit that 9 times on 2026-10-10 and 45 times over the run
 * (`pi-bg-wait bg1; date`, `cd … && pi-bg-wait bg1 && git status`, `git status && pi-bg-wait bg2 && pi-bg-stop bg1`),
 * each a wasted turn. `splitMixed` accepts the two shapes that keep shell order and meaning:
 *
 *   lead:  [cd|source|.|export … &&|;]* OPS [(&& | ;) REST]   setup, then the waits/stops, then the rest
 *   trail: REST (&& | ;) OPS                                   the rest, then the waits/stops
 *
 * OPS is one or more waits/stops joined by && or ;. The caller runs the parts in order and honours `&&`: a wait counts
 * as failed while its job is still running or when there is no such job, a stop when there is no such job, a bash
 * part when it exits non-zero; after a failed part, a part behind `&&` does not run. In the lead shape the setup
 * (only `cd`, `source`, `.`, `export`) is replayed in front of REST, since REST runs in its own bash.
 *
 * Splitting happens only at top-level `&&`, `;` and newlines, outside quotes, parentheses, braces, `$(…)` and
 * backticks. Anything else is refused (undefined): a wait or stop between two other commands, a heredoc, `||`, `&` or
 * a pipe next to one, a redirection other than `>/dev/null`, `2>/dev/null`, `2>&1`, or a pipe out of one other than
 * `| tail …` / `| head …` (both only trim the wait's own, already capped, output). A wait or stop that is only quoted
 * text (a commit message, a prompt, `echo`) gives "plain": the command runs as it is.
 */

export type BgOp = { kind: "wait" | "stop"; id: string };
type Sep = "&&" | ";" | "||" | "|" | "&";
type Joiner = "&&" | ";";
export type Mixed = {
	/** cd/source/export segments before the ops (lead shape), replayed in front of `after` */
	setup: string;
	/** bash to run before the ops (trail shape) */
	before: string;
	ops: BgOp[];
	/** joiners in run order: [before→op0]?, op0→op1, …, [opN→after]? */
	joins: Joiner[];
	/** bash to run after the ops (lead shape), with the setup in front */
	after: string;
};

const OP = /^\s*pi-bg-(wait|stop)\s+((?:bg|loop)?\d+)((?:\s+(?:>\s*\/dev\/null|2>\s*\/dev\/null|2>&1|&>\s*\/dev\/null))*)\s*$/;
const PIPE_TAIL = /^\s*(?:tail|head)(?:\s+-[a-zA-Z]*\s*\d*|\s+\d+)*\s*$/;
const SETUP = /^\s*(?:cd|source|\.|export)(?:\s|$)/;
// a wait or stop in command position, as the caller's MIXED_WAIT tests it
const IN_COMMAND = /(^|&&|\|\||;|\||\(|\{|\n)\s*pi-bg-(wait|stop)\s+(bg|loop)?\d+\b/;
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;

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
			if (c === "\\" && quote !== "'" && i + 1 < command.length) cur += command[++i];
			else if (c === quote) quote = undefined;
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
		if (depth > 0 || c === ")" || c === "}") {
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

const join = (segs: string[], seps: Sep[], from: number, to: number): string => {
	let out = "";
	for (let i = from; i < to; i++) {
		if (!segs[i].trim()) continue;
		if (out) out += seps[i - 1] === ";" ? "; " : ` ${seps[i - 1]} `;
		out += segs[i].trim();
	}
	return out;
};

/** The parts of a mixed command in run order; "plain" when every mention is quoted text; undefined to refuse. */
export function splitMixed(command: string): Mixed | "plain" | undefined {
	const parsed = segments(command);
	if (!parsed) return undefined;
	if (!IN_COMMAND.test(command.replace(QUOTED, "''"))) return "plain";
	let { segs, seps } = parsed;
	// `pi-bg-wait bg1 2>&1 | tail -3`: fold the trimming pipe into the wait (it only shortens the wait's output)
	for (let i = 0; i < segs.length - 1; i++) {
		if (seps[i] === "|" && OP.test(segs[i]) && PIPE_TAIL.test(segs[i + 1])) {
			segs = [...segs.slice(0, i + 1), ...segs.slice(i + 2)];
			seps = [...seps.slice(0, i), ...seps.slice(i + 1)];
		}
	}
	// drop empty segments left by a trailing `;` or newline
	while (segs.length > 1 && !segs[segs.length - 1].trim()) {
		segs.pop();
		seps.pop();
	}
	const isOp = segs.map((s) => OP.test(s));
	const first = isOp.indexOf(true);
	const last = isOp.lastIndexOf(true);
	if (first < 0) return undefined; // a mention we cannot place (inside a subshell or a pipe): refuse
	for (let i = first; i <= last; i++) if (!isOp[i]) return undefined; // ops must be one contiguous run
	for (let i = Math.max(0, first - 1); i <= last && i < seps.length; i++) if (seps[i] !== "&&" && seps[i] !== ";") return undefined;
	const ops: BgOp[] = [];
	for (let i = first; i <= last; i++) {
		const m = OP.exec(segs[i])!;
		if (m[1] === "wait" && m[2].startsWith("loop")) return undefined;
		ops.push({ kind: m[1] as BgOp["kind"], id: /^\d+$/.test(m[2]) ? `bg${m[2]}` : m[2] });
	}
	const opJoins = seps.slice(first, last) as Joiner[];
	const hasBefore = first > 0;
	const hasAfter = last < segs.length - 1;
	const beforeIsSetup = hasBefore && segs.slice(0, first).every((s) => SETUP.test(s));
	if (hasBefore && hasAfter && !beforeIsSetup) return undefined; // a wait or stop between two commands
	const setup = beforeIsSetup && hasAfter ? join(segs, seps, 0, first) : "";
	const before = hasBefore && !setup ? join(segs, seps, 0, first) : "";
	const afterJoin = hasAfter ? (seps[last] as Joiner) : undefined;
	const after = hasAfter ? join(segs, seps, last + 1, segs.length) : "";
	const joins: Joiner[] = [...(before ? [seps[first - 1] as Joiner] : []), ...opJoins, ...(afterJoin ? [afterJoin] : [])];
	return { setup, before, ops, joins, after: after && setup ? `${setup} && ${after}` : after };
}
