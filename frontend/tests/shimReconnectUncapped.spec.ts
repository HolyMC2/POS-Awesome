// The /posapp web/phone shell must not cap socket.io reconnection. An earlier
// `reconnectionAttempts: 3` (~8s) meant a foreground wifi flap — navigator.onLine
// stays true, the tab stays visible, so nothing re-arms — killed realtime for the
// rest of the shift (audit RUNTIME-F3). socket.io defaults to Infinity with
// exponential backoff, matching Desk. Source-pinned: the ioOpts object must not
// set reconnectionAttempts.
import { describe, expect, it } from "vitest";
import shimSource from "../src/posapp/utils/frappe-shim.ts?raw";

describe("the realtime shim does not cap reconnection", () => {
	it("passes no reconnectionAttempts to socket.io (defaults to Infinity)", () => {
		// The whole file: no active `reconnectionAttempts:` key anywhere. The word
		// may appear in the explaining comment, but never as an object key.
		const withoutComments = shimSource.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
		expect(withoutComments).not.toMatch(/reconnectionAttempts\s*:/);
	});
});
