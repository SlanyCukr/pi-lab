// Minimal OpenAI-compatible chat-completions server for testing pi-kit without real credentials.
// Script per request, based on how many tool results the conversation already has:
//   0 -> call `subagent` (Explore)   1 -> call `advisor`   2+ -> reply "MOCK_DONE"
// Every request body is appended to $MOCK_LOG (default /tmp/mock-requests.jsonl).
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_PORT || 18080);
const LOG = process.env.MOCK_LOG || "/tmp/mock-requests.jsonl";

// MOCK_TEXT_ONLY=1 skips the tool calls (just captures the request and replies MOCK_DONE).
// MOCK_REPLY='text' replaces the MOCK_DONE text reply.
// MOCK_SCRIPT='[{"name":"read","args":{"path":"/etc/hostname"}}]' replaces the default script.
// Requests without tools (e.g. compaction summaries) always get a text reply.
function parseScript(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`mock-llm: MOCK_SCRIPT is not valid JSON: ${e.message}`);
    process.exit(2);
  }
}
const script = process.env.MOCK_TEXT_ONLY ? [] : process.env.MOCK_SCRIPT ? parseScript(process.env.MOCK_SCRIPT) : [
  { name: "subagent", args: { subagent_type: "Explore", description: "box probe", prompt: "Reply with the word hi." } },
  { name: "advisor", args: {} },
];

function chunk(res, delta, finish = null) {
  const body = { id: "mock", object: "chat.completion.chunk", created: 0, model: "mock-1",
    choices: [{ index: 0, delta, finish_reason: finish }] };
  res.write(`data: ${JSON.stringify(body)}\n\n`);
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    appendFileSync(LOG, raw.replace(/\n/g, " ") + "\n");
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const toolResults = (body.messages || []).filter((m) => m.role === "tool").length;
    res.writeHead(200, { "content-type": "text/event-stream" });
    chunk(res, { role: "assistant" });
    const step = (body.tools || []).length > 0 ? script[toolResults] : undefined;
    if (step) {
      chunk(res, { tool_calls: [{ index: 0, id: `call_${toolResults}`, type: "function",
        function: { name: step.name, arguments: JSON.stringify(step.args) } }] });
      chunk(res, {}, "tool_calls");
    } else {
      chunk(res, { content: process.env.MOCK_REPLY || "MOCK_DONE" });
      chunk(res, {}, "stop");
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
}).listen(PORT, "127.0.0.1", () => console.log(`mock-llm on ${PORT}`));
