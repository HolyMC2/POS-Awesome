import { reactive } from "vue";
import {
	startBootstrapLoading,
	stopBootstrapLoading,
	setScopeMeta,
} from "../composables/core/useLoading";

/**
 * Interface representing the global loading state.
 */
export interface LoadingState {
	active: boolean;
	progress: number;
	sources: Record<string, number>;
	message: string;
	sourceMessages: Record<string, string>;
	/**
	 * Sources that never reached 100% before the stall watchdog released the
	 * blocking overlay. Empty on a healthy boot; purely diagnostic.
	 */
	stalledSources: string[];
}

/**
 * How long the bootstrap overlay may sit without ANY forward progress before
 * the watchdog releases it.
 *
 * The bootstrap scope is blocking: `LoadingOverlay` renders
 * `position: fixed; inset: 0; pointer-events: all`, so a source that never
 * completes locks the operator out of the terminal with no way back except
 * closing the tab. A no-progress window (rather than a total budget) keeps slow
 * but healthy catalog loads alive — a 40k-item sync ticks progress constantly.
 */
export const BOOT_LOADING_STALL_TIMEOUT_MS = 20_000;

// Internal tracking variables
let sourceCount = 0;
let completedSum = 0;
let isCompleting = false;
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let stallTimeoutMs = BOOT_LOADING_STALL_TIMEOUT_MS;

/**
 * Reactive loading state used by the UI.
 */
export const loadingState = reactive<LoadingState>({
	active: false,
	progress: 0,
	sources: {},
	message: __("Loading app data..."),
	sourceMessages: {
		init: __("Initializing application..."),
		items: __("Loading product catalog..."),
		customers: __("Loading customer database..."),
	},
	stalledSources: [],
});

function pendingSources(): string[] {
	return Object.entries(loadingState.sources)
		.filter(([, value]) => (value || 0) < 100)
		.map(([name]) => name);
}

function clearStallWatchdog(): void {
	if (stallTimer === null) {
		return;
	}

	clearTimeout(stallTimer);
	stallTimer = null;
}

/**
 * (Re)arms the no-progress watchdog. Called when sources are registered and on
 * every real progress increase, so a boot that keeps moving is never cut off.
 */
function armStallWatchdog(): void {
	clearStallWatchdog();

	if (sourceCount === 0 || isCompleting || !loadingState.active) {
		return;
	}

	stallTimer = setTimeout(() => {
		stallTimer = null;
		const pending = pendingSources();
		if (!pending.length || isCompleting || !loadingState.active) {
			return;
		}

		loadingState.stalledSources = pending;
		console.warn(
			`[posa][boot] Bootstrap loading made no progress for ${stallTimeoutMs}ms; releasing the blocking overlay so the route stays usable.`,
			{
				pendingSources: pending,
				progress: loadingState.progress,
				sources: { ...loadingState.sources },
			},
		);
		completeLoading();
	}, stallTimeoutMs);
}

/**
 * Overrides the watchdog window. Test seam — production code uses the default.
 */
export function setBootLoadingStallTimeout(
	timeoutMs = BOOT_LOADING_STALL_TIMEOUT_MS,
): void {
	stallTimeoutMs =
		Number.isFinite(timeoutMs) && timeoutMs > 0
			? timeoutMs
			: BOOT_LOADING_STALL_TIMEOUT_MS;
}

/**
 * Initializes the loading sources.
 * @param list List of source names to track
 */
export function initLoadingSources(list: string[]): void {
	// Reset state
	clearStallWatchdog();
	loadingState.sources = {};
	loadingState.stalledSources = [];
	sourceCount = list.length;
	completedSum = 0;
	isCompleting = false;

	// Validate input
	if (!list || list.length === 0) {
		console.warn("No loading sources provided");
		return;
	}

	list.forEach((name) => {
		loadingState.sources[name] = 0;
	});

	loadingState.progress = 0;
	loadingState.active = true;
	startBootstrapLoading();
	setScopeMeta("bootstrap", {
		kind: "bootstrap",
		blocking: true,
		message: loadingState.message,
		progress: 0,
	});
	armStallWatchdog();
}

/**
 * Sets the progress of a specific source.
 * @param name The source name
 * @param value Progress value (0-100)
 */
export function setSourceProgress(name: string, value: number): void {
	// Safety checks
	if (!(name in loadingState.sources) || isCompleting || sourceCount === 0)
		return;

	// Clamp value between 0 and 100 and prevent regressions
	const clampedValue = Math.max(0, Math.min(100, value));
	const oldValue = loadingState.sources[name] || 0;
	const newValue = Math.max(oldValue, clampedValue);

	loadingState.sources[name] = newValue;

	// Update message only if it changed
	const newMessage =
		loadingState.sourceMessages[name] || __(`Loading ${name}...`);
	if (loadingState.message !== newMessage) {
		loadingState.message = newMessage;
	}
	setScopeMeta("bootstrap", {
		message: loadingState.message,
		progress: loadingState.progress,
	});

	// Only update totals when progress increases
	if (newValue > oldValue) {
		completedSum += newValue - oldValue;
		const newProgress = Math.round(completedSum / sourceCount);

		// Only animate if progress actually changed
		if (newProgress !== loadingState.progress && newProgress <= 100) {
			animateProgress(loadingState.progress, newProgress);
		}

		if (newProgress >= 100 && !isCompleting) {
			completeLoading();
			return;
		}

		// Boot is still moving — give it another full watchdog window.
		armStallWatchdog();
	}
}

/**
 * Animates the progress bar from one value to another.
 */
function animateProgress(from: number, to: number): void {
	if (from === to) return;

	const startTime = performance.now();
	const duration = 300;

	function updateProgress(currentTime: number) {
		const elapsed = currentTime - startTime;
		const progress = Math.min(elapsed / duration, 1);

		// Use easing function for smoother animation
		const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
		loadingState.progress = Math.round(from + (to - from) * eased);

		if (progress < 1) {
			requestAnimationFrame(updateProgress);
		} else {
			loadingState.progress = to;
		}
		setScopeMeta("bootstrap", {
			message: loadingState.message,
			progress: loadingState.progress,
		});
	}

	requestAnimationFrame(updateProgress);
}

/**
 * Finalizes the loading process.
 */
function completeLoading(): void {
	// Prevent multiple completion calls
	if (isCompleting) return;
	isCompleting = true;
	clearStallWatchdog();

	loadingState.progress = 100;
	loadingState.message = __("Setup complete!");
	setScopeMeta("bootstrap", {
		message: loadingState.message,
		progress: 100,
	});

	// Brief completion phase, then show ready
	setTimeout(() => {
		if (!loadingState.active) return; // Check if still active
		loadingState.message = __("Ready!");
		setScopeMeta("bootstrap", {
			message: loadingState.message,
			progress: 100,
		});

		// Hide after showing ready message
		setTimeout(() => {
			loadingState.active = false;
			loadingState.message = __("Loading app data...");
			stopBootstrapLoading();
			// Reset for next use
			sourceCount = 0;
			completedSum = 0;
			isCompleting = false;
		}, 600);
	}, 400);
}

/**
 * Marks a specific source as 100% loaded.
 */
export function markSourceLoaded(name: string): void {
	setSourceProgress(name, 100);
}

/**
 * Manually resets the loading state.
 */
export function resetLoadingState(): void {
	clearStallWatchdog();
	loadingState.active = false;
	loadingState.progress = 0;
	loadingState.message = __("Loading app data...");
	loadingState.sources = {};
	loadingState.stalledSources = [];
	sourceCount = 0;
	completedSum = 0;
	isCompleting = false;
	stopBootstrapLoading();
}

/**
 * Gets current loading status for debugging.
 */
export function getLoadingStatus() {
	return {
		active: loadingState.active,
		progress: loadingState.progress,
		sources: { ...loadingState.sources },
		stalledSources: [...loadingState.stalledSources],
		sourceCount,
		completedSum,
		isCompleting,
		stallWatchdogArmed: stallTimer !== null,
	};
}
