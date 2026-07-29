/**
 * Interface representing a table header configuration.
 */
export interface TableHeader {
    title: string;
    key: string;
    align?: "start" | "center" | "end";
    sortable?: boolean;
    width?: string;
}

/**
 * Get table headers configuration for items list view.
 * @param context Context: 'pos' or 'purchase'
 * @param posProfile POS profile configuration
 * @returns Array of header configurations
 */
export function getItemsTableHeaders(context: "pos" | "purchase" | string, posProfile?: any): TableHeader[] {
    if (context === "purchase") {
        return [
            {
                title: __("Item"),
                key: "item_name",
                align: "start",
                sortable: true,
                width: "40%",
            },
            {
                title: __("Buying Price"),
                key: "rate",
                align: "end",
                sortable: true,
                width: "25%",
            },
            {
                title: __("Stock"),
                key: "actual_qty",
                align: "end",
                sortable: true,
                width: "20%",
            },
        ];
    }

    const headers: TableHeader[] = [
        {
            title: __("Name"),
            align: "start",
            sortable: true,
            key: "item_name",
            // Item names are the primary read target; squeezing them
            // into 1/5 of the row leaves operators staring at
            // "Bocina Auricula…". Give Name the lion's share so long
            // names like "Bocina Auricular para iPhone XR" fit.
            width: "38%",
        },
        {
            title: __("Code"),
            align: "start",
            sortable: true,
            key: "item_code",
            width: "18%",
        },
        { title: __("Rate"), key: "rate", align: "start", width: "18%" },
        {
            title: __("Available QTY"),
            key: "actual_qty",
            align: "start",
            width: "14%",
        },
        { title: __("UOM"), key: "stock_uom", align: "start", width: "12%" },
    ];

    // Remove item code column if configured
    if (posProfile && !posProfile.posa_display_item_code) {
        headers.splice(1, 1);
    }

    return headers;
}

/**
 * Width tiers for the catalog list view, mirroring the cart's law in
 * `useItemsTableResponsive.getResponsiveVisibleHeaders`: measure the
 * container, then drop the columns that stopped earning their share.
 *
 * Name and Rate are never dropped — they are what the operator reads to
 * pick an item. Everything else goes least-useful-first: UOM, then Code,
 * then Available QTY, so a 360px phone still shows a legible name and a
 * price instead of five columns of ellipsis.
 */
const CATALOG_WIDTH_TIERS: { maxWidth: number; drop: string[] }[] = [
    { maxWidth: 360, drop: ["stock_uom", "item_code", "actual_qty"] },
    { maxWidth: 480, drop: ["stock_uom", "item_code"] },
    { maxWidth: 620, drop: ["stock_uom"] },
];

/**
 * Below this container width the row runs its tighter cell padding: at
 * four columns, 16px either side spends over a fifth of a 600px row on
 * whitespace.
 */
export const CATALOG_COMPACT_MAX_WIDTH = 620;

const parsePercentage = (width: TableHeader["width"]): number | null => {
    if (typeof width !== "string") return null;
    const match = /^\s*([\d.]+)\s*%\s*$/.exec(width);
    if (!match) return null;
    const parsed = Number.parseFloat(match[1] as string);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Percentage widths are authored to fill the whole row, and CSS grid
 * does not reflow `%` tracks when one goes away — dropping UOM would
 * simply leave 12% of the row blank. Rescale the survivors so they add
 * back up to 100%. Non-percentage widths (`1fr`, numbers) are left
 * alone: they already flex.
 */
const rescaleWidths = (headers: TableHeader[]): TableHeader[] => {
    const percentages = headers.map((header) => parsePercentage(header.width));
    if (percentages.some((value) => value === null)) return headers;
    const total = (percentages as number[]).reduce((sum, value) => sum + value, 0);
    if (!total) return headers;
    return headers.map((header, index) => ({
        ...header,
        width: `${Math.round((((percentages[index] as number) * 100) / total) * 100) / 100}%`,
    }));
};

/**
 * Filter a header set down to what fits `width` pixels of container.
 * A width of 0 means "not measured yet" and returns the headers as-is,
 * so the first paint is never narrower than the real layout.
 */
export function getResponsiveItemsTableHeaders(headers: TableHeader[], width: number): TableHeader[] {
    if (!Array.isArray(headers) || headers.length === 0) return [];
    if (!(width > 0)) return headers;

    const tier = CATALOG_WIDTH_TIERS.find((candidate) => width < candidate.maxWidth);
    if (!tier) return headers;

    const dropped = new Set(tier.drop);
    const visible = headers.filter((header) => !dropped.has(header.key));
    if (visible.length === headers.length) return headers;

    return rescaleWidths(visible);
}

/**
 * Whether the catalog row should run its compact cell padding.
 */
export function isCompactCatalogWidth(width: number): boolean {
    return width > 0 && width < CATALOG_COMPACT_MAX_WIDTH;
}
