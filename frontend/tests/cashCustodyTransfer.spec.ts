// @vitest-environment jsdom

/**
 * Whole sealed bag → the safe's configured off-site cash ledger (docs/WHOLE-BAG-TRANSFERS.md).
 *
 * The screen may only record a move that already happened: the supervisor sees
 * the amount and the destination the server will use, ticks that the sealed bag
 * physically left, and gives a reason. The request carries the bag and the
 * reason and nothing the server derives. A lost response is replayed with the
 * saved request, and a bag nobody else counted never reads as verified.
 * `api.ts` is mocked as in `cashCustodyViewUX.spec.ts`; its retry storage is
 * covered by `cashCustodyRequests.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const read = vi.fn();
const command = vi.fn();
const pendingActions = vi.fn(() => [] as { action: string; payload: any }[]);
vi.mock("../src/posapp/components/pos/custody/api", async () => {
	const actual = await vi.importActual<any>(
		"../src/posapp/components/pos/custody/api",
	);
	return {
		emptyCount: actual.emptyCount,
		amount: actual.amount,
		read: (...args: any[]) => read(...args),
		command: (...args: any[]) => command(...args),
		printEvidence: vi.fn(),
		pendingActions: (...args: any[]) => pendingActions(...args),
	};
});
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import CashCustodyView from "../src/posapp/components/pos/custody/CashCustodyView.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";

const SUPERVISOR = "supervisor@doco.mx";
const CASHIER = "cashier@doco.mx";
const HOME = "Caja fuerte casa - DOCO";
const REASON = "Beto took the sealed bag home; owner acknowledged receipt";

const bag = (over: Record<string, any> = {}) => ({
	name: "CASH-BAG-TEST4",
	seal: "QA-SEALED-04",
	purpose: "Takings",
	state: "Unverified",
	amount: 2211,
	prepared_by: CASHIER,
	verified_by: null,
	opening_shift: null,
	modified: "2026-09-23 08:20:00.000000",
	...over,
});
const context = (over: Record<string, any> = {}) => ({
	safe: "CASH-SAFE-00002",
	currency: "MXN",
	float_target: 1000,
	drawer_limit: 5000,
	can_manage: true,
	can_transfer: true,
	transfer_blocker: null,
	offsite_cash_account: HOME,
	offsite_cash_account_name: "Caja fuerte casa",
	balance: 5000,
	loose_balance: 2789,
	in_transit: 0,
	bags: [bag()],
	counts: [],
	...over,
});

const mountView = () => {
	setActivePinia(createPinia());
	const ui = useUIStore();
	ui.posProfile = { name: "Doco Ventas" } as any;
	ui.posOpeningShift = null as any;
	return mount(CashCustodyView);
};
const button = (wrapper: any, label: string) =>
	wrapper.findAll("button").find((b: any) => b.text().startsWith(label));
async function selectBag(wrapper: any, seal = "QA-SEALED-04") {
	await wrapper
		.findAll("button.record")
		.find((b: any) => b.text().includes(seal))!
		.trigger("click");
	await flushPromises();
}
async function openTransfer(wrapper: any) {
	await selectBag(wrapper);
	await button(wrapper, "Move whole bag off-site")!.trigger("click");
	await flushPromises();
}
const confirmBox = (wrapper: any) =>
	wrapper.get('[data-testid="custody-transfer-confirm"]');
const draftKey = `cash-custody-draft:${SUPERVISOR}:Doco Ventas:no-shift`;

beforeEach(() => {
	read.mockReset().mockResolvedValue(context());
	command.mockReset().mockResolvedValue({
		bag: "CASH-BAG-TEST4",
		amount: 2211,
		state: "Transferred",
		transfer_account: HOME,
		journal_entry: "ACC-JV-00077",
	});
	pendingActions.mockReset().mockReturnValue([]);
	localStorage.clear();
	(window as any).frappe = { session: { user: SUPERVISOR } };
});

describe("whole-bag transfer — before confirming", () => {
	it("selects a permitted cash workspace when no sales shift has chosen a profile", async () => {
		const pinia = createPinia(); setActivePinia(pinia);
		const ui = useUIStore(); ui.posProfile = null as any; ui.posOpeningShift = null as any;
		read.mockImplementation(async (method: string) => method === "safes"
			? [{ name: "SAFE-1", title: "Tienda", pos_profile: "Doco Ventas", company: "Doco" }]
			: context());
		const wrapper = mount(CashCustodyView); await flushPromises();
		expect(read).toHaveBeenCalledWith("context", { pos_profile: "Doco Ventas" });
		expect(wrapper.get('[data-testid="custody-register-select"]').element).toHaveProperty("value", "Doco Ventas");
		expect(ui.posProfile).toBeNull();
		await openTransfer(wrapper);
		expect(wrapper.get('[data-testid="custody-transfer-summary"]').text()).toContain(HOME);
	});

	it("works without an open shift and shows the amount and destination the server will use", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openTransfer(wrapper);
		const summary = wrapper
			.get('[data-testid="custody-transfer-summary"]')
			.text();
		expect(summary).toContain("2,211.00");
		expect(summary).toContain("Caja fuerte casa");
		expect(summary).toContain(HOME);
		expect(wrapper.get(".custody__direction").text()).toContain(
			"CASH-SAFE-00002",
		);
		expect(wrapper.get('[data-testid="custody-confirm"]').text()).toContain(
			"2,211.00",
		);
		// Nothing about the money is editable: no count, no amount, no account picker.
		expect(wrapper.find("select").exists()).toBe(false);
		expect(wrapper.find('input[type="number"]').exists()).toBe(false);
		expect(command).not.toHaveBeenCalled();
	});

	it("says plainly that an unverified bag leaves with only the preparer's count", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openTransfer(wrapper);
		const warning = wrapper
			.get('[data-testid="custody-transfer-unverified-warning"]')
			.text();
		expect(warning).toContain("never independently verified");
		expect(warning).toContain(CASHIER);
	});

	it("names the verifier instead of warning for a verified bag", async () => {
		read.mockResolvedValue(
			context({
				bags: [
					bag({ state: "Available", verified_by: "gerente@doco.mx" }),
				],
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		await openTransfer(wrapper);
		expect(
			wrapper
				.find('[data-testid="custody-transfer-unverified-warning"]')
				.exists(),
		).toBe(false);
		expect(wrapper.get("form").text()).toContain("gerente@doco.mx");
	});

	it("refuses to send until the physical move is confirmed", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openTransfer(wrapper);
		expect((confirmBox(wrapper).element as HTMLInputElement).required).toBe(
			true,
		);
		await wrapper.get("textarea").setValue(REASON);
		await wrapper.get("form").trigger("submit");
		await flushPromises();
		expect(command).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("has already physically left");
		// The reason is mandatory and at least 8 characters, as the server requires.
		const note = wrapper.get("textarea").element as HTMLTextAreaElement;
		expect(note.required).toBe(true);
		expect(note.minLength).toBe(8);
	});
});

describe("whole-bag transfer — the request", () => {
	it("sends only the bag and the reason, then shows the destination and journal", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openTransfer(wrapper);
		await confirmBox(wrapper).setValue(true);
		await wrapper.get("textarea").setValue(REASON);
		read.mockResolvedValue(
			context({
				bags: [
					bag({
						state: "Transferred",
						transfer_account: HOME,
						transferred_by: SUPERVISOR,
						transferred_on: "2026-09-23 18:05:00",
					}),
				],
			}),
		);
		await wrapper.get("form").trigger("submit");
		await flushPromises();
		expect(command).toHaveBeenCalledTimes(1);
		expect(command).toHaveBeenCalledWith("transfer_safe", {
			pos_profile: "Doco Ventas",
			bag: "CASH-BAG-TEST4",
			note: REASON,
		});
		const success = wrapper.get(".panel--success").text();
		expect(success).toContain("Whole bag moved to Caja fuerte casa.");
		expect(success).toContain("never independently verified");
		expect(
			wrapper
				.get('[data-testid="custody-success-journal"]')
				.attributes("href"),
		).toBe("/app/journal-entry/ACC-JV-00077");
		// The unsent form was released before the request left.
		expect(localStorage.getItem(draftKey)).toBeNull();
	});

	it("replays an unconfirmed transfer with the saved request, not a new one", async () => {
		const saved = {
			pos_profile: "Doco Ventas",
			bag: "CASH-BAG-TEST4",
			note: REASON,
		};
		pendingActions.mockReturnValue([
			{ action: "transfer_safe", payload: saved },
		]);
		// The first request already committed; the bag reads as moved.
		read.mockResolvedValue(
			context({
				bags: [bag({ state: "Transferred", transfer_account: HOME })],
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		const retry = button(
			wrapper,
			"Retry unconfirmed action: Move whole bag off-site",
		)!;
		expect(retry.text()).toContain("QA-SEALED-04");
		pendingActions.mockReturnValue([]);
		await retry.trigger("click");
		await flushPromises();
		expect(command).toHaveBeenCalledWith("transfer_safe", saved);
		expect(
			wrapper.get('[data-testid="custody-success-journal"]').text(),
		).toContain("ACC-JV-00077");
	});

	it("keeps the typed reason as an unsent draft but never the physical confirmation", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openTransfer(wrapper);
		await confirmBox(wrapper).setValue(true);
		await wrapper.get("textarea").setValue(REASON);
		const draft = JSON.parse(localStorage.getItem(draftKey) as string);
		expect(draft.action).toBe("transfer_safe");
		expect(draft.note).toBe(REASON);
		expect(JSON.stringify(draft)).not.toMatch(/confirm|physical/i);
		wrapper.unmount();

		const again = mountView();
		await flushPromises();
		expect(again.text()).toContain("Your unsent cash form was restored");
		expect(
			(again.get("textarea").element as HTMLTextAreaElement).value,
		).toBe(REASON);
		expect((confirmBox(again).element as HTMLInputElement).checked).toBe(
			false,
		);
	});

	it("clears the confirmation when a refresh changes the destination", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openTransfer(wrapper);
		await confirmBox(wrapper).setValue(true);
		expect((confirmBox(wrapper).element as HTMLInputElement).checked).toBe(
			true,
		);
		read.mockResolvedValue(
			context({
				offsite_cash_account: "Caja socio - DOCO",
				offsite_cash_account_name: "Caja socio",
			}),
		);
		await wrapper.get('[data-testid="custody-refresh"]').trigger("click");
		await flushPromises();
		expect((confirmBox(wrapper).element as HTMLInputElement).checked).toBe(
			false,
		);
		expect(
			wrapper.get('[data-testid="custody-transfer-summary"]').text(),
		).toContain("Caja socio");
	});

	it("turns an open form into an unsent draft when the bag moved elsewhere", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openTransfer(wrapper);
		await wrapper.get("textarea").setValue(REASON);
		read.mockResolvedValue(
			context({
				bags: [bag({ state: "Transferred", transfer_account: HOME })],
			}),
		);
		await wrapper.get('[data-testid="custody-refresh"]').trigger("click");
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(false);
		expect(
			wrapper.find('[data-testid="custody-stale-draft"]').exists(),
		).toBe(true);
		expect(command).not.toHaveBeenCalled();
	});
});

describe("whole-bag transfer — who may, and why not", () => {
	it("disables the action and links a supervisor to this safe's settings when no destination is set", async () => {
		const blocker =
			"Configure an off-site cash account on this safe before transferring whole bags.";
		read.mockResolvedValue(
			context({
				can_transfer: false,
				transfer_blocker: blocker,
				offsite_cash_account: null,
				offsite_cash_account_name: null,
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		await selectBag(wrapper);
		expect(
			button(wrapper, "Move whole bag off-site")!.attributes("disabled"),
		).toBeDefined();
		const reason = wrapper.get('[data-testid="custody-transfer-blocker"]');
		expect(reason.text()).toContain(blocker);
		expect(reason.get("a").attributes("href")).toBe(
			"/app/pos-cash-safe/CASH-SAFE-00002",
		);
		expect(wrapper.find("select").exists()).toBe(false);
	});

	it("never offers the transfer to a cashier or for a bag outside the safe", async () => {
		(window as any).frappe = { session: { user: CASHIER } };
		read.mockResolvedValue(
			context({
				can_manage: false,
				can_transfer: false,
				bags: [bag({ state: "Available" })],
			}),
		);
		const cashier = mountView();
		await flushPromises();
		await selectBag(cashier);
		expect(button(cashier, "Move whole bag off-site")).toBeUndefined();
		expect(
			cashier.find('[data-testid="custody-transfer-blocker"]').exists(),
		).toBe(false);

		(window as any).frappe = { session: { user: SUPERVISOR } };
		for (const state of [
			"Disputed",
			"In Transit",
			"Issued",
			"Deposited",
			"Unpacked",
			"Transferred",
		]) {
			read.mockResolvedValue(context({ bags: [bag({ state })] }));
			const wrapper = mountView();
			await flushPromises();
			await wrapper
				.findAll("button.filter")
				.find((b: any) => b.text().startsWith("All"))!
				.trigger("click");
			await selectBag(wrapper);
			expect(
				button(wrapper, "Move whole bag off-site"),
				state,
			).toBeUndefined();
			wrapper.unmount();
		}
	});
});

describe("whole-bag transfer — history", () => {
	const moved = () =>
		context({
			bags: [
				bag({
					state: "Transferred",
					transfer_account: HOME,
					transferred_by: SUPERVISOR,
					transferred_on: "2026-09-23 18:05:00",
				}),
				bag({
					name: "CASH-BAG-00005",
					seal: "FLOAT-9",
					state: "Available",
					verified_by: "gerente@doco.mx",
				}),
			],
		});

	it("files a moved bag under Completed with a muted chip and its destination", async () => {
		read.mockResolvedValue(moved());
		const wrapper = mountView();
		await flushPromises();
		const open = wrapper.findAll("button.record").map((b: any) => b.text());
		expect(open.some((t: string) => t.includes("QA-SEALED-04"))).toBe(false);
		await wrapper
			.findAll("button.filter")
			.find((b: any) => b.text().startsWith("Completed"))!
			.trigger("click");
		const row = wrapper
			.findAll("button.record")
			.find((b: any) => b.text().includes("QA-SEALED-04"))!;
		expect(row.text()).toContain("Moved to the off-site safe");
		expect(row.text()).toContain(HOME);
		expect(row.get(".chip").classes()).toContain("chip--muted");
	});

	it("finds moved bags by destination or by the words the row shows", async () => {
		read.mockResolvedValue(moved());
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button.filter")
			.find((b: any) => b.text().startsWith("All"))!
			.trigger("click");
		const search = wrapper.get('input[type="search"]');
		for (const term of ["fuerte casa", "off-site", SUPERVISOR]) {
			await search.setValue(term);
			const seals = wrapper
				.findAll("button.record")
				.map((b: any) => b.text());
			expect(
				seals.some((t: string) => t.includes("QA-SEALED-04")),
				term,
			).toBe(true);
			expect(
				seals.some((t: string) => t.includes("FLOAT-9")),
				term,
			).toBe(false);
		}
	});

	it("keeps an unverified moved bag visibly unverified, with who, when and where", async () => {
		read.mockResolvedValue(moved());
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button.filter")
			.find((b: any) => b.text().startsWith("All"))!
			.trigger("click");
		await selectBag(wrapper);
		const detail = wrapper.get(".record-detail");
		expect(
			detail.get('[data-testid="custody-transfer-unverified"]').text(),
		).toContain("Never independently verified");
		const record = detail
			.get('[data-testid="custody-transfer-record"]')
			.text();
		expect(record).toContain(HOME);
		expect(record).toContain(SUPERVISOR);
		expect(record).toContain("Open the bag record");
		expect(detail.text()).not.toContain("Not verified yet");
		expect(button(wrapper, "Move whole bag off-site")).toBeUndefined();
	});
});
