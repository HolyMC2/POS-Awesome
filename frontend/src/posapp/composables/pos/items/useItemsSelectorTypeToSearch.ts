import type { Ref } from "vue";

type UseItemsSelectorTypeToSearchArgs = {
	getContext: () => string;
	activeView: Ref<string>;
	cameraScannerActive: Ref<boolean>;
	prepareSearchInjection: () => void;
	revealItemSearchView: () => void;
	requestForegroundItemSearchFocus: () => void;
	appendSearchCharacter: (_character: string) => void;
};

const SEARCH_TRIGGER_KEY_PATTERN = /^[\p{L}\p{N}\-._/\\]$/u;

function isEditableElement(element: Element | null | undefined) {
	if (!(element instanceof HTMLElement)) {
		return false;
	}

	const contentEditable = element.getAttribute("contenteditable");
	if (
		element.isContentEditable ||
		(typeof element.contentEditable === "string" &&
			element.contentEditable.toLowerCase() !== "inherit") ||
		(contentEditable !== null && contentEditable.toLowerCase() !== "false")
	) {
		return true;
	}

	const tagName = element.tagName;
	if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
		return true;
	}

	return Boolean(
		element.closest(
			"input, textarea, select, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']",
		),
	);
}

function isTypeToSearchKey(event: KeyboardEvent) {
	if (!event || event.defaultPrevented || event.repeat || event.isComposing) {
		return false;
	}
	if (event.ctrlKey || event.metaKey || event.altKey) {
		return false;
	}
	return SEARCH_TRIGGER_KEY_PATTERN.test(event.key || "");
}

function hasVisibleDialog() {
	if (typeof document === "undefined") {
		return false;
	}

	const dialogs = document.querySelectorAll("[role='dialog']");
	return Array.from(dialogs).some((dialog) => {
		if (!(dialog instanceof HTMLElement)) {
			return false;
		}
		return Boolean(dialog.offsetWidth || dialog.offsetHeight || dialog.getClientRects().length);
	});
}

export function registerItemsSelectorTypeToSearch({
	getContext,
	activeView,
	cameraScannerActive,
	prepareSearchInjection,
	revealItemSearchView,
	requestForegroundItemSearchFocus,
	appendSearchCharacter,
}: UseItemsSelectorTypeToSearchArgs) {
	if (getContext() !== "pos" || typeof document === "undefined") {
		return () => {};
	}

	/** A hosted destination (Cobranza, Series y lotes…) or the anchored pay
	 *  screen has the keyboard; a bare key there must not reveal the sale. */
	const isAnotherSurfaceUp = () =>
		Boolean(
			document.querySelector(".destination-host, [data-pos-keyboard-root='payment']") &&
				Array.from(
					document.querySelectorAll(".destination-host, [data-pos-keyboard-root='payment']"),
				).some((el) => el instanceof HTMLElement && (el.offsetWidth || el.offsetHeight)),
		);

	const isCartRowFocused = () =>
		Boolean(
			document.activeElement instanceof Element &&
				document.activeElement.closest('[data-pos-keyboard-target="cart-row"]'),
		);

	const handleGlobalTypeToSearchKeydown = (event: KeyboardEvent) => {
		if (!isTypeToSearchKey(event)) {
			return;
		}

		if (
			getContext() !== "pos" ||
			activeView.value === "payment" ||
			cameraScannerActive.value ||
			hasVisibleDialog() ||
			isEditableElement(document.activeElement) ||
			// A focused cart line owns its bare keys (the keymap's ROW scope:
			// p = price, d = discount, s = serial…). Routing them into the
			// search box here would steal the loop the line exists for.
			isCartRowFocused() ||
			isAnotherSurfaceUp()
		) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		prepareSearchInjection();
		revealItemSearchView();
		requestForegroundItemSearchFocus();
		appendSearchCharacter(event.key);
	};

	document.addEventListener("keydown", handleGlobalTypeToSearchKeydown, true);

	return () => {
		document.removeEventListener("keydown", handleGlobalTypeToSearchKeydown, true);
	};
}
