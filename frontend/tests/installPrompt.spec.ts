// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bindInstallPrompt,
	isIosSafari,
	readStandalone,
	resetInstallPromptForTests,
	useInstallPrompt,
} from "../src/posapp/composables/core/useInstallPrompt";

/**
 * The install affordance's contract (native-feel round 1):
 *  - Chromium hands the page ONE deferred `beforeinstallprompt`; binding must
 *    happen before any menu mounts, and the menu replays it on demand.
 *  - iOS has no prompt API: the Share-sheet hint shows only there, and only
 *    while the page still runs inside the browser.
 *  - Once the register runs standalone (or `appinstalled` fired), nothing is
 *    offered any more.
 */
const fakePromptEvent = (outcome: "accepted" | "dismissed" = "accepted") => {
	const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
	};
	event.prompt = vi.fn(async () => {});
	event.userChoice = Promise.resolve({ outcome, platform: "web" });
	return event;
};

const setUserAgent = (ua: string, maxTouchPoints = 0) => {
	Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
	Object.defineProperty(window.navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
};

const ANDROID_CHROME =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_OS_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("useInstallPrompt", () => {
	beforeEach(() => {
		resetInstallPromptForTests();
		setUserAgent(ANDROID_CHROME);
		delete (window.navigator as any).standalone;
	});
	afterEach(() => {
		resetInstallPromptForTests();
	});

	it("offers nothing until the browser hands over a prompt", () => {
		bindInstallPrompt(window);
		const { canInstall, showsIosHint, isStandalone } = useInstallPrompt(window);
		expect(canInstall.value).toBe(false);
		expect(showsIosHint.value).toBe(false);
		expect(isStandalone.value).toBe(false);
	});

	it("captures beforeinstallprompt (and cancels the browser's own infobar), then replays it on install()", async () => {
		bindInstallPrompt(window);
		const { canInstall, install } = useInstallPrompt(window);
		const event = fakePromptEvent("accepted");
		window.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(canInstall.value).toBe(true);
		await expect(install()).resolves.toBe("accepted");
		expect(event.prompt).toHaveBeenCalledTimes(1);
		// A used prompt cannot be replayed — the offer withdraws itself.
		expect(canInstall.value).toBe(false);
		await expect(install()).resolves.toBe("unavailable");
	});

	it("binds once: a second bind does not double-register", () => {
		const spy = vi.spyOn(window, "addEventListener");
		bindInstallPrompt(window);
		bindInstallPrompt(window);
		const installs = spy.mock.calls.filter(([type]) => type === "beforeinstallprompt");
		expect(installs).toHaveLength(1);
		spy.mockRestore();
	});

	it("withdraws every offer once the app is installed or already standalone", () => {
		bindInstallPrompt(window);
		const { canInstall, isStandalone } = useInstallPrompt(window);
		window.dispatchEvent(fakePromptEvent());
		expect(canInstall.value).toBe(true);
		window.dispatchEvent(new Event("appinstalled"));
		expect(isStandalone.value).toBe(true);
		expect(canInstall.value).toBe(false);
	});

	it("shows the Share-sheet hint on iOS Safari only, and not once standalone", () => {
		setUserAgent(IPHONE_SAFARI, 5);
		bindInstallPrompt(window);
		const { showsIosHint, canInstall } = useInstallPrompt(window);
		expect(showsIosHint.value).toBe(true);
		expect(canInstall.value).toBe(false);
		// Safari's own flag for a Home-Screen launch.
		resetInstallPromptForTests();
		(window.navigator as any).standalone = true;
		bindInstallPrompt(window);
		expect(useInstallPrompt(window).showsIosHint.value).toBe(false);
	});

	it("recognises iPadOS behind its desktop-class user agent by its touch points", () => {
		expect(isIosSafari(IPAD_OS_AS_MAC, 5)).toBe(true);
		expect(isIosSafari(IPAD_OS_AS_MAC, 0)).toBe(false);
		expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false);
	});

	it("reads standalone from display-mode or Safari's navigator flag", () => {
		expect(readStandalone(window)).toBe(false);
		(window.navigator as any).standalone = true;
		expect(readStandalone(window)).toBe(true);
	});
});
