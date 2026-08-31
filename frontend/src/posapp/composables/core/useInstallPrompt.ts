import { computed, ref } from "vue";

/**
 * Install affordance for the register as a PWA — native-feel round 1 (08-30).
 *
 * One module-level state (the `beforeinstallprompt` event fires ONCE per page
 * load, before any component that could want it has mounted), exposed as a
 * composable so the navbar menu can offer «Instalar la app» exactly when the
 * browser would honour it, and the iOS hint exactly when there is no prompt
 * API at all but the page is still running inside Safari's chrome.
 *
 *  - Chromium (Android, desktop): `beforeinstallprompt` → `canInstall`; the
 *    menu action calls `install()`, which replays the deferred prompt.
 *  - iOS Safari: no event, ever. `showsIosHint` is true while the page is
 *    NOT standalone and the UA is iPhone/iPad Safari — the menu shows the
 *    Share → «Añadir a pantalla de inicio» hint instead.
 *  - Already installed (`display-mode: standalone`, or Safari's
 *    `navigator.standalone`): neither is offered.
 *
 * `bindInstallPrompt()` is idempotent and is what `main` calls once at boot;
 * tests call it against a jsdom window and dispatch the events by hand.
 */

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
const installed = ref(false);
const standalone = ref(false);
let bound = false;

const STANDALONE_QUERY = "(display-mode: standalone)";

export const readStandalone = (win: Window = window): boolean => {
	try {
		if (typeof win.matchMedia === "function" && win.matchMedia(STANDALONE_QUERY).matches) {
			return true;
		}
	} catch {
		/* jsdom without matchMedia */
	}
	const nav = win.navigator as Navigator & { standalone?: boolean };
	return nav?.standalone === true;
};

export const isIosSafari = (userAgent: string, maxTouchPoints = 0): boolean => {
	const ua = userAgent || "";
	// iPadOS 13+ reports a Mac UA; the touch points tell it apart.
	// Chrome/Firefox/Edge on iOS are Safari underneath and expose no install
	// path of their own either, so the Share-sheet hint is the truth for every
	// browser on the device — no UA-brand test beyond "is this iOS".
	return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
};

export function bindInstallPrompt(win: Window = window): void {
	if (bound) return;
	bound = true;
	standalone.value = readStandalone(win);
	win.addEventListener("beforeinstallprompt", (event: Event) => {
		// The browser would otherwise show its own mini-infobar at a moment
		// of ITS choosing; the register offers the same prompt from the menu.
		event.preventDefault();
		deferredPrompt.value = event as BeforeInstallPromptEvent;
	});
	win.addEventListener("appinstalled", () => {
		installed.value = true;
		deferredPrompt.value = null;
	});
	try {
		win.matchMedia?.(STANDALONE_QUERY)?.addEventListener?.("change", (e) => {
			standalone.value = e.matches;
		});
	} catch {
		/* no matchMedia */
	}
}

/** Test seam: forget everything, as a fresh page load would. */
export function resetInstallPromptForTests(): void {
	deferredPrompt.value = null;
	installed.value = false;
	standalone.value = false;
	bound = false;
}

export function useInstallPrompt(win: Window | undefined = typeof window === "undefined" ? undefined : window) {
	const isStandalone = computed(() => standalone.value || installed.value);
	const canInstall = computed(() => !isStandalone.value && deferredPrompt.value !== null);
	const showsIosHint = computed(() => {
		if (isStandalone.value || deferredPrompt.value) return false;
		if (!win) return false;
		return isIosSafari(win.navigator?.userAgent ?? "", win.navigator?.maxTouchPoints ?? 0);
	});

	const install = async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
		const prompt = deferredPrompt.value;
		if (!prompt) return "unavailable";
		await prompt.prompt();
		const choice = await prompt.userChoice?.catch(() => null);
		// A dismissed prompt cannot be replayed; the browser will fire a fresh
		// event when it is willing again.
		deferredPrompt.value = null;
		return choice?.outcome ?? "dismissed";
	};

	return { canInstall, isStandalone, showsIosHint, install };
}
