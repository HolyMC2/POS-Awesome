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
