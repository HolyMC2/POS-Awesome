// MP-INTEGRATION-POINT — the modal's phase must follow the terminal OUTCOME.
//
// Prod 2026-09-08 (Doco Ventas, Newland N950): the customer typed a wrong PIN,
// the terminal went back to idle, and the POS sat on "Esperando que el cliente
// pague en la terminal…" with only «Cancelar venta» — no «Reintentar», so the
// charge could not be re-sent. The connector now reports the decline as `error`
// (+ reason); this pins the gate's side: an outcome status, known or not, must
// leave the "waiting" phase and offer the retry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({
	createPointOrder: vi.fn(),
	pointOrderStatus: vi.fn(),
	cancelPointOrder: vi.fn(async () => ({ ok: true })),
	listEnabledTerminals: vi.fn(async () => [{ terminal_id: "TERM1" }]),
}));
vi.mock("../src/posapp/services/mp_point", () => svc);

import { useMpPointSaleGate } from "../src/posapp/composables/pos/payments/useMpPointSaleGate";

function makeGate() {
	const doc = {
		name: "ACC-SINV-2026-03224",
		doctype: "Sales Invoice",
		currency: "MXN",
		payments: [{ mode_of_payment: "MercadoPago Point", amount: 5100 }],
	};
	return useMpPointSaleGate({
		getInvoiceDoc: () => doc,
		getPosProfile: () => ({ name: "Doco Ventas", mp_point_enabled: 1, mp_default_terminal_id: "TERM1" }),
		isSupervisor: () => false,
	});
}

// Let the start() → resolveTerminal() → createPointOrder() promise chain settle.
async function settle() {
	for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0);
}

// Feed the poll a sequence of status replies (last one repeats) and tick the
// 2s poll timer once per reply.
async function startAndPoll(replies: any[]) {
	const gate = makeGate();
	let i = 0;
	svc.pointOrderStatus.mockImplementation(async () => replies[Math.min(i++, replies.length - 1)]);
	const finalize = gate.ensureChargedBeforeFinalize();
	await settle();
	for (let k = 0; k < replies.length; k++) await vi.advanceTimersByTimeAsync(2000);
	return { gate, finalize };
}

describe("useMpPointSaleGate — terminal outcome drives the modal phase", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		(globalThis as any).__ = (s: string) => s;
		(globalThis as any).frappe = {
			boot: { mercadopago: { enabled: 1 } },
			msgprint: vi.fn(),
			session: { user: "cajero@doco" },
		};
		svc.createPointOrder.mockReset().mockResolvedValue({ ok: true, order: { name: "MPO-2026-000061", order_status: "created" } });
		svc.pointOrderStatus.mockReset();
		svc.cancelPointOrder.mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps waiting while the order is still at the terminal", async () => {
		const { gate } = await startAndPoll([
			{ order_status: "created", error: null, payment: null },
			{ order_status: "at_terminal", error: null, payment: null },
		]);
		expect(gate.state.phase).toBe("waiting");
		expect(gate.state.open).toBe(true);
		expect(svc.pointOrderStatus).toHaveBeenCalledTimes(2);
	});

	it("declined card → failed phase with the connector's reason, retry re-pushes a new order", async () => {
		const { gate } = await startAndPoll([
			{ order_status: "at_terminal", error: null, payment: null },
			{ order_status: "error", error: "Pago rechazado en la terminal (rejected_by_issuer)", payment: null },
		]);
		expect(gate.state.phase).toBe("failed");
		expect(gate.state.message).toBe("Pago rechazado en la terminal (rejected_by_issuer)");
		// Polling stopped on the outcome — no further status calls.
		await vi.advanceTimersByTimeAsync(4000);
		expect(svc.pointOrderStatus).toHaveBeenCalledTimes(2);

		gate.retry();
		await settle();
		expect(svc.cancelPointOrder).toHaveBeenCalledWith("MPO-2026-000061");
		expect(svc.createPointOrder).toHaveBeenCalledTimes(2);
		expect(gate.state.phase).toBe("waiting");
	});

	it("an unknown outcome status is not mistaken for 'still waiting'", async () => {
		const { gate } = await startAndPoll([{ order_status: "refunded", error: null, payment: null }]);
		expect(gate.state.phase).toBe("failed");
		expect(gate.state.message).toBe("No se completó el cobro");
	});

	it("finished + Approved approves and unblocks finalize", async () => {
		const { gate, finalize } = await startAndPoll([
			{ order_status: "finished", error: null, payment: { status: "Approved", amount_gross: 5100 } },
		]);
		expect(gate.state.phase).toBe("approved");
		expect(gate.state.open).toBe(false);
		await expect(finalize).resolves.toBe(true);
	});
});
