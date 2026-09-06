import { readFileSync } from "node:fs";
import { parse as parseScript } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { afterEach, describe, expect, it, vi } from "vitest";

// Execute the actual Options API methods independently of the register's
// hardware/render graph. No copied implementation or successful network mock.
function method(path: string, name: string, frappe: unknown) {
	const script = parseSfc(readFileSync(`src/posapp/components/pos/${path}.vue`, "utf8")).descriptor.script!.content;
	const exported: any = parseScript(script, { sourceType: "module" }).program.body.find((node) => node.type === "ExportDefaultDeclaration");
	const methods = exported.declaration.properties.find((node: any) => node.key?.name === "methods");
	const node = methods.value.properties.find((entry: any) => entry.key?.name === name);
	return new Function("frappe", `return ({${script.slice(node.start, node.end)}}).${name}`)(frappe);
}

afterEach(() => vi.restoreAllMocks());

describe("optional register reads during an offline transition", () => {
	it.each([
		["getCustomerGroups", "groups"],
		["getCustomerTerritorys", "territorys"],
		["getGenders", "genders"],
	])("%s handles rejection and allows a later successful retry", async (name, field) => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		const get_list = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockResolvedValueOnce([{ name: "Available" }]);
		const context = { [field]: [] };
		const run = method("dialogs/customer/UpdateCustomer", name, { db: { get_list } });
		await expect(run.call(context)).resolves.toBeUndefined();
		expect(context[field]).toEqual([]);
		expect(warning).toHaveBeenCalledOnce();
		await run.call(context);
		expect(context[field]).toEqual(["Available"]);
	});

	it("does not overwrite current settings after failed refresh, then refreshes on retry", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const get_doc = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockResolvedValueOnce({ name: "POS Settings" });
		const setPosSettings = vi.fn();
		const context = { uiStore: { setPosSettings } };
		const run = method("shell/Pos", "get_pos_setting", { db: { get_doc } });
		await run.call(context);
		expect(setPosSettings).not.toHaveBeenCalled();
		await run.call(context);
		expect(setPosSettings).toHaveBeenCalledOnce();
		expect(setPosSettings).toHaveBeenCalledWith({ name: "POS Settings" });
	});

	it("does not grant coupons when discovery fails", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const call = vi.fn(({ error }) => { error(new TypeError("Failed to fetch")); return Promise.resolve(null); });
		const add_coupon = vi.fn();
		const run = method("offers/PosCoupons", "setActiveGiftCoupons", { call });
		await run.call({ customer: "Customer", pos_profile: { company: "Company" }, add_coupon });
		expect(call).toHaveBeenCalledOnce();
		expect(add_coupon).not.toHaveBeenCalled();
	});
});
