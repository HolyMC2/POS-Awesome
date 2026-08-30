import { ref, getCurrentInstance, inject } from "vue";
import { useToastStore } from "../../../stores/toastStore.js";
import { useUIStore } from "../../../stores/uiStore.js";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import {
	initPromise,
	checkDbHealth,
	getOpeningStorage,
	setOpeningStorage,
	clearOpeningStorage,
	setTaxTemplate,
	isOffline,
	getPendingOfflineInvoiceCount,
	getBootstrapSnapshot,
	setBootstrapSnapshot,
} from "../../../../offline/index";
import { getValidCachedOpeningForCurrentUser } from "../../../utils/openingCache";
import { resolveStaleShiftNotice } from "../../../components/pos/shift/staleShiftNotice";
import { createBootstrapSnapshotFromRegisterData } from "../../../../offline/bootstrapSnapshot";
import { debugLog } from "../../../utils/debug";

declare const __BUILD_VERSION__: string;
declare const frappe: any;

type SkippedPrintedInvoice = {
	invoice?: string;
	doctype?: string;
	return_against?: string;
	reason?: string;
};

type PendingDraftInvoice = {
	name?: string;
	owner?: string;
	grand_total?: number;
};

type ClosingShiftPreparationResponse = {
	closing_shift?: any;
	skipped_printed_invoices?: SkippedPrintedInvoice[];
	pending_drafts?: PendingDraftInvoice[];
	drafts_will_be_deleted?: boolean;
};

const translateMessage = (value: string) => (typeof window !== "undefined" && window.__
	? window.__(value)
	: value);

export function buildSkippedClosingInvoicesPrompt(
	skippedInvoices: SkippedPrintedInvoice[],
) {
	const saldoInvoices = skippedInvoices.filter((i) => i?.reason === "saldo_unconfirmed");
	// Everything else is a cancelled-return skip (legacy entries have no reason).
	const returnInvoices = skippedInvoices.filter((i) => i?.reason !== "saldo_unconfirmed");

	const fmtNames = (list: SkippedPrintedInvoice[], withReturnAgainst: boolean) =>
		list
			.slice(0, 5)
			.map((invoice) => {
				const invoiceName = invoice?.invoice || translateMessage("Unknown invoice");
				const returnAgainst = withReturnAgainst ? invoice?.return_against : undefined;
				return returnAgainst
					? `${invoiceName} (${translateMessage("Return Against")}: ${returnAgainst})`
					: invoiceName;
			})
			.join(", ");

	const lines: string[] = [];

	if (returnInvoices.length) {
		const count = returnInvoices.length;
		// Keep the translatable part static (count prefixed) so the es-MX row matches.
		lines.push(
			count === 1
				? translateMessage("1 printed return invoice references a cancelled invoice and will be excluded from closing.")
				: `${count} ${translateMessage("printed return invoices reference cancelled invoices and will be excluded from closing.")}`,
		);
		const details = fmtNames(returnInvoices, true);
		if (details) {
			lines.push(`${translateMessage("Invoices")}: ${details}.`);
		}
	}

	if (saldoInvoices.length) {
		const count = saldoInvoices.length;
		lines.push(
			count === 1
				? translateMessage("1 held recarga (Saldo) sale has no TAECEL confirmation and will be excluded from closing.")
				: `${count} ${translateMessage("held recarga (Saldo) sales have no TAECEL confirmation and will be excluded from closing.")}`,
		);
		const details = fmtNames(saldoInvoices, false);
		if (details) {
			lines.push(`${translateMessage("Invoices")}: ${details}.`);
		}
	}

	lines.push(translateMessage("The skipped invoice will remain a draft."));
	lines.push(translateMessage("Do you want to proceed?"));

	return lines.filter(Boolean).join(" ");
}

export function buildPendingDraftsPrompt(
	pendingDrafts: PendingDraftInvoice[],
) {
	const count = pendingDrafts.length;
	// Keep the translatable part static (count prefixed) so the es-MX row
	// matches — same reason the skipped-invoices prompt has a singular row.
	const baseMessage = count === 1
		? translateMessage("1 draft invoice on this shift will be DELETED when the shift closes.")
		: `${count} ${translateMessage("draft invoices on this shift will be DELETED when the shift closes.")}`;
	const details = pendingDrafts
		.slice(0, 5)
		.map((draft) => {
			const name = draft?.name || translateMessage("Unknown invoice");
			return draft?.owner ? `${name} (${draft.owner})` : name;
		})
		.join(", ");
	const detailMessage = details
		? `${translateMessage("Invoices")}: ${details}${count > 5 ? "…" : "."}`
		: "";
	return [
		baseMessage,
		detailMessage,
		translateMessage("Do you want to proceed?"),
	]
		.filter(Boolean)
		.join(" ");
}

function normalizeClosingShiftPreparationResponse(
	payload: any,
): ClosingShiftPreparationResponse {
	if (payload?.closing_shift || payload?.skipped_printed_invoices) {
		return payload;
	}

	return {
		closing_shift: payload,
		skipped_printed_invoices: [],
	};
}

export function usePosShift(openDialog?: () => void) {
	const instance = getCurrentInstance();
	const proxy: any = instance?.proxy;
	const eventBus: any = proxy?.eventBus || inject("eventBus");
	const buildVersion =
		typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : null;
	const toastStore = useToastStore();
	const uiStore = useUIStore();

	const pos_profile = ref<any>(null);
	const pos_opening_shift = ref<any>(null);
	// E4: an enforced stale shift INSISTS (the shell renders a sticky banner
	// with the corte action) instead of seizing the screen. The server blocks
	// sales into a stale shift either way, so nothing needs the hostage.
	const staleShiftEnforced = ref(false);

	function applyRegisterData(data: any) {
		if (!data) {
			return;
		}
		pos_profile.value = data.pos_profile;
		pos_opening_shift.value = data.pos_opening_shift;
		uiStore.setRegisterData(data);
		setBootstrapSnapshot(
			createBootstrapSnapshotFromRegisterData(
				data,
				getBootstrapSnapshot(),
				{ buildVersion },
			),
		);

		try {
			frappe.realtime.emit("pos_profile_registered");
		} catch (e) {
			console.warn("Realtime emit failed", e);
		}
	}

	async function check_opening_entry() {
		await initPromise;
		await checkDbHealth();
		const cachedOpening = getValidCachedOpeningForCurrentUser(
			getOpeningStorage(),
			frappe?.session?.user,
		);
		if (cachedOpening) {
			applyRegisterData(cachedOpening);
			console.info("LoadPosProfile (bootstrapped from cache)");
		}
		return frappe
			.call("posawesome.posawesome.api.shifts.check_opening_shift", {
				user: frappe.session.user,
			})
			.then((r: any) => {
				if (r.message) {
					applyRegisterData(r.message);
					if (pos_profile.value.taxes_and_charges) {
						frappe.call({
							method: "frappe.client.get",
							args: {
								doctype: "Sales Taxes and Charges Template",
								name: pos_profile.value.taxes_and_charges,
							},
							callback: (res: any) => {
								if (res.message) {
									setTaxTemplate(
										pos_profile.value.taxes_and_charges,
										res.message,
									);
								}
							},
						});
					}
					console.info("LoadPosProfile");
					try {
						setOpeningStorage(r.message);
					} catch (e) {
						console.error("Failed to cache opening data", e);
					}
					// Shift opened on a previous day: never adopt it silently.
					// Warn always; when the profile enforces closure, INSIST
					// (sticky banner in the shell with the corte action) — the
					// old auto-open of the fullscreen corte was critique E4's
					// hostage-taking, and the contract module can no longer
					// express it. The server blocks submits into a stale shift
					// regardless, so the operator dismissing the banner risks
					// nothing but a refused sale.
					const notice = resolveStaleShiftNotice(
						!!r.message.stale_shift,
						!!r.message.force_close_stale_shift,
					);
					staleShiftEnforced.value = !!notice?.insist;
					if (notice) {
						toastStore.show({
							title: __(notice.titleKey),
							message: __(notice.messageKey),
							color: notice.tone,
							timeout: 0,
						});
					}
				} else {
					console.info("No opening shift found, opening dialog");
					staleShiftEnforced.value = false;
					clearOpeningStorage();
					openDialog && openDialog();
				}
			})
			.catch((err: unknown) => {
				console.error("Error checking opening entry", err);
				const data = cachedOpening ||
					getValidCachedOpeningForCurrentUser(
						getOpeningStorage(),
						frappe?.session?.user,
					);
				if (data) {
					applyRegisterData(data);
					console.info("LoadPosProfile (cached)");
					return;
				}
				if (!isOffline()) {
					clearOpeningStorage();
				}
				openDialog && openDialog();
			});
	}

	function get_closing_data() {
		const cachedOpeningShift = (getOpeningStorage() as any)
			?.pos_opening_shift;
		const resolvedShift =
			uiStore.posOpeningShift ||
			pos_opening_shift.value ||
			cachedOpeningShift ||
			null;
		if (!resolvedShift) {
			// Words, not silence (2026-08-25): a refused close with no reason
			// reads as a dead button — the movil roast's audit found exactly
			// this shape swallowing a press with nothing on screen.
			toastStore.show({
				title: typeof (window as any)?.__ === "function" ? (window as any).__("No open shift") : "No open shift",
				message:
					typeof (window as any)?.__ === "function"
						? (window as any).__("There is no open shift on this register to close.")
						: "There is no open shift on this register to close.",
				color: "warning",
			});
			return Promise.resolve();
		}

		// Unsynced offline sales belong in THIS shift's corte. Closing now
		// omits them from the totals, and the server rejects a post into a
		// closed shift (assert_shift_not_stale) — so they would dead-letter.
		// Block the close until the queue drains. `__` is a Frappe global; guard
		// it so the composable stays unit-testable.
		const _t = (s: string): string =>
			typeof (window as any)?.__ === "function" ? (window as any).__(s) : s;
		const pendingOffline = getPendingOfflineInvoiceCount();
		if (pendingOffline > 0) {
			toastStore.show({
				title: _t("Unsynced sales pending"),
				message: `${_t("Cannot close: offline sales not yet synced")}: ${pendingOffline}. ${_t("Wait for sync (or resolve them in Facturas Offline) first.")}`,
				color: "warning",
			});
			return Promise.resolve();
		}
		if (isOffline()) {
			toastStore.show({
				title: _t("Offline — cannot close shift"),
				message: _t(
					"Reconnect before closing so every sale is accounted for.",
				),
				color: "warning",
			});
			return Promise.resolve();
		}

		return frappe
			.call(
				"posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.make_closing_shift_from_opening",
				{ opening_shift: resolvedShift },
			)
			.then((r: any) => {
				if (r.message) {
					const response = normalizeClosingShiftPreparationResponse(r.message);
					const closingShift = response.closing_shift;
					const skippedPrintedInvoices = Array.isArray(response.skipped_printed_invoices)
						? response.skipped_printed_invoices
						: [];
					const pendingDrafts = Array.isArray(response.pending_drafts)
						? response.pending_drafts
						: [];
					if (!closingShift) {
						// Same rule: the server answered but carried no closing
						// draft — say so instead of eating the press.
						toastStore.show({
							title:
								typeof (window as any)?.__ === "function"
									? (window as any).__("Could not prepare closing")
									: "Could not prepare closing",
							message:
								typeof (window as any)?.__ === "function"
									? (window as any).__("The server returned no closing draft for this shift — try again.")
									: "The server returned no closing draft for this shift — try again.",
							color: "error",
						});
						return;
					}

					if (skippedPrintedInvoices.length) {
						const confirmed = window.confirm(
							buildSkippedClosingInvoicesPrompt(skippedPrintedInvoices),
						);
						if (!confirmed) {
							return;
						}
					}

					if (pendingDrafts.length) {
						if (response.drafts_will_be_deleted) {
							// Profile purges drafts at close — make that explicit
							// and let the closer back out.
							const confirmed = window.confirm(
								buildPendingDraftsPrompt(pendingDrafts),
							);
							if (!confirmed) {
								return;
							}
						} else {
							// Closing would throw server-side (stranded drafts).
							// Stop here with the actionable list instead of
							// letting the submit fail later.
							const details = pendingDrafts
								.slice(0, 5)
								.map((d) => (d?.owner ? `${d?.name} (${d.owner})` : d?.name))
								.join(", ");
							toastStore.show({
								title: __("Draft invoices block closing"),
								message: `${__("Submit or delete these drafts first — a supervisor can see them in Invoice Management:")} ${details}${pendingDrafts.length > 5 ? "…" : ""}`,
								color: "error",
								timeout: 0,
							});
							return;
						}
					}

					eventBus?.emit("open_ClosingDialog", closingShift);
				}
			})
			.catch((err: unknown) => {
				// make_closing_shift_from_opening submits the shift's printed
				// draft invoices; a server-side validate throw (e.g. "Valuation
				// Rate missing for Item …") rejected here unhandled, so the
				// operator only saw "Uncaught (in promise) Error: HTTP 417" in
				// the console and no on-screen reason. Surface the real message
				// (the shim now carries Frappe's _server_messages text).
				const anyErr = err as any;
				let message =
					anyErr?.serverMessage ||
					anyErr?.message ||
					anyErr?.exc ||
					String(err) ||
					translateMessage("Could not prepare closing shift.");
				message = String(message).replace(/<[^>]+>/g, "").trim();
				console.error("Error preparing closing shift", err);
				toastStore.show({
					title: translateMessage("Could not close shift"),
					message,
					color: "error",
					timeout: 12000,
				});
			});
	}

	function submit_closing_pos(data: any) {
		debugLog("Submitting closing shift", data);
		const closeStartedAt = Date.now();
		// Capture the active profile before we null it below so the
		// closing-ticket print can still reach the configured printer
		// + format. After clear, `pos_profile.value` flips to null and
		// the QZ helper would lose `posa_qz_printer_name` /
		// `posa_closing_shift_print_format`.
		const activeProfile = pos_profile.value as any;
		frappe
			.call(
				"posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.submit_closing_shift",
				{
					closing_shift: JSON.stringify(data),
				},
			)
			.then((r: any) => {
				debugLog("Submit result", r);
				// SPEC C: corte friction — server round-trip of the close.
				import("../../../utils/telemetry")
					.then(({ track }) =>
						track("pos:shift_close_ms", Date.now() - closeStartedAt, {
							payments: (data?.payment_reconciliation || []).length,
						}),
					)
					.catch(() => {});
				if (r.message) {
					// Auto-print the cierre-de-caja ticket BEFORE the
					// state-clear runs. Fire-and-forget — print failure
					// must not block the close (the doc is already
					// submitted in the DB). Operator can re-print from
					// Desk if QZ Tray was down.
					const closingShiftName = r.message;
					const printFormat = activeProfile?.posa_closing_shift_print_format;
					if (printFormat && closingShiftName) {
						// Dynamic import keeps qzTray out of the
						// non-print hot path (its bundle pulls
						// signing crypto + ESC/POS helpers).
						import("../../../services/qzTray")
							.then(({ printDocumentViaQz }) =>
								printDocumentViaQz({
									doctype: "POS Closing Shift",
									name: closingShiftName,
									printFormat,
									letterhead: activeProfile?.letter_head || null,
									noLetterhead: activeProfile?.letter_head ? "0" : "1",
									printerName:
										activeProfile?.posa_qz_printer_name || undefined,
								}),
							)
							.catch((err) => {
								console.warn(
									"[POSA] Closing-shift auto-print failed:",
									err,
								);
								toastStore.show({
									title: translateMessage("Close-shift ticket print failed"),
									message:
										translateMessage("Shift was closed correctly. Re-print from Desk if needed."),
									color: "warning",
									timeout: 8000,
								});
							});
					}
					pos_profile.value = null;
					pos_opening_shift.value = null;
					uiStore.posOpeningShift = null;
					staleShiftEnforced.value = false;
					clearOpeningStorage();
					useInvoiceStore().clear();
					toastStore.show({
						title: translateMessage("POS Shift Closed"),
						color: "success",
					});
					check_opening_entry();
				}
			})
			.catch((err: unknown) => {
				console.error("Failed to submit closing shift", err);
				// Surface the Frappe error to the operator. Without this
				// the close-shift button silently no-ops, leaving the
				// operator confused — e.g. ERPNext throws
				// "missing valuation rate for items …" but until this
				// catch wired the toast, the error only landed in the
				// browser console + bench error log. Closing the shift
				// is a quasi-financial event; silent failure is the
				// worst possible UX.
				const anyErr = err as any;
				let message = "";
				// Frappe puts user-facing exception messages in
				// `_server_messages` (JSON-encoded array of objects).
				const sm = anyErr?._server_messages || anyErr?.responseJSON?._server_messages;
				if (sm) {
					try {
						const parsed = JSON.parse(sm);
						if (Array.isArray(parsed) && parsed.length) {
							const first = parsed[0];
							const obj = typeof first === "string" ? JSON.parse(first) : first;
							message = obj?.message || obj?.title || String(first);
						}
					} catch {
						message = String(sm);
					}
				}
				if (!message) {
					message = anyErr?.message || anyErr?.exc || String(err) || translateMessage("Close-shift failed.");
				}
				// Strip HTML — Frappe throws sometimes include <strong>/
				// <br/> markup that toastStore renders as plain text.
				message = message.replace(/<[^>]+>/g, "").trim();
				toastStore.show({
					title: translateMessage("Could not close shift"),
					message,
					color: "error",
					timeout: 12000,
				});
			});
	}

	return {
		pos_profile,
		pos_opening_shift,
		staleShiftEnforced,
		check_opening_entry,
		get_closing_data,
		submit_closing_pos,
	};
}
