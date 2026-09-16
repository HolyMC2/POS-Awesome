/** A Taller handoff narrows the existing queue; it never claims or pays a request. */
export function tallerHandoff(search: string) {
 const order = new URLSearchParams(search).get("taller_order")?.trim() || "";
 if (!order || order.length > 140 || /[\x00-\x1f\x7f]/.test(order)) return null;
 return { order, returnUrl: `/taller/orders/${encodeURIComponent(order)}?tab=cobro` };
}
