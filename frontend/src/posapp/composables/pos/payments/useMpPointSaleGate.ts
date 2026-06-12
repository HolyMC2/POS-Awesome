// MP-INTEGRATION-POINT (sale checkout) — hard gate.
//
// Isolated MercadoPago module: blocks finalizing a POS *sale* until the
// MercadoPago Point terminal actually approves the charge. Will NOT be
// upstreamed — keep all MP logic in this file + MpPointSaleGateDialog.vue.
//
// Gating mirrors MPPointDialog.vue: reads frappe.boot.mercadopago.enabled +
// the active POS Profile mp_point_enabled. No-op (returns true) when the
// connector is off or the sale has no MercadoPago Point amount, so retail /
// mumu profiles see zero behavior change.
//
// Flow: validateSubmission() → ensureChargedBeforeFinalize() → submitInvoice().
// The terminal charge is keyed to the draft invoice name (external_reference),
// so the connector auto-matches the booked payment to this exact invoice.
import { reactive, onBeforeUnmount } from "vue";
import {
	createPointOrder,
	pointOrderStatus,
	cancelPointOrder,
	listEnabledTerminals,
} from "../../../services/mp_point";

declare const __: (_text: string, _args?: any[]) => string;
declare const frappe: any;

const POLL_MS = 2000;
const TIMEOUT_MS = 15 * 60 * 1000;

type Phase = "idle" | "sending" | "choosing" | "waiting" | "processing" | "approved" | "failed";

export interface MpTerminalOption {
	terminal_id: string;
	store_id?: string;
	pos_id?: string;
	operating_mode?: string;
}

export interface MpPointSaleGateState {
	open: boolean;
	phase: Phase;
	message: string;
	amount: number;
	currency: string;
	orderName: string | null;
	canOverride: boolean;
	terminals: MpTerminalOption[];
}

export interface MpPointSaleGateOptions {
	getInvoiceDoc: () => any;
	getPosProfile: () => any;
	isSupervisor: () => boolean;
}

export function useMpPointSaleGate(opts: MpPointSaleGateOptions) {
	const state = reactive<MpPointSaleGateState>({
		open: false,
		phase: "idle",
		message: "",
		amount: 0,
		currency: "",
		orderName: null,
		canOverride: false,
		terminals: [],
	});

	// Pending sale context while the cashier picks a terminal ("choosing").
	let pendingInvoice: string | null = null;
	let pendingAmount = 0;

	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let deadline = 0;
	let realtimeOff: (() => void) | null = null;
	let resolver: ((_ok: boolean) => void) | null = null;

	const pointMop = (): string =>
		frappe?.boot?.mercadopago?.point_mode_of_payment || "MercadoPago Point";

	const enabled = (): boolean => {
		const boot = frappe?.boot?.mercadopago;
		const prof = opts.getPosProfile();
		return !!(boot && boot.enabled && prof && Number(prof.mp_point_enabled) === 1);
	};

	// Sum of the MercadoPago Point payment rows on the current invoice. Returns
	// 0 for returns (negative amounts) or when the MoP isn't used.
	const pointAmountDue = (): number => {
		const doc = opts.getInvoiceDoc();
		if (!doc || !Array.isArray(doc.payments)) return 0;
		const name = pointMop();
		const sum = doc.payments
			.filter((p: any) => p?.mode_of_payment === name)
			.reduce((acc: number, p: any) => acc + (Number(p?.amount) || 0), 0);
		return sum > 0 ? sum : 0;
	};

	const stopPolling = (): void => {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
		if (typeof realtimeOff === "function") {
			realtimeOff();
			realtimeOff = null;
		}
	};

	const settle = (ok: boolean): void => {
		if (resolver) {
			const r = resolver;
			resolver = null;
			r(ok);
		}
	};

	// Device-level memory of the cashier's last pick, keyed by profile so two
	// cajas sharing a device but switching profiles don't cross terminals.
	const rememberKey = (): string => {
		const prof = opts.getPosProfile();
		return `posa_mp_terminal:${prof?.name || prof?.pos_profile || "?"}`;
	};

	// Terminal resolution priority:
	//   1. POS Profile default (mp_default_terminal_id) — manager-controlled
	//   2. last pick remembered on this device (still enabled)
	//   3. the only enabled terminal
	//   4. multiple candidates → cashier picks (phase "choosing")
	//   5. none / fetch error → undefined (server falls back to Settings default)
	const resolveTerminal = async (): Promise<{ id?: string; options?: MpTerminalOption[] }> => {
		let terminals: MpTerminalOption[] = [];
		try {
			const res = await listEnabledTerminals();
			if (Array.isArray(res)) terminals = res;
		} catch {
			return {}; // server-side Settings default takes over
		}
		if (!terminals.length) return {};

		const has = (id: string | null | undefined): boolean =>
			!!id && terminals.some((t) => t.terminal_id === id);

		const profDefault = opts.getPosProfile()?.mp_default_terminal_id;
		if (has(profDefault)) return { id: profDefault };

		if (terminals.length === 1) {
			const only = terminals[0];
			return only ? { id: only.terminal_id } : {};
		}

		let remembered: string | null = null;
		try {
			remembered = localStorage.getItem(rememberKey());
		} catch {
			/* storage unavailable — just ask */
		}
		if (has(remembered)) return { id: remembered as string };

		return { options: terminals };
	};

	const setPhase = (p: Phase, m: string): void => {
		state.phase = p;
		state.message = m;
	};

	// Terminal didn't approve — leave the modal open so the cashier can retry,
	// cancel, or (supervisor only) override. Does NOT settle the promise.
	const terminalFailed = (msg: string): void => {
		stopPolling();
		setPhase("failed", msg || __("No se completó el cobro"));
		state.canOverride = opts.isSupervisor();
	};

	const approve = (): void => {
		stopPolling();
		setPhase("approved", __("✅ Pago aprobado"));
		state.open = false;
		settle(true);
	};

	const schedulePoll = (): void => {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = setTimeout(poll, POLL_MS);
	};

	const poll = async (): Promise<void> => {
		if (!state.orderName || state.phase === "approved" || state.phase === "failed") return;
		if (Date.now() > deadline) {
			terminalFailed(__("Tiempo agotado — verifica la terminal"));
			return;
		}
		try {
			const st: any = await pointOrderStatus(state.orderName);
			const s = st && st.order_status;
			if (s === "processing") {
				setPhase("processing", __("Procesando…"));
			} else if (s === "created" || s === "at_terminal") {
				setPhase("waiting", __("Esperando que el cliente pague en la terminal…"));
			}
			if (s === "finished") {
				// The connector books the payment and auto-matches it (external_reference),
				// so by "finished" the payment may be "Reconciled" rather than just
				// "Approved". Both mean the money was taken.
				const ps = st.payment && st.payment.status;
				if (ps === "Approved" || ps === "Reconciled") {
					approve();
					return;
				}
				terminalFailed(__("La terminal no aprobó el pago"));
				return;
			}
			if (s === "expired" || s === "canceled" || s === "error") {
				terminalFailed((st && st.error) || __("No se completó el cobro"));
				return;
			}
			schedulePoll();
		} catch {
			// Transient — keep polling until the deadline.
			schedulePoll();
		}
	};

	const subscribeRealtime = (order: string): void => {
		// Optional latency optimisation — poll stays authoritative.
		try {
			const rt = frappe?.realtime;
			if (!rt || typeof rt.on !== "function") return;
			const handler = (data: any) => {
				if (data && data.order === order) void poll();
			};
			rt.on("mercadopago_order", handler);
			realtimeOff = () => {
				try {
					rt.off && rt.off("mercadopago_order", handler);
				} catch {
					/* ignore */
				}
			};
		} catch {
			/* realtime is best-effort */
		}
	};

	const dispatchToTerminal = async (
		pos_invoice: string,
		amount: number,
		terminal_id: string | undefined,
	): Promise<void> => {
		setPhase("sending", __("Enviando a la terminal…"));
		try {
			const invoice_doctype = opts.getInvoiceDoc()?.doctype || "Sales Invoice";
			const res: any = await createPointOrder({ pos_invoice, amount, terminal_id, invoice_doctype });
			if (!res || !res.ok || !res.order || !res.order.name) {
				terminalFailed((res && res.order && res.order.error_message) || __("No se pudo enviar a la terminal"));
				return;
			}
			state.orderName = res.order.name;
			deadline = Date.now() + TIMEOUT_MS;
			setPhase("waiting", __("Esperando que el cliente pague en la terminal…"));
			subscribeRealtime(res.order.name);
			schedulePoll();
		} catch (e: any) {
			terminalFailed((e && e.message) || __("Error de conexión"));
		}
	};

	const start = async (pos_invoice: string, amount: number): Promise<void> => {
		state.open = true;
		state.canOverride = false;
		state.orderName = null;
		state.terminals = [];
		pendingInvoice = pos_invoice;
		pendingAmount = amount;
		setPhase("sending", __("Enviando a la terminal…"));
		const resolved = await resolveTerminal();
		if (resolved.options && resolved.options.length) {
			// Multiple enabled terminals, no default — cashier picks once;
			// the choice is remembered on this device (per profile).
			state.terminals = resolved.options;
			setPhase("choosing", __("Elige la terminal para cobrar"));
			return;
		}
		await dispatchToTerminal(pos_invoice, amount, resolved.id);
	};

	// Dialog action for the "choosing" phase.
	function chooseTerminal(terminal_id: string): void {
		if (!pendingInvoice || state.phase !== "choosing") return;
		try {
			localStorage.setItem(rememberKey(), terminal_id);
		} catch {
			/* storage unavailable — choice just won't stick */
		}
		state.terminals = [];
		void dispatchToTerminal(pendingInvoice, pendingAmount, terminal_id);
	}

	// PUBLIC: call from the finalize path. Resolves true when it's safe to
	// finalize the sale (terminal approved, nothing to charge, or supervisor
	// override), false when the cashier cancelled.
	async function ensureChargedBeforeFinalize(): Promise<boolean> {
		if (!enabled()) return true;
		const due = pointAmountDue();
		if (due <= 0) return true;

		const doc = opts.getInvoiceDoc();
		const pos_invoice = doc?.name;
		if (!pos_invoice) {
			// No saved draft name → the connector can't auto-match. Match the
			// existing MPPointDialog behaviour: tell the cashier to save first.
			frappe.msgprint(__("Guarda la venta antes de cobrar en la terminal"));
			return false;
		}

		state.amount = due;
		state.currency = doc?.currency || "";
		return new Promise<boolean>((resolve) => {
			resolver = resolve;
			void start(pos_invoice, due);
		});
	}

	// Dialog actions ────────────────────────────────────────────────
	function retry(): void {
		const doc = opts.getInvoiceDoc();
		const pos_invoice = doc?.name;
		if (!pos_invoice) return;
		const old = state.orderName;
		if (old) void cancelPointOrder(old).catch(() => {});
		void start(pos_invoice, state.amount);
	}

	async function cancel(): Promise<void> {
		const old = state.orderName;
		if (old) {
			try {
				await cancelPointOrder(old);
			} catch {
				/* ignore — abort the sale regardless */
			}
		}
		stopPolling();
		state.open = false;
		setPhase("idle", "");
		settle(false);
	}

	// Supervisor-only escape hatch (terminal offline / already charged on the
	// device). Stamps the invoice so the override is auditable.
	function override(): void {
		if (!opts.isSupervisor()) return;
		const doc = opts.getInvoiceDoc();
		if (doc) {
			const who = frappe?.session?.user || "?";
			const stamp = __("[MP-OVERRIDE] Terminal sin confirmar — autorizado por {0}", [who]);
			doc.remarks = doc.remarks ? `${doc.remarks}\n${stamp}` : stamp;
			// Server-side audit row (Comment on the invoice timeline). The
			// remarks stamp above is client-editable after the fact; the
			// Comment is server-stamped (user + time). Fire-and-forget —
			// the sale must never block on audit plumbing.
			try {
				frappe.call({
					method: "posawesome.posawesome.api.mp_audit.log_mp_override",
					args: {
						invoice_name: doc.name || null,
						doctype: doc.doctype || "Sales Invoice",
					},
					freeze: false,
				});
			} catch {
				/* never block the sale on audit */
			}
		}
		stopPolling();
		state.open = false;
		setPhase("idle", "");
		settle(true);
	}

	// If the payment screen unmounts mid-gate, stop polling and unblock the
	// awaiting finalize (abandon = treat as cancel) so nothing leaks or hangs.
	onBeforeUnmount(() => {
		stopPolling();
		settle(false);
	});

	return {
		state,
		enabled,
		pointAmountDue,
		ensureChargedBeforeFinalize,
		retry,
		cancel,
		override,
		chooseTerminal,
	};
}
