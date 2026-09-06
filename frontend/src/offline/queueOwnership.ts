import { memory } from "./db";

export type QueueOwner = { queue_user: string; queue_profile: string | null };

function session() {
	return (globalThis as any).frappe || (globalThis as any).window?.frappe;
}

export function queueOwnershipError(message: string): Error {
	const translate = session()?._ || (globalThis as any).window?.__ || (globalThis as any).__;
	return new Error(typeof translate === "function" ? translate(message) : message);
}

export function currentQueueOwner(): QueueOwner | null {
	const user = String(session()?.session?.user || "").trim();
	if (!user || user === "Guest") return null;
	// A login in another tab updates the cookie before this tab's boot object.
	// Refuse stale-session replay until this tab loads the new authenticated boot.
	if (typeof document !== "undefined") {
		const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("user_id="));
		if (cookie) {
			try { if (decodeURIComponent(cookie.slice(8)) !== user) return null; }
			catch { return null; }
		}
	}
	const opening = memory.pos_opening_storage;
	const shiftUser = opening?.pos_opening_shift?.user;
	const profile = !shiftUser || shiftUser === user
		? opening?.pos_profile?.name || opening?.pos_opening_shift?.pos_profile
		: null;
	return { queue_user: user, queue_profile: profile ? String(profile) : null };
}

export function ownsQueueEntry(entry: Partial<QueueOwner>): boolean {
	const current = currentQueueOwner();
	return !!current && entry.queue_user === current.queue_user &&
		(!entry.queue_profile || entry.queue_profile === current.queue_profile);
}

export function captureQueueOwner(payload: Record<string, any>): QueueOwner {
	const owner = currentQueueOwner();
	if (!owner) throw queueOwnershipError("Sign in before saving work on this register.");
	const profileRef = payload?.invoice?.pos_profile || payload?.pos_profile ||
		payload?.args?.pos_profile || payload?.args?.payload?.pos_profile ||
		payload?.payload?.pos_profile || owner.queue_profile;
	const profile = typeof profileRef === "object" ? profileRef?.name || owner.queue_profile : profileRef;
	if (profile && owner.queue_profile && String(profile) !== owner.queue_profile) {
		throw queueOwnershipError("The active POS profile changed. Reopen the original register before saving.");
	}
	return { ...owner, queue_profile: profile ? String(profile) : null };
}

export function assertQueueOwner(entry: Partial<QueueOwner>) {
	if (!ownsQueueEntry(entry)) {
		throw queueOwnershipError("This saved work belongs to another session. Sign in to the original cashier and register.");
	}
}

export function canRecoverLegacyQueue() {
	const roles = session()?.user_roles || session()?.boot?.user?.roles || [];
	return !!currentQueueOwner() && (currentQueueOwner()?.queue_user === "Administrator" ||
		(Array.isArray(roles) && roles.includes("System Manager")));
}
