import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Cancel-Payment exit spans three files that only agree by string: the emit
 * in Payments.vue, the declaration in the closed bus map, and the listener in
 * the shell. Renaming any one of them leaves the other two compiling and the
 * event landing nowhere — Cancel would quietly fall back to the Browse exit,
 * which is the bug this replaced. So the name is pinned across all three.
 *
 * Source-level on purpose, and therefore in its own file: the behavioural half
 * lives in posShellDockTabs.spec.ts, which runs under jsdom where node:fs is
 * not available.
 */

const read = (relativePath: string) =>
	readFileSync(
		fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)),
		"utf8",
	);

/** The event Payments.vue's cancel path actually asks for. */
const emittedEvent = () => {
	const source = read("posapp/components/pos/Payments.vue");
	const cancelBody = source.slice(source.indexOf("const cancel_payment ="));
	return /eventBus\??\.?emit\??\.?\("([^"]+)"\)/.exec(cancelBody)?.[1];
};

/**
 * Every way out of the payment view that has to land on the CART, and the
 * function in each file that owns that exit. They all hand the move to the
 * shell rather than setting the panel and the active view themselves — doing
 * it locally races the shell's activeView watcher and lands on Browse.
 */
const CART_EXITS = [
	{
		what: "Cancel Payment",
		file: "posapp/components/pos/Payments.vue",
		from: "const cancel_payment =",
		until: "const finishSubmissionNavigation",
	},
	{
		what: "Alt+1 and a customer change",
		file: "posapp/components/pos/invoice_utils/dialogs.ts",
		from: "export function close_payments",
		until: "export async function change_price_list_rate",
	},
	{
		what: "Alt+1 on a panel without close_payments",
		file: "posapp/components/pos/invoice/invoiceShortcuts.ts",
		from: "if (isDigit(event, 1))",
		// The neighbouring Alt+N branches reveal the invoice panel too, and are
		// right to do it with set_compact_panel: they only move the panel, never
		// activeView, so there is no watcher to race.
		until: "if (isDigit(event, 2))",
	},
] as const;

/** Just the one exit's body — the anchors keep neighbours out of the match. */
const exitBody = (exit: (typeof CART_EXITS)[number]) => {
	const source = read(exit.file);
	const start = source.indexOf(exit.from);
	expect(start, `${exit.file} no longer contains ${exit.from}`).toBeGreaterThan(-1);
	const end = source.indexOf(exit.until, start);
	expect(end, `${exit.file} no longer contains ${exit.until}`).toBeGreaterThan(start);
	return source.slice(start, end);
};

describe("show_invoice_panel is wired end to end", () => {
	it("emits an event the closed bus map declares", () => {
		const event = emittedEvent();
		expect(
			event,
			"Payments.vue's cancel path no longer emits a bus event — the shell hand-off is gone",
		).toBeTruthy();

		expect(
			read("posapp/bus.ts"),
			`bus.ts must declare "${event}": an undeclared event rides the bus untyped, so vue-tsc cannot catch a mismatch`,
		).toContain(`${event}: void;`);
	});

	it("emits an event the shell registers and tears down", () => {
		const event = emittedEvent();
		const shell = read("posapp/components/pos/shell/Pos.vue");

		expect(shell, `Pos.vue must listen for "${event}"`).toContain(
			`eventBus.on("${event}", showInvoicePanel)`,
		);
		// A listener left behind after unmount answers for a dead component; the
		// sibling teardowns all pass the handler for the same reason.
		expect(shell, `Pos.vue must remove its "${event}" listener on unmount`).toContain(
			`eventBus.off("${event}", showInvoicePanel)`,
		);
	});

	it("routes to showInvoicePanel rather than the raw panel setter", () => {
		// setCompactPanel sets the panel without suppressing the activeView
		// watcher, so the panel would flip straight back to the selector.
		const shell = read("posapp/components/pos/shell/Pos.vue");
		expect(shell).not.toContain(`eventBus.on("show_invoice_panel", setCompactPanel)`);
	});

	it.each(CART_EXITS)("$what asks the shell for the cart", (exit) => {
		expect(exitBody(exit)).toContain('emit?.("show_invoice_panel")');
	});

	it.each(CART_EXITS)("$what does not set the compact panel itself", (exit) => {
		// set_compact_panel routes to setCompactPanel, which does not suppress
		// the activeView watcher — the panel would flip back to the selector.
		expect(exitBody(exit)).not.toContain('"set_compact_panel", "invoice"');
		expect(exitBody(exit)).not.toContain('showCompactPanel(this.eventBus, "invoice")');
		expect(exitBody(exit)).not.toContain('showCompactPanel(context, "invoice")');
	});
});
