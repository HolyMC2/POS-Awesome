// @vitest-environment jsdom

/**
 * Cash custody as the person holding the money meets it.
 *
 * The contract under test is `docs/POS-CASH-CUSTODY.md`: a cashier receives a
 * float and returns it in sealed bags, a supervisor verifies SOMEBODY ELSE'S
 * count, and an unconfirmed response is retried rather than re-counted into a
 * second transfer. The screen has to say which of those is this person's turn
 * — and must not offer an action the server will refuse, because a refused
 * cash action on a touch screen reads as "the till is broken".
 *
 * The component is plain elements plus `CashCountEditor`, so it mounts under a
 * runtime-only VTU with no Vuetify stubs. `api.ts` is mocked: it belongs to
 * the request-recovery spec (`cashCustodyRequests.spec.ts`) and is verified
 * there against localStorage, not here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const read = vi.fn();
const command = vi.fn();
const printEvidence = vi.fn();
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
		printEvidence: (...args: any[]) => printEvidence(...args),
		pendingActions: (...args: any[]) => pendingActions(...args),
	};
});
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

import CashCustodyView from "../src/posapp/components/pos/custody/CashCustodyView.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";

const CASHIER = "cashier@doco.mx";
const SUPERVISOR = "supervisor@doco.mx";

const bag = (over: Record<string, any> = {}) => ({
	name: "CASH-BAG-00007",
	seal: "DOCO-FLOAT-11",
	purpose: "Float",
	state: "Available",
	amount: 1000,
	prepared_by: SUPERVISOR,
	verified_by: null,
	opening_shift: null,
	modified: "2026-09-15 08:20:00.000000",
	...over,
});
const countRow = (over: Record<string, any> = {}) => ({
	name: "CASH-COUNT-00031",
	scope: "Bag",
	state: "Exception",
	opening_shift: "POS-OPEN-0009",
	bag: "CASH-BAG-00007",
	amount: 940,
	expected_amount: 1000,
	difference: -60,
	counted_by: CASHIER,
	note: "Two notes missing",
	modified: "2026-09-15 09:05:00.000000",
	closing_shift: null,
	count_json: JSON.stringify({
		denominations: [{ value: 500, quantity: 1 }],
		source: "denominations",
		reason: "",
	}),
	...over,
});
const context = (over: Record<string, any> = {}) => ({
	safe: "CASH-SAFE-00002",
	currency: "MXN",
	float_target: 1000,
	drawer_limit: 5000,
	can_manage: false,
	balance: 2190,
	loose_balance: 1190,
	in_transit: 0,
	bags: [bag()],
	counts: [],
	...over,
});

/** The shell's bus, as the register provides it: the band press comes back
 *  through `custody:primary`, so a test can press the band without a shell. */
const makeBus = () => {
	const handlers: Record<string, Function[]> = {};
	return {
		handlers,
		on: (event: string, handler: Function) => (handlers[event] ||= []).push(handler),
		off: (event: string, handler: Function) => {
			handlers[event] = (handlers[event] || []).filter((entry) => entry !== handler);
		},
		emit: (event: string) => (handlers[event] || []).slice().forEach((handler) => handler()),
	};
};
/** Every band state the screen published, newest last. A listener prop rather
 *  than `wrapper.emitted()`: the first state is published during setup, which
 *  VTU's own recorder does not see. */
let bandStates: any[] = [];
const mountView = ({
	shift = "POS-OPEN-0009",
	bus,
}: { shift?: string | null; bus?: ReturnType<typeof makeBus> } = {}) => {
	setActivePinia(createPinia());
	const ui = useUIStore();
	ui.posProfile = { name: "Doco Ventas" } as any;
	ui.posOpeningShift = shift ? ({ name: shift } as any) : null;
	return mount(CashCustodyView, {
		props: { onBand: (state: any) => bandStates.push(state) } as any,
		...(bus ? { global: { provide: { eventBus: bus } } } : {}),
	});
};
/** The band state the screen is publishing right now. */
const band = (_wrapper?: any) => bandStates[bandStates.length - 1];
const texts = (wrapper: any, selector: string) =>
	wrapper.findAll(selector).map((n: any) => n.text());
const buttonLabels = (wrapper: any) => texts(wrapper, "button");

beforeEach(() => {
	read.mockReset().mockResolvedValue(context());
	command
		.mockReset()
		.mockResolvedValue({ bag: "CASH-BAG-00007", amount: 1000 });
	printEvidence.mockReset().mockResolvedValue(undefined);
	pendingActions.mockReset().mockReturnValue([]);
	push.mockReset();
	bandStates = [];
	localStorage.clear();
	(window as any).frappe = { session: { user: CASHIER } };
});

/** The unsent-form key owned by `custody/draft.ts`, spelled out on purpose:
 *  a change of scope here is a change of who inherits someone else's count. */
const draftKey = (
	user = CASHIER,
	profile = "Doco Ventas",
	shift: string | null = "POS-OPEN-0009",
) => `cash-custody-draft:${user}:${profile}:${shift || "no-shift"}`;
const openDrop = async (wrapper: any) => {
	await wrapper
		.findAll("button")
		.find((b: any) => b.text() === "Return bag to safe")!
		.trigger("click");
	await flushPromises();
};

describe("cash custody — whose turn it is", () => {
	it("names the role, the register and the drawer state instead of a bare title", async () => {
		const wrapper = mountView();
		await flushPromises();
		const header = wrapper.get("header").text();
		expect(header).toContain("Cashier");
		expect(header).toContain("Doco Ventas");
		expect(header).toContain("Drawer open");
	});

	it("leads the cashier to the receivable bag and keeps supervisor-only work off the screen", async () => {
		const wrapper = mountView();
		await flushPromises();
		const guidance = wrapper
			.get('[aria-labelledby="custody-guidance"]')
			.text();
		expect(guidance).toContain(
			"Bags you can count and receive into the drawer",
		);
		expect(buttonLabels(wrapper)).not.toContain("Prepare float bag");
		expect(buttonLabels(wrapper)).not.toContain("Count safe");
	});

	it("tells a cashier without a shift why the drawer actions are unavailable", async () => {
		const wrapper = mountView({ shift: null });
		await flushPromises();
		expect(wrapper.text()).toContain(
			"Open your register shift before receiving or returning cash.",
		);
		const drop = wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Return bag to safe")!;
		expect(drop.attributes("disabled")).toBeDefined();
	});
});

describe("cash custody — a selected bag offers only legal actions", () => {
	const select = async (wrapper: any, seal = "DOCO-FLOAT-11") => {
		const record = wrapper
			.findAll("button.record")
			.find((b: any) => b.text().includes(seal))!;
		await record.trigger("click");
		await flushPromises();
		return wrapper.get(".record-detail");
	};

	it("shows the custody trail and a plain-language state, not just the record id", async () => {
		const wrapper = mountView();
		await flushPromises();
		const detail = await select(wrapper);
		expect(detail.text()).toContain("DOCO-FLOAT-11");
		expect(detail.text()).toContain("Verified in safe");
		expect(detail.text()).toContain(SUPERVISOR);
		// The internal id stays visible as evidence, but it is not the heading.
		expect(detail.get("h3").text()).not.toContain("CASH-BAG-00007");
		expect(detail.text()).toContain("CASH-BAG-00007");
	});

	it("refuses to offer self-verification or bank handling to the person who prepared the bag", async () => {
		read.mockResolvedValue(
			context({
				can_manage: true,
				bags: [bag({ state: "Unverified", prepared_by: CASHIER })],
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		const detail = await select(wrapper);
		const verify = detail
			.findAll("button")
			.find((b: any) => b.text() === "Verify bag")!;
		expect(verify.attributes("disabled")).toBeDefined();
		expect(detail.text()).toContain(
			"You counted this bag. Another person must verify or receive it.",
		);
		// Unverified cash never leaves for the bank.
		expect(
			detail.findAll("button").map((b: any) => b.text()),
		).not.toContain("Send to bank");
	});

	it("offers verification of another person's bag to a supervisor", async () => {
		read.mockResolvedValue(
			context({
				can_manage: true,
				bags: [bag({ state: "Unverified", prepared_by: SUPERVISOR })],
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		const detail = await select(wrapper);
		const verify = detail
			.findAll("button")
			.find((b: any) => b.text() === "Verify bag")!;
		expect(verify.attributes("disabled")).toBeUndefined();
	});

	it("explains a finished bag instead of pretending an action is left", async () => {
		read.mockResolvedValue(
			context({
				bags: [bag({ state: "Deposited", verified_by: SUPERVISOR })],
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		// Completed evidence stays reachable — it is filtered, never hidden.
		await wrapper
			.findAll("button.filter")
			.find((b: any) => b.text().startsWith("Completed"))!
			.trigger("click");
		const detail = await select(wrapper);
		expect(detail.text()).toContain("Deposited at the bank");
		expect(detail.text()).toContain("This bag is closed evidence.");
		expect(
			detail.findAll("button").map((b: any) => b.text()),
		).not.toContain("Send to bank");
	});
});

describe("cash custody — the form says which cash action it is", () => {
	it("labels the confirmation with the task and the counted amount", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Return bag to safe")!
			.trigger("click");
		await flushPromises();
		const confirm = wrapper.get('[data-testid="custody-confirm"]');
		expect(confirm.text()).toContain("Return this cash to the safe");
		expect(confirm.text()).toContain("$0.00");
		expect(wrapper.get("form").text()).toContain(
			"The drawer decreases by the counted amount",
		);
	});

	it("requires the reason the server requires, on the actions that need one", async () => {
		read.mockResolvedValue(
			context({ can_manage: true, bags: [bag({ purpose: "Takings" })] }),
		);
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button.record")
			.find((b: any) => b.text().includes("DOCO-FLOAT-11"))!
			.trigger("click");
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Send to bank")!
			.trigger("click");
		await flushPromises();
		const note = wrapper.get("form textarea");
		expect(note.attributes("required")).toBeDefined();
		expect(note.attributes("minlength")).toBe("8");
		expect(wrapper.get("form").text()).toContain("Bank run details");
	});

	it("warns before a receipt that will be recorded as a difference", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button.record")
			.find((b: any) => b.text().includes("DOCO-FLOAT-11"))!
			.trigger("click");
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Receive into drawer")!
			.trigger("click");
		await flushPromises();
		const form = wrapper.get("form");
		expect(form.text()).toContain("Expected");
		expect(form.text()).toContain("Short by");
		expect(form.text()).toContain("does not add cash to your drawer");
		expect(form.get("textarea").attributes("required")).toBeDefined();
	});

	it("confirms what happened and what follows, and keeps the record in view", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button.record")
			.find((b: any) => b.text().includes("DOCO-FLOAT-11"))!
			.trigger("click");
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Receive into drawer")!
			.trigger("click");
		await flushPromises();
		read.mockResolvedValue(context({ bags: [bag({ state: "Issued" })] }));
		await wrapper.get('[data-testid="custody-confirm"]').trigger("submit");
		await flushPromises();
		expect(command).toHaveBeenCalledWith(
			"receive",
			expect.objectContaining({
				pos_profile: "Doco Ventas",
				opening_shift: "POS-OPEN-0009",
				bag: "CASH-BAG-00007",
			}),
		);
		const status = wrapper.get('[role="status"]').text();
		expect(status).toContain("Bag received into your drawer.");
		expect(status).toContain(
			"Return the drawer to the safe in sealed bags at closing.",
		);
		expect(wrapper.get(".record-detail").text()).toContain("In the drawer");
	});

	it("keeps the disputed-count wording that tells the cashier the drawer did not change", async () => {
		command.mockResolvedValue({
			bag: "CASH-BAG-00007",
			state: "Disputed",
			amount: 940,
		});
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button.record")
			.find((b: any) => b.text().includes("DOCO-FLOAT-11"))!
			.trigger("click");
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Receive into drawer")!
			.trigger("click");
		await flushPromises();
		await wrapper.get('[data-testid="custody-confirm"]').trigger("submit");
		await flushPromises();
		expect(wrapper.get('[role="status"]').text()).toContain(
			"Count differs. The bag is held for supervisor review; drawer cash was not changed.",
		);
	});
});

describe("cash custody — counts, differences and evidence", () => {
	it("titles a count by its scope and bag, keeps the difference readable, and gates self-review", async () => {
		read.mockResolvedValue(
			context({
				can_manage: true,
				counts: [countRow({ counted_by: CASHIER })],
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button.tab")
			.find((b: any) => b.text().includes("Counts and exceptions"))!
			.trigger("click");
		await flushPromises();
		const record = wrapper.get("button.record");
		expect(record.text()).toContain("Bag count · DOCO-FLOAT-11");
		expect(record.text()).toContain("Short by");
		await record.trigger("click");
		await flushPromises();
		const detail = wrapper.get(".record-detail");
		const review = detail
			.findAll("button")
			.find((b: any) => b.text() === "Review difference")!;
		expect(review.attributes("disabled")).toBeDefined();
		expect(detail.text()).toContain(
			"Another supervisor must review a difference you counted.",
		);
	});

	it("survives unreadable count evidence instead of blanking the screen", async () => {
		read.mockResolvedValue(
			context({
				can_manage: true,
				counts: [countRow({ count_json: "{not json" })],
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button.tab")
			.find((b: any) => b.text().includes("Counts and exceptions"))!
			.trigger("click");
		await wrapper.get("button.record").trigger("click");
		await flushPromises();
		expect(wrapper.get(".record-detail").text()).toContain(
			"The stored count evidence could not be read here.",
		);
	});
});

describe("cash custody — honest about the network", () => {
	it("surfaces a failed load with a retry instead of an empty workspace", async () => {
		read.mockRejectedValueOnce(new Error("Connection lost"));
		const wrapper = mountView();
		await flushPromises();
		expect(wrapper.get('[role="alert"]').text()).toContain(
			"Connection lost",
		);
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Try again")!
			.trigger("click");
		await flushPromises();
		expect(read.mock.calls.filter(([method]) => method === "context")).toHaveLength(2);
		expect(wrapper.find(".workspace").exists()).toBe(true);
	});

	it("replays the saved request for an unconfirmed action and says not to move the cash again", async () => {
		const payload = {
			pos_profile: "Doco Ventas",
			seal: "DOCO-TAK-4",
			count: { source: "manual", amount: 250 },
		};
		pendingActions.mockReturnValue([{ action: "drop", payload }]);
		const wrapper = mountView();
		await flushPromises();
		const retry = wrapper
			.findAll("button")
			.find((b: any) => b.text().startsWith("Retry unconfirmed action"))!;
		expect(retry.text()).toContain("Return bag to safe");
		expect(retry.text()).toContain("DOCO-TAK-4");
		command.mockResolvedValue({ bag: "CASH-BAG-00009", amount: 250 });
		await retry.trigger("click");
		await flushPromises();
		expect(command).toHaveBeenCalledWith("drop", payload);
	});

	it("explains an interrupted submit as unconfirmed, not as a failure to repeat by hand", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Return bag to safe")!
			.trigger("click");
		await flushPromises();
		command.mockRejectedValueOnce(new TypeError("NetworkError"));
		pendingActions.mockReturnValue([
			{ action: "drop", payload: { pos_profile: "Doco Ventas" } },
		]);
		await wrapper.get('[data-testid="custody-confirm"]').trigger("submit");
		await flushPromises();
		const alert = wrapper.get('[role="alert"]').text();
		expect(alert).toContain("NetworkError");
		expect(alert).toContain("Do not move the cash again");
	});
});

describe("cash custody — primary integration safeguards", () => {
	it("preserves an entered handover when another queue record is tapped", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Return bag to safe")!
			.trigger("click");
		await wrapper.get("form input").setValue("KEEP-SEAL");
		await wrapper.get("button.record").trigger("click");
		expect(
			(wrapper.get("form input").element as HTMLInputElement).value,
		).toBe("KEEP-SEAL");
		expect(wrapper.text()).toContain(
			"Finish or cancel your current cash action",
		);
	});
	it("removes the old submit form after a successful recovery", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Return bag to safe")!
			.trigger("click");
		command.mockImplementationOnce(async () => {
			pendingActions.mockReturnValue([
				{ action: "drop", payload: { pos_profile: "Doco Ventas" } },
			]);
			throw new TypeError("NetworkError");
		});
		await wrapper.get("form").trigger("submit");
		await flushPromises();
		pendingActions.mockReturnValue([]);
		await wrapper
			.findAll("button")
			.find((b) => b.text().startsWith("Retry unconfirmed action"))!
			.trigger("click");
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(false);
		expect(wrapper.get(".record-detail").text()).toContain("DOCO-FLOAT-11");
		expect(command).toHaveBeenCalledTimes(2);
	});
});


/**
 * Counting a drawer is not a single keystroke. The cashier gets interrupted,
 * walks to the safe, the tab reloads, a supervisor takes the screen for a
 * minute — and the counted money has to still be there afterwards. It must also
 * still be *only a form*: nothing here may send a cash action on its own, and a
 * record that moved on in the meantime must not come back as a live button.
 */
describe("cash custody — unsent work survives leaving the screen", () => {
	it("brings the typed handover back on the next mount without sending anything", async () => {
		const first = mountView();
		await flushPromises();
		await openDrop(first);
		await first.get("form input").setValue("DOCO-TAK-9");
		await first.get("form textarea").setValue("Sealed before the bank run");
		await first
			.get('[data-testid="cash-count-override-toggle"]')
			.trigger("click");
		await first
			.get('[data-testid="cash-count-manual-amount"]')
			.setValue("250");
		await flushPromises();
		first.unmount();

		const second = mountView();
		await flushPromises();
		const form = second.get("form");
		expect(form.text()).toContain(
			"Seal drawer cash and return it to the safe",
		);
		expect((form.get("input").element as HTMLInputElement).value).toBe(
			"DOCO-TAK-9",
		);
		expect(
			(form.get("textarea").element as HTMLTextAreaElement).value,
		).toBe("Sealed before the bank run");
		expect(second.get('[data-testid="custody-confirm"]').text()).toContain(
			"$250.00",
		);
		expect(second.text()).toContain("Your unsent cash form was restored");
		expect(command).not.toHaveBeenCalled();
	});

	it("keeps the unsent form to its own user, register and shift", async () => {
		const first = mountView();
		await flushPromises();
		await openDrop(first);
		await first.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		first.unmount();
		expect(localStorage.getItem(draftKey())).toBeTruthy();

		(window as any).frappe = { session: { user: SUPERVISOR } };
		const other = mountView();
		await flushPromises();
		expect(other.find("form").exists()).toBe(false);
		other.unmount();

		(window as any).frappe = { session: { user: CASHIER } };
		const nextShift = mountView({ shift: "POS-OPEN-0010" });
		await flushPromises();
		expect(nextShift.find("form").exists()).toBe(false);
		// Nobody else's screen may consume the cashier's saved work either.
		expect(localStorage.getItem(draftKey())).toBeTruthy();
	});

	it("forgets the form once the cashier cancels it", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		await wrapper
			.findAll("form button")
			.find((b: any) => b.text() === "Cancel")!
			.trigger("click");
		await flushPromises();
		expect(localStorage.getItem(draftKey())).toBeNull();

		const second = mountView();
		await flushPromises();
		expect(second.find("form").exists()).toBe(false);
	});

	it("forgets the form once the cash action is actually recorded", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		expect(localStorage.getItem(draftKey())).toBeTruthy();
		await wrapper.get('[data-testid="custody-confirm"]').trigger("submit");
		await flushPromises();
		expect(localStorage.getItem(draftKey())).toBeNull();

		const second = mountView();
		await flushPromises();
		expect(second.find("form").exists()).toBe(false);
	});

	it("does not reopen a form whose bag has moved on, and never makes it actionable", async () => {
		localStorage.setItem(
			draftKey(),
			JSON.stringify({
				action: "receive",
				bag: "CASH-BAG-00007",
				cash_count: null,
				seal: "",
				purpose: "Float",
				note: "",
				reference: "",
				count: {
					source: "manual",
					amount: "1000",
					reason: "",
					denominations: [],
				},
				saved_at: "2026-09-15 08:00:00",
			}),
		);
		// Somebody else already took this bag into their drawer.
		read.mockResolvedValue(context({ bags: [bag({ state: "Issued" })] }));
		const wrapper = mountView();
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(false);
		const stale = wrapper.get('[data-testid="custody-stale-draft"]').text();
		expect(stale).toContain("no longer matches the cash records");
		expect(stale).toContain("Receive into drawer");
		expect(stale).toContain("$1,000.00");
		expect(buttonLabels(wrapper)).not.toContain("Receive into the drawer");
		expect(command).not.toHaveBeenCalled();

		await wrapper
			.findAll('[data-testid="custody-stale-draft"] button')
			.find((b: any) => b.text() === "Discard the unsent form")!
			.trigger("click");
		await flushPromises();
		expect(localStorage.getItem(draftKey())).toBeNull();
		expect(
			wrapper.find('[data-testid="custody-stale-draft"]').exists(),
		).toBe(false);
	});

	it("does not reopen a form whose record the server no longer returns", async () => {
		localStorage.setItem(
			draftKey(),
			JSON.stringify({
				action: "receive",
				bag: "CASH-BAG-00099",
				cash_count: null,
				seal: "",
				purpose: "Float",
				note: "",
				reference: "",
				count: {
					source: "denominations",
					amount: "",
					reason: "",
					denominations: [],
				},
				saved_at: "2026-09-15 08:00:00",
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(false);
		expect(
			wrapper.get('[data-testid="custody-stale-draft"]').exists(),
		).toBe(true);
	});

	it("closes an open form whose bag somebody else took, keeping the work visible", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button.record")
			.find((b: any) => b.text().includes("DOCO-FLOAT-11"))!
			.trigger("click");
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Receive into drawer")!
			.trigger("click");
		await flushPromises();
		await wrapper.get("form textarea").setValue("Counted at the safe");
		read.mockResolvedValue(context({ bags: [bag({ state: "Issued" })] }));
		await wrapper.get('[data-testid="custody-refresh"]').trigger("click");
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(false);
		const stale = wrapper.get('[data-testid="custody-stale-draft"]').text();
		expect(stale).toContain("Receive into drawer");
		expect(stale).toContain("Counted at the safe");
		expect(command).not.toHaveBeenCalled();
	});

	it("keeps the saved work when the queue itself fails to load", async () => {
		const first = mountView();
		await flushPromises();
		await openDrop(first);
		await first.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		first.unmount();

		read.mockRejectedValueOnce(new Error("Connection lost"));
		const second = mountView();
		await flushPromises();
		expect(second.text()).toContain(
			"Your unsent cash form is still saved on this device",
		);
		expect(localStorage.getItem(draftKey())).toBeTruthy();

		await second
			.findAll("button")
			.find((b: any) => b.text() === "Try again")!
			.trigger("click");
		await flushPromises();
		expect(
			(second.get("form input").element as HTMLInputElement).value,
		).toBe("DOCO-TAK-9");
	});

	it("leaves the unconfirmed cash action in charge and keeps the form saved", async () => {
		const first = mountView();
		await flushPromises();
		await openDrop(first);
		await first.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		first.unmount();

		pendingActions.mockReturnValue([
			{ action: "drop", payload: { pos_profile: "Doco Ventas" } },
		]);
		const second = mountView();
		await flushPromises();
		expect(second.find("form").exists()).toBe(false);
		expect(second.text()).toContain(
			"It reopens once the unconfirmed cash action is resolved",
		);
		expect(localStorage.getItem(draftKey())).toBeTruthy();
	});

	it("says so when the browser cannot keep the form, instead of pretending it is safe", async () => {
		const storage = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new DOMException("Quota exceeded", "QuotaExceededError");
			});
		const wrapper = mountView();
		await flushPromises();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		expect(
			wrapper.get('[data-testid="custody-draft-warning"]').text(),
		).toContain("cannot keep your unsent cash form");
		// The work stays on screen to be finished or written down.
		expect(
			(wrapper.get("form input").element as HTMLInputElement).value,
		).toBe("DOCO-TAK-9");
		storage.mockRestore();
	});

	it("hands the work to the command layer before the request leaves", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		expect(localStorage.getItem(draftKey())).toBeTruthy();
		let savedWhileSending: string | null = "not read";
		command.mockImplementationOnce(async () => {
			savedWhileSending = localStorage.getItem(draftKey());
			return { bag: "CASH-BAG-00007", amount: 1000 };
		});
		await wrapper.get('[data-testid="custody-confirm"]').trigger("submit");
		await flushPromises();
		// Nothing on this device could reopen the transfer that is in flight.
		expect(savedWhileSending).toBeNull();
		expect(localStorage.getItem(draftKey())).toBeNull();
		const second = mountView();
		await flushPromises();
		expect(second.find("form").exists()).toBe(false);
	});

	it("sends no cash action when the browser will not release the saved form", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		const raw = localStorage.getItem(draftKey());
		const removeItem = vi
			.spyOn(Storage.prototype, "removeItem")
			.mockImplementation(() => {
				throw new DOMException("Denied", "SecurityError");
			});
		await wrapper.get('[data-testid="custody-confirm"]').trigger("submit");
		await flushPromises();
		expect(command).not.toHaveBeenCalled();
		expect(wrapper.get('[role="alert"]').text()).toContain(
			"no cash action was sent and no cash moved",
		);
		expect(localStorage.getItem(draftKey())).toBe(raw);
		removeItem.mockRestore();
	});

	it("leaves recovery to the unconfirmed action instead of keeping a second copy", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		command.mockImplementationOnce(async () => {
			pendingActions.mockReturnValue([
				{ action: "drop", payload: { pos_profile: "Doco Ventas" } },
			]);
			throw new TypeError("NetworkError");
		});
		await wrapper.get('[data-testid="custody-confirm"]').trigger("submit");
		await flushPromises();
		expect(localStorage.getItem(draftKey())).toBeNull();
		// Editing the form that is still on screen must not recreate a rival copy
		// of instructions the server may already have recorded.
		await wrapper.get("form input").setValue("DOCO-TAK-10");
		await flushPromises();
		expect(localStorage.getItem(draftKey())).toBeNull();
	});

	it("gives the form back when the server refuses the action outright", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		// An explicit refusal: `api.ts` drops its own record, so nothing is
		// unconfirmed and the typed work is the cashier's again.
		command.mockRejectedValueOnce(
			Object.assign(new Error("Count mismatch"), { status: 417 }),
		);
		await wrapper.get('[data-testid="custody-confirm"]').trigger("submit");
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(true);
		expect(localStorage.getItem(draftKey())).toContain("DOCO-TAK-9");
		wrapper.unmount();
		const second = mountView();
		await flushPromises();
		expect(
			(second.get("form input").element as HTMLInputElement).value,
		).toBe("DOCO-TAK-9");
	});

	it("makes the cashier deal with kept work before starting another task", async () => {
		localStorage.setItem(
			draftKey(),
			JSON.stringify({
				action: "receive",
				bag: "CASH-BAG-00007",
				cash_count: null,
				seal: "",
				purpose: "Float",
				note: "Counted at the safe",
				reference: "",
				count: { source: "manual", amount: "1000", reason: "" },
				saved_at: "2026-09-15 08:00:00",
			}),
		);
		read.mockResolvedValue(context({ bags: [bag({ state: "Issued" })] }));
		const wrapper = mountView();
		await flushPromises();
		const raw = localStorage.getItem(draftKey());
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Return bag to safe")!
			.trigger("click");
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(false);
		expect(wrapper.text()).toContain(
			"Copy or discard the unsent cash form kept from before",
		);
		expect(localStorage.getItem(draftKey())).toBe(raw);
		await wrapper
			.findAll('[data-testid="custody-stale-draft"] button')
			.find((b: any) => b.text() === "Discard the unsent form")!
			.trigger("click");
		await openDrop(wrapper);
		expect(wrapper.find("form").exists()).toBe(true);
	});

	it("will not write new work over a damaged saved form until it is discarded", async () => {
		localStorage.setItem(draftKey(), "{damaged");
		const wrapper = mountView();
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b: any) => b.text() === "Return bag to safe")!
			.trigger("click");
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(false);
		expect(wrapper.text()).toContain(
			"Discard the damaged saved cash form before starting another cash task",
		);
		expect(localStorage.getItem(draftKey())).toBe("{damaged");

		await wrapper
			.findAll('[data-testid="custody-draft-warning"] button')
			.find((b: any) => b.text() === "Discard the damaged saved form")!
			.trigger("click");
		await flushPromises();
		expect(localStorage.getItem(draftKey())).toBeNull();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		expect(localStorage.getItem(draftKey())).toContain("DOCO-TAK-9");
	});

	it("treats a reshaped saved count as damage rather than feeding it to the counter", async () => {
		localStorage.setItem(
			draftKey(),
			JSON.stringify({
				action: "drop",
				bag: null,
				cash_count: null,
				seal: "DOCO-TAK-9",
				purpose: "Takings",
				note: "",
				reference: "",
				count: {
					source: "denominations",
					denominations: [{ value: "x", quantity: {} }],
				},
				saved_at: "2026-09-15 08:00:00",
			}),
		);
		const wrapper = mountView();
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(false);
		expect(
			wrapper.get('[data-testid="custody-draft-warning"]').text(),
		).toContain("could not be read");
		expect(localStorage.getItem(draftKey())).toContain('"x"');
	});

	it("does not carry an open form into another shift or register", async () => {
		const wrapper = mountView();
		await flushPromises();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await flushPromises();
		const ui = useUIStore();

		ui.posOpeningShift = { name: "POS-OPEN-0010" } as any;
		await flushPromises();
		expect(wrapper.find("form").exists()).toBe(false);
		expect(localStorage.getItem(draftKey())).toContain("DOCO-TAK-9");
		expect(
			localStorage.getItem(
				draftKey(CASHIER, "Doco Ventas", "POS-OPEN-0010"),
			),
		).toBeNull();

		ui.posProfile = { name: "Mumu Escuinapa" } as any;
		await flushPromises();
		expect(
			localStorage.getItem(
				draftKey(CASHIER, "Mumu Escuinapa", "POS-OPEN-0010"),
			),
		).toBeNull();
		expect(localStorage.getItem(draftKey())).toContain("DOCO-TAK-9");
	});

	it("reports damaged saved work without overwriting or replaying it", async () => {
		localStorage.setItem(draftKey(), "{damaged");
		const wrapper = mountView();
		await flushPromises();
		expect(
			wrapper.get('[data-testid="custody-draft-warning"]').text(),
		).toContain("could not be read");
		expect(wrapper.find("form").exists()).toBe(false);
		expect(localStorage.getItem(draftKey())).toBe("{damaged");
		expect(command).not.toHaveBeenCalled();
	});
});

it("offers a compact bag label separately from the full handover", async () => {
 const wrapper = mountView(); await flushPromises();
 await wrapper.get("button.record").trigger("click");
 await wrapper.findAll("button").find(b=>b.text()==="Print bag label")!.trigger("click");
 await flushPromises();
 expect(printEvidence).toHaveBeenLastCalledWith("POS Cash Bag","CASH-BAG-00007","label");
 await wrapper.findAll("button").find(b=>b.text()==="Print handover")!.trigger("click");
 await flushPromises();
 expect(printEvidence).toHaveBeenLastCalledWith("POS Cash Bag","CASH-BAG-00007","slip");
});

it("offers scoped full history when the recent completed records are limited", async () => {
 read.mockResolvedValue(context({queues:{bags:{history_has_more:true},counts:{history_has_more:true}}}));
 const wrapper=mountView(); await flushPromises();
 expect(wrapper.get('[data-testid="custody-history-notice"]').text()).toContain('All pending work is shown');
 expect(wrapper.get('[data-testid="custody-history-notice"] a').attributes('href')).toBe('/app/pos-cash-bag?safe=CASH-SAFE-00002');
 await wrapper.findAll('[role="tab"]')[1]!.trigger('click');
 expect(wrapper.get('[data-testid="custody-history-notice"] a').attributes('href')).toBe('/app/pos-cash-count?safe=CASH-SAFE-00002&counted_by=cashier%40doco.mx');
});

it("retains the editable form when cancel cannot remove its saved copy", async () => {
 const wrapper=mountView(); await flushPromises(); await openDrop(wrapper);
 await wrapper.get('form input').setValue('KEEP-SEAL'); await flushPromises();
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('Denied');});
 try {
  await wrapper.findAll('form button').find(b=>b.text()==='Cancel')!.trigger('click');
  expect(wrapper.find('form').exists()).toBe(true);
  expect((wrapper.get('form input').element as HTMLInputElement).value).toBe('KEEP-SEAL');
  expect(localStorage.getItem(draftKey())).toContain('KEEP-SEAL');
 } finally {remove.mockRestore();}
});

it("does not replay a cash request while its old form cannot be released", async () => {
 pendingActions.mockReturnValue([{action:'drop',payload:{pos_profile:'Doco Ventas'}}]);
 const wrapper=mountView(); await flushPromises();
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('Denied');});
 try {
  await wrapper.findAll('button').find(b=>b.text().startsWith('Retry unconfirmed action'))!.trigger('click');
  await flushPromises(); expect(command).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('no cash action was sent');
 } finally {remove.mockRestore();}
});

/**
 * The band the shell draws under this screen.
 *
 * Hosted by the rail, custody used to inherit the sale's «BACK TO SALE ·
 * $0.00»: the wrong number (nothing is being sold) under the wrong verb (the
 * cashier is holding a bag, not a cart). The screen now publishes its own —
 * one number, one action — and the rules that protect the money hold there
 * too: no command starts from a selection, an unconfirmed transfer leads to
 * its retry and to nothing else, and a blocked state does not offer a press.
 */
describe("cash custody — the band the shell draws", () => {
	it("points at the waiting bag and its money instead of the sale's zero", async () => {
		const wrapper = mountView();
		await flushPromises();
		const state = band(wrapper);
		expect(state.kind).toBe("custody");
		expect(state.labelKey).toBe("Bags you can count and receive into the drawer");
		expect(state.value).toBe(1000);
		expect(state.primaryAction.id).toBe("custody.primary");
		expect(state.primaryEnabled).toBe(true);
	});

	it("offers the selected bag's permitted next step and opens its form, sending nothing", async () => {
		const bus = makeBus();
		const wrapper = mountView({ bus });
		await flushPromises();
		await wrapper
			.findAll("button.record")
			.find((b: any) => b.text().includes("DOCO-FLOAT-11"))!
			.trigger("click");
		await flushPromises();
		expect(band(wrapper)).toMatchObject({
			labelKey: "Bag {0}",
			labelParams: ["DOCO-FLOAT-11"],
			value: 1000,
			primaryAction: { id: "custody.primary", labelKey: "Receive into drawer" },
		});

		bus.emit("custody:primary");
		await flushPromises();
		expect(command).not.toHaveBeenCalled();
		expect(wrapper.get("form").text()).toContain("Receive and count this bag into your drawer");
	});

	it("carries the form's own validated Confirm and its counted amount", async () => {
		const bus = makeBus();
		const wrapper = mountView({ bus });
		await flushPromises();
		await openDrop(wrapper);
		await wrapper.get("form input").setValue("DOCO-TAK-9");
		await wrapper.get('[data-testid="cash-count-override-toggle"]').trigger("click");
		await wrapper.get('[data-testid="cash-count-manual-amount"]').setValue("250");
		await flushPromises();
		expect(band(wrapper)).toMatchObject({
			labelKey: "Return bag to safe",
			value: 250,
			primaryAction: { id: "custody.primary", labelKey: "Return this cash to the safe" },
			primaryEnabled: true,
		});
		// The same verb the form prints, and the same money.
		expect(wrapper.get('[data-testid="custody-confirm"]').text()).toContain(
			"Return this cash to the safe",
		);
		expect(wrapper.get('[data-testid="custody-confirm"]').text()).toContain("$250.00");

		bus.emit("custody:primary");
		await flushPromises();
		expect(command).toHaveBeenCalledTimes(1);
		expect(command).toHaveBeenCalledWith("drop", expect.objectContaining({ seal: "DOCO-TAK-9" }));
	});

	it("leads an unconfirmed cash action to its retry and to nothing else", async () => {
		pendingActions.mockReturnValue([
			{ action: "drop", payload: { pos_profile: "Doco Ventas", seal: "DOCO-TAK-9" } },
		]);
		const bus = makeBus();
		const wrapper = mountView({ bus });
		await flushPromises();
		expect(band(wrapper)).toMatchObject({
			tone: "warning",
			labelKey: "Unconfirmed cash action",
			primaryAction: { id: "custody.primary", labelKey: "Retry unconfirmed action" },
		});

		bus.emit("custody:primary");
		await flushPromises();
		expect(command).toHaveBeenCalledTimes(1);
		expect(command).toHaveBeenCalledWith("drop", {
			pos_profile: "Doco Ventas",
			seal: "DOCO-TAK-9",
		});
	});

	it("does not offer a press the screen itself would refuse", async () => {
		pendingActions.mockImplementation(() => {
			throw new Error("storage");
		});
		const bus = makeBus();
		const wrapper = mountView({ bus });
		await flushPromises();
		const state = band(wrapper);
		// Recovery evidence unreadable: the screen refuses every task until a
		// supervisor has checked Desk, so the band refuses the press too — and
		// the panel above it says why.
		expect(wrapper.text()).toContain("could not be read");
		expect(state.primaryEnabled).toBe(false);
		bus.emit("custody:primary");
		await flushPromises();
		expect(command).not.toHaveBeenCalled();
		expect(wrapper.find("form").exists()).toBe(false);
	});

	it("says so honestly when the selected bag has no step for this person", async () => {
		const wrapper = mountView({ shift: null });
		await flushPromises();
		await wrapper
			.findAll("button.record")
			.find((b: any) => b.text().includes("DOCO-FLOAT-11"))!
			.trigger("click");
		await flushPromises();
		// No open drawer: receiving is blocked, and the band says the bag's amount
		// under the only verb that is true.
		expect(band(wrapper)).toMatchObject({
			labelKey: "Bag {0}",
			value: 1000,
			primaryAction: { id: "sale.return", labelKey: "Back to sale" },
		});
	});

	it("takes its band down with it and stops answering the shell", async () => {
		const bus = makeBus();
		const wrapper = mountView({ bus });
		await flushPromises();
		wrapper.unmount();
		expect(band(wrapper)).toBe(null);
		expect(bus.handlers["custody:primary"]).toEqual([]);
	});
});
