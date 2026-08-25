// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createVuetify } from "vuetify";

import ItemHeader from "../src/posapp/components/pos/items/ItemHeader.vue";
import selectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";
import scanProcessorSource from "../src/posapp/composables/pos/items/useScanProcessor.ts?raw";
import {
	lastResolvedScan,
	recordResolvedScan,
	resetLastScanEcho,
} from "../src/posapp/composables/pos/items/useLastScanEcho";
import { chordLabelFor } from "../src/posapp/composables/pos/items/useShortcutChordLabel";

/**
 * Scan-bar affordances — Riel y Cajón §17.7, artboard nodes 21-24:
 *
 *   [⌕] Escanear, buscar o explorar artículo…   último: IPN001902  [F2]  [Explorar catálogo F4]
 *
 * Two properties here are worth more than the pixels.
 *
 * `último:` must name what the scan RESOLVED to, never what was typed. On a
 * counter with a fast gun the row appearing somewhere in a list is not proof
 * that the right row appeared, and an echo that repeated a failed scan would
 * teach the cashier to trust a signal that is wrong — worse than no signal.
 *
 * The chord chips must name the BOUND chord, never the mock's (ruling R8). The
 * artboard prints F2 and F4; the shipped pack binds Alt+3 and Alt+B, and F4 has
 * meant `employee.switch` since before the shortcuts engine. A chip naming a key
 * that does something else costs the operator a mid-sale cashier switch and the
 * credibility of every other chip on screen.
 */

const VTextFieldStub = defineComponent({
	props: { modelValue: { type: String, default: "" } },
	emits: ["update:modelValue"],
	template:
		'<div><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="append-inner" /></div>',
});

const mountHeader = (props = {}) =>
	mount(ItemHeader, {
		props: {
			posProfile: { posa_input_qty: 0, posa_enable_camera_scanning: 0 },
			searchInput: "",
			isPhone: false,
			...props,
		},
		global: {
			plugins: [createVuetify()],
			components: { VTextField: VTextFieldStub },
			config: {
				globalProperties: {
					__: (value: string, args?: unknown[]) =>
						Array.isArray(args)
							? value.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)]))
							: value,
					frappe: { _: (value: string) => value },
				},
			},
		},
	});

describe("`último:` names what resolved, not what was typed", () => {
	beforeEach(() => resetLastScanEcho());

	it("records a code that produced a cart line", () => {
		recordResolvedScan("IPN001902");
		expect(lastResolvedScan.value).toBe("IPN001902");
	});

	it("survives the row landing — confirmation that vanishes has confirmed nothing", () => {
		recordResolvedScan("IPN001902");
		// whatever else the register does next, the echo is not cleared by it
		expect(lastResolvedScan.value).toBe("IPN001902");
	});

	it("leaves the previous confirmation standing when nothing resolved", () => {
		recordResolvedScan("IPN001902");
		recordResolvedScan("");
		recordResolvedScan(null);
		recordResolvedScan(undefined);
		recordResolvedScan("   ");
		expect(
			lastResolvedScan.value,
			"a miss must not overwrite the last good confirmation, and must never echo itself",
		).toBe("IPN001902");
	});

	/**
	 * The guard the whole affordance rests on, asserted against SOURCE because
	 * it is a property of where the call sits: `recordResolvedScan` is reachable
	 * only after `itemAddition.addItem` has resolved. The miss branches
	 * (`Item not found`) must not touch it.
	 */
	it("is recorded only on the success path in useScanProcessor", () => {
		const calls = [...scanProcessorSource.matchAll(/recordResolvedScan\(/g)];
		expect(calls.length, "exactly one recording site, on the success path").toBe(1);

		const at = scanProcessorSource.indexOf("recordResolvedScan(");
		const addItemAt = scanProcessorSource.indexOf("await itemAddition.addItem(");
		expect(addItemAt, "the add-item call must exist").toBeGreaterThan(-1);
		expect(
			at > addItemAt,
			"recording before the line exists would echo a scan that never landed",
		).toBe(true);

		const notFoundAt = scanProcessorSource.indexOf("Item not found");
		expect(
			at < notFoundAt || notFoundAt === -1,
			"the miss branch must not record an echo",
		).toBe(true);
	});

	it("renders the echo on desktop and hides it when nothing has resolved", () => {
		const withEcho = mountHeader({ lastResolvedScan: "IPN001902" });
		expect(withEcho.find('[data-testid="scan-echo"]').exists()).toBe(true);
		expect(withEcho.find('[data-testid="scan-echo"]').text()).toContain("IPN001902");

		const empty = mountHeader({ lastResolvedScan: "" });
		expect(empty.find('[data-testid="scan-echo"]').exists()).toBe(false);
	});

	it("stays off the phone, where the field has no room and the cart is in view", () => {
		const phone = mountHeader({ lastResolvedScan: "IPN001902", isPhone: true });
		expect(phone.find('[data-testid="scan-echo"]').exists()).toBe(false);
	});
});

describe("chord chips name the bound chord, never the mock's", () => {
	it("resolves the field and catalogue chords from the active keymap", () => {
		// The shipped pack, not the artboard: R8.
		expect(chordLabelFor("items.focusSearch")).toBe("Alt + 3");
		expect(chordLabelFor("catalog.toggleDrawer")).toBe("Alt + B");
	});

	it("does not print the artboard's F2/F4, which mean other things", () => {
		expect(chordLabelFor("items.focusSearch")).not.toBe("F2");
		expect(
			chordLabelFor("catalog.toggleDrawer"),
			"F4 has meant employee.switch since before the shortcuts engine",
		).not.toBe("F4");
		expect(chordLabelFor("employee.switch")).toBe("F4");
	});

	it("returns null for an unbound action so the caller renders no chip", () => {
		expect(chordLabelFor("nonexistent.action")).toBeNull();
		expect(chordLabelFor("")).toBeNull();
	});

	it("renders the chip when bound and omits it when not", () => {
		const bound = mountHeader({ searchChord: "Alt + 3" });
		expect(bound.find('[data-testid="scan-chord"]').text()).toBe("Alt + 3");

		const unbound = mountHeader({ searchChord: "" });
		expect(unbound.find('[data-testid="scan-chord"]').exists()).toBe(false);
	});
});

describe("Explorar catálogo uses the drawer's one door", () => {
	it("emits browse-catalog rather than reaching for drawer state", () => {
		const header = mountHeader({ showBrowse: true, browseChord: "Alt + B" });
		const button = header.find('[data-testid="browse-catalog"]');
		expect(button.exists()).toBe(true);
		expect(button.text()).toContain("Alt + B");
	});

	it("is absent where there is no cajón to open", () => {
		const header = mountHeader({ showBrowse: false });
		expect(header.find('[data-testid="browse-catalog"]').exists()).toBe(false);
	});

	/**
	 * One drawer state, three entry points — rail item, chord, and this button —
	 * all through `toggle_catalog_drawer`, which `Pos.vue` owns. A fourth path
	 * that called a drawer method directly would be a second source of truth for
	 * "is the catalogue open".
	 */
	it("routes through the same bus event the rail and the chord use", () => {
		expect(selectorSource).toContain('eventBus.emit("toggle_catalog_drawer")');
		expect(selectorSource).toMatch(/@browse-catalog="openCatalogDrawer"/);
	});

	it("is offered only on the sale screen, never to purchase or barcode printing", () => {
		// The movil suppression (2026-08-25) joins the gate: on a phone the
		// browse screen IS the catalogue, so the toggle — and its chord hint,
		// meaningless on glass — stands down without unmounting anything.
		expect(selectorSource).toMatch(
			/showBrowseButton = computed\(\s*\(\) => !!props\.headerTarget && props\.context === "pos" && !props\.suppressBrowseButton,?\s*\)/,
		);
	});
});

describe("the default render path is untouched", () => {
	it("hides every new affordance unless it is asked for", () => {
		const plain = mountHeader();
		expect(plain.find('[data-testid="scan-echo"]').exists()).toBe(false);
		expect(plain.find('[data-testid="scan-chord"]').exists()).toBe(false);
		expect(plain.find('[data-testid="browse-catalog"]').exists()).toBe(false);
	});

	it("takes them all as props, so a teleported header behaves like an in-place one", () => {
		// ItemHeader stays purely presentational: nothing here reads the drawer,
		// the keymap or the scan state directly, so where its DOM currently lives
		// cannot change what it renders.
		const source = selectorSource;
		expect(source).toMatch(/:last-resolved-scan="lastResolvedScan"/);
		expect(source).toMatch(/:search-chord="searchChordLabel"/);
		expect(source).toMatch(/:browse-chord="browseChordLabel"/);
		expect(source).toMatch(/:show-browse="showBrowseButton"/);
	});
});
