import api from "./api";
import { getShiftTerminalContext } from "../../offline/shiftTerminal";

const baseMethod = "posawesome.posawesome.api.cash_movement.service";

const cashMovementService = {
	getContext(pos_profile?: string, pos_opening_shift?: string) {
		return api.call(`${baseMethod}.get_cash_movement_context`, {
			pos_profile,
			pos_opening_shift,
		});
	},

	createExpense(payload: Record<string, any>) {
		return api.call(`${baseMethod}.create_pos_expense`, { payload: { ...getShiftTerminalContext(), ...payload } });
	},

	createDeposit(payload: Record<string, any>) {
		return api.call(`${baseMethod}.create_cash_deposit`, { payload: { ...getShiftTerminalContext(), ...payload } });
	},

	createCashIn(payload: Record<string, any>) {
		return api.call(`${baseMethod}.create_cash_in`, { payload: { ...getShiftTerminalContext(), ...payload } });
	},

	getShiftMovements(args: {
		pos_opening_shift: string;
		movement_type?: string;
		status?: string;
		search_text?: string;
		limit_start?: number;
		limit_page_length?: number;
	}) {
		return api.call(`${baseMethod}.get_shift_cash_movements`, args);
	},

	getSubmittedExpenses(args: {
		pos_opening_shift: string;
		limit_start?: number;
		limit_page_length?: number;
	}) {
		return api.call(`${baseMethod}.get_submitted_expenses`, args);
	},

	cancel(name: string) {
		return api.call(`${baseMethod}.cancel_cash_movement`, { name, ...getShiftTerminalContext() });
	},

	duplicate(name: string, posting_date?: string) {
		return api.call(`${baseMethod}.duplicate_cash_movement`, { name, posting_date, ...getShiftTerminalContext() });
	},

	remove(name: string) {
		return api.call(`${baseMethod}.delete_cash_movement`, { name, ...getShiftTerminalContext() });
	},
};

export default cashMovementService;
