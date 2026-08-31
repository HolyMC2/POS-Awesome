// Every event that rides the typed bus must be DECLARED in bus.ts's `Events`
// map — that declaration is what lets vue-tsc catch a view that mishandles a
// payload, and it is how a listener that a refactor drops gets noticed. Two live
// events (show_change_due, run_menu_action) had slipped in undeclared and
// vue-tsc stayed green because the biggest consumers are untyped <script> blocks
// (audit RUNTIME-F9). This scans the register tree and asserts parity.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import busSrc from "../src/posapp/bus.ts?raw";

const SRC = resolve(__dirname, "../src/posapp");

const walk = (dir: string, out: string[] = []) => {
	for (const name of readdirSync(dir)) {
		const full = resolve(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(vue|ts)$/.test(name)) out.push(full);
	}
	return out;
};

// The keys declared in `export type Events = { ... }`.
const declaredKeys = () => {
	const block = busSrc.slice(busSrc.indexOf("export type Events = {"));
	const body = block.slice(block.indexOf("{") + 1, block.indexOf("\n};"));
	const keys = new Set<string>();
	for (const m of body.matchAll(/^\s*"?([A-Za-z_][\w:-]*)"?\s*:/gm)) keys.add(m[1]);
	return keys;
};

// Strip line and block comments so a commented-out `.off("dead_event")` is not
// mistaken for a live contract.
const stripComments = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Every real `eventBus.emit("X")` or `.on("X")` in the tree — the send/receive
// contract. `.off` is cleanup and may name an event defensively, so it is not a
// signal that the event is on the bus.
const usedEvents = () => {
	const re = /eventBus\??\.(?:emit|on)\(\s*["'`]([A-Za-z_][\w:-]*)["'`]/g;
	const found = new Map<string, string>();
	for (const file of walk(SRC)) {
		const text = stripComments(readFileSync(file, "utf8"));
		for (const m of text.matchAll(re)) {
			if (!found.has(m[1])) found.set(m[1], file.replace(SRC, ""));
		}
	}
	return found;
};

describe("the typed event bus is complete", () => {
	it("declares show_change_due and run_menu_action", () => {
		const keys = declaredKeys();
		expect(keys.has("show_change_due")).toBe(true);
		expect(keys.has("run_menu_action")).toBe(true);
	});

	it("declares every event that rides the bus anywhere in the register", () => {
		const keys = declaredKeys();
		const undeclared: string[] = [];
		for (const [name, where] of usedEvents()) {
			if (!keys.has(name)) undeclared.push(`${name}  (first seen ${where})`);
		}
		expect(undeclared, "undeclared bus events:\n" + undeclared.join("\n")).toEqual([]);
	});
});
