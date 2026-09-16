/** Latest response wins per list; parallel lists cannot clear each other's busy state. */
export function beginInvoiceListRequest(owner: any, key: string) {
	owner.listRequests ??= {};
	const id = (owner.listRequests[key]?.id || 0) + 1;
	owner.listRequests[key] = { id, pending: true, error: "" };
	owner.loading = true;
	const current = () => owner.listRequests[key]?.id === id;
	return {
		current,
		fail(message: string) {
			if (current()) owner.listRequests[key].error = message;
		},
		finish() {
			if (current()) owner.listRequests[key].pending = false;
			owner.loading = Object.values(owner.listRequests).some((state: any) => state.pending);
		},
	};
}
