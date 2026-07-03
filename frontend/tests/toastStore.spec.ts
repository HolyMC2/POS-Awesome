import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useToastStore } from "../src/posapp/stores/toastStore";

describe("toastStore message handling", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("shows `message` as detail when a title is present", () => {
		// Regression: `message` used to be read only as a title fallback and
		// was dropped whenever a title was passed — error toasts like the
		// close-shift failure showed the title with no reason.
		const store = useToastStore();
		store.show({
			title: "Could not close shift",
			message: "Valuation Rate for the Item IPN004757 is required",
			color: "error",
		});
		expect(store.text).toContain("Could not close shift");
		expect(store.text).toContain("Valuation Rate for the Item IPN004757");
	});

	it("does not duplicate `message` when it doubles as the title", () => {
		const store = useToastStore();
		store.show({ message: "Saved" });
		expect(store.text).toBe("Saved");
	});

	it("prefers explicit detail/text over `message`", () => {
		const store = useToastStore();
		store.show({ title: "T", message: "from-message", detail: "from-detail" });
		expect(store.text).toContain("from-detail");
		expect(store.text).not.toContain("from-message");
	});
});
