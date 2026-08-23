// @vitest-environment node

/**
 * The source half of the customer display's privacy decision — see
 * `customerDisplayPrivacy.spec.ts` for the mounted half and the reasoning.
 *
 * Split for the reason `registerSaysItOnceSource.spec.ts` is split: `node:fs`
 * does not interop under jsdom (build plan §10), and the mounted half must
 * mount. The two catch different mistakes. A DOM check only sees a field a
 * fixture happened to reach; a template scan sees one bound behind a `v-if`
 * nobody's fixture satisfies, and it sees the binding on the day it is written
 * rather than on the day someone finds the right snapshot to expose it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src/posapp");

/** Read off the component itself — a template this spec cannot see is a
 *  template it cannot guard. Comments are stripped because they ARGUE the
 *  exclusions and so necessarily name the fields; the guard is about what is
 *  BOUND, not about what is discussed. */
const TEMPLATE = (() => {
	const source = readFileSync(
		resolve(SRC, "components/customer_display/CustomerDisplay.vue"),
		"utf8",
	);
	const match = /<template>([\s\S]*)<\/template>/.exec(source);
	if (!match) throw new Error("CustomerDisplay.vue has no template block");
	return match[1]!.replace(/<!--[\s\S]*?-->/g, "");
})();

describe("the customer display's template binds none of the refused fields", () => {
	it("still has a template with a total in it, so the absences mean something", () => {
		expect(TEMPLATE).toContain('data-money-role="total"');
	});

	it.each([
		["customer_name", "a person's name, readable by whoever is next in the queue"],
		["item_code", "an internal SKU the customer cannot use"],
		["channel_id", "an internal identifier with no reader on this screen"],
	])("does not bind %s", (field, why) => {
		expect(
			TEMPLATE.includes(field),
			`CustomerDisplay.vue's template binds \`${field}\`: ${why}. ` +
				`This screen faces outward and the customer cannot opt out of what it ` +
				`says about them. If it genuinely needs this field, the argument belongs ` +
				`in the component's header comment and this spec changes with it.`,
		).toBe(false);
	});
});

describe("the snapshot contract has not widened underneath the screen", () => {
	// `utils/customerDisplay.ts` is not this component's to change. This
	// asserts nothing has ADDED one of the fields the design refused: they
	// cross a window into a screen a stranger can read, and the decision about
	// whether they belong there has to be made before anything renders them.
	const interfaceBlock = (() => {
		const transport = readFileSync(resolve(SRC, "utils/customerDisplay.ts"), "utf8");
		const match = /export interface CustomerDisplaySnapshot \{([\s\S]*?)\}/.exec(transport);
		if (!match) throw new Error("CustomerDisplaySnapshot is gone or renamed");
		return match[1]!;
	})();

	it("still carries the fields the screen does use", () => {
		expect(interfaceBlock).toContain("total_amount");
		expect(interfaceBlock).toContain("items");
	});

	it.each([
		"wallet",
		"loyalty",
		"customer_phone",
		"mobile_no",
		"email",
		"customer_id",
		"purchase_history",
	])("does not carry %s", (field) => {
		expect(
			interfaceBlock.includes(field),
			`the snapshot now carries \`${field}\`. \`Cobro.dc.html\` shows the ` +
				`wallet on the CASHIER's screen, which is a different privacy ` +
				`context — decide whether it belongs on the customer's before it ` +
				`crosses the window.`,
		).toBe(false);
	});
});
