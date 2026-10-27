// Test only: reproduces the exit hang in a real `pi -p`. At session start it gives vscode-jsonrpc's stream reader
// (the copy pi-lens depends on) a message whose body never arrives, then closes the stream, as an LSP server
// stopped mid-message does. Without lsp-exit, pi answers and then never exits.
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const require = createRequire(`${process.env.HOME}/.pi/agent/npm/node_modules/`);
const { StreamMessageReader } = require("vscode-jsonrpc/node");

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		const stream = new PassThrough();
		new StreamMessageReader(stream).listen(() => {});
		stream.write('Content-Length: 500\r\n\r\n{"jsonrpc":"2.0",');
		stream.end();
	});
}
