// The double-submit guard must live in the store, not in Payments.vue: the
// register destroys and rebuilds the payment surface across the 1100px boundary
// (no KeepAlive), so a component-local ref would reset the guard mid-submit and
// a second PAGAR would be accepted for the same invoice (audit RUNTIME-F2).
import { describe, expect, it } from "vitest";
import paymentsSrc from "../src/posapp/components/pos/Payments.vue?raw";
import uiStoreSrc from "../src/posapp/stores/uiStore.ts?raw";

describe("the submit guard is store-backed so it survives a resize remount", () => {
	it("uiStore owns submissionInFlight and exposes a setter", () => {
		expect(uiStoreSrc).toMatch(/const submissionInFlight = ref\(false\)/);
		expect(uiStoreSrc).toMatch(/setSubmissionInFlight/);
		// exported from the store
		expect(uiStoreSrc).toMatch(/\n\s*submissionInFlight,/);
	});

	it("Payments.vue reads the store's flag, never a local ref", () => {
		// no local `const submissionInFlight = ref(...)`
		expect(paymentsSrc).not.toMatch(/const submissionInFlight = ref\(/);
		// it reads uiStore
		expect(paymentsSrc).toMatch(/submissionInFlight = computed\(\(\) => uiStore\.submissionInFlight\)/);
		// writes go through the store setter
		expect(paymentsSrc).toMatch(/uiStore\.setSubmissionInFlight\(true\)/);
		expect(paymentsSrc).toMatch(/uiStore\.setSubmissionInFlight\(false\)/);
	});
});
