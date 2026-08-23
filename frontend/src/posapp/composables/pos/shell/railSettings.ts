/**
 * The settings entries the rail's «Más» flyout offers (§17.7 addendum).
 *
 * These are NOT destinations, and they are deliberately not in
 * `railDestinations.ts`: nothing here occupies the content area, changes the
 * URL or has a screen at all. They are the navbar actions menu's entries,
 * reachable from the rail — because the rail replaced the hamburger drawer as
 * the desktop navigation, and a cashier standing at the rail should not have
 * to go back up to the navbar to change the language or check for an update.
 *
 * ## Why an id and not a handler
 *
 * Every dialog behind these lives in `NavbarMenu.vue` (Language, QZ Tray) or
 * in `Navbar.vue` above it (About), together with the gating that decides
 * whether the entry exists at all. The rail is in a different tree and must
 * not own a second copy of any of that — a second QZ dialog would be a second
 * certificate flow, and a second gate would be a gate that drifts.
 *
 * So `RailSetting.id` IS `NavbarMenu`'s action id. The rail names one on the
 * bus; that menu looks it up in its OWN action list and runs its OWN handler.
 * An entry the profile has gated off is simply not in that list, so naming it
 * does nothing — which is the behaviour we want and not a special case anyone
 * has to write. `railSettingsGroup.spec.ts` pins the ids against the source.
 *
 * Pure by construction, like `railDestinations.ts`: no Vue, no store, no
 * `__()`. Labels are English source strings, wrapped at render.
 */

export const RAIL_SETTING_IDS = [
	"qz-tray-setup",
	"language",
	"check-for-updates",
	"about",
] as const;

export type RailSettingId = (typeof RAIL_SETTING_IDS)[number];

/**
 * Capability questions the shell answers for the settings group. Only one so
 * far, and it is a POS Profile flag rather than a preset capability: a
 * terminal that prints through the browser has no QZ certificate to manage.
 */
export type RailSettingGate = "silentPrint";

export interface RailSetting {
	/** `NavbarMenu`'s action id — see the note above. Never invent one here. */
	id: RailSettingId;
	/** English source. Translated at render, never in this module. */
	label: string;
	icon: string;
	/** One line under the label, same as the tools group's `hint`. */
	hint: string;
	gate: RailSettingGate | null;
	/**
	 * Needs the server to be reachable to do anything at all, so the flyout
	 * dims it offline exactly as it dims a blocked destination. QZ is a local
	 * websocket and the About dialog reads the boot payload, so neither is.
	 */
	needsConnection: boolean;
}

export const RAIL_SETTINGS: readonly RailSetting[] = [
	{
		id: "qz-tray-setup",
		label: "QZ Tray Setup",
		icon: "mdi-printer-wireless",
		hint: "Connect printer and manage certificate",
		gate: "silentPrint",
		needsConnection: false,
	},
	{
		id: "language",
		label: "Language",
		icon: "mdi-translate",
		hint: "Change interface language",
		gate: null,
		// The change itself is a server call, but the dialog is where the
		// operator finds that out — and offering it offline is how they learn
		// the setting exists. The navbar menu does not gate it either.
		needsConnection: false,
	},
	{
		id: "check-for-updates",
		label: "Check for Updates",
		icon: "mdi-update",
		hint: "Check for new commits",
		gate: null,
		needsConnection: true,
	},
	{
		id: "about",
		label: "About",
		icon: "mdi-information-outline",
		hint: "App information",
		gate: null,
		needsConnection: false,
	},
] as const;

/** One settings entry, fully resolved for render. Mirrors `RailItem`. */
export interface RailSettingItem {
	id: RailSettingId;
	label: string;
	icon: string;
	hint: string;
	/** Reachable but degraded — needs signal. Draws the amber dot. */
	dimmed: boolean;
	/** Not runnable right now (shift closed, or offline and server-bound). */
	disabled: boolean;
	/**
	 * Label plus the reason it cannot be used. The amber dot is aria-hidden,
	 * so this is the only carrier of "needs connection" for a screen reader —
	 * the same rule the destinations follow.
	 */
	ariaLabel: string;
}

export interface RailSettingsContext {
	/** Frappe translation. Passed in so this module stays free of the global. */
	__: (key: string) => string;
	/** `posa_silent_print` on the POS Profile. */
	silentPrint: boolean;
	/** Register has no usable connection right now. */
	offline: boolean;
	/** The whole rail is inert until the shift opens (§5.1). */
	railDisabled: boolean;
}

/** The settings entries this register actually has, in render order. */
export const visibleRailSettings = (silentPrint: boolean): readonly RailSetting[] =>
	RAIL_SETTINGS.filter((setting) => setting.gate === null || silentPrint);

export function resolveRailSettings(ctx: RailSettingsContext): RailSettingItem[] {
	return visibleRailSettings(ctx.silentPrint).map((setting) => {
		const offlineBlocked = ctx.offline && setting.needsConnection;
		const label = ctx.__(setting.label);

		const notes: string[] = [];
		if (ctx.railDisabled) {
			notes.push(ctx.__("Shift not open"));
		} else if (offlineBlocked) {
			notes.push(ctx.__("Needs connection"));
		}

		return {
			id: setting.id,
			label,
			icon: setting.icon,
			hint: ctx.__(setting.hint),
			dimmed: offlineBlocked,
			disabled: ctx.railDisabled || offlineBlocked,
			ariaLabel: notes.length ? `${label} — ${notes.join(" · ")}` : label,
		};
	});
}
