/** A Taller handoff narrows the existing queue; it never claims or pays a request. */
export function tallerHandoff(search: string) {
 const order = new URLSearchParams(search).get("taller_order")?.trim() || "";
 if (!order || order.length > 140 || Array.from(order).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
 return { order, returnUrl: `/taller/orders/${encodeURIComponent(order)}?tab=cobro` };
}
