// The movil browse card must show the WHOLE product photo, letterboxed, not a
// crop. `max-width/max-height: 100%` did not constrain the image in the well's
// `display: grid; place-items: center` cell, so a portrait photo rendered at its
// intrinsic height and `overflow: hidden` cropped it to the top third (reported
// by the owner). The image is absolutely pinned to the well now, so
// `object-fit: contain` letterboxes it with the well's neutral background.
import { describe, expect, it } from "vitest";
import src from "../src/posapp/components/pos/mobile/browse/MobileBrowseCard.vue?raw";

const rule = (sel: string) => {
	const style = src.slice(src.indexOf("<style"), src.lastIndexOf("</style>"));
	const at = style.indexOf(`${sel} {`);
	expect(at, `${sel} missing`).toBeGreaterThan(-1);
	return style.slice(at, style.indexOf("}", at));
};

describe("the movil browse thumbnail shows the whole picture", () => {
	it("pins the image to the well and contains it (no crop)", () => {
		const img = rule(".mbrowse-card__image");
		expect(img).toMatch(/position:\s*absolute/);
		expect(img).toMatch(/inset:\s*0/);
		expect(img).toMatch(/object-fit:\s*contain/);
		expect(img).not.toMatch(/object-fit:\s*cover/);
	});
	it("the well clips and is a relative box the image can fill", () => {
		const well = rule(".mbrowse-card__well");
		expect(well).toMatch(/position:\s*relative/);
		expect(well).toMatch(/overflow:\s*hidden/);
	});
});
