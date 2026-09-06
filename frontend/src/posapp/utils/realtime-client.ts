/** Realtime loads independently of the register's module and DOM readiness. */
type Handler = (...args: any[]) => void;
type Factory = (url: string, options: Record<string, unknown>) => any;

let clientPromise: Promise<Factory | null> | null = null;

export function loadRealtimeClient(): Promise<Factory | null> {
	const available = (window as any).io;
	if (typeof available === "function") return Promise.resolve(available);
	if (clientPromise) return clientPromise;

	clientPromise = new Promise<Factory | null>((resolve) => {
		const script = document.createElement("script");
		script.src = "/socket.io/socket.io.js";
		script.async = true;
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timeout);
			script.onload = null;
			script.onerror = null;
			const factory = (window as any).io;
			if (typeof factory === "function") resolve(factory);
			else {
				script.remove();
				resolve(null);
			}
		};
		const timeout = window.setTimeout(finish, 15000);
		script.onload = finish;
		script.onerror = finish;
		document.head.appendChild(script);
	}).finally(() => { clientPromise = null; });
	return clientPromise;
}

export function makeRealtime() {
	let socket: any = null;
	let connecting: Promise<any> | null = null;
	let retryTimer: number | null = null;
	let retryDelay = 1000;
	const handlers = new Map<string, Set<Handler>>();

	function retryLater() {
		if (retryTimer !== null || !navigator.onLine) return;
		retryTimer = window.setTimeout(() => {
			retryTimer = null;
			void ensureSocket();
		}, retryDelay);
		retryDelay = Math.min(retryDelay * 2, 30000);
	}

	function ensureSocket(): Promise<any> {
		if (socket) return Promise.resolve(socket);
		if (connecting) return connecting;
		// New component subscriptions must respect a failed download's backoff.
		if (retryTimer !== null) return Promise.resolve(null);
		connecting = loadRealtimeClient().then((ioFactory) => {
			if (!ioFactory) {
				retryLater();
				return null;
			}
			const siteName = window.posawesome_site_name || "";
			const namespace = siteName ? `/${siteName}` : "";
			// Match Desk: polling-first with websocket upgrade and socket.io's
			// unlimited, backed-off reconnection after a foreground wifi flap.
			const ioOpts: Record<string, unknown> = { withCredentials: true };
			if (window.location.protocol === "https:") ioOpts.secure = true;
			socket = ioFactory(`${window.location.origin}${namespace}`, ioOpts);
			for (const [event, callbacks] of handlers) {
				for (const callback of callbacks) socket.on(event, callback);
			}
			socket.on("connect_error", (error: any) => {
				console.warn("[POSA][shim] socket connect_error:", error?.message || error);
			});
			retryDelay = 1000;
			return socket;
		}).catch((error) => {
			console.warn("[POSA][shim] realtime client unavailable:", error);
			retryLater();
			return null;
		}).finally(() => { connecting = null; });
		return connecting;
	}

	window.addEventListener("online", () => {
		if (retryTimer !== null) window.clearTimeout(retryTimer);
		retryTimer = null;
		void ensureSocket();
	});

	return {
		get socket() { return socket; },
		on(event: string, callback: Handler) {
			let callbacks = handlers.get(event);
			if (!callbacks) handlers.set(event, callbacks = new Set());
			if (callbacks.has(callback)) return;
			callbacks.add(callback);
			if (socket) socket.on(event, callback);
			else void ensureSocket();
		},
		off(event: string, callback?: Handler) {
			if (callback) handlers.get(event)?.delete(callback);
			else handlers.get(event)?.clear();
			if (callback) socket?.off(event, callback);
			else socket?.off(event);
		},
		emit(event: string, ...args: any[]) {
			void ensureSocket().then((active) => active?.emit(event, ...args));
		},
	};
}
