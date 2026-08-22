// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

import OfflineQueueView from "../src/posapp/components/pos/offline/OfflineQueueView.vue";
import {
	buildHeldSales,
	claimsEverythingUploaded,
	elapsedLabel,
	queuedBandInput,
	resolveUploadClaim,
	summariseHeldSales,
} from "../src/posapp/components/pos/offline/offlineQueueModel";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";

/**
 * The desktop offline queue (build plan §12 item E, `Offline.dc.html`).
 *
 * The screen makes one promise — *"Ningún ticket se pierde"* — and the table is
 * the evidence for it, so almost every test here is about whether a row tells
 * the truth: the order it will upload in, what it is worth, and whether it is
 * WAITING or STUCK. Those last two look alike in amber and are not the same
 * fact at all: a dead letter is cash in the drawer with no invoice behind it.
 */

/** A marker no formatter produces, so counting it counts MONEY, not digits. */
const MONEY = "¤";
const currency = (value: number) => `${MONEY}${value.toFixed(2)}`;
const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;

const snapshot = (over: Record<string, any> = {}) => ({
	queue_id: over.queue_id ?? 1,
	entity_type: "invoice",
	status: over.status ?? "pending",
	created_at: over.created_at ?? "2026-08-22T19:44:00.000Z",
	retry_count: over.retry_count ?? 0,
	last_error: over.last_error ?? null,
	idempotency_key: over.idempotency_key ?? "inv-1755900000000-abcd1234",
	draft_invoice_name: over.draft_invoice_name ?? null,
	invoice: {
		customer_name: "Alejandra Ríos Bautista",
		grand_total: 1129,
		items: [
			{ item_name: "Combo Protección", qty: 1 },
			{ item_name: "Funda", qty: 2 },
			{ item_name: "Adaptador", qty: 3 },
		],
		payments: [{ mode_of_payment: "Efectivo", amount: 1129 }],
		posa_client_request_id: "inv-1755900000000-abcd1234",
		...(over.invoice || {}),
	},
	data: over.data ?? {},
});

const mountView = (props: Record<string, unknown> = {}) =>
	mount(OfflineQueueView, {
		props: { formatCurrency: currency, ...props },
		global: { plugins: [createVuetify()] },
	});

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

describe("the queue is built from what the register is actually holding", () => {
	it("orders oldest first, whatever order the rows arrived in", () => {
		// The screen states the rule out loud — "se suben en orden, de la más
		// vieja a la más nueva" — so it is a promise this module keeps rather
		// than an accident of how Dexie sorted.
		const rows = buildHeldSales([
			snapshot({ queue_id: 2, created_at: "2026-08-22T19:44:00.000Z" }),
			snapshot({ queue_id: 1, created_at: "2026-08-22T17:44:00.000Z" }),
			snapshot({ queue_id: 3, created_at: "2026-08-22T19:52:00.000Z" }),
		]);

		expect(rows.map((row) => row.key)).toEqual(["1", "2", "3"]);
	});

	it("prefers a server name over the local reference, and says which it got", () => {
		const [local] = buildHeldSales([snapshot({})]);
		const [named] = buildHeldSales([
			snapshot({ draft_invoice_name: "ACC-SINV-2026-00042" }),
		]);

		expect(local!.ticketIsLocal).toBe(true);
		expect(local!.ticket).toBe("ABCD1234");
		expect(named!.ticketIsLocal).toBe(false);
		expect(named!.ticket).toBe("ACC-SINV-2026-00042");
	});

	it("summarises the sale from its own lines", () => {
		const [row] = buildHeldSales([snapshot({})]);

		expect(row!.contents).toBe("Combo Protección + 2 × Funda");
		expect(row!.lineCount).toBe(3);
	});

	it("reads the tender off the invoice, and names the derived cases apart", () => {
		const [cash] = buildHeldSales([snapshot({})]);
		const [mixed] = buildHeldSales([
			snapshot({
				invoice: {
					payments: [
						{ mode_of_payment: "Efectivo", amount: 500 },
						{ mode_of_payment: "Tarjeta", amount: 629 },
					],
				},
			}),
		]);
		const [credit] = buildHeldSales([
			snapshot({ invoice: { payments: [] }, data: { is_credit_sale: 1 } }),
		]);

		// Tenant data passes through untranslated; only our own words are keys.
		expect(cash!.tenderLabel).toBe("Efectivo");
		expect(cash!.tenderIsLiteral).toBe(true);
		expect(mixed!.tenderLabel).toBe("Mixed");
		expect(mixed!.tenderIsLiteral).toBe(false);
		expect(credit!.tenderLabel).toBe("On credit");
	});

	it("falls back to the rounded total rather than showing nothing", () => {
		const [row] = buildHeldSales([
			snapshot({ invoice: { grand_total: undefined, rounded_total: 447 } }),
		]);

		expect(row!.amount).toBe(447);
	});

	it("never reads a dead letter as a calm 'waiting'", () => {
		// §7 class C: cash was physically accepted and no invoice exists. The
		// artboard's amber "En espera" on this row would be the exact lie this
		// screen is built to make impossible.
		const [row] = buildHeldSales([snapshot({ status: "dead_letter", retry_count: 5 })]);

		expect(row!.state).toBe("stuck");
		expect(row!.tone).toBe("danger");
		expect(row!.statusKey).not.toBe("Waiting");
	});

	it("keeps a drafted sale distinguishable from one still queued", () => {
		const [row] = buildHeldSales([snapshot({ status: "draft_review" })]);

		expect(row!.state).toBe("draftReview");
	});
});

describe("the totals under the table", () => {
	const rows = () =>
		buildHeldSales([
			snapshot({ queue_id: 1, created_at: "2026-08-22T18:00:00.000Z" }),
			snapshot({
				queue_id: 2,
				created_at: "2026-08-22T19:00:00.000Z",
				invoice: {
					grand_total: 518,
					payments: [{ mode_of_payment: "Tarjeta", amount: 518 }],
				},
			}),
			snapshot({ queue_id: 3, status: "synced", created_at: "2026-08-22T17:00:00.000Z" }),
		]);

	it("counts only what is still held — an uploaded sale is history", () => {
		const summary = summariseHeldSales(rows());

		expect(summary.ticketCount).toBe(2);
		expect(summary.totalHeld).toBe(1647);
		expect(summary.uploadedCount).toBe(1);
	});

	it("groups by tender, biggest first", () => {
		const summary = summariseHeldSales(rows());

		expect(summary.byTender.map((t) => [t.label, t.amount])).toEqual([
			["Efectivo", 1129],
			["Tarjeta", 518],
		]);
	});

	it("dates the queue from the oldest sale still held, not the oldest row", () => {
		expect(summariseHeldSales(rows()).oldestHeldAt).toBe("2026-08-22T18:00:00.000Z");
	});

	it("hands the band the one number, through the band's own model", () => {
		const state = resolveBandState(queuedBandInput(summariseHeldSales(rows())));

		expect(state.kind).toBe("queued");
		expect(state.value).toBe(1647);
		expect(state.primaryAction.id).toBe("offline.keepSelling");
	});
});

describe("how long this has been going on is derived, never stored", () => {
	const now = new Date("2026-08-22T21:31:00.000Z");

	it("reads two instants and subtracts them", () => {
		expect(elapsedLabel("2026-08-22T19:44:00.000Z", now)).toBe("1 h 47 m");
		expect(elapsedLabel("2026-08-22T21:00:00.000Z", now)).toBe("31 m");
		expect(elapsedLabel("2026-08-22T21:30:30.000Z", now)).toBe("< 1 m");
	});

	it("says nothing rather than something negative when the clock steps back", () => {
		expect(elapsedLabel("2026-08-22T22:00:00.000Z", now)).toBe("");
		expect(elapsedLabel(null, now)).toBe("");
	});
});

describe("the claim about money, which is the one that can lie", () => {
	const held = summariseHeldSales(buildHeldSales([snapshot({})]));
	const empty = summariseHeldSales([]);

	it("refuses to say everything is uploaded while the queue still holds a sale", () => {
		// Online is true the moment the network returns; the sales taken while it
		// was gone have not reached the server. The weaker fact wins.
		const claim = resolveUploadClaim({ online: true, summary: held });

		expect(claimsEverythingUploaded(claim)).toBe(false);
		expect(claim.id).toBe("uploading");
	});

	it("says it only when the queue is genuinely empty and the server is reachable", () => {
		expect(claimsEverythingUploaded(resolveUploadClaim({ online: true, summary: empty }))).toBe(
			true,
		);
		expect(claimsEverythingUploaded(resolveUploadClaim({ online: false, summary: empty }))).toBe(
			false,
		);
	});
});

describe("the surface a shopkeeper reads", () => {
	it("is a surface, not the phone's overlay", () => {
		// `MobileOfflineOverlay` is deliberately a `role="status"` layer over the
		// live dock. This is the other treatment, and the scope attribute is how
		// the evidence lane tells them apart.
		const wrapper = mountView();

		expect(wrapper.get('[data-testid="offline-queue"]').attributes("data-offline-scope")).toBe(
			"surface",
		);
	});

	it("renders one row per held sale, in upload order", () => {
		const rows = buildHeldSales([
			snapshot({ queue_id: 9, created_at: "2026-08-22T19:44:00.000Z" }),
			snapshot({ queue_id: 8, created_at: "2026-08-22T18:40:00.000Z" }),
		]);
		const wrapper = mountView({ rows });
		const rendered = wrapper.findAll("[data-held-state]");

		expect(rendered).toHaveLength(2);
		expect(rendered.map((row) => row.attributes("data-testid"))).toEqual([
			"offline-row-8",
			"offline-row-9",
		]);
	});

	it("states the ordering rule on screen, because it is a promise", () => {
		expect(mountView().get('[data-testid="offline-order-rule"]').text()).toContain(
			"oldest to the newest",
		);
	});

	it("declares what every money figure on it is", () => {
		// Same rule as tests/registerSaysItOnce.spec.ts, and a queue table is
		// MANY figures: each declares itself, and the count has to stay right.
		const rows = buildHeldSales([snapshot({ queue_id: 1 }), snapshot({ queue_id: 2 })]);
		const wrapper = mountView({ rows });

		expect(countMoney(wrapper.html())).toBe(wrapper.findAll("[data-money-role]").length);
	});

	it("declares one role per figure, so a role cannot cover two numbers", () => {
		const wrapper = mountView({ rows: buildHeldSales([snapshot({})]) });

		for (const element of wrapper.findAll("[data-money-role]")) {
			expect(countMoney(element.html())).toBe(1);
		}
	});

	it("claims no total — the band owns the one number", () => {
		const wrapper = mountView({ rows: buildHeldSales([snapshot({})]) });

		expect(wrapper.findAll('[data-money-role="total"]')).toHaveLength(0);
		expect(wrapper.findAll('[data-money-role="queued-ticket"]')).toHaveLength(1);
	});

	it("states the connection claim beside the reassurance, and keeps it weak", () => {
		// The component's half of the rule the model enforces: back online with a
		// queue is not "uploaded", and this is the chip a cashier reads before
		// deciding the shift can close.
		const wrapper = mountView({ rows: buildHeldSales([snapshot({})]), online: true });
		const chip = wrapper.get('[data-testid="offline-claim"]');

		expect(chip.text()).toContain("still to upload");
		expect(chip.text()).not.toContain("Everything is uploaded");
		expect(wrapper.text()).not.toContain("The internet dropped");
	});

	it("keeps the artboard's headline while the signal is actually gone", () => {
		const wrapper = mountView({ rows: buildHeldSales([snapshot({})]), online: false });

		expect(wrapper.text()).toContain("The internet dropped — keep selling");
		expect(wrapper.get('[data-testid="offline-claim"]').text()).toBe("No connection");
	});

	it("renders an honest empty state instead of an empty table", () => {
		const wrapper = mountView({ rows: [] });
		const empty = wrapper.get('[data-testid="offline-empty"]');

		expect(empty.text()).toContain("Nothing is waiting to upload");
		// It says the QUEUE is empty — a fact it can see — and not that the
		// register is synced, which is a claim about a server it cannot reach.
		expect(empty.text()).not.toContain("synced");
	});

	it("derives the elapsed block from the oldest held sale, and labels it as that", () => {
		const wrapper = mountView({
			rows: buildHeldSales([snapshot({ created_at: "2026-08-22T19:44:00.000Z" })]),
			now: new Date("2026-08-22T21:31:00.000Z"),
		});
		const elapsed = wrapper.get('[data-testid="offline-elapsed"]');

		expect(elapsed.text()).toContain("1 h 47 m");
		// Nothing in this app records when the connection dropped, so the label
		// names the weaker fact it can actually prove.
		expect(elapsed.text()).toContain("Holding sales for");
	});

	it("names the connection instead when the shell does know when it dropped", () => {
		const wrapper = mountView({
			rows: buildHeldSales([snapshot({ created_at: "2026-08-22T19:44:00.000Z" })]),
			offlineSince: "2026-08-22T20:31:00.000Z",
			now: new Date("2026-08-22T21:31:00.000Z"),
		});

		expect(wrapper.get('[data-testid="offline-elapsed"]').text()).toContain("No connection for");
		expect(wrapper.get('[data-testid="offline-elapsed"]').text()).toContain("1 h 0 m");
	});

	it("hides the elapsed block rather than showing a zero", () => {
		expect(mountView({ rows: [] }).find('[data-testid="offline-elapsed"]').exists()).toBe(false);
	});

	it("raises the rows an operator has to act on above the table", () => {
		const wrapper = mountView({
			rows: buildHeldSales([snapshot({ status: "dead_letter", retry_count: 5 })]),
		});

		expect(wrapper.get('[data-testid="offline-attention"]').text()).toContain(
			"could not be uploaded",
		);
		expect(wrapper.get("[data-held-state]").attributes("data-held-state")).toBe("stuck");
	});

	it("folds a long queue into a count instead of rendering three hundred rows", () => {
		const rows = buildHeldSales(
			Array.from({ length: 12 }, (_, index) =>
				snapshot({ queue_id: index + 1, created_at: `2026-08-22T18:${String(index).padStart(2, "0")}:00.000Z` }),
			),
		);
		const wrapper = mountView({ rows, maxRows: 5 });

		expect(wrapper.findAll("[data-held-state]")).toHaveLength(5);
		expect(wrapper.get('[data-testid="offline-more"]').text()).toContain("7");
	});

	it("carries the offline surface manifest rather than restating what works", () => {
		const wrapper = mountView();

		expect(wrapper.get('[data-offline-surface="cfdi"]').attributes("data-offline-availability")).toBe(
			"blocked",
		);
		expect(
			wrapper.get('[data-offline-surface="checkout"]').attributes("data-offline-availability"),
		).toBe("queued");
	});

	it("cites the module behind every reassurance it prints", () => {
		// R4's ruling: an offline claim ships with the code that makes it
		// checkable, or it does not ship.
		const wrapper = mountView();

		for (const promise of wrapper.findAll("[data-promise]")) {
			expect(promise.attributes("data-backed-by")).toMatch(/^src\/offline\//);
		}
	});
});

describe("Reintentar, from the button's side", () => {
	it("asks the shell once per press", () => {
		// Listener props, not `wrapper.emitted()` — VTU does not record component
		// emits in this repo (build plan §10).
		const onRetry = vi.fn();
		const wrapper = mountView({ onRetry });

		wrapper.get('[data-testid="offline-retry"]').trigger("click");

		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("cannot be pressed again while a drain is already running", () => {
		const onRetry = vi.fn();
		const wrapper = mountView({ onRetry, retrying: true });

		wrapper.get('[data-testid="offline-retry"]').trigger("click");

		expect(onRetry).not.toHaveBeenCalled();
		expect(wrapper.get('[data-testid="offline-retry"]').attributes("disabled")).toBeDefined();
	});
});
