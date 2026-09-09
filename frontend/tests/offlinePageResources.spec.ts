// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import page from "../../posawesome/www/offline.html?raw";
import worker from "../../posawesome/www/sw.js?raw";

describe("cached offline fallback", () => {
	it("renders its content and icon without any network subresources", () => {
		document.documentElement.innerHTML = page;
		expect(document.querySelector("h1")?.textContent).toBe(
			"You are offline",
		);
		expect(document.querySelector(".icon svg path")).not.toBeNull();
		expect(document.querySelector("style")?.textContent).toContain(
			".container",
		);
		expect(
			document.querySelectorAll("[src], [href], [srcset]"),
		).toHaveLength(0);
		expect(document.querySelector("style")?.textContent).not.toMatch(
			/url\s*\(/i,
		);
	});

	it("remains the service worker's cached navigation fallback", () => {
		expect(worker).toContain('"/offline.html"');
		expect(worker).toContain('caches.match("/offline.html")');
	});
});
