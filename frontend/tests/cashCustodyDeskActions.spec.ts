// @vitest-environment jsdom
// Desk custody controller (posawesome/public/js/cash_custody.js): action-specific
// dialogs, retry that preserves the request ID, and a summary that never stacks
// or injects operator text. The real file is executed here, not a copy.
// `node:fs` named imports do not interop under jsdom here, so the controller
// source is pulled in as text by Vite instead.
import SOURCE from "../../posawesome/public/js/cash_custody.js?raw";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Minimal jQuery surface: only what the controller uses. */
function jq(target: any): any {
	let nodes: Element[] = [];
	if (target instanceof Element) nodes = [target];
	else if (Array.isArray(target)) nodes = target.filter(Boolean);
	else if (typeof target === "string")
		nodes = Array.from(document.querySelectorAll(target));
	else if (target && target.nodes) nodes = target.nodes;
	else if (target === document.body) nodes = [document.body];
	return {
		nodes,
		get length() {
			return nodes.length;
		},
		find(selector: string) {
			const found: Element[] = [];
			nodes.forEach((node) =>
				found.push(...Array.from(node.querySelectorAll(selector))),
			);
			return jq(found);
		},
		each(fn: any) {
			nodes.forEach((node, index) => fn.call(node, index, node));
			return this;
		},
		closest(selector: string) {
			return jq(
				nodes
					.map((node) => node.closest(selector))
					.filter(Boolean) as Element[],
			);
		},
		remove() {
			nodes.forEach((node) => node.remove());
			return this;
		},
		html(value?: string) {
			if (value === undefined) return nodes[0] ? nodes[0].innerHTML : "";
			nodes.forEach((node) => (node.innerHTML = value));
			return this;
		},
		text(value?: string) {
			if (value === undefined)
				return nodes[0] ? nodes[0].textContent : "";
			nodes.forEach((node) => (node.textContent = value));
			return this;
		},
		addClass(names: string) {
			nodes.forEach((node) =>
				node.classList.add(...names.split(" ").filter(Boolean)),
			);
			return this;
		},
		on() {
			return this;
		},
	};
}

class FakeDialog {
	title: string;
	fields: any[];
	fields_dict: Record<string, any> = {};
	values: Record<string, any> = {};
	primary_action: any;
	primary_label: string;
	$wrapper = jq(document.createElement("div"));
	visible = false;
	enabled = true;

	constructor(options: any) {
		this.title = options.title;
		this.fields = options.fields;
		this.primary_action = options.primary_action;
		this.primary_label = options.primary_action_label;
		options.fields.forEach((df: any) => {
			if (!df.fieldname) return;
			this.fields_dict[df.fieldname] = {
				df,
				$wrapper: jq(document.createElement("div")),
			};
			if (df.default !== undefined)
				this.values[df.fieldname] = df.default;
		});
		(FakeDialog as any).last = this;
	}
	get_value(fieldname: string) {
		return this.values[fieldname];
	}
	set_value(fieldname: string, value: any) {
		this.values[fieldname] = value;
	}
	get_values() {
		const missing = this.fields.filter(
			(df: any) => df.fieldname && df.reqd && !this.values[df.fieldname],
		);
		// Frappe returns null and highlights the field instead of submitting.
		return missing.length ? null : { ...this.values };
	}
	set_df_property(fieldname: string, property: string, value: any) {
		const field = this.fields_dict[fieldname];
		if (field) field.df[property] = value;
		const df = this.fields.find(
			(entry: any) => entry.fieldname === fieldname,
		);
		if (df) df[property] = value;
	}
	show() {
		this.visible = true;
	}
	hide() {
		this.visible = false;
	}
	disable_primary_action() {
		this.enabled = false;
	}
	enable_primary_action() {
		this.enabled = true;
	}
	get_primary_btn() {
		return { text: (label: string) => (this.primary_label = label) };
	}
	feedbackText() {
		return this.fields_dict.feedback.$wrapper.html();
	}
}

const call = vi.fn();
const getList = vi.fn();
let dashboard: HTMLElement;

function makeForm(doc: any) {
	return {
		doc,
		is_new: () => false,
		set_df_property: vi.fn(),
		reload_doc: vi.fn().mockResolvedValue(undefined),
		page: { set_indicator: vi.fn(), wrapper: document.body },
		dashboard: {
			wrapper: dashboard,
			add_section(
				html: string,
				label: string,
				cssClass = "form-dashboard-section",
			) {
				const section = document.createElement("div");
				section.className = cssClass;
				section.innerHTML = `<h6>${label}</h6>${html}`;
				dashboard.appendChild(section);
				return jq(section);
			},
		},
	} as any;
}

const BAG = {
	doctype: "POS Cash Bag",
	name: "CASH-BAG-00014",
	pos_profile: "QA",
	currency: "MXN",
	seal: "QA-SEAL-1",
	purpose: "Float",
	state: "Unverified",
	amount: 900,
	prepared_by: "ana@example.com",
	count_json: JSON.stringify({
		denominations: [{ value: 100, quantity: 9 }],
		source: "denominations",
	}),
};

beforeEach(() => {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	dashboard = document.createElement("div");
	document.body.appendChild(dashboard);
	localStorage.clear();
	call.mockReset();
	getList.mockReset().mockResolvedValue([]);
	const globals = globalThis as any;
	globals.$ = jq;
	globals.__ = (message: string) => message;
	globals.flt = (value: any) => Number(value) || 0;
	globals.cint = (value: any) => parseInt(value, 10) || 0;
	globals.format_currency = (value: any, currency: string) =>
		`$ ${(Number(value) || 0).toFixed(2)} ${currency || ""}`.trim();
	globals.frappe = {
		session: { user: "beto@example.com" },
		user: { has_role: (role: string) => role === "POS Awesome Supervisor" },
		utils: {
			escape_html: (value: string) =>
				String(value).replace(
					/[&<>"']/g,
					(char) =>
						({
							"&": "&amp;",
							"<": "&lt;",
							">": "&gt;",
							'"': "&quot;",
							"'": "&#39;",
						})[char] as string,
				),
		},
		router: {
			slug: (doctype: string) => doctype.toLowerCase().replace(/ /g, "-"),
		},
		ui: { Dialog: FakeDialog },
		db: { get_list: getList },
		call,
		msgprint: vi.fn(),
		show_alert: vi.fn(),
		set_route: vi.fn(),
	};
	new Function(SOURCE)();
});

const custody = () => (globalThis as any).window.posaCashCustody;
const dialog = () => (FakeDialog as any).last as FakeDialog;
const storeKey = (action: string) =>
	`cash-custody-request:beto@example.com:QA:${action}`;

describe("action dialogs ask only for what the action needs", () => {
	it("keeps the handover note optional for a verification count", async () => {
		await custody().action(makeForm(BAG), "verify");
		const fields = dialog().fields;
		const note = fields.find((df: any) => df.fieldname === "note");
		expect(note.reqd).toBe(0);
		expect(fields.some((df: any) => df.fieldname === "denominations")).toBe(
			true,
		);
		expect(fields.some((df: any) => df.fieldname === "reference")).toBe(
			false,
		);
	});

	it("asks only for the bank reference when confirming a deposit", async () => {
		await custody().action(
			makeForm({ ...BAG, state: "In Transit" }),
			"confirm_bank",
		);
		const fields = dialog().fields;
		expect(
			fields.find((df: any) => df.fieldname === "reference").reqd,
		).toBe(1);
		// The server never stores a note for this action, so the dialog must not collect one.
		expect(fields.some((df: any) => df.fieldname === "note")).toBe(false);
		expect(fields.some((df: any) => df.fieldname === "denominations")).toBe(
			false,
		);
	});

	it("still requires the reason the server demands for a dispatch", async () => {
		await custody().action(
			makeForm({ ...BAG, state: "Available" }),
			"dispatch",
		);
		expect(
			dialog().fields.find((df: any) => df.fieldname === "note").reqd,
		).toBe(1);
	});

	it("requires a reason once the count differs from the sealed amount", async () => {
		const frm = makeForm(BAG);
		await custody().action(frm, "verify");
		dialog().set_value("denominations", [{ value: 100, quantity: 8 }]);
		(dialog().fields_dict.denominations as any).grid = {
			get_data: () => dialog().get_value("denominations"),
		};
		await dialog().primary_action();
		expect(dialog().fields_dict.note.df.reqd).toBe(1);
		expect(call).not.toHaveBeenCalled();
	});
});

describe("one request ID per instruction", () => {
	async function submitVerify(frm: any) {
		await custody().action(frm, "verify");
		(dialog().fields_dict.denominations as any).grid = {
			get_data: () => [{ value: 100, quantity: 9 }],
		};
		await dialog().primary_action();
	}

	it("sends the counted payload and clears the saved request on success", async () => {
		call.mockResolvedValue({
			message: { bag: BAG.name, cash_count: "CASH-COUNT-1", amount: 900 },
		});
		const frm = makeForm(BAG);
		await submitVerify(frm);
		const args = call.mock.calls[0][0].args;
		expect(args.action).toBe("verify");
		expect(args.payload.bag).toBe("CASH-BAG-00014");
		expect(args.payload.pos_profile).toBe("QA");
		expect(args.payload.count).toEqual({
			source: "denominations",
			denominations: [{ value: 100, quantity: 9 }],
		});
		expect(args.payload.request_id).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
		expect(localStorage.getItem(storeKey("verify"))).toBeNull();
		expect(dialog().visible).toBe(false);
	});

	it("distinguishes a committed action from a failed screen refresh", async () => {
		call.mockResolvedValue({ message: { bag: BAG.name, amount: 900 } });
		const frm = makeForm(BAG);
		frm.reload_doc.mockRejectedValue(new Error("refresh failed"));
		await submitVerify(frm);
		expect(localStorage.getItem(storeKey("verify"))).toBeNull();
		expect(dialog().visible).toBe(false);
		expect((globalThis as any).frappe.msgprint).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining(
					"was saved, but the screen could not refresh",
				),
			}),
		);
		expect(call).toHaveBeenCalledTimes(1);
	});
	it("retries a lost response with the same request ID and payload", async () => {
		call.mockRejectedValueOnce(new TypeError("NetworkError"));
		const frm = makeForm(BAG);
		await submitVerify(frm);
		const saved = JSON.parse(
			localStorage.getItem(storeKey("verify")) as string,
		);
		expect(saved.request_id).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
		expect(dialog().feedbackText()).toContain(
			"never records the transfer twice",
		);
		expect(dialog().primary_label).toBe("Retry unconfirmed action");
		// Locked inputs keep the replay payload identical to the one the server may already hold.
		expect(dialog().fields_dict.denominations.df.read_only).toBe(1);

		call.mockResolvedValueOnce({ message: { bag: BAG.name, amount: 900 } });
		await dialog().primary_action();
		const first = call.mock.calls[0][0].args.payload;
		const second = call.mock.calls[1][0].args.payload;
		expect(second).toEqual(first);
		expect(localStorage.getItem(storeKey("verify"))).toBeNull();
	});

	it("reopens an unconfirmed action from storage instead of starting a new one", async () => {
		call.mockRejectedValueOnce(new TypeError("NetworkError"));
		await submitVerify(makeForm(BAG));
		const saved = JSON.parse(
			localStorage.getItem(storeKey("verify")) as string,
		);

		await custody().action(makeForm(BAG), "verify");
		expect(dialog().primary_label).toBe("Retry unconfirmed action");
		call.mockResolvedValueOnce({ message: { bag: BAG.name, amount: 900 } });
		await dialog().primary_action();
		expect(call.mock.calls[1][0].args.payload.request_id).toBe(
			saved.request_id,
		);
	});

	it("surfaces a refusal, keeps nothing pending and lets the details be corrected", async () => {
		call.mockRejectedValueOnce({
			status: 417,
			responseJSON: {
				_server_messages: JSON.stringify([
					JSON.stringify({
						message: "Another person must verify the bag.",
					}),
				]),
			},
		});
		await submitVerify(makeForm(BAG));
		expect(localStorage.getItem(storeKey("verify"))).toBeNull();
		expect(dialog().feedbackText()).toContain(
			"Another person must verify the bag.",
		);
		expect(dialog().fields_dict.denominations.df.read_only).toBeUndefined();
	});

	it("refuses a manual total without a reason before any cash instruction is sent", async () => {
		await custody().action(makeForm(BAG), "verify");
		dialog().set_value("manual_total", 1);
		dialog().set_value("manual_amount", 900);
		dialog().set_value("manual_reason", "short");
		await dialog().primary_action();
		expect(call).not.toHaveBeenCalled();
		expect(dialog().feedbackText()).toContain("at least 8 characters");
		expect(localStorage.getItem(storeKey("verify"))).toBeNull();
	});
});

describe("record summary", () => {
	it("shows the amount and count evidence without stacking on refresh", async () => {
		const frm = makeForm(BAG);
		await custody().render(frm);
		await custody().render(frm);
		expect(dashboard.querySelectorAll(".posa-custody-summary").length).toBe(
			1,
		);
		const html = dashboard.innerHTML;
		expect(html).toContain("$ 900.00 MXN");
		expect(html).toContain("Counted notes and coins");
		expect(frm.page.set_indicator).toHaveBeenCalledWith(
			"Awaiting verification",
			"orange",
		);
	});

	it("escapes operator text and never prints the stored JSON", async () => {
		await custody().render(
			makeForm({ ...BAG, seal: "<img src=x onerror=alert(1)>" }),
		);
		const html = dashboard.innerHTML;
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;img");
		expect(html).not.toContain("count_json");
	});

	it("does not claim a difference on a draft drawer count", async () => {
		await custody().render(
			makeForm({
				doctype: "POS Cash Count",
				name: "CASH-COUNT-31",
				pos_profile: "QA",
				currency: "MXN",
				scope: "Drawer",
				state: "Draft",
				amount: 910,
				expected_amount: 0,
				difference: 0,
				counted_by: "ana@example.com",
				count_json: JSON.stringify({
					denominations: [],
					source: "manual",
					reason: "Counted by hand",
				}),
			}),
		);
		const html = dashboard.innerHTML;
		expect(html).toContain("$ 910.00 MXN");
		expect(html).not.toContain("Expected");
		expect(html).toContain("Counted by hand");
	});

	it("reports unreadable count evidence instead of dropping the summary", async () => {
		await custody().render(makeForm({ ...BAG, count_json: "{not json" }));
		expect(dashboard.innerHTML).toContain("could not be read");
		expect(dashboard.innerHTML).toContain("QA-SEAL-1");
	});

	it("requests the bag label layout when printing a label", async () => {
		call.mockResolvedValue({ message: "<html></html>" });
		await custody().print(makeForm(BAG), "label");
		expect(call.mock.calls[0][0].args).toEqual({
			doctype: "POS Cash Bag",
			name: "CASH-BAG-00014",
			layout: "label",
		});
	});
});


it("labels a bank posting as a journal entry, not a variance correction", async () => {
 call.mockResolvedValue({message:{bag:BAG.name,journal_entry:"BANK-JE-1",amount:900}});
 await custody().action(makeForm({...BAG,state:"In Transit"}),"confirm_bank");
 dialog().set_value("reference","BANK-RECEIPT-1");
 await dialog().primary_action();
 expect((globalThis as any).frappe.show_alert).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining("Journal Entry:")}),10);
});

describe("whole-bag transfer off-site from Desk", () => {
	const HOME = "Caja fuerte casa - QA";
	const REASON = "Beto carried the sealed bag to the home safe";
	const ctx = (over: Record<string, any> = {}) => ({
		safe: "CASH-SAFE-00002",
		can_manage: true,
		can_transfer: true,
		transfer_blocker: null,
		offsite_cash_account: HOME,
		offsite_cash_account_name: "Caja fuerte casa",
		bags: [{ name: BAG.name, state: "Unverified", amount: 900, prepared_by: "ana@example.com", verified_by: null }],
		...over,
	});
	const isContext = (entry: any) => entry[0].method.endsWith("service.context");
	const commands = () => call.mock.calls.filter((entry) => !isContext(entry));
	const result = { bag: BAG.name, amount: 900, state: "Transferred", transfer_account: HOME, journal_entry: "ACC-JV-00077" };

	beforeEach(() => {
		(FakeDialog as any).last = null;
	});

	it("reads the safe first and shows the amount, destination and missing verification", async () => {
		call.mockResolvedValueOnce({ message: ctx() });
		await custody().action(makeForm(BAG), "transfer_safe");
		expect(call.mock.calls[0][0].args).toEqual({ pos_profile: "QA", history_limit: 0 });
		const summary = dialog().fields_dict.transfer.$wrapper.html();
		expect(summary).toContain("$ 900.00 MXN");
		expect(summary).toContain("Caja fuerte casa");
		expect(summary).toContain(HOME);
		expect(summary).toContain("never independently verified");
		expect(summary).toContain("ana@example.com");
		// No account picker, no amount, no count: the server derives both.
		const names = dialog().fields.map((df: any) => df.fieldname).filter(Boolean);
		expect(names).toEqual(["help", "feedback", "transfer", "physical_done", "note"]);
		expect(dialog().fields_dict.note.df.reqd).toBe(1);
	});

	it("will not send until the physical move is confirmed, then sends only bag and reason", async () => {
		call.mockResolvedValueOnce({ message: ctx() });
		const frm = makeForm(BAG);
		await custody().action(frm, "transfer_safe");
		dialog().set_value("note", REASON);
		await dialog().primary_action();
		expect(commands()).toHaveLength(0);
		expect(dialog().feedbackText()).toContain("has already physically left");
		expect(localStorage.getItem(storeKey("transfer_safe"))).toBeNull();

		call.mockResolvedValueOnce({ message: result });
		dialog().set_value("physical_done", 1);
		await dialog().primary_action();
		expect(commands()).toHaveLength(1);
		const args = commands()[0][0].args;
		expect(args.action).toBe("transfer_safe");
		expect(Object.keys(args.payload).sort()).toEqual(["bag", "note", "pos_profile", "request_id"]);
		expect(args.payload).toMatchObject({ pos_profile: "QA", bag: BAG.name, note: REASON });
		expect(localStorage.getItem(storeKey("transfer_safe"))).toBeNull();
		expect(frm.reload_doc).toHaveBeenCalled();
		expect((globalThis as any).frappe.show_alert).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("ACC-JV-00077") }),
			10,
		);
	});

	it("refuses a bag that already left, before any cash instruction exists", async () => {
		call.mockResolvedValueOnce({ message: ctx({ bags: [] }) });
		const frm = makeForm({ ...BAG, state: "Available" });
		await custody().action(frm, "transfer_safe");
		expect(dialog()).toBeNull();
		expect(commands()).toHaveLength(0);
		expect(frm.reload_doc).toHaveBeenCalled();
		expect((globalThis as any).frappe.msgprint).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("no longer a sealed bag") }),
		);
	});

	it("explains a missing destination and links a supervisor to the safe", async () => {
		const blocker = "Configure an off-site cash account on this safe before transferring whole bags.";
		call.mockResolvedValueOnce({ message: ctx({ can_transfer: false, transfer_blocker: blocker, offsite_cash_account: null }) });
		await custody().action(makeForm(BAG), "transfer_safe");
		expect(dialog()).toBeNull();
		expect(commands()).toHaveLength(0);
		const message = (globalThis as any).frappe.msgprint.mock.calls[0][0].message;
		expect(message).toContain(blocker);
		expect(message).toContain('href="/app/pos-cash-safe/CASH-SAFE-00002"');
	});

	it("sends nothing when the safe cannot be read", async () => {
		call.mockRejectedValueOnce(new TypeError("NetworkError"));
		await custody().action(makeForm(BAG), "transfer_safe");
		expect(dialog()).toBeNull();
		expect(commands()).toHaveLength(0);
	});

	it("replays a lost transfer with the same request even after the bag reads as moved", async () => {
		call.mockResolvedValueOnce({ message: ctx() });
		await custody().action(makeForm(BAG), "transfer_safe");
		dialog().set_value("note", REASON);
		dialog().set_value("physical_done", 1);
		call.mockRejectedValueOnce(new TypeError("NetworkError"));
		await dialog().primary_action();
		const saved = JSON.parse(localStorage.getItem(storeKey("transfer_safe")) as string);
		expect(custody().pendingForBag("QA", BAG.name)).toEqual(["transfer_safe"]);
		expect(custody().pendingForBag("QA", "CASH-BAG-OTHER")).toEqual([]);

		const before = call.mock.calls.length;
		call.mockResolvedValueOnce({ message: result });
		await custody().action(makeForm({ ...BAG, state: "Transferred" }), "transfer_safe");
		// No fresh context read: a replay is the saved request, whatever the state says now.
		expect(call.mock.calls.length).toBe(before);
		expect(dialog().primary_label).toBe("Retry unconfirmed action");
		expect(dialog().fields_dict.physical_done.df.read_only).toBe(1);
		await dialog().primary_action();
		const replay = commands()[commands().length - 1][0].args.payload;
		expect(replay.request_id).toBe(saved.request_id);
		expect(replay).toEqual(commands()[0][0].args.payload);
		expect(localStorage.getItem(storeKey("transfer_safe"))).toBeNull();
	});

	it("shows where a moved bag went and that nobody verified it", async () => {
		await custody().render(
			makeForm({
				...BAG,
				state: "Transferred",
				transfer_account: HOME,
				transfer_journal: "ACC-JV-00077",
				transferred_by: "beto@example.com",
				transferred_on: "2026-09-23 18:05:00",
			}),
		);
		const html = dashboard.innerHTML;
		expect(html).toContain("Never independently verified");
		expect(html).toContain('href="/app/account/' + encodeURIComponent(HOME) + '"');
		expect(html).toContain('href="/app/journal-entry/ACC-JV-00077"');
		expect(html).toContain("beto@example.com");
		expect(html).not.toContain("Verified by</dt><dd>ana");
	});

	it("does not warn about verification for a verified bag that moved", async () => {
		await custody().render(
			makeForm({ ...BAG, state: "Transferred", verified_by: "gerente@example.com", transfer_account: HOME }),
		);
		expect(dashboard.innerHTML).not.toContain("Never independently verified");
		expect(dashboard.innerHTML).toContain("gerente@example.com");
	});
});
