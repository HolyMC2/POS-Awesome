// @vitest-environment jsdom
/**
 * What the cash-movement history RENDERS at a given width, and where the
 * columns it sheds go.
 *
 * `cashHistoryTableLayout.spec.ts` holds the arithmetic — that the tier which
 * fits is the tier chosen. This file holds the wiring: that the component
 * actually asks for that tier, that a narrow width still reaches every value,
 * and that the row's controls are never what gets dropped.
 *
 * `v-data-table` is registered as a recording stub rather than mounted from
 * Vuetify. Vuetify components import their own `.css` and vitest will not
 * resolve those out of `node_modules` (`mdiIconSet.spec.ts` records the same
 * wall), and what belongs to this component is the headers it hands down and
 * the slots it fills — which the stub reproduces from Vuetify's own slot
 * contract: `item.<key>` receives `{ item, internalItem, isExpanded,
 * toggleExpand }` and `expanded-row` receives `{ columns, item }`.
 *
 * Width arrives through the ResizeObserver, not `getBoundingClientRect`: the
 * table follows the CARD's width, and jsdom reports 0 for every box, so the
 * observer callback is the only honest way to say "this surface is 724px".
 */
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import CashMovementHistory from "../src/posapp/components/pos/cash/CashMovementHistory.vue";

/**
 * The two widths the destination audit ran at, resolved to what the history
 * card actually gets. Derived in `cashHistoryTableLayout.spec.ts` from the
 * destination's own grid; repeated here as the numbers this file drives with.
 */
const AT_1440 = 724;
const AT_1280 = 630.67;

const ROW = {
	name: "CM-2026-00184",
	posting_date: "2026-08-22",
	against_name: "Refaccionaria del Centro",
	movement_type: "Expense",
	amount: 12450,
	source_account: "1110-001 - Caja Mostrador - DOCO",
	target_account: "5010-004 - Gastos de Operacion - DOCO",
	remarks: "Pago de fletes del pedido 7781",
	journal_entry: "ACC-JV-2026-01184",
	docstatus: 1,
};

/** Vuetify's `VDataTable` slot contract, reduced to what this component uses. */
const DataTableStub = defineComponent({
	name: "VDataTable",
	props: {
		headers: { type: Array as () => any[], default: () => [] },
		items: { type: Array as () => any[], default: () => [] },
		expanded: { type: Array as () => string[], default: () => [] },
		itemValue: { type: String, default: "" },
	},
	emits: ["update:expanded"],
	methods: {
		isExpanded(internalItem: any) {
			return this.expanded.includes(internalItem.raw.name);
		},
		toggleExpand(internalItem: any) {
			const name = internalItem.raw.name;
			this.$emit(
				"update:expanded",
				this.isExpanded(internalItem) ? this.expanded.filter((n) => n !== name) : [...this.expanded, name],
			);
		},
	},
	template: `<div class="stub-table">
		<span v-for="header in headers" :key="header.key" class="stub-th" :data-key="header.key">{{ header.title }}</span>
		<div v-for="row in items" :key="row.name" class="stub-row">
			<span class="stub-date"><slot name="item.posting_date" :item="row" /></span>
			<span class="stub-status"><slot name="item.docstatus" :item="row" /></span>
			<span class="stub-actions">
				<slot name="item.actions" :item="row" :internal-item="{ raw: row }" :is-expanded="isExpanded" :toggle-expand="toggleExpand" />
			</span>
			<span v-if="isExpanded({ raw: row })" class="stub-detail">
				<slot name="expanded-row" :columns="headers" :item="row" />
			</span>
		</div>
	</div>`,
});

/**
 * Vuetify's own `VBtn`/`VChip` cannot be mounted here (their stylesheets do
 * not resolve), and left unregistered they render as inert `<v-btn>` elements
 * that no `find("button")` can press. These render the one thing the
 * assertions need: a real control carrying its label.
 */
const ButtonStub = defineComponent({
	name: "VBtn",
	props: { disabled: { type: Boolean, default: false } },
	template: `<button :disabled="disabled"><slot /></button>`,
});

const ChipStub = defineComponent({
	name: "VChip",
	props: { color: { type: String, default: "" } },
	template: `<span class="stub-chip" :data-color="color"><slot /></span>`,
});

const originalResizeObserver = globalThis.ResizeObserver;
let resize: ((_width: number) => void) | null = null;

beforeEach(() => {
	resize = null;
	globalThis.ResizeObserver = class {
		constructor(callback: ResizeObserverCallback) {
			resize = (width: number) => callback([{ contentRect: { width } } as ResizeObserverEntry], this as never);
		}
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

afterAll(() => {
	globalThis.ResizeObserver = originalResizeObserver;
});

async function mountAt(width: number, props: Record<string, unknown> = {}) {
	const wrapper = mount(CashMovementHistory, {
		props: {
			rows: [ROW],
			loading: false,
			actionLoading: false,
			allowCancel: true,
			allowDelete: true,
			selectedStatus: "",
			selectedMovementType: "",
			selectedSearchText: "",
			pendingOfflineCount: 0,
			...props,
		},
		global: { components: { VDataTable: DataTableStub, VBtn: ButtonStub, VChip: ChipStub } },
	});
	resize?.(width);
	await nextTick();
	return wrapper;
}

const columnKeys = (wrapper: any) => wrapper.findAll(".stub-th").map((th: any) => th.attributes("data-key"));
const detailText = (wrapper: any) => wrapper.find(".stub-detail").text();

describe("which columns the register draws, at which width", () => {
	it("keeps Source and Target at 1440 and moves the paper trail off the row", async () => {
		const wrapper = await mountAt(AT_1440);

		expect(columnKeys(wrapper)).toEqual([
			"posting_date",
			"against_name",
			"movement_type",
			"amount",
			"source_account",
			"target_account",
			"docstatus",
			"actions",
		]);
	});

	it("falls to the six a cashier reviewing the drawer reads, at 1280", async () => {
		const wrapper = await mountAt(AT_1280);

		expect(columnKeys(wrapper)).toEqual([
			"posting_date",
			"against_name",
			"movement_type",
			"amount",
			"docstatus",
			"actions",
		]);
	});

	it("draws all ten once the surface is wide enough to hold them", async () => {
		// Single-column mode below the 1100px grid boundary: the history is the
		// whole destination and the full set fits again.
		const wrapper = await mountAt(968);

		expect(columnKeys(wrapper)).toHaveLength(10);
		expect(columnKeys(wrapper)).toContain("remarks");
		expect(columnKeys(wrapper)).toContain("journal_entry");
	});

	it("starts narrow rather than flashing a too-wide table", async () => {
		// jsdom has no layout, so this is also what a first frame looks like
		// before the observer reports: the tier that cannot overflow.
		const wrapper = mount(CashMovementHistory, {
			props: {
				rows: [ROW],
				loading: false,
				actionLoading: false,
				allowCancel: true,
				allowDelete: true,
				selectedStatus: "",
				selectedMovementType: "",
				selectedSearchText: "",
				pendingOfflineCount: 0,
			},
			global: { components: { VDataTable: DataTableStub, VBtn: ButtonStub, VChip: ChipStub } },
		});

		expect(columnKeys(wrapper)).toHaveLength(6);
	});
});

describe("a shed column is still reachable", () => {
	it("puts the paper trail in the row's detail at 1440", async () => {
		const wrapper = await mountAt(AT_1440);
		await wrapper.find(".stub-actions button").trigger("click");

		const detail = detailText(wrapper);
		expect(detail).toContain("Remarks");
		expect(detail).toContain(ROW.remarks);
		expect(detail).toContain("Journal Entry");
		expect(detail).toContain(ROW.journal_entry);
	});

	it("puts Source and Target there too once the width sheds them", async () => {
		const wrapper = await mountAt(AT_1280);
		await wrapper.find(".stub-actions button").trigger("click");

		const detail = detailText(wrapper);
		expect(detail).toContain(ROW.source_account);
		expect(detail).toContain(ROW.target_account);
		// Direction is what the detail is FOR at this width; the audit's
		// complaint was a value that had no route back, not a value in a panel.
		expect(detail).toContain("Source");
		expect(detail).toContain("Target");
	});

	it("names an empty value rather than rendering a blank line", async () => {
		const wrapper = await mountAt(AT_1280, {
			rows: [{ ...ROW, remarks: "", journal_entry: null }],
		});
		await wrapper.find(".stub-actions button").trigger("click");

		expect(detailText(wrapper)).toContain("—");
	});

	it("offers no disclosure when the width sheds nothing", async () => {
		const wrapper = await mountAt(968);

		expect(wrapper.find(".stub-actions").text()).not.toContain("Details");
		// And the row keeps the height it had: three controls, not four.
		expect(wrapper.findAll(".stub-actions button")).toHaveLength(3);
	});

	it("closes a row that a widened window has nothing left to reveal", async () => {
		const wrapper = await mountAt(AT_1440);
		await wrapper.find(".stub-actions button").trigger("click");
		expect(wrapper.find(".stub-detail").exists()).toBe(true);

		resize?.(968);
		await nextTick();

		expect(wrapper.find(".stub-detail").exists()).toBe(false);
	});
});

describe("the row's controls survive every width", () => {
	it.each([
		["1440", AT_1440],
		["1280", AT_1280],
		["single column", 968],
	])("keeps Duplicate, Cancel and Delete at %s", async (_label, width) => {
		const wrapper = await mountAt(width);
		const text = wrapper.find(".stub-actions").text();

		expect(text).toContain("Duplicate");
		expect(text).toContain("Cancel");
		expect(text).toContain("Delete");
	});

	it("still emits the row a control was pressed for", async () => {
		// Listener props, not `wrapper.emitted()` — VTU records only native
		// events that bubble to the root in this repo (build plan §10).
		const onDuplicate = vi.fn();
		const wrapper = await mountAt(AT_1280, { onDuplicate });
		const buttons = wrapper.findAll(".stub-actions button");

		// [Details, Duplicate, Cancel, Delete] at a width that sheds something.
		await buttons[1]!.trigger("click");

		expect(onDuplicate).toHaveBeenCalledWith(ROW);
	});

	it("keeps the status chip's word next to its colour", async () => {
		// §17.7 permits the chip's colour precisely because it is paired with
		// text; a colourblind operator reads the state either way.
		const wrapper = await mountAt(AT_1280);

		expect(columnKeys(wrapper)).toContain("docstatus");
		expect(wrapper.html()).toContain("Submitted");
	});
});
