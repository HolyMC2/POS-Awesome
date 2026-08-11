/**
 * Realtime wiring for the floor (spec §6.7).
 *
 * Frappe exposes no generic room-join, so occupancy rides the document room
 * `doc:POS Floor/<floor>` and the client `doc_subscribe`s to it — which also
 * buys the permission gate for free. And because socket delivery has **no
 * reconnect replay**, every consumer here pairs its events with an
 * authoritative pull: the socket is a latency optimisation, never the truth.
 *
 * @module posapp/stores/floor/floorRealtime
 */

const realtime = (): any => {
	try {
		return (window as any)?.frappe?.realtime || null;
	} catch {
		return null;
	}
};

const emitRealtime = (event: string, ...args: unknown[]) => {
	const rt = realtime();
	if (!rt) return;
	try {
		if (typeof rt.emit === "function") {
			rt.emit(event, ...args);
		} else if (rt.socket && typeof rt.socket.emit === "function") {
			rt.socket.emit(event, ...args);
		}
	} catch {
		/* no socket — the visibility/reconnect pull still covers us */
	}
};

export interface FloorRealtimeHandlers {
	/** Current floor docname, or null when nothing is selected. */
	activeFloor: () => string | null;
	/** A `posa_floor_update` / `posa_tabs_update` payload arrived. */
	onUpdate: (payload: any) => void;
	/** Socket reconnected, tab became visible, or the network came back. */
	onResync: () => void;
}

export interface FloorRealtime {
	bind: () => void;
	unbind: () => void;
	/** Join the active floor's room; a no-op when already joined. */
	subscribe: () => void;
	unsubscribe: () => void;
}

export const createFloorRealtime = (handlers: FloorRealtimeHandlers): FloorRealtime => {
	let subscribedFloor: string | null = null;
	let bound = false;

	const unsubscribe = () => {
		if (!subscribedFloor) return;
		emitRealtime("doc_unsubscribe", "POS Floor", subscribedFloor);
		subscribedFloor = null;
	};

	const subscribe = () => {
		const floor = handlers.activeFloor();
		if (!floor || subscribedFloor === floor) return;
		unsubscribe();
		subscribedFloor = floor;
		emitRealtime("doc_subscribe", "POS Floor", floor);
	};

	const onVisibilityChange = () => {
		if (document.visibilityState === "visible") {
			handlers.onResync();
		}
	};

	// A reconnect lands in a fresh socket with no rooms, so the subscription is
	// re-made before the pull that reconciles whatever was missed while away.
	const onReconnect = () => {
		subscribedFloor = null;
		subscribe();
		handlers.onResync();
	};

	const bind = () => {
		if (bound) return;
		bound = true;
		const rt = realtime();
		if (rt && typeof rt.on === "function") {
			rt.on("posa_floor_update", handlers.onUpdate);
			rt.on("posa_tabs_update", handlers.onUpdate);
		}
		try {
			rt?.socket?.on?.("connect", onReconnect);
		} catch {
			/* shimmed realtime without a raw socket — visibility still pulls */
		}
		document.addEventListener("visibilitychange", onVisibilityChange);
		window.addEventListener("online", onReconnect);
	};

	const unbind = () => {
		if (!bound) return;
		bound = false;
		const rt = realtime();
		try {
			rt?.off?.("posa_floor_update", handlers.onUpdate);
			rt?.off?.("posa_tabs_update", handlers.onUpdate);
			rt?.socket?.off?.("connect", onReconnect);
		} catch {
			/* nothing bound */
		}
		document.removeEventListener("visibilitychange", onVisibilityChange);
		window.removeEventListener("online", onReconnect);
		unsubscribe();
	};

	return { bind, unbind, subscribe, unsubscribe };
};
