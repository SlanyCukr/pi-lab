Follow-up for anyone applying the `sessionId` fix from this issue: it needs a matching cleanup, or headless runs hang.

**What happens.** With `sessionId: "advisor-<id>"`, pi-ai's openai-codex provider caches a WebSocket for that session id. After each response it arms a referenced 5-minute idle timer (`SESSION_WEBSOCKET_CACHE_TTL_MS`, `scheduleSessionWebSocketExpiry` in `pi-ai/dist/api/openai-codex-responses.js`). pi's session disposal calls `cleanupSessionResources(mainSessionId)`, which never matches the `advisor-` id. So a `pi -p` run that called the advisor stays alive for about 5 minutes after it finishes. It doesn't matter in the TUI, but scripts and CI wait.

**Evidence (pi 0.87.1, advisor model `openai-codex/gpt-6-astra`).**
- `sessionId` patch only: the agent ends at 17 s and the process exits at 300 s (killed by `timeout`). The only live handle is a `TLSSocket` to `chatgpt.com:443`.
- Unpatched 2.11.0 (no `sessionId`): exits in 13–14 s, with no prompt-cache reads.
- `sessionId` patch plus the cleanup below: exits in 15–18 s, and the prompt cache still hits.

**Fix** (`index.ts`, idempotent, as the pi extension docs ask):

```ts
import { cleanupSessionResources } from "@earendil-works/pi-ai";

pi.on("session_shutdown", (_event, ctx) => {
	cleanupSessionResources(`advisor-${ctx.sessionManager.getSessionId()}`);
});
```

The id has to match the one passed to `completeSimple`, so a shared helper for `advisor-${sessionId}` is cleaner than repeating the template string.
