import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Source-level, like tests/paymentsCompactSheet.spec.ts: Payments.vue and
// Pos.vue cannot be imported under vitest (they pull the whole POS stack
// through `.js` specifiers that only resolve in the vite pipeline), so the
// route the change amount takes from the submit response to the shell is
// pinned here. The dialog's own behaviour is in tests/changeDueDialog.spec.ts;
// the composable's is in tests/usePaymentSubmission.spec.ts.
const read = (path: string) => readFileSync(resolve(path), "utf8");

const dialogSource = read(
	"src/posapp/components/pos/payments/ChangeDueDialog.vue",
);
const submissionSource = read(
	"src/posapp/composables/pos/payments/usePaymentSubmission.ts",
);
const paymentsSource = read("src/posapp/components/pos/Payments.vue");
const shellSource = read("src/posapp/components/pos/shell/Pos.vue");

describe("change-due dialog styling", () => {
	const styleBlock = dialogSource.slice(dialogSource.lastIndexOf("<style"));

	it("keeps the amount readable from a meter away", () => {
		// The clamp floor is the promise: 3rem at the narrowest phone.
		expect(styleBlock).toMatch(
			/\.change-due-amount \{[^}]*font-size: clamp\(3rem/,
		);
	});

	it("keeps the confirm button thumb-sized", () => {
		expect(styleBlock).toMatch(/\.change-due-confirm \{[^}]*min-height: 56px/);
	});

	it("carries no auto-dismiss of any kind", () => {
		// The toast this replaced timed out after 12s and was missed anyway.
		expect(dialogSource).not.toContain("timeout");
		expect(dialogSource).not.toContain("setTimeout");
	});

	it("paints from theme tokens only, so both themes read", () => {
		const card = styleBlock.slice(styleBlock.indexOf(".change-due-card"));
		expect(card).toContain("background: var(--pos-card-bg)");
		expect(card).toContain("color: var(--pos-text-primary)");
		expect(styleBlock).toContain("color: var(--pos-text-primary)");
		// A literal hex is one theme's mistake waiting to ship.
		expect(styleBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
	});
});

describe("change-due submit wiring", () => {
	const changeBlock = (() => {
		const start = submissionSource.indexOf(
			"if (pChange > 0 && !doc.is_return) {",
		);
		expect(start).toBeGreaterThan(-1);
		return submissionSource.slice(
			start,
			submissionSource.indexOf("\n\t\t\t}", start),
		);
	})();

	it("hands the change to the dialog instead of the toast", () => {
		expect(changeBlock).toContain("onChangeDue(changeDue)");
		// The toast survives only as the fallback for a caller that wires no
		// handler; it must never fire alongside the dialog.
		expect(changeBlock).toMatch(
			/if \(onChangeDue\) \{[\s\S]*?\} else \{[\s\S]*?toastStore\?\.show/,
		);
	});

	it("reports the change the server actually booked", () => {
		// pChange is the amount of the change Payment Entry; anything recomputed
		// here could disagree with the GL.
		expect(changeBlock).toContain("amount: pChange");
	});

	it("leaves the print call ahead of it and unawaited", () => {
		const printIndex = submissionSource.indexOf("onPrint(submittedDocument, {");
		const changeIndex = submissionSource.indexOf(
			"if (pChange > 0 && !doc.is_return) {",
		);
		expect(printIndex).toBeGreaterThan(-1);
		expect(printIndex).toBeLessThan(changeIndex);
		// `await onPrint(` would park Submit & Print behind the printer.
		expect(submissionSource).not.toContain("await onPrint(");
	});
});

describe("change-due shell wiring", () => {
	it("routes the amount through the shell, which outlives the payment dialog", () => {
		// Dialog mode mounts Payments behind a v-if that dies with the payment
		// dialog onFinishNavigation closes moments later, taking any overlay
		// that component owns with it.
		expect(paymentsSource).toContain(
			'eventBus?.emit?.("show_change_due", payload)',
		);
		expect(shellSource).toContain(
			'eventBus.on("show_change_due", handleShowChangeDue)',
		);
		expect(shellSource).toContain(
			'eventBus.off("show_change_due", handleShowChangeDue)',
		);
	});

	it("mounts the dialog on the shell root, outside the payment dialog", () => {
		const dialogIndex = shellSource.indexOf("<ChangeDueDialog");
		expect(dialogIndex).toBeGreaterThan(-1);
		expect(dialogIndex).toBeGreaterThan(shellSource.indexOf("</v-dialog>"));
	});

	it("keeps the dialog in the main bundle", () => {
		// A chunk fetch at the instant a sale lands is the one moment the
		// network can least be trusted.
		expect(shellSource).toContain(
			'import ChangeDueDialog from "../payments/ChangeDueDialog.vue"',
		);
		expect(shellSource).not.toContain(
			'import("../payments/ChangeDueDialog.vue")',
		);
	});

	it("formats the amount with the POS currency formatter and symbol", () => {
		expect(shellSource).toContain(
			"const formatChangeAmount = (value) => formatCurrency(value)",
		);
		expect(shellSource).toContain(
			"getCurrencySymbol(changeDueCurrency.value)",
		);
	});

	it("drops a zero or missing amount rather than opening an empty dialog", () => {
		expect(shellSource).toMatch(
			/handleShowChangeDue = \(payload = \{\}\) => \{[\s\S]*?if \(amount <= 0\) \{[\s\S]*?return;/,
		);
	});
});

describe("change-due translations", () => {
	const es = read("../posawesome/translations/es.csv");

	it("ships Spanish for both strings the dialog shows", () => {
		expect(es).toContain("\nChange due,Cambio");
		expect(es).toContain("\nChange given,Entregado");
	});
});
