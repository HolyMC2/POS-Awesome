// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createVuetify } from "vuetify";

// Raw SFC text: the guarantees below are properties of the SOURCE — which
// directive hides the catalogue, how many scan fields are written — so the
// source is the honest thing to read. `?raw` keeps it environment-agnostic;
// the repo already scans this way (itemSelectorLayoutOwnership.spec.ts).
import selectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";
import ItemHeader from "../src/posapp/components/pos/items/ItemHeader.vue";
import scannerSource from "../src/posapp/composables/pos/items/useScannerInput.ts?raw";

/**
 * Riel y Cajón (§17.7) draws the scan bar on the SALE screen with the catalogue
 * behind an "Explorar catálogo" button — the cashier scans with the ticket at
 * full width and no grid on screen. That is the density argument for direction
 * E over the rejected direction C.
 *
 * The scan bar was already its own component (`ItemHeader.vue`, purely
 * presentational). What could not move was its STATE OWNER, `ItemsSelector`.
 * So the move is a Teleport, not a second component — and these tests exist to
 * keep it that way, because the obvious alternative (mount another scan field
 * on the sale screen) gives the register two live scan targets and counts every
 * barcode twice. That is a money bug wearing a layout bug's clothes.
 */

const template = () => selectorSource.slice(0, selectorSource.indexOf("<script"));

const VTextFieldStub = defineComponent({
	props: { modelValue: { type: String, default: "" } },
	emits: ["update:modelValue"],
	template:
		'<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

describe("the scan bar detaches without cloning itself", () => {
	it("writes exactly one ItemHeader", () => {
		const mounts = [...template().matchAll(/<ItemHeader\b/g)];
		expect(
			mounts.length,
			"a second ItemHeader means two live scan targets and every barcode counted twice",
		).toBe(1);
	});

	it("moves that one header with Teleport rather than re-rendering it", () => {
		expect(template()).toMatch(/<Teleport[^>]*:disabled="!headerTarget"/);
	});

	it("is inert without a target, so purchase and barcode-printing are untouched", () => {
		// `headerTarget` defaults to null and `:disabled` is its negation, so the
		// default render path is byte-for-byte the pre-existing one.
		expect(selectorSource).toMatch(/headerTarget:\s*\{[^}]*default:\s*null/s);
	});
});

describe("hiding the catalogue must not detach the shop's scanner", () => {
	/**
	 * The load-bearing test in this file.
	 *
	 * `useScannerInput` attaches the keyboard wedge to the DOCUMENT
	 * (`onScan.attachTo(document, …)`) behind a `document._scannerAttached`
	 * singleton, and detaches it on unmount. So unmounting `ItemsSelector` to
	 * hide the catalogue takes the shop's scanner down with it — silently: the
	 * register looks perfectly fine and simply stops responding to the gun.
	 */
	it("attaches the wedge to the document, not to the field", () => {
		expect(scannerSource).toContain("onScan.attachTo(document");
		expect(scannerSource).toContain("_scannerAttached");
	});

	it("hides the catalogue with v-show, never v-if", () => {
		const catalogue = template();
		expect(catalogue).toMatch(/v-show="showCatalog"/);
		expect(
			catalogue,
			"v-if would unmount ItemsSelector and detach the document scanner",
		).not.toMatch(/v-if="showCatalog"/);
	});

	it("documents why, so the next edit does not 'tidy' v-show into v-if", () => {
		expect(selectorSource).toMatch(/`v-show`, never `v-if`/);
	});
});

describe("ItemHeader still carries the scan path once detached", () => {
	const mountHeader = (props = {}) =>
		mount(ItemHeader, {
			props: {
				posProfile: { posa_input_qty: 0, posa_enable_camera_scanning: 0 },
				searchInput: "",
				...props,
			},
			global: {
				plugins: [createVuetify()],
				// Vuetify's real components cannot mount here — the app registers
				// them through vite-plugin-vuetify's auto-import, which vitest does
				// not apply, and importing `vuetify/components` directly drags in
				// CSS the node resolver rejects. The repo already answers this by
				// stubbing the one component under test
				// (customerSelectorAffordances.spec.ts does it for VAutocomplete).
				//
				// A real `<input>` in the stub is the point: native `keydown` and
				// `paste` listeners fall through to it, so these assertions exercise
				// ItemHeader's own WIRING — the thing that has to survive the move —
				// rather than Vuetify's field internals, which are not ours to test.
				components: { VTextField: VTextFieldStub },
				config: {
					globalProperties: {
						// `frappe` goes through globalProperties, not globalThis: a Vue
						// template resolves only a whitelist of real globals (Math,
						// Date, JSON…), and an unlisted identifier reads `undefined`.
						__: (value: string) => value,
						frappe: { _: (value: string) => value },
					},
				},
			},
		});

	it("renders a search field bound to the owner's state", () => {
		const wrapper = mountHeader({ searchInput: "IPN001902" });
		expect(wrapper.find("input").exists()).toBe(true);
		expect(wrapper.find("input").element.value).toBe("IPN001902");
	});

	it("reports a typed term to its owner", async () => {
		// VTU does not record `emit()` from <script setup> in this repo
		// (tests/changeDueDialog.spec.ts:93) — listener props are the workaround.
		const onSearchInput = vi.fn();
		const wrapper = mountHeader({ onSearchInput });
		await wrapper.find("input").setValue("tortilla");
		expect(onSearchInput).toHaveBeenCalledWith("tortilla");
	});

	it("reports the Enter a keyboard wedge sends after the code", async () => {
		// A hardware gun types the barcode and terminates with Enter. If this
		// path is lost the field looks fine and the gun stops adding lines.
		const onEnter = vi.fn();
		const wrapper = mountHeader({ onEnter });
		await wrapper.find("input").trigger("keydown.enter");
		expect(onEnter).toHaveBeenCalled();
	});

	it("reports a pasted scan, which is how clipboard-mode guns arrive", async () => {
		const onSearchPaste = vi.fn();
		const wrapper = mountHeader({ onSearchPaste });
		await wrapper.find("input").trigger("paste");
		expect(onSearchPaste).toHaveBeenCalled();
	});

	it("exposes the field so focus shortcuts can still reach it", () => {
		// `items.focusSearch` / `items.focusToolbarSearch` resolve through this.
		expect(mountHeader().vm.debounce_search).toBeTruthy();
	});
});
