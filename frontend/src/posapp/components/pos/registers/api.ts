import api from "../../../services/api";

export type ShiftQueue = "attention" | "open" | "closed";
export interface ShiftRow {
	name: string;
	user: string;
	cashier_name: string;
	pos_profile: string;
	company: string;
	warehouse: string;
	status: "Open" | "Closed";
	period_start_date: string;
	period_end_date: string | null;
	pos_closing_shift: string | null;
	recovery_pending: boolean;
	older_shift: boolean;
	is_mine: boolean;
}
export interface ShiftPage {
	shifts: ShiftRow[];
	summary: { open: number; attention: number };
	can_manage: boolean;
	as_of: string;
	next_cursor: string | null;
}
export interface ShiftDetail {
	shift: ShiftRow;
	can_manage: boolean;
	as_of: string;
	amounts_hidden: boolean;
	currency: string;
	cash_movements_enabled: boolean;
	closing_enabled: boolean;
	tenders: { mode_of_payment: string; opening_amount: number; expected_amount: number }[];
	movements: { name: string; posting_date: string; movement_type: string; amount: number; remarks: string }[];
}
export const listShifts = (queue: ShiftQueue, search: string, cursor?: string | null) =>
	api.call<ShiftPage>("posawesome.posawesome.api.registers.list_shifts", { queue, search, cursor });
export const shiftDetail = (opening_shift: string) =>
	api.call<ShiftDetail>("posawesome.posawesome.api.registers.shift_detail", { opening_shift });
