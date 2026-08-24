import api from "./api";

import type { OrderStoryPayload } from "../components/pos/flows/orden/orderStory";

/**
 * The Orden de servicio read model, from the SPA's side.
 *
 * Three reads and nothing else: this file cannot charge, cannot load a cart
 * and cannot mark a request charged. Those stay on `charge_requests`'s write
 * endpoints, which the surface calls through the same path the legacy dialog
 * always used — see `OrdenSurface.vue`'s `collect`.
 */

const BASE = "posawesome.posawesome.api.charge_requests";

/** Provenance keys the server returns; the view turns them into Spanish. */
export type OrderLineProvenance = "stock" | "customer_supplied" | "ordered" | "labor";

export interface ServiceOrderLine {
	item_code: string;
	item_name: string;
	description?: string | null;
	qty: number;
	rate: number;
	amount: number;
	kind: "labor" | "part";
	provenance: OrderLineProvenance;
	billable: boolean;
	serial_no?: string | null;
}

export interface ServiceOrderCard {
	name: string;
	folio: string;
	reference_doctype?: string | null;
	reference_name?: string | null;
	customer?: string | null;
	customer_name?: string | null;
	/** IMEIs / serials on the device, so the search box can find it. */
	serials: string[];
	customer_phone?: string | null;
	title: string;
	amount_total: number;
	advance: number;
	repair_status?: string | null;
	invoiced: boolean;
	invoice?: string | null;
	warranty: boolean;
	no_charge: boolean;
	warranty_days?: number | null;
}

export interface ServiceOrderDetail extends ServiceOrderCard {
	technician?: string | null;
	received_on?: string | null;
	finished_on?: string | null;
	worked_minutes?: number | null;
	warranty_expires_on?: string | null;
	lines: ServiceOrderLine[];
}

export interface ServiceOrderCounts {
	ready: number;
	/** `null` on a tenant with no repair app — see the server's read model. */
	working: number | null;
	delivered: number;
}

export function fetchServiceOrderCounts(posProfile: string) {
	return api.call<ServiceOrderCounts>(`${BASE}.get_service_order_counts`, {
		pos_profile: posProfile,
	});
}

export function fetchServiceOrderQueue(posProfile: string, bucket: "ready" | "delivered") {
	return api.call<ServiceOrderCard[]>(`${BASE}.get_service_order_queue`, {
		pos_profile: posProfile,
		bucket,
	});
}

export function fetchServiceOrderDetail(posProfile: string, name: string) {
	return api.call<ServiceOrderDetail>(`${BASE}.get_service_order_detail`, {
		pos_profile: posProfile,
		name,
	});
}

/**
 * One document's timeline. `doctype` is "Repair Order" or "Sales Order" — the
 * server refuses anything else, because "the events of a document" is not a
 * generic question and an open-ended argument would be a read of anything.
 */
export function fetchOrderStory(doctype: string, name: string) {
	return api.call<OrderStoryPayload>("posawesome.posawesome.api.order_story.get_order_story", {
		doctype,
		name,
	});
}

let countsPromise: Promise<ServiceOrderCounts> | null = null;
let countsProfile: string | null = null;

/**
 * Session-cached counts, for the rail's badge.
 *
 * Same shape as `getDashboardAccessCached`, and for the same reason: the shell
 * asks on mount, on the hottest path in the product, and a badge is not worth
 * a round trip per render. A transport failure clears the cache so the next
 * caller retries; a profile change starts a new cache rather than reporting
 * the previous register's queue.
 */
export function getServiceOrderCountsCached(posProfile: string, force = false) {
	if (force || !countsPromise || countsProfile !== posProfile) {
		countsProfile = posProfile;
		countsPromise = fetchServiceOrderCounts(posProfile).catch((error) => {
			countsPromise = null;
			throw error;
		});
	}
	return countsPromise;
}

/** Drop the cached counts — after a charge, the queue is one shorter. */
export function invalidateServiceOrderCounts() {
	countsPromise = null;
	countsProfile = null;
}
