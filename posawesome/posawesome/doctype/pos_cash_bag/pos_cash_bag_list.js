// The folio identifies the physical bag; the record ID remains available below it.
(function () {
	const states = {
		Unverified: ["Awaiting verification", "orange"],
		Available: ["Available in the safe", "blue"],
		Disputed: ["Held for review", "red"],
		Issued: ["Issued to a drawer", "green"],
		"In Transit": ["In transit to the bank", "purple"],
		Deposited: ["Deposited at the bank", "gray"],
		Unpacked: ["Returned to loose safe cash", "gray"],
	};
	const state = (doc) => states[doc.state] || [doc.state || "", "gray"];
	const person = (user) => (frappe.user_info(user) || {}).fullname || user || "";
	const money = (doc) => window.format_currency(doc.amount, doc.currency);
	const print = (names) => {
		if (!names.length) return frappe.msgprint(__("Select at least one bag to print."));
		frappe.require("/assets/posawesome/js/cash_custody.js", () =>
			window.posaCashCustody.printBags(names),
		);
	};
	frappe.listview_settings["POS Cash Bag"] = {
		hide_name_column: true,
		add_fields: [
			"seal",
			"amount",
			"currency",
			"purpose",
			"state",
			"safe",
			"pos_profile",
			"prepared_by",
			"verified_by",
			"received_by",
			"creation",
			"opening_shift",
		],
		filters: [["state", "in", ["Unverified", "Available", "Disputed"]]],
		get_indicator(doc) {
			const [label, color] = state(doc);
			return [__(label), color, "state,=," + doc.state];
		},
		formatters: {
			prepared_by(value) {
				return "<span>" + frappe.utils.escape_html(person(value)) + "</span>";
			},
		},
		button: {
			show: () => true,
			get_label: () => __("Print bag label"),
			get_description: (doc) => frappe.utils.escape_html(__("Print bag label") + ": " + doc.seal),
			action: (doc) => print([doc.name]),
		},
		onload(list) {
			list.page.main.addClass("posa-bag-list");
			list.list_view_settings.disable_scrolling = true;
			if (!document.getElementById("posa-bag-list-style")) {
				const css = document.createElement("style");
				css.id = "posa-bag-list-style";
				css.textContent =
					".posa-bag-list .list-row{height:auto;min-height:88px}.posa-bag-list .list-subject .level-item{white-space:normal;min-width:0}.posa-bag-context{display:block;font-size:12px;font-weight:400;color:var(--text-muted);line-height:1.5;overflow-wrap:anywhere}.posa-bag-status{font-weight:600;color:var(--text-color)}.posa-bag-queues{display:flex;flex-wrap:wrap;gap:6px;padding:12px 0}.posa-bag-queues button{min-height:36px}.posa-bag-queue-select{display:none}.posa-bag-queues button[aria-pressed=true]{background:var(--control-bg-on-gray);box-shadow:inset 0 0 0 1px var(--text-muted)}.posa-bag-list .frappe-list .list-row-container .level-left{flex:1;min-width:0}.posa-bag-list .list-subject>.level-item:not(.select-like){flex:1;min-width:0}.posa-bag-list .list-row-col.list-subject{flex:3;min-width:0}@media(max-width:991px){.posa-bag-list .list-row{min-height:112px}.posa-bag-list .list-subject{flex:1;min-width:0}.posa-bag-queues button{display:none}.posa-bag-queue-select{display:block;width:100%;min-height:44px;background:var(--control-bg);color:var(--text-color);border:1px solid var(--border-color);border-radius:6px;padding:8px}.posa-bag-list .list-row .mobile-layout{display:none!important}.posa-bag-list .list-row-col:has(>.btn-action){display:block!important;margin:8px 0 0 30px;flex:none}.posa-bag-list .btn-action{min-height:44px;max-width:none}.posa-bag-list .list-row .level-right{display:none}.posa-bag-list .list-row .level-left{width:100%;display:block}.posa-bag-list .list-row .list-row-col:not(.list-subject):not(:has(>.btn-action)),.posa-bag-list .list-row-head .list-row-col:not(.list-subject){display:none!important}.posa-bag-list .list-subject>.level-item>a{white-space:normal;overflow-wrap:anywhere}}";
				document.head.appendChild(css);
			}
			// Retain Frappe's checkbox, navigation and text escaping, then add real DOM text.
			const original = list.get_subject_element.bind(list);
			list.get_subject_element = function (doc, title) {
				const node = original(doc, doc.seal || title),
					parent = node.querySelector("a")?.parentElement;
				if (!parent) return node;
				parent.style.display = "block";
				const info = document.createElement("span");
				info.className = "posa-bag-context";
				const status = document.createElement("span");
				status.className = "posa-bag-status";
				status.textContent = __(state(doc)[0]) + " · " + money(doc) + " · " + __(doc.purpose);
				const date = document.createElement("span");
				date.style.display = "block";
				date.textContent =
					__("Prepared by") +
					": " +
					person(doc.prepared_by) +
					" · " +
					frappe.datetime.str_to_user(doc.creation);
				const ref = document.createElement("span");
				ref.style.display = "block";
				ref.textContent =
					doc.name +
					(doc.verified_by ? " · " + __("Verified by") + ": " + person(doc.verified_by) : "");
				info.append(status, date, ref);
				parent.appendChild(info);
				return node;
			};
			const bar = document.createElement("nav");
			bar.className = "posa-bag-queues";
			bar.setAttribute("aria-label", __("Cash bag queues"));
			const select = document.createElement("select");
			select.className = "posa-bag-queue-select";
			select.setAttribute("aria-label", __("Cash bag queues"));
			select.add(new Option(__("Filtered bags"), "custom"));
			const queues = [
				["In the safe", ["Unverified", "Available", "Disputed"]],
				["Awaiting verification", ["Unverified"]],
				["Available in the safe", ["Available"]],
				["Held for review", ["Disputed"]],
				["Issued to a drawer", ["Issued"]],
				["In transit to the bank", ["In Transit"]],
				["Completed", ["Deposited", "Unpacked"]],
				["All bags", null],
			];
			async function choose(values) {
				list.filter_area.remove("state");
				if (values) await list.filter_area.add([["POS Cash Bag", "state", "in", values]]);
				else await list.refresh();
			}
			queues.forEach(([label, values], index) => {
				select.add(new Option(__(label), String(index)));
				const button = document.createElement("button");
				button.type = "button";
				button.className = "btn btn-default btn-sm";
				button.textContent = __(label);
				button.onclick = () => choose(values);
				bar.appendChild(button);
			});
			select.onchange = () => {
				if (select.value !== "custom") void choose(queues[Number(select.value)][1]);
			};
			bar.prepend(select);
			list.settings.before_render = () => {
				const filter = list.filter_area.get().find((f) => f[1] === "state");
				const values =
					filter && (Array.isArray(filter[3]) ? filter[3] : String(filter[3]).split(","));
				const match = queues.findIndex(([, states]) =>
					!filter
						? !states
						: ["=", "in"].includes(filter[2]) &&
							states &&
							states.length === values.length &&
							states.every((s) => values.includes(s)),
				);
				select.value = match < 0 ? "custom" : String(match);
				bar.querySelectorAll("button").forEach((button, index) =>
					button.setAttribute("aria-pressed", String(index === match)),
				);
			};
			list.$result.before(bar);
			list.page.add_actions_menu_item(__("Print selected bags"), () =>
				print(list.get_checked_items().map((doc) => doc.name)),
			);
		},
	};
})();
