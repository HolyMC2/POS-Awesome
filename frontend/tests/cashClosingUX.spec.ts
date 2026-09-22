// @vitest-environment jsdom
/**
 * Counting the drawer at close, and dividing it into the bags that go back to
 * the safe (docs/POS-CASH-CUSTODY.md).
 *
 * What is guarded here is the SEAM between the cashier's fingers and
 * `api/cash_custody/service.py`: every refusal that file can raise
 * (`finalize_drawer`, `new_bag`, `model.count`) is one the cashier would
 * otherwise meet with the cash already counted, sealed and in their hands. So
 * the assertions are about the shape this screen produces and about what it
 * says BEFORE the band is pressed — never about relaxing a server rule.
 *
 * Mounted rather than source-scanned, because the claims are behavioural: a
 * quantity that reaches the model, a payload that is or is not emitted.
 *
 * Emits are read through prop listeners, not `wrapper.emitted()`. This repo
 * builds its specs with `process.env.NODE_ENV` defined as `"production"`
 * (vite.config.js), so Vue skips the devtools hook Vue Test Utils records
 * emits through — `emitted()` returns native DOM events only, and an assertion
 * on it passes or fails for reasons that have nothing to do with the register.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("../src/offline/shiftTerminal", () => ({
	getShiftTerminalContext: () => ({
		terminal_id: "browser",
		terminal_token: "secret",
		terminal_generation: 1,
	}),
}));

import CashClosingAllocation from "../src/posapp/components/pos/custody/CashClosingAllocation.vue";
import CashCountEditor from "../src/posapp/components/pos/custody/CashCountEditor.vue";

// A refused save now reads the register back before it gives up, so the
// microtask chain a click has to unwind is longer than one round trip.
const flush = async () => {
	for (let i = 0; i < 24; i += 1) await Promise.resolve();
};

const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0];

/** The server's own count shape, as `model.count()` returns it. */
const drawerDraft = (amount: number, over: Record<string, unknown> = {}) => ({
	name: "CASH-COUNT-1",
	scope: "Drawer",
	state: "Draft",
	opening_shift: "SHIFT",
	counted_by: "cashier",
	amount,
	modified: "2026-09-15 08:20:00",
	note: "Handover to the afternoon shift",
	count_json: JSON.stringify({
		source: "denominations",
		denominations: [{ value: 500, quantity: amount / 500 }],
		reason: "",
		amount,
		derived_minor: amount * 100,
		total_minor: amount * 100,
	}),
	...over,
});

let context: any;
let availability: any;
let saveResult: any;
let call: ReturnType<typeof vi.fn>;

const mountEditor = (model: any, currency = "MXN") => {
	const onUpdate = vi.fn();
	const wrapper = mount(CashCountEditor, {
		props: { modelValue: model, currency, "onUpdate:modelValue": onUpdate },
	});
	const apply = async () => {
		await wrapper.setProps({ modelValue: last(onUpdate) });
		return last(onUpdate);
	};
	return { wrapper, onUpdate, apply };
};

const mountAllocation = async (props: Record<string, unknown> = {}) => {
	const events = {
		onEnabled: vi.fn(),
		onPrepared: vi.fn(),
		onCounted: vi.fn(),
		onNote: vi.fn(),
	};
	const wrapper = mount(CashClosingAllocation, {
		props: {
			profile: "QA",
			opening: "SHIFT",
			currency: "MXN",
			...events,
			...props,
		},
	});
	await flush();
	await wrapper.vm.$nextTick();
	return { wrapper, ...events };
};

/** Type into a denomination stepper the way a cashier does. */
const typeCount = async (scope: any, index: number, value: string) => {
	const box = scope.findAll('[data-testid="denomination-count"]')[index];
	if (!box) throw new Error(`no stepper at index ${index}`);
	await box.setValue(value);
};

const save = async (wrapper: any) => {
	await wrapper.find('[data-testid="cash-closing-save"]').trigger("click");
	await flush();
	await wrapper.vm.$nextTick();
};

beforeEach(() => {
	localStorage.clear();
	availability = { enabled: true };
	context = { bags: [], counts: [] };
	saveResult = {
		cash_count: "CASH-COUNT-1",
		modified: "2026-09-15 08:30:00",
		amount: 500,
	};
	call = vi.fn(async ({ method, args }: any) => {
		if (method.endsWith(".availability")) return { message: availability };
		if (method.endsWith(".context")) return { message: context };
		if (method.endsWith(".command")) {
			if (args.action !== "save_drawer")
				throw Error(`Unexpected action ${args.action}`);
			return { message: saveResult };
		}
		throw Error(`Unexpected call ${method}`);
	});
	(window as any).frappe = { session: { user: "cashier" }, call };
	(window as any).__ = (text: string) => text;
});

afterEach(() => {
	delete (window as any).frappe;
	delete (window as any).__;
});

describe("the denomination count produces what the server accepts", () => {
	it("stores whole-number quantities and drops the rows that hold nothing", async () => {
		// `model.count()` refuses a fractional or non-numeric quantity outright,
		// and a `type=number` box happily offered both.
		const { wrapper, apply, onUpdate } = mountEditor({
			source: "denominations",
			denominations: [],
			reason: "",
			amount: "",
		});
		await typeCount(wrapper, 0, "2.5");
		expect(onUpdate).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain(
			"Enter a whole number of notes or coins.",
		);
		await typeCount(wrapper, 0, "2");
		expect((await apply()).denominations).toEqual([
			{ value: 1000, quantity: 2 },
		]);

		await typeCount(wrapper, 0, "0");
		expect((await apply()).denominations).toEqual([]);
	});

	it("keeps the rows in one order, so the same drawer is the same JSON", async () => {
		const { wrapper, apply } = mountEditor({
			source: "denominations",
			denominations: [],
			reason: "",
			amount: "",
		});
		let model: any;
		for (const [index, value] of [
			[3, "1"],
			[0, "2"],
			[1, "1"],
		] as [number, string][]) {
			await typeCount(wrapper, index, value);
			model = await apply();
		}
		expect(model.denominations.map((row: any) => row.value)).toEqual([
			1000, 500, 100,
		]);
	});

	it("draws a row for a face this currency's table does not list", async () => {
		// Counted money that is invisible is worse than an odd row: the total
		// would include cash the cashier cannot see or correct.
		const { wrapper } = mountEditor({
			source: "denominations",
			denominations: [{ value: 2000, quantity: 1 }],
			reason: "",
			amount: "",
		});
		const faces = wrapper
			.findAll("[data-face-minor]")
			.map((row) => row.attributes("data-face-minor"));
		expect(faces).toContain("200000");
		expect(
			wrapper.find('[data-testid="cash-count-total"]').text(),
		).toContain("2,000");
	});

	it("keeps the manual override explicit, with the derived count beside it", async () => {
		const { wrapper, apply } = mountEditor({
			source: "denominations",
			denominations: [{ value: 500, quantity: 1 }],
			reason: "",
			amount: "",
		});
		expect(
			wrapper.find('[data-testid="cash-count-manual-chip"]').exists(),
		).toBe(false);

		await wrapper
			.find('[data-testid="cash-count-override-toggle"]')
			.trigger("click");
		const manual = await apply();
		expect(manual.source).toBe("manual");
		// The derived figure carries across rather than being retyped.
		expect(manual.amount).toBe("500.00");
		expect(
			wrapper.find('[data-testid="cash-count-manual-chip"]').exists(),
		).toBe(true);
		expect(
			wrapper.find('[data-testid="cash-count-derived"]').text(),
		).toContain("500");
		// A reason shorter than `model.count()`'s eight characters is marked
		// where it is typed, not after the save round-trip.
		expect(
			wrapper
				.find('[data-testid="cash-count-manual-reason"]')
				.attributes("aria-invalid"),
		).toBe("true");
	});

	it("refuses a manual total the server could not parse", async () => {
		const { wrapper, onUpdate } = mountEditor({
			source: "manual",
			denominations: [],
			reason: "",
			amount: "",
		});
		await wrapper
			.find('[data-testid="cash-count-manual-amount"]')
			.setValue("1,2.345x");
		expect(last(onUpdate).amount).toBe("1,2.345x");
	});
});

describe("the closing allocation only claims to be ready when it is", () => {
	it("says so when custody could not be checked, instead of closing as if it were off", async () => {
		call.mockImplementation(async ({ method }: any) => {
			if (method.endsWith(".availability")) throw Error("offline");
			return { message: {} };
		});
		const { wrapper, onEnabled } = await mountAllocation();
		expect(last(onEnabled)).toBe(false);
		expect(wrapper.find('[role="alert"]').text()).toContain(
			"Cash custody could not be checked",
		);
	});

	it("restores the saved draft, its note, and reports no unsaved changes", async () => {
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper, onCounted } = await mountAllocation();
		const badge = wrapper.find('[data-testid="cash-closing-saved"]').text();
		expect(badge).toContain("Saved");
		expect(badge).not.toContain("Unsaved");
		expect(
			(
				wrapper.find('[data-testid="cash-closing-note"]')
					.element as HTMLTextAreaElement
			).value,
		).toBe("Handover to the afternoon shift");
		expect(last(onCounted)).toBe(500);
	});

	it("reports unsaved changes as soon as the count moves, and clears them on save", async () => {
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper, onPrepared } = await mountAllocation();
		await typeCount(wrapper, 0, "1");
		await wrapper.vm.$nextTick();
		expect(
			wrapper.find('[data-testid="cash-closing-saved"]').text(),
		).toContain("Unsaved changes");
		expect(last(onPrepared)).toBeNull();

		saveResult = {
			cash_count: "CASH-COUNT-1",
			modified: "2026-09-15 08:40:00",
			amount: 1500,
		};
		await save(wrapper);
		expect(
			wrapper.find('[data-testid="cash-closing-saved"]').text(),
		).not.toContain("Unsaved changes");
		// Optimistic concurrency: the save carries the timestamp the draft
		// arrived with, so a second window's edit is refused rather than lost.
		const sent = call.mock.calls.at(-1)![0].args.payload;
		expect(sent.cash_count).toBe("CASH-COUNT-1");
		expect(sent.modified).toBe("2026-09-15 08:20:00");
	});

	it("keeps the counted work when the save is refused, and offers the retry", async () => {
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper, onCounted } = await mountAllocation();
		call.mockImplementation(async ({ method }: any) => {
			if (method.endsWith(".command"))
				throw Object.assign(
					Error("This count changed in another window."),
					{
						// An explicit server refusal, so `api.command()` releases the
						// request key and a corrected count can simply be saved again.
						serverMessage: "stale",
						status: 417,
					},
				);
			return {
				message: method.endsWith(".availability")
					? availability
					: context,
			};
		});
		await save(wrapper);
		const alert = wrapper.find('[data-testid="cash-closing-error"]');
		expect(alert.text()).toContain("another window");
		expect(alert.find("button").text()).toBe("Retry");
		expect(
			wrapper.find('[data-testid="cash-closing-pending"]').exists(),
		).toBe(false);
		expect(last(onCounted)).toBe(500);
		expect(
			(
				wrapper.findAll('[data-testid="denomination-count"]')[1]!
					.element as HTMLInputElement
			).value,
		).toBe("1");
	});

	it("replays a save whose answer never arrived instead of looping on the refusal", async () => {
		// `api.command()` keeps the request ID so the server returns the original
		// result rather than writing a second count — but it refuses DIFFERENT
		// instructions under that key, which is a dead end without this action.
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper, onPrepared } = await mountAllocation();
		call.mockImplementationOnce(async () => {
			throw new TypeError("NetworkError");
		});
		await save(wrapper);
		expect(
			wrapper.find('[data-testid="cash-closing-pending"]').exists(),
		).toBe(true);
		expect(
			(
				wrapper.find('[data-testid="cash-closing-save"]')
					.element as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(last(onPrepared)).toBeNull();

		// The cashier recounts while the result is unknown; the replay still
		// sends what was already in flight.
		await typeCount(wrapper, 0, "1");
		await wrapper
			.find('[data-testid="cash-closing-pending"] button')
			.trigger("click");
		await flush();
		await wrapper.vm.$nextTick();
		const replayed = call.mock.calls.at(-1)![0].args.payload;
		expect(replayed.count.denominations).toEqual([
			{ value: 500, quantity: 1 },
		]);
		expect(
			wrapper.find('[data-testid="cash-closing-pending"]').exists(),
		).toBe(false);
		// And the newer count is honestly still unsaved.
		expect(
			wrapper.find('[data-testid="cash-closing-saved"]').text(),
		).toContain("Unsaved changes");
	});

	it("emits the closing payload only once the bags account for the saved count", async () => {
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper, onPrepared } = await mountAllocation();
		await save(wrapper);

		// The first save offers the whole drawer as one bag; it still has no seal.
		expect(last(onPrepared)).toBeNull();
		expect(
			wrapper.find('[data-testid="cash-closing-remaining"]').text(),
		).toContain("Fully allocated");

		await wrapper
			.find(".cash-closing__field--seal input")
			.setValue("BAG-1");
		await wrapper.vm.$nextTick();
		expect(last(onPrepared)).toMatchObject({
			cash_count: "CASH-COUNT-1",
			modified: "2026-09-15 08:30:00",
			note: "Handover to the afternoon shift",
		});
		expect(last(onPrepared).bags).toEqual([
			{
				seal: "BAG-1",
				purpose: "Takings",
				count: {
					source: "denominations",
					denominations: [{ value: 500, quantity: 1 }],
					reason: "",
					amount: 500,
				},
			},
		]);
		expect(
			wrapper.find('[data-testid="cash-closing-ready"]').exists(),
		).toBe(true);
	});

	it("names a seal the safe already holds before the close fails on a unique index", async () => {
		context = { bags: [{ seal: "bag-1" }], counts: [drawerDraft(500)] };
		const { wrapper, onPrepared } = await mountAllocation();
		await save(wrapper);
		await wrapper
			.find(".cash-closing__field--seal input")
			.setValue("BAG-1");
		await wrapper.vm.$nextTick();
		expect(wrapper.text()).toContain(
			"This seal already belongs to another bag.",
		);
		expect(last(onPrepared)).toBeNull();

		await wrapper
			.find(".cash-closing__field--seal input")
			.setValue("BAG-2");
		await wrapper.vm.$nextTick();
		expect(last(onPrepared)).not.toBeNull();
	});

	it("lists what is still missing rather than silently refusing to close", async () => {
		context = { bags: [], counts: [drawerDraft(500, { note: "" })] };
		const { wrapper } = await mountAllocation({ expected: 620 });
		await save(wrapper);
		await wrapper
			.find(".cash-closing__field--seal input")
			.setValue("BAG!!");
		await wrapper.vm.$nextTick();
		const todo = wrapper.find('[data-testid="cash-closing-todo"]').text();
		expect(todo).toContain("Give every bag its own seal.");
		// `finalize_drawer` calls `note()` whenever the drawer differs from
		// expected; without the note the close is refused after the band.
		expect(todo).toContain("Add a note explaining the cash difference");
		expect(
			wrapper.find('[data-testid="cash-closing-difference"]').text(),
		).toContain("120");
	});

	it("puts the remaining cash in a second bag exactly, denomination by denomination", async () => {
		context = {
			bags: [],
			counts: [
				drawerDraft(700, {
					count_json: JSON.stringify({
						source: "denominations",
						denominations: [
							{ value: 500, quantity: 1 },
							{ value: 100, quantity: 2 },
						],
						reason: "",
						amount: 700,
						derived_minor: 70000,
						total_minor: 70000,
					}),
				}),
			],
		};
		saveResult = {
			cash_count: "CASH-COUNT-1",
			modified: "2026-09-15 08:30:00",
			amount: 700,
		};
		const { wrapper, onPrepared } = await mountAllocation();
		await save(wrapper);

		// Split the $100s out of the takings bag, then hand the rest to a float.
		const takings = wrapper
			.findAll('[data-testid="cash-count-editor"]')
			.at(-1)!;
		await typeCount(takings, 3, "0");
		await wrapper.vm.$nextTick();
		await wrapper
			.find('[data-testid="cash-closing-add-bag"]')
			.trigger("click");
		await wrapper.vm.$nextTick();
		await wrapper
			.findAll('[data-testid="cash-closing-fill"]')
			.at(-1)!
			.trigger("click");
		await wrapper.vm.$nextTick();

		expect(
			wrapper.find('[data-testid="cash-closing-remaining"]').text(),
		).toContain("Fully allocated");
		const seals = wrapper.findAll(".cash-closing__field--seal input");
		await seals[0]!.setValue("BAG-A");
		await seals[1]!.setValue("BAG-B");
		await wrapper.vm.$nextTick();
		expect(
			last(onPrepared).bags.map((bag: any) => bag.count.denominations),
		).toEqual([
			[{ value: 500, quantity: 1 }],
			[{ value: 100, quantity: 2 }],
		]);
	});

	it("falls back to the server draft when the local copy is unreadable", async () => {
		localStorage.setItem("cash-closing:cashier:QA:SHIFT", "{damaged");
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper, onCounted } = await mountAllocation();
		expect(last(onCounted)).toBe(500);
		expect(
			wrapper.find('[data-testid="cash-closing-saved"]').text(),
		).toContain("CASH-COUNT-1");
	});

	it("keeps a cached count when the context read fails, and says the draft did not load", async () => {
		localStorage.setItem(
			"cash-closing:cashier:QA:SHIFT",
			JSON.stringify({
				count: {
					source: "denominations",
					denominations: [{ value: 200, quantity: 3 }],
					reason: "",
					amount: "",
				},
				bags: [],
				note: "",
				saved: null,
				savedSignature: "",
			}),
		);
		call.mockImplementation(async ({ method }: any) => {
			if (method.endsWith(".availability"))
				return { message: { enabled: true } };
			throw Error("Connection lost");
		});
		const { wrapper, onCounted } = await mountAllocation();
		expect(last(onCounted)).toBe(600);
		expect(wrapper.text()).toContain("Connection lost");
	});
});

/**
 * The register is the one that knows what was saved.
 *
 * A cached drawer count used to be the end of the question: the screen applied
 * it and never looked at the server's own draft, so a count saved from another
 * window left this screen holding a `modified` the server had already moved
 * past. Every Save was refused with the same message and the only offered
 * action was the same Save again. What follows is that loop, from both ends —
 * detection and a way out — plus the cases where the saved count is finished or
 * simply gone, and the rule that an unchecked count never claims to be ready.
 */
describe("a saved drawer count is reconciled with the register, not replayed", () => {
	/** Leave a complete, ready cache behind, the way a real reload finds one. */
	const seedSavedCache = async () => {
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper, onPrepared } = await mountAllocation();
		await save(wrapper);
		await wrapper.find(".cash-closing__field--seal input").setValue("BAG-1");
		await wrapper.vm.$nextTick();
		// The cache only counts as a baseline if it really was closable.
		expect(last(onPrepared)).not.toBeNull();
		wrapper.unmount();
	};

	/** The same draft, saved again by another window since this screen last saw it. */
	const movedOn = (over: Record<string, unknown> = {}) => ({
		bags: [],
		counts: [drawerDraft(500, { modified: "2026-09-15 09:00:00", ...over })],
	});

	const conflictOf = (wrapper: any) =>
		wrapper.find('[data-testid="cash-closing-conflict"]');
	const saveDisabled = (wrapper: any) =>
		(
			wrapper.find('[data-testid="cash-closing-save"]')
				.element as HTMLButtonElement
		).disabled;

	it("reports the register's newer count instead of saving over it, and stops offering the refusal", async () => {
		await seedSavedCache();
		context = movedOn();
		const { wrapper, onPrepared, onCounted } = await mountAllocation();

		const panel = conflictOf(wrapper);
		expect(panel.exists()).toBe(true);
		expect(panel.text()).toContain("changed on the register");
		// Both figures are on screen: choosing is not choosing blind.
		expect(panel.find('[data-money-role="local-count"]').text()).toContain(
			"500",
		);
		expect(panel.find('[data-money-role="server-count"]').text()).toContain(
			"2026-09-15 09:00",
		);
		// The stale identity cannot be sent again while this is unresolved.
		expect(saveDisabled(wrapper)).toBe(true);
		expect(last(onPrepared)).toBeNull();
		expect(wrapper.find('[data-testid="cash-closing-todo"]').text()).toContain(
			"Reconcile this drawer count with the register",
		);
		// And nothing the cashier counted was thrown away to say so.
		expect(last(onCounted)).toBe(500);
		expect(wrapper.findAll(".cash-closing__field--seal input").length).toBe(1);
	});

	it("saves the cashier's own count over the version they just reviewed", async () => {
		await seedSavedCache();
		context = movedOn();
		const { wrapper, onPrepared } = await mountAllocation();

		await wrapper
			.find('[data-testid="cash-closing-keep-local"]')
			.trigger("click");
		await wrapper.vm.$nextTick();
		expect(conflictOf(wrapper).exists()).toBe(false);
		// Keeping a local count is not the same as having saved it.
		expect(
			wrapper.find('[data-testid="cash-closing-saved"]').text(),
		).toContain("Unsaved changes");
		expect(last(onPrepared)).toBeNull();
		expect(saveDisabled(wrapper)).toBe(false);

		saveResult = {
			cash_count: "CASH-COUNT-1",
			modified: "2026-09-15 09:10:00",
			amount: 500,
		};
		await save(wrapper);
		// The save carries the timestamp that was actually reviewed, so the
		// server accepts it instead of refusing the same stale one forever.
		const sent = call.mock.calls.at(-1)![0].args.payload;
		expect(sent.cash_count).toBe("CASH-COUNT-1");
		expect(sent.modified).toBe("2026-09-15 09:00:00");
		expect(last(onPrepared)).toMatchObject({
			cash_count: "CASH-COUNT-1",
			modified: "2026-09-15 09:10:00",
		});
		expect(last(onPrepared).bags[0].seal).toBe("BAG-1");
	});

	it("loads the register's version when that is the count the cashier trusts, keeping the bags", async () => {
		await seedSavedCache();
		context = {
			bags: [],
			counts: [
				drawerDraft(1000, {
					modified: "2026-09-15 09:00:00",
					note: "Recounted with the supervisor",
				}),
			],
		};
		const { wrapper, onCounted, onPrepared, onNote } = await mountAllocation();

		await wrapper
			.find('[data-testid="cash-closing-load-server"]')
			.trigger("click");
		await wrapper.vm.$nextTick();
		expect(conflictOf(wrapper).exists()).toBe(false);
		expect(last(onCounted)).toBe(1000);
		expect(last(onNote)).toBe("Recounted with the supervisor");
		expect(
			wrapper.find('[data-testid="cash-closing-saved"]').text(),
		).not.toContain("Unsaved changes");
		// The bag allocation survived the load, and now visibly disagrees with
		// the larger count rather than being silently re-cut.
		expect(wrapper.findAll(".cash-closing__field--seal input").length).toBe(1);
		expect(wrapper.find('[data-testid="cash-closing-todo"]').text()).toContain(
			"Allocate the remaining",
		);
		expect(last(onPrepared)).toBeNull();
	});

	it("says a completed count cannot be edited, and keeps counting in a new one", async () => {
		await seedSavedCache();
		context = movedOn({ state: "Final", closing_shift: "POSA-CS-26-0000001" });
		const { wrapper } = await mountAllocation();

		const panel = conflictOf(wrapper);
		expect(panel.text()).toContain("already completed on the register");
		expect(
			wrapper.find('[data-testid="cash-closing-keep-local"]').text(),
		).toBe("Keep my count as a new count");

		await wrapper
			.find('[data-testid="cash-closing-keep-local"]')
			.trigger("click");
		await wrapper.vm.$nextTick();
		expect(wrapper.find('[data-testid="cash-closing-saved"]').exists()).toBe(
			false,
		);

		await save(wrapper);
		// No identity is claimed, so the server opens a fresh draft instead of
		// refusing an edit to a count it already finalized.
		const sent = call.mock.calls.at(-1)![0].args.payload;
		expect(sent.cash_count).toBeUndefined();
		expect(sent.modified).toBeUndefined();
		expect(sent.count.denominations).toEqual([{ value: 500, quantity: 1 }]);
	});

	it("reports a saved count the register no longer holds, without discarding it", async () => {
		await seedSavedCache();
		context = { bags: [], counts: [] };
		const { wrapper, onCounted } = await mountAllocation();

		const panel = conflictOf(wrapper);
		expect(panel.text()).toContain("no longer holds your saved count");
		// There is no server version to load, so no such choice is offered.
		expect(
			wrapper.find('[data-testid="cash-closing-load-server"]').exists(),
		).toBe(false);
		expect(last(onCounted)).toBe(500);
	});

	it("asks which count to keep when the register holds a draft this screen never saved", async () => {
		// Counted here, saved from the other window: adopting either one silently
		// would delete money somebody physically counted.
		localStorage.setItem(
			"cash-closing:cashier:QA:SHIFT",
			JSON.stringify({
				count: {
					source: "denominations",
					denominations: [{ value: 200, quantity: 3 }],
					reason: "",
					amount: "",
				},
				bags: [],
				note: "",
				saved: null,
				savedSignature: "",
			}),
		);
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper, onCounted } = await mountAllocation();

		expect(conflictOf(wrapper).text()).toContain(
			"already holds a saved count for this shift",
		);
		expect(last(onCounted)).toBe(600);
		expect(saveDisabled(wrapper)).toBe(true);

		await wrapper
			.find('[data-testid="cash-closing-load-server"]')
			.trigger("click");
		await wrapper.vm.$nextTick();
		expect(last(onCounted)).toBe(500);
		expect(
			wrapper.find('[data-testid="cash-closing-saved"]').text(),
		).toContain("CASH-COUNT-1");
	});

	it("keeps an untouched screen on the register's draft, with no question to answer", async () => {
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper } = await mountAllocation();
		expect(conflictOf(wrapper).exists()).toBe(false);
		expect(
			wrapper.find('[data-testid="cash-closing-saved"]').text(),
		).toContain("CASH-COUNT-1");
	});

	it("leaves the unconfirmed action first: no recovery choice is taken while a replay is owed", async () => {
		await seedSavedCache();
		// A save whose answer never arrived, exactly as `api.command()` stored it.
		localStorage.setItem(
			"cash-custody-request:cashier:QA:save_drawer",
			JSON.stringify({
				request_id: "aaaaaaaaaaaaaaaaaaaa",
				body: JSON.stringify({
					pos_profile: "QA",
					opening_shift: "SHIFT",
					count: {
						source: "denominations",
						denominations: [{ value: 500, quantity: 1 }],
						reason: "",
						amount: "",
					},
					note: "",
					cash_count: "CASH-COUNT-1",
					modified: "2026-09-15 08:30:00",
				}),
			}),
		);
		context = movedOn();
		const { wrapper, onPrepared } = await mountAllocation();

		expect(
			wrapper.find('[data-testid="cash-closing-pending"]').exists(),
		).toBe(true);
		const panel = conflictOf(wrapper);
		expect(panel.text()).toContain("Retry the unconfirmed cash action");
		for (const id of ["cash-closing-load-server", "cash-closing-keep-local"])
			expect(
				(wrapper.find(`[data-testid="${id}"]`).element as HTMLButtonElement)
					.disabled,
			).toBe(true);

		// And the choice really is inert, not merely styled as such.
		await wrapper
			.find('[data-testid="cash-closing-keep-local"]')
			.trigger("click");
		await wrapper.vm.$nextTick();
		expect(conflictOf(wrapper).exists()).toBe(true);
		expect(last(onPrepared)).toBeNull();
	});

	it("does not call a cached count ready when the register could not be checked", async () => {
		await seedSavedCache();
		call.mockImplementation(async ({ method }: any) => {
			if (method.endsWith(".availability"))
				return { message: { enabled: true } };
			throw Error("Connection lost");
		});
		const { wrapper, onCounted, onPrepared } = await mountAllocation();

		// Everything the cashier did is still here — the claim about it is not.
		expect(last(onCounted)).toBe(500);
		expect(wrapper.findAll(".cash-closing__field--seal input").length).toBe(1);
		// Never, not merely by the end: a cached count is complete the instant it
		// is applied, and the parent submits whatever payload it last received.
		expect(onPrepared.mock.calls.every(([payload]) => payload === null)).toBe(
			true,
		);
		expect(wrapper.find('[data-testid="cash-closing-ready"]').exists()).toBe(
			false,
		);
		expect(wrapper.find('[data-testid="cash-closing-todo"]').text()).toContain(
			"could not be checked with the register",
		);
		expect(saveDisabled(wrapper)).toBe(true);
		call.mockClear();
		await save(wrapper);
		expect(call).not.toHaveBeenCalled();
	});

	it("reads the register back when a save is refused, turning the dead end into a choice", async () => {
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper } = await mountAllocation();
		context = movedOn();
		call.mockImplementationOnce(async () => {
			throw Object.assign(Error("This count changed in another window."), {
				serverMessage: "stale",
				status: 417,
			});
		});
		await save(wrapper);

		expect(
			wrapper.find('[data-testid="cash-closing-error"]').text(),
		).toContain("another window");
		expect(conflictOf(wrapper).exists()).toBe(true);
		// The Retry that would earn the identical refusal is gone; the choices
		// that can actually resolve it are what is left.
		expect(
			wrapper.find('[data-testid="cash-closing-error"] button').exists(),
		).toBe(false);
		expect(saveDisabled(wrapper)).toBe(true);
	});

	it("does not roll the screen back to a stored copy the browser stopped updating", async () => {
		context = { bags: [], counts: [drawerDraft(500)] };
		const { wrapper, onCounted } = await mountAllocation();
		// Storage dies after the cache was written: the copy on disk is now the
		// count as it was, and the live count is the one in the cashier's hands.
		const setItem = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("QuotaExceededError");
			});
		try {
			await typeCount(wrapper, 0, "1");
			await wrapper.vm.$nextTick();
			expect(last(onCounted)).toBe(1500);
			// The save cannot even be recorded for recovery, so it is refused and
			// the screen re-reads the register.
			await save(wrapper);
			expect(last(onCounted)).toBe(1500);
			expect(
				(
					wrapper.findAll('[data-testid="denomination-count"]')[0]!
						.element as HTMLInputElement
				).value,
			).toBe("1");
			expect(wrapper.text()).toContain("Browser storage is unavailable");
		} finally {
			setItem.mockRestore();
		}
	});
});

describe("primary integration count safeguards", () => {
	it("does not mark edits made during a save as saved", async () => {
		const { wrapper, onPrepared } = await mountAllocation();
		await typeCount(wrapper, 1, "1");
		let complete: (_v: any) => void = () => {};
		call.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		await wrapper.get('[data-testid="cash-closing-save"]').trigger("click");
		await typeCount(wrapper, 1, "2");
		complete({ message: saveResult });
		await flush();
		expect(
			wrapper.get('[data-testid="cash-closing-saved"]').text(),
		).toContain("Unsaved changes");
		expect(last(onPrepared)).toBeNull();
	});
	it("does not reveal an expected zero for a blind count", async () => {
		const { wrapper } = await mountAllocation({ expected: null });
		expect(wrapper.find('[data-money-role="expected"]').exists()).toBe(
			false,
		);
	});
});
