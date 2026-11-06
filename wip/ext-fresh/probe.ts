const n = ((globalThis as any).__probeEvals = ((globalThis as any).__probeEvals ?? 0) + 1);
console.error(`PROBE module evaluated (${n})`);
export default function () {}
