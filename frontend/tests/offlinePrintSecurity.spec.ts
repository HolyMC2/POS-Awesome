// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ template: "", terms: "" }));
vi.mock("../src/offline/index", () => ({
	getPrintTemplate: () => cache.template,
	getTermsAndConditions: () => cache.terms,
	memoryInitPromise: Promise.resolve(),
}));
import renderInvoice from "../src/offline_print_template";

const injection = '<img data-attack="yes" src="x" onerror="window.__receiptExecuted = true">';
const invoice = () => ({ name: "TEST-1", company: "Store", customer_name: "Customer", grand_total: 100,
	payments: [{ amount: 20 }], items: [{ item_code: "A", item_name: "Item", qty: 1, rate: 100, amount: 100 }] });
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("offline receipt data boundaries", () => {
	beforeEach(() => {
		cache.template = ""; cache.terms = "";
		vi.stubGlobal("frappe", {});
	});

	it("prints hostile invoice and item text literally in the fallback receipt", async () => {
		const doc: any = invoice();
		for (const field of ["name", "company", "customer_name", "contact_mobile", "posa_notes", "posa_authorization_code"]) doc[field] = injection;
		Object.assign(doc.items[0], { item_code: injection, item_name: `${injection} name`, serial_no: injection, uom: injection });
		doc.taxes = [{ description: injection, rate: 16, tax_amount: 16 }];
		const rendered = parse(await renderInvoice(doc));
		expect(rendered.querySelector("img[data-attack], [onerror]")).toBeNull();
		expect(rendered.body.textContent).toContain(injection);
	});

	it("autoescapes custom template values while preserving sanitized rich terms and receipt styles", async () => {
		cache.template = '<html><head><style>.total{font-weight:bold}</style></head><body><h1>{{ doc.customer_name }}</h1><section>{{ terms|safe }}</section></body></html>';
		cache.terms = '<b>Keep your receipt</b><script>window.__receiptExecuted=true</script><iframe srcdoc="bad"></iframe><a href="javascript:alert(1)">bad</a>';
		const rendered = parse(await renderInvoice({ ...invoice(), customer_name: injection }));
		expect(rendered.querySelector("h1")?.textContent).toBe(injection);
		expect(rendered.querySelector("section b")?.textContent).toBe("Keep your receipt");
		expect(rendered.querySelector("style")?.textContent).toContain("font-weight:bold");
		expect(rendered.querySelector("script, iframe, [onerror], [href^='javascript:']")).toBeNull();
	});

	it("sanitizes rich terms when a broken custom template falls back", async () => {
		cache.template = "{% if broken";
		cache.terms = `<b>Warranty</b>${injection}<form action="/api/method/test"><input></form>`;
		const rendered = parse(await renderInvoice(invoice()));
		expect(rendered.querySelector(".terms b")?.textContent).toBe("Warranty");
		expect(rendered.querySelector("[onerror], form")).toBeNull();
	});

	it("prints the actual partial tender on a credit sale", async () => {
		cache.template = "<p>{{ doc.paid_amount }}</p>";
		expect(parse(await renderInvoice({ ...invoice(), is_credit_sale: 1 })).body.textContent).toBe("20");
	});
});
