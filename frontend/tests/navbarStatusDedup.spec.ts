import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The top bar states each fact once.
 *
 * The register status line (checklist item A) landed BESIDE the indicators it
 * was meant to replace, so a real register shipped a bar that said the
 * connection twice — "Online · synced" in the strip and "Online" in the
 * indicator, three inches apart — and the POS profile twice, in the strip and
 * in the avatar chip's meta line.
 *
 * Duplication of this kind does not read as redundancy, it reads as
 * disagreement: two labels for one fact invite the operator to look for the
 * difference between them. And the pair was not equivalent — the strip
 * distinguishes online-with-a-queue from online-and-synced, which is the
 * distinction that matters to somebody about to close a shift.
 *
 * These are negative guarantees — "no second statement of this exists" — and a
 * negative can only be proven by scanning the source, never by mounting it.
 * Comments are stripped first, because the ones added with the fix necessarily
 * quote the declarations being asserted.
 */
const sourcePath = (relativePath: string) =>
	fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url));

const read = (relativePath: string) => readFileSync(sourcePath(relativePath), "utf8");
const stripComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

const indicator = read("posapp/components/navbar/StatusIndicator.vue");
const appBar = read("posapp/components/navbar/NavbarAppBar.vue");
const resolver = read("posapp/components/navbar/registerStatusLine.ts");

describe("the connection is stated once", () => {
	it("hides the indicator's wording at every width, not just on a phone", () => {
		const css = stripComments(indicator);
		// The class has several blocks in this stylesheet; the guarantee is
		// that ONE of them hides it, so scan all of them rather than the first
		// — which is the layout block and says `display: flex`.
		const blocks = [...css.matchAll(/\.status-info-always-visible\s*\{([^}]*)\}/g)].map(
			(match) => match[1] ?? "",
		);
		expect(blocks.length).toBeGreaterThan(0);
		expect(blocks.some((block) => /display:\s*none/.test(block))).toBe(true);

		// The rule must not sit inside a media query — that was the original
		// shape, and it left the duplicate on every desktop register.
		const guarded = /@media[^{]*\{[^@]*?\.status-info-always-visible\s*\{[^}]*display:\s*none/s;
		expect(css).not.toMatch(guarded);
	});

	it("keeps every affordance the wording never carried", () => {
		// Retiring the label must not retire the button. Each of these is
		// something the status line cannot do, so losing them by deleting the
		// component would have been a net loss dressed as a cleanup.
		expect(indicator).toMatch(/emit\(['"]toggle-panel['"]\)/); // opens the offline panel
		expect(indicator).toContain("v-tooltip"); // names the host it could not reach
		expect(indicator).toContain("status-bootstrap-warning-indicator");
		expect(indicator).toContain("status-checking-indicator"); // recheck in flight
		// `Limited` — network up, server down — is a state the strip's single
		// `online` boolean collapses. The icon is where it survives.
		expect(indicator).toContain('__("Limited")');
	});
});

describe("the register's identity is stated once", () => {
	it("leaves the cashier's name to the avatar chip", () => {
		// There the name labels a control: clicking it switches cashier.
		expect(appBar).toContain("cashierChipLabel");
		expect(resolver).not.toMatch(/segments\.push\(\s*cashier\s*\)/);
	});

	it("leaves the POS profile to the status line", () => {
		expect(stripComments(appBar)).not.toContain("cashierChipMeta");
		expect(resolver).toMatch(/segments\.push\(profile\)/);
	});
});

describe("the chip that carries a money claim is the last to go", () => {
	it("pushes the connection chip after saldo, not before it", () => {
		const saldoAt = resolver.indexOf('id: "saldo"');
		const connectionAt = resolver.lastIndexOf("chips.push(connectionChip(input))");
		expect(saldoAt).toBeGreaterThan(-1);
		expect(connectionAt).toBeGreaterThan(saldoAt);
	});

	it("gives the connection chip the priority that never drops", () => {
		// Every `connection` chip in every branch — offline, queued, synced,
		// compact — must be priority 1, or one code path quietly becomes
		// droppable while the others are not.
		// Sliced by offset rather than matched with a character class: one
		// branch's label is `To upload · {0}`, and the `}` of that placeholder
		// ends a `[^}]*` match early — which made this assertion pass over the
		// very branch most worth checking.
		const offsets = [...resolver.matchAll(/id: "connection"/g)].map((m) => m.index ?? 0);
		expect(offsets.length).toBeGreaterThanOrEqual(4);
		for (const offset of offsets) {
			expect(resolver.slice(offset, offset + 220)).toContain("priority: 1");
		}
	});
});
