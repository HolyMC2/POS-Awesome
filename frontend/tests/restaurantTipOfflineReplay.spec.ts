import { describe, expect, it } from "vitest";

import { buildEndpointArgs } from "../src/offline/restaurantQueue";
import type { RestaurantQueuePayload } from "../src/offline/restaurantTypes";

describe("offline restaurant tip replay", () => {
	it("preserves the exact tip and stable request id in the settle call", () => {
		const payload = {
			kind: "restaurant:order:settle",
			order_uid: "order-1",
			client_request_id: "tip-request-1",
			queued_at: "2026-08-12T00:00:00.000Z",
			args: {
				name_or_uid: "order-1",
				invoice_payload: { payments: [{ amount: 60 }] },
				tip_amount: 10,
			},
		} satisfies RestaurantQueuePayload;

		const firstReplay = buildEndpointArgs(payload);
		const retry = buildEndpointArgs(payload);

		expect(firstReplay.tip_amount).toBe(10);
		expect(firstReplay.client_request_id).toBe("tip-request-1");
		expect(retry).toEqual(firstReplay);
	});
});
