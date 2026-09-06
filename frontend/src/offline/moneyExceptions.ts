import { getQueueEntries, type OfflineEntityType } from "./writeQueue";
import { getInvoiceOutboxRows } from "./invoiceOutbox";
import { currentQueueOwner } from "./queueOwnership";
import { initPromise } from "./db";
import { browserMoneyExceptions } from "../posapp/components/pos/payments/exceptions/moneyExceptionModel";

const entities: OfflineEntityType[] = ["invoice", "payment", "cash_movement", "restaurant_order"];
export async function readLocalMoneyExceptions() {
	await initPromise;
	const owner = currentQueueOwner();
	if (!owner) throw new Error("Sign in as the original cashier to review saved work.");
	const [results, [outbox]] = await Promise.all([
		Promise.allSettled(entities.map(entity => getQueueEntries(entity))),
		Promise.allSettled([getInvoiceOutboxRows()]),
	]);
	const current = currentQueueOwner();
	if (!current || JSON.stringify(current) !== JSON.stringify(owner)) throw new Error("The cashier or register changed. Reopen the exception report.");
	const entries = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
	const rows = browserMoneyExceptions(entries, outbox?.status === "fulfilled" ? outbox.value : []);
	return { rows: rows.slice(0, 100), has_more: rows.length > 100,
		errors: [...results.flatMap((result, index) => result.status === "rejected" ? [entities[index]] : []),
			...(outbox?.status === "fulfilled" ? [] : ["invoice_outbox"])] };
}
