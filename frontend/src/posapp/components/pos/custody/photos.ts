export interface CashPhotoTarget { doctype: "POS Cash Bag" | "POS Cash Count"; name: string }
interface PhotoPanel { hasPending(): boolean; destroy(): void }
const asset = "/assets/posawesome/js/cash_photos.js?v=20260923-photo-evidence";
let loading: Promise<void> | undefined;
const __ = (text: string) => (window as any).__?.(text) || text;
function loadScript() {
	if ((window as any).posaCashPhotos) return Promise.resolve();
	if (!loading) loading = new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = asset;
		script.onload = () => resolve();
		script.onerror = () => { script.remove(); loading = undefined; reject(Error("photos")); };
		document.head.append(script);
	});
	return loading;
}
/** One uploader implementation is shared with Desk; retry never repeats a cash action. */
export function mountCashPhotos(host: HTMLElement, target: CashPhotoTarget): PhotoPanel {
	let panel: PhotoPanel | undefined, disposed = false;
	async function mount() {
		try {
			await loadScript();
			if (!disposed) panel = (window as any).posaCashPhotos.mount(host, target);
		} catch {
			if (disposed) return;
			host.replaceChildren();
			const retry = document.createElement("button");
			retry.type = "button";
			retry.textContent = __("Load photo evidence");
			retry.onclick = mount;
			host.append(retry);
		}
	}
	void mount();
	return { hasPending: () => Boolean(panel?.hasPending()), destroy() { disposed = true; panel?.destroy(); } };
}
