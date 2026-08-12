/**
 * Utility functions for responsive item card layout.
 */

/**
 * Columns from the MEASURED container width (not the window). The card grid
 * lives in panels of very different widths — classic desk ≈ 40% of the
 * window, lean vertical = 100%, phone = 100% of a small window — so only the
 * container can size it. ~216px per column track keeps parity with the
 * legacy window-based buckets (390→1, 440→2, 768→3) and lets a full-width
 * desk panel fan out instead of hugging the left 40%. Capped at 6 so cards
 * stay readable on very wide registers.
 */
export const getCardColumnsForContainer = (width: number): number => {
    if (!width || width <= 0) {
        return 0;
    }
    return Math.max(1, Math.min(6, Math.floor(width / 216)));
};

/**
 * Calculates the number of columns based on container width.
 */
export const getCardColumns = (width: number): number => {
    if (width <= 768) {
        return 1;
    }
    if (width <= 1200) {
        return 2;
    }
    return 3;
};

/**
 * Calculates the gap between cards based on container width.
 */
export const getCardGap = (width: number): number => {
    if (width <= 768) {
        return 10;
    }
    if (width <= 1200) {
        return 12;
    }
    return 16;
};

/**
 * Calculates the padding for the card container based on container width.
 */
export const getCardPadding = (width: number): number => {
    if (width <= 768) {
        return 10;
    }
    if (width <= 1200) {
        return 12;
    }
    return 16;
};
