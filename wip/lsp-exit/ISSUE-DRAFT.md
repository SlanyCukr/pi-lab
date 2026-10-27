Draft for apmantza/pi-lens (follow-up to #4554, which is closed). Not posted; the user decides.

---

**Headless `pi -p` still never exits after an LSP server stops mid-message (vscode-jsonrpc partial-message timer)**

pi-lens 4.4.4, pi 1.4.0, Node 24 and 26. About 1 in 4 of our unattended `pi -p` runs that edit files answered and then
stayed alive until killed.

Cause, read from the hung process's event loop over the inspector: the only ref'd handle was one 10000 ms timer,
`(token, timeout) => { this.partialMessageTimer = void 0; if (token === this.messageToken) { this.firePartialMessage(...); this.setPartialMessageTimer(); } }`.
No child processes or sockets were left.

That is `ReadableStreamMessageReader.setPartialMessageTimer` in the bundled vscode-jsonrpc 9.0.3. When a message's
headers arrive but its body does not (the LSP server stopped mid-write), the timer re-arms every 10 s for as long as
the message stays incomplete: `messageToken` never changes, and neither `dispose()` nor the stream's close clears it.

Repro (no pi needed):

```js
const { StreamMessageReader } = require("vscode-jsonrpc/node");
const s = new (require("node:stream").PassThrough)();
new StreamMessageReader(s).listen(() => {});
s.write('Content-Length: 500\r\n\r\n{"jsonrpc":"2.0",');
s.end(); // node never exits
```

Possible fix in pi-lens: keep the reader and set `reader.partialMessageTimeout = 0` when the LSP process exits or the
client is disposed (the pending timer then fires once more and stops). Nothing in pi-lens listens to
`onPartialMessage`. Our local workaround unrefs that one timer: https://github.com/SlanyCukr/pi-lab (`lsp-exit`).
