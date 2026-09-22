import { defineStore } from "pinia";

/** Shared by the closing screen and the shell that owns the server calls. */
export const useClosingFlowStore = defineStore("closingFlow", {
	state: () => ({
		preparing: false,
		submitting: false,
		completed: false,
		terminalReady: false,
		error: "",
		draft: {} as Record<string, any>,
		pendingDrafts: [] as Array<{ name: string; owner?: string }>,
		skippedInvoices: [] as Array<{ invoice?: string; reason?: string }>,
		deletesDrafts: false,
		reviewAccepted: false,
	}),
	getters: {
		reviewRequired: (state) =>
			state.pendingDrafts.length > 0 || state.skippedInvoices.length > 0,
		reviewBlocked: (state) =>
			state.pendingDrafts.length > 0 && !state.deletesDrafts,
	},
});
