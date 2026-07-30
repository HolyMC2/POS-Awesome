// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const trackMock = vi.hoisted(() => vi.fn());
const toastShow = vi.hoisted(() => vi.fn());

vi.mock("../src/posapp/utils/telemetry", () => ({ track: trackMock }));
vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({ show: toastShow }),
}));

import {
	PRINT_POPUP_BLOCKED_EVENT,
	reportPrintPopupBlocked,
	trackPrintPopupBlocked,
} from "../src/posapp/utils/printPopupBlocked";

describe("print popup-block reporting", () => {
	beforeEach(() => {
		trackMock.mockReset();
		toastShow.mockReset();
		delete (window as any).__;
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("counts a terminal block and tells the operator", () => {
		reportPrintPopupBlocked("payment-print");

		expect(trackMock).toHaveBeenCalledWith(PRINT_POPUP_BLOCKED_EVENT, 1, {
			context: "payment-print",
		});
		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({ color: "warning", key: "print-popup-blocked" }),
		);
	});

	it("counts a recoverable block without a second message", () => {
		// The caller (reprint new-tab) already explains the fallback in its
		// own words; a generic toast on top would contradict it.
		trackPrintPopupBlocked("reprint-last-new-tab");

		expect(trackMock).toHaveBeenCalledWith(PRINT_POPUP_BLOCKED_EVENT, 1, {
			context: "reprint-last-new-tab",
		});
		expect(toastShow).not.toHaveBeenCalled();
	});

	it("passes extra dimensions through to telemetry", () => {
		reportPrintPopupBlocked("offline-print", { doctype: "POS Invoice" });

		expect(trackMock).toHaveBeenCalledWith(PRINT_POPUP_BLOCKED_EVENT, 1, {
			context: "offline-print",
			doctype: "POS Invoice",
		});
	});

	it("still counts the block when the toast store is unavailable", () => {
		toastShow.mockImplementation(() => {
			throw new Error("no active pinia");
		});

		expect(() => reportPrintPopupBlocked("payment-entry-print")).not.toThrow();
		expect(trackMock).toHaveBeenCalled();
	});

	it("never lets a telemetry failure break the print path", () => {
		trackMock.mockImplementation(() => {
			throw new Error("buffer full");
		});

		expect(() => reportPrintPopupBlocked("hold-confirm-print")).not.toThrow();
		expect(toastShow).toHaveBeenCalled();
	});

	it("translates through the desk global when one is present", () => {
		(window as any).__ = (value: string) => `es::${value}`;

		reportPrintPopupBlocked("payment-print");

		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({ title: "es::The print window was blocked" }),
		);
	});
});
