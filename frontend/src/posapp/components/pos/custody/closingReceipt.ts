import { printClosingEvidence } from "./api";

const __ = (text: string) => (window as any).__?.(text) || text;

/** Read-only continuation after a confirmed close, independent of opening the next shift. */
export function showClosingBagReceipt(closing: string) {
	const dialog = document.createElement("dialog");
	dialog.className = "cash-bag-receipt";
	dialog.setAttribute("aria-label", __("Closing bags"));
	dialog.innerHTML = `<style>
 .cash-bag-receipt{width:min(520px,calc(100vw - 24px));max-height:calc(100dvh - 32px);box-sizing:border-box;overflow:auto;margin:auto;padding:24px;border:1px solid var(--border-color,#ccc);border-radius:14px;background:var(--fg-color,#fff);color:var(--text-color,#222);font:14px/1.5 system-ui}
 .cash-bag-receipt::backdrop{background:#0007}.cash-bag-receipt h2{margin:0 0 8px;font-size:20px}.cash-bag-receipt ul{padding:0;list-style:none}.cash-bag-receipt li{padding:12px 0;border-bottom:1px solid var(--border-color,#ddd);overflow-wrap:anywhere}.cash-bag-receipt strong{display:block;font-size:17px}.cash-bag-receipt small{display:block}.cash-bag-receipt select{box-sizing:border-box;width:100%;padding:10px;background:var(--control-bg,#f4f4f4);color:inherit;border:1px solid var(--border-color,#ccc);border-radius:6px}.cash-bag-receipt footer{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.cash-bag-receipt button{min-height:44px;padding:10px 16px;border:1px solid var(--border-color,#ccc);border-radius:8px;background:var(--control-bg,#eee);color:inherit;font:inherit;cursor:pointer}.cash-bag-receipt button:disabled{opacity:.5}.cash-bag-receipt [data-error]{color:var(--red-600,#b42318)}.cash-bag-receipt a{color:inherit;text-decoration:underline}.cash-bag-receipt :focus-visible{outline:2px solid #4686db;outline-offset:2px}
 </style><h2></h2><p data-message></p><a data-closing target="_blank" rel="noopener"></a><ul data-bags></ul><p data-error role="alert"></p><button data-retry hidden type="button"></button><label><span data-format></span><select data-layout></select></label><footer><button data-print disabled type="button"></button><button data-done type="button"></button></footer>`;
	const el = <T extends HTMLElement>(selector: string) =>
		dialog.querySelector<T>(selector)!;
	el("h2").textContent = __("Shift closed. Label the bags.");
	el("[data-message]").textContent = __(
		"Print one slip per bag, or copy its folio, amount, date and shift onto paper. Attach it to the matching bag.",
	);
	const link = el<HTMLAnchorElement>("[data-closing]");
	link.textContent = closing;
	link.href = "/app/pos-closing-shift/" + encodeURIComponent(closing);
	el("[data-format]").textContent = __("Paper format");
	const select = el<HTMLSelectElement>("[data-layout]");
	(
		[
			["ticket", "80 mm receipt"],
			["label", "100 × 76 mm label"],
			["slip", "Handover sheet"],
		] as const
	).forEach(([value, label]) => {
		select.add(new Option(__(label), value));
	});
	const print = el<HTMLButtonElement>("[data-print]");
	print.textContent = __("Print bag labels");
	const retry = el<HTMLButtonElement>("[data-retry]");
	retry.textContent = __("Retry");
	el("[data-done]").textContent = __("Continue");
	el("[data-done]").onclick = () => dialog.close();
	dialog.addEventListener("close", () => dialog.remove(), { once: true });
	async function load() {
		retry.hidden = true;
		el("[data-error]").textContent = "";
		try {
			const response = await (window as any).frappe.call({
				method: "posawesome.posawesome.api.cash_custody.printing.closing_bags",
				args: { closing_shift: closing },
			});
			if (!dialog.isConnected) return;
			const rows = response.message;
			if (!Array.isArray(rows)) throw new Error();
			el("[data-bags]").replaceChildren();
			rows.forEach((bag: any) => {
				const row = document.createElement("li"),
					title = document.createElement("strong"),
					details = document.createElement("small");
				title.textContent =
					bag.seal +
					" · " +
					new Intl.NumberFormat(undefined, {
						style: "currency",
						currency: bag.currency,
					}).format(bag.amount);
				details.textContent = [
					bag.purpose,
					bag.state,
					bag.prepared_by,
					bag.prepared_on,
				].join(" · ");
				row.append(title, details);
				el("[data-bags]").appendChild(row);
			});
			print.disabled = !rows.length;
			if (!rows.length)
				el("[data-message]").textContent = __(
					"This closing has no bags to print.",
				);
		} catch {
			if (!dialog.isConnected) return;
			el("[data-error]").textContent = __(
				"The shift is closed. Its bag labels could not be loaded. Retry here or print them from the closing record.",
			);
			retry.hidden = false;
		}
	}
	print.onclick = async () => {
		print.disabled = true;
		el("[data-error]").textContent = "";
		try {
			await printClosingEvidence(closing, select.value);
		} catch {
			el("[data-error]").textContent = __(
				"The shift is closed. Printing failed; allow pop-ups and retry, or copy the bag details onto paper.",
			);
		} finally {
			print.disabled = false;
		}
	};
	retry.onclick = load;
	document.body.appendChild(dialog);
	dialog.showModal();
	void load();
}
