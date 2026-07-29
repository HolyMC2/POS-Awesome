const SETTINGS_KEY = "posawesome_item_selector_settings";

/**
 * Interface for item selector settings.
 */
export interface ItemSelectorSettings {
    display_mode?: "list" | "card";
    show_images?: boolean;
    [key: string]: any;
}

/**
 * Loads item selector settings from localStorage.
 */
export const loadItemSelectorSettings = (): ItemSelectorSettings | null => {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (!saved) {
            return null;
        }
        const parsed = JSON.parse(saved);
        return parsed && typeof parsed === "object" ? (parsed as ItemSelectorSettings) : null;
    } catch (error) {
        console.error("Failed to load item selector settings:", error);
        return null;
    }
};

/**
 * Saves item selector settings to localStorage.
 *
 * Merges over what is already stored: callers own a subset of the blob
 * (the settings dialog writes the sync/pagination keys, the selector
 * writes `display_mode`), and a straight overwrite from either one would
 * silently drop the other's keys.
 */
export const saveItemSelectorSettings = (settings: ItemSelectorSettings): boolean => {
    try {
        const merged = { ...(loadItemSelectorSettings() || {}), ...settings };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
        return true;
    } catch (error) {
        console.error("Failed to save item selector settings:", error);
        return false;
    }
};

const isDisplayMode = (value: unknown): value is "list" | "card" =>
    value === "list" || value === "card";

/**
 * Reads the persisted list/card preference for the item catalog.
 * Returns null when nothing valid is stored, so the caller keeps its own
 * default.
 */
export const loadItemsViewPreference = (): "list" | "card" | null => {
    const saved = loadItemSelectorSettings();
    return isDisplayMode(saved?.display_mode) ? saved.display_mode : null;
};

/**
 * Persists the list/card preference. Cards suit a phone and lists suit a
 * counter monitor, so the choice has to survive the reload instead of
 * snapping back to "list" every shift.
 */
export const saveItemsViewPreference = (view: unknown): boolean => {
    if (!isDisplayMode(view)) {
        return false;
    }
    return saveItemSelectorSettings({ display_mode: view });
};
