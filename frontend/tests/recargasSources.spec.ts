/**
 * Where every figure on the Recargas screen comes from — and what happens to
 * the ones with nowhere to come from (build plan §12 item F).
 *
 * The artboard is dense with money and the register can source some of it and
 * not the rest. This suite pins BOTH halves, because only one of them is
 * self-evident from reading the code: that a real payload produces the real
 * figure, and that a missing source produces NOTHING — not a zero, not a dash,
 * not a plausible number. `Recargas.dc.html` draws a commission of `$321` and a
 * rate of `5 %` for which no read model exists anywhere in the stack, and a
 * cashier who sees a commission believes they earned it.
 *
 * The read-only block at the end is a different kind of guarantee. A recharge
 * that reaches TAECEL is charged whether it succeeds or not, so the seam this
 * screen reads through is allowed to name three methods and refuses everything
 * else before the request leaves.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
	amountPresets,
	buildCatalogTabs,
	findCarrier,
	tabForCarrier,
} from "../src/posapp/components/pos/recargas/recargasCatalog";
import { recargasEnabled } from "../src/posapp/components/pos/recargas/recargasGate";
import {
	buildTodayLedger,
	maskReference,
	rechargeBandInput,
	resolveBolsa,
} from "../src/posapp/components/pos/recargas/recargasModel";
import {
	RECARGAS_READS,
	isRecargasReadMethod,
	readOnlyCall,
	useRecargasSnapshot,
} from "../src/posapp/components/pos/recargas/useRecargasSnapshot";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";

const TODAY = "2026-08-22";

const row = (over: Record<string, any> = {}) => ({
	name: over.name ?? "SLDO-0001",
	status: over.status ?? "Success",
	requested_at: over.requested_at ?? `${TODAY} 19:41:00`,
	referencia: over.referencia ?? "5528416390",
	monto: over.monto ?? 200,
	saldo_carrier: over.saldo_carrier ?? "Telcel",
	saldo_product: over.saldo_product ?? "Telcel $200",
	item_code: over.item_code ?? "TEL200",
	...over,
});

/* -------------------------------------------------------------------------- */

describe("the pouch balance", () => {
	it("renders the real balance when the manager left it visible", () => {
		const bolsa = resolveBolsa({ visible: true, balance: 1240, as_of: "2026-08-22 19:45:00" }, 0);
		expect(bolsa.available).toBe(1240);
		expect(bolsa.asOf).toBe("2026-08-22 19:45:00");
		expect(bolsa.unavailable).toBe(false);
	});

	it("is entirely absent when the manager hid it", () => {
		// `Saldo Settings.show_available_balance_in_pos` defaults OFF and the
		// server then sends `{visible: false}` with no balance in it at all.
		const bolsa = resolveBolsa({ visible: false }, 200);
		expect(bolsa.visible).toBe(false);
		expect(bolsa.available).toBeNull();
		expect(bolsa.after).toBeNull();
	});

	it("shows no balance rather than a zero when the server could not answer", () => {
		// Credentials missing, or TAECEL unreachable with no cached snapshot. A
		// zero reads as an empty pouch and stops a cashier selling against money
		// that is actually there.
		const bolsa = resolveBolsa({ visible: true, balance: null, error: "creds" }, 200);
		expect(bolsa.available).toBeNull();
		expect(bolsa.unavailable).toBe(true);
		expect(bolsa.after).toBeNull();
	});

	it("computes what is left only when both halves are known", () => {
		expect(resolveBolsa({ visible: true, balance: 1240 }, 200).after).toBe(1040);
		expect(resolveBolsa({ visible: true, balance: 1240 }, 0).after).toBeNull();
		expect(resolveBolsa(null, 200).after).toBeNull();
	});
});

describe("today's ledger", () => {
	it("counts only today, from the server's own day", () => {
		const ledger = buildTodayLedger(
			[row(), row({ name: "SLDO-0002", requested_at: "2026-08-21 22:00:00" })],
			{ today: TODAY, limit: 200 },
		);
		expect(ledger.entries).toHaveLength(1);
		expect(ledger.operations).toBe(1);
	});

	it("sums only what was actually delivered", () => {
		// A refunded or failed recharge came back to the pouch; counting it as
		// sold would inflate the day and hide the reversal.
		const ledger = buildTodayLedger(
			[
				row({ name: "a", monto: 200, status: "Success" }),
				row({ name: "b", monto: 50, status: "Refunded" }),
				row({ name: "c", monto: 100, status: "InProgress" }),
			],
			{ today: TODAY, limit: 200 },
		);
		expect(ledger.sold).toBe(200);
		expect(ledger.refunded).toBe(1);
		expect(ledger.entries.map((e) => e.outcome)).toEqual(["applied", "refunded", "confirming"]);
	});

	it("keeps Manual Review out of both the delivered and the refunded tallies", () => {
		// TAECEL may or may not have charged it. It is neither money back nor
		// money gone, and saldo's own `_row_flags` keeps it out of the
		// refundable total for the same reason.
		const ledger = buildTodayLedger([row({ status: "Manual Review", monto: 300 })], {
			today: TODAY,
			limit: 200,
		});
		expect(ledger.sold).toBe(0);
		expect(ledger.refunded).toBe(0);
		expect(ledger.needsAttention).toBe(1);
	});

	it("withholds every counter when the page was capped", () => {
		// `list_transactions` caps at its limit. "31 recargas hoy" quietly
		// becoming the cap is exactly the confident wrong number this screen
		// refuses; the table still shows the rows it has.
		const rows = Array.from({ length: 5 }, (_unused, i) => row({ name: `SLDO-${i}` }));
		const ledger = buildTodayLedger(rows, { today: TODAY, limit: 5 });
		expect(ledger.complete).toBe(false);
		expect(ledger.operations).toBeNull();
		expect(ledger.sold).toBeNull();
		expect(ledger.entries).toHaveLength(5);
	});

	it("has no commission to report, and says so with a null rather than a zero", () => {
		// `list_transactions`'s SELECT does not include `st.comision`, and the
		// carrier's `ComisionCliente` is not exposed to the POS at all. A zero
		// here would render as "Comisión de hoy $0.00" on a day the shop earned.
		expect(buildTodayLedger([row()], { today: TODAY, limit: 200 }).commission).toBeNull();
	});

	it("masks the middle of a customer's number", () => {
		// The rows carry phone numbers — which is why the endpoint scopes them to
		// one shop — and this screen faces the counter.
		expect(maskReference("5528416390")).toBe("55 •••• 6390");
		expect(maskReference("4471")).toBe("4471");
	});

	it("treats an unrecognised status as still confirming, never as delivered", () => {
		const ledger = buildTodayLedger([row({ status: "Something New" })], {
			today: TODAY,
			limit: 200,
		});
		expect(ledger.entries[0]?.outcome).toBe("confirming");
		expect(ledger.sold).toBe(0);
	});
});

describe("the catalogue is data, not the artboard's drawing", () => {
	const tree = {
		categorias: [
			{
				name: "Tiempo Aire",
				carriers: [
					{
						name: "Telcel",
						label: "Telcel",
						tipo: "0",
						products: [
							{ codigo: "TEL200", nombre: "Telcel $200", monto: 200 },
							{ codigo: "TEL050", nombre: "Telcel $50", monto: 50 },
							{ codigo: "TEL050B", nombre: "Telcel $50 bis", monto: 50 },
						],
					},
				],
			},
			{
				name: "Servicios",
				carriers: [{ name: "CFE", label: "CFE", tipo: "1", products: [] }],
			},
		],
	};

	it("builds its tabs from the categories the sync actually wrote", () => {
		// The artboard draws three. `catalog_tree` orders Tiempo Aire, Paquetes,
		// GiftCards, Servicios and then whatever else it found, so hard-coding
		// three would hide a category the shop stocks.
		expect(buildCatalogTabs(tree).map((tab) => tab.label)).toEqual(["Tiempo Aire", "Servicios"]);
	});

	it("offers only amounts that exist as a product", () => {
		// The artboard draws $10–$500 for every company. An amount with no
		// `Saldo Product` behind it has no Item and cannot be sent at all.
		const telcel = findCarrier(buildCatalogTabs(tree), "Telcel");
		expect(amountPresets(telcel).map((p) => p.amount)).toEqual([50, 200]);
	});

	it("shows one button per amount, so two $50s cannot sit side by side", () => {
		const telcel = findCarrier(buildCatalogTabs(tree), "Telcel");
		expect(amountPresets(telcel).filter((p) => p.amount === 50)).toHaveLength(1);
	});

	it("gives an open-amount company no presets at all", () => {
		const cfe = findCarrier(buildCatalogTabs(tree), "CFE");
		expect(cfe?.openAmount).toBe(true);
		expect(amountPresets(cfe)).toEqual([]);
	});

	it("drops a product with no code, because nothing could be added to a cart", () => {
		const tabs = buildCatalogTabs({
			categorias: [
				{
					name: "Tiempo Aire",
					carriers: [{ name: "Bait", label: "Bait", tipo: "0", products: [{ monto: 50 }] }],
				},
			],
		});
		expect(tabs).toEqual([]);
	});

	it("renders nothing from an unreadable tree", () => {
		expect(buildCatalogTabs(null)).toEqual([]);
		expect(buildCatalogTabs({})).toEqual([]);
	});

	it("finds a company across tabs, so a hint resolves from any page", () => {
		const tabs = buildCatalogTabs(tree);
		expect(tabForCarrier(tabs, "CFE")?.label).toBe("Servicios");
		expect(findCarrier(tabs, "nope")).toBeNull();
	});
});

describe("the band, not this screen, carries the number", () => {
	it("hands the band a recharge input rather than rendering a total", () => {
		const band = resolveBandState(
			rechargeBandInput({
				carrier: "Telcel",
				carrierLabel: "Telcel",
				reference: "5528416390",
				amount: 200,
				itemCode: "TEL200",
			}),
		);
		expect(band.kind).toBe("recharge");
		expect(band.value).toBe(200);
		expect(band.primaryEnabled).toBe(true);
	});

	it("stays unarmed until a company was CHOSEN, not merely hinted", () => {
		const band = resolveBandState(
			rechargeBandInput({
				carrier: null,
				carrierLabel: null,
				reference: "5528416390",
				amount: 200,
				itemCode: null,
			}),
		);
		expect(band.primaryEnabled).toBe(false);
	});

	it("stays unarmed for a typed amount with no product behind it", () => {
		const band = resolveBandState(
			rechargeBandInput({
				carrier: "CFE",
				carrierLabel: "CFE",
				reference: "4471",
				amount: 680,
				itemCode: null,
			}),
		);
		expect(band.primaryEnabled).toBe(false);
	});
});

describe("the capability gate", () => {
	it("opens on the POS Profile flag the saldo app actually installs", () => {
		expect(recargasEnabled({ posProfile: { saldo_enabled: 1 } })).toBe(true);
		expect(recargasEnabled({ posProfile: { saldo_enabled: "1" } })).toBe(true);
	});

	it("opens on the capability too, so the two gates cannot contradict", () => {
		expect(recargasEnabled({ posProfile: {}, hasCapability: (c) => c === "saldo" })).toBe(true);
	});

	it("stays shut on a register that sells no airtime", () => {
		expect(recargasEnabled({ posProfile: { saldo_enabled: 0 }, hasCapability: () => false })).toBe(
			false,
		);
		expect(recargasEnabled({})).toBe(false);
		expect(recargasEnabled({ posProfile: null })).toBe(false);
	});

	it("stays shut when the capability store throws", () => {
		expect(
			recargasEnabled({
				posProfile: {},
				hasCapability: () => {
					throw new Error("store not ready");
				},
			}),
		).toBe(false);
	});
});

describe("the seam may only read", () => {
	it("names three methods, all of them reads", () => {
		expect(Object.values(RECARGAS_READS)).toEqual([
			"saldo.api.status.get_pos_available_balance",
			"saldo.api.status.list_transactions",
			"saldo.api.catalog_admin.catalog_tree",
		]);
	});

	it.each([
		"saldo.api.transactions.create_and_submit",
		"saldo.api.holds.retry_held_line",
		"saldo.api.status.refund_undelivered",
		"saldo.api.settings.fetch_balance",
	])("refuses %s before the request leaves", async (method) => {
		// Every one of these either submits to TAECEL or reaches it live, and
		// TAECEL charges on request. The guard throws rather than returning
		// empty so the mistake is loud in a spec instead of silent at a counter.
		const call = vi.fn();
		await expect(readOnlyCall(call)({ method })).rejects.toThrow(/may only read/);
		expect(call).not.toHaveBeenCalled();
	});

	it("lets the three reads through", async () => {
		const call = vi.fn().mockResolvedValue({ message: {} });
		await readOnlyCall(call)({ method: RECARGAS_READS.ledger });
		expect(call).toHaveBeenCalledTimes(1);
		expect(isRecargasReadMethod(RECARGAS_READS.ledger)).toBe(true);
		expect(isRecargasReadMethod("saldo.api.transactions.create_and_submit")).toBe(false);
	});

	it("scopes the ledger to this register's shop and to today", async () => {
		const call = vi.fn().mockResolvedValue({ message: { rows: [row()] } });
		const snapshot = useRecargasSnapshot({
			call,
			posProfile: () => "Doco Ventas",
			today: () => TODAY,
			limit: 200,
		});
		await snapshot.refresh();
		const ledgerCall = call.mock.calls.find(([o]) => o.method === RECARGAS_READS.ledger)?.[0];
		expect(ledgerCall.args).toMatchObject({
			pos_profile: "Doco Ventas",
			from_date: TODAY,
			limit: 200,
		});
		expect(snapshot.rows.value).toHaveLength(1);
	});

	it("keeps one dead source from blanking the other two", async () => {
		// The pouch balance can be switched off by a manager, or unreachable,
		// while the ledger — a plain SELECT — answers perfectly well.
		const call = vi.fn(async ({ method }: { method: string }) => {
			if (method === RECARGAS_READS.balance) {
				throw new Error("no credentials");
			}
			return { message: method === RECARGAS_READS.ledger ? { rows: [row()] } : { categorias: [] } };
		});
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const snapshot = useRecargasSnapshot({ call, today: () => TODAY });
		await snapshot.refresh();
		expect(snapshot.bolsa.value).toBeNull();
		expect(snapshot.rows.value).toHaveLength(1);
		expect(snapshot.catalog.value).toEqual({ categorias: [] });
		errors.mockRestore();
	});
});

/* -------------------------------------------------------------------------- */
/* Source scan — guarantees about the whole file, not about one render         */
/* -------------------------------------------------------------------------- */

describe("the surface keeps the shell's layout and touch discipline", () => {
	/** Comments come out first: this file explains the height chain in prose as
	 * well as declaring it, and a scan that counted the explanation would pass
	 * on a component that only talked about `min-height: 0`. */
	const read = (name: string) =>
		readFileSync(resolve(__dirname, "../src/posapp/components/pos/recargas", name), "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/<!--[\s\S]*?-->/g, " ");

	const SURFACES = [
		"RecargasView.vue",
		"RecargasCapture.vue",
		"RecargasLedger.vue",
		"RecargasBolsaCard.vue",
	];

	it("adds no second scrollport — the ledger owns the only one", () => {
		// 59c5fe1ad: the register showed two live scrollbars at once because a
		// height was GUESSED. Every ancestor down to the scrolling element is
		// `flex: 1 1 auto; min-height: 0`, and `min-height: 0` is the half that
		// does the work — a flex item refuses to shrink below its content
		// without it, which is how a bare "add overflow" fix NESTS a scrollport
		// instead of removing one.
		const chain = `${read("RecargasView.vue")}${read("RecargasCapture.vue")}${read("RecargasLedger.vue")}`;
		expect(read("RecargasView.vue")).toContain("overflow: hidden");
		// Root, body, capture column, ledger card, and the scrollport itself:
		// five links, no guessed heights anywhere along them.
		expect(chain.match(/min-height: 0/g) ?? []).toHaveLength(5);
		// And exactly ONE element in the whole subtree may scroll.
		expect(chain.match(/overflow(-y)?: auto/g) ?? []).toHaveLength(1);
	});

	it("keeps every control a cashier taps at 44 px on a touch screen", () => {
		const capture = read("RecargasCapture.vue");
		expect(capture).toContain("@media (pointer: coarse)");
		expect(capture).toContain("min-height: var(--reg-touch-min)");
	});

	it("spends no saturated fill — the accent belongs to the band's primary", () => {
		// §17.7 invariant 2. Tabs, company chips and amount buttons are neutral
		// and selection is a tint plus an edge; nine filled amount buttons would
		// drown the one button that matters.
		for (const name of SURFACES) {
			expect(read(name), `${name} uses a Vuetify colour prop`).not.toMatch(/\scolor="/);
		}
	});

	it("paints from tokens, with the one documented exception on the record", () => {
		// "A literal hex is one theme's mistake waiting to ship"
		// (tests/changeDueWiring.spec.ts). The danger pair is the exception:
		// theme.css has no error BUTTON pair and register-tokens.css has no
		// `--reg-tone-danger-*` yet. Pinned at two so a third literal has to be
		// argued for rather than slipped in.
		const styles = SURFACES.map(read).join("");
		const literals = styles.match(/var\(--[a-z-]+, #[0-9a-fA-F]{3,8}\)/g) ?? [];
		expect(literals).toHaveLength(2);
		expect(literals.every((value) => value.includes("--reg-tone-danger"))).toBe(true);
	});
});
