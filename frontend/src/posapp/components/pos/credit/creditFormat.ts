/**
 * Text, money and link helpers shared by the credit-sale components.
 *
 * `translate` is `__()` with the interpolation fallback a spec needs when the
 * Frappe global is absent (the same contract as flows/ledger/ledgerText.ts).
 * Money is formatted in the currency the server returned; an empty or unknown
 * currency formats as a plain number instead of guessing one.
 */
import { isApiEnvelopeError } from "../../../services/api";
import type { CreditCompliance } from "./creditApi";

type Interpolation = ReadonlyArray<string | number>;

export const translate = (text: string, args?: Interpolation): string => {
	const global = typeof window === "undefined" ? undefined : (window as any).__;
	if (typeof global === "function") {
		return (global as (_value: string, _params?: Interpolation) => string)(text, args);
	}
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index: string) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

const formatters = new Map<string, Intl.NumberFormat>();

const formatterFor = (currency: string): Intl.NumberFormat => {
	const cached = formatters.get(currency);
	if (cached) return cached;
	let formatter: Intl.NumberFormat;
	try {
		formatter = currency
			? new Intl.NumberFormat(undefined, { style: "currency", currency })
			: new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	} catch {
		// Not an ISO 4217 code: the number is still worth showing.
		formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}
	formatters.set(currency, formatter);
	return formatter;
};

export const formatMoney = (value: unknown, currency?: string | null): string => {
	const amount = Number(value);
	return formatterFor(String(currency || "").trim().toUpperCase()).format(Number.isFinite(amount) ? amount : 0);
};

/**
 * `2026-09-24` as the viewer's locale writes a date. Parsed as a LOCAL date:
 * `new Date("2026-09-24")` is UTC midnight, which west of Greenwich renders
 * as the day before.
 */
export const formatDate = (value?: string | null): string => {
	const text = String(value || "");
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
	if (!match) return text;
	const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
};

/**
 * Only same-origin files become links or image sources. The URL is parsed
 * rather than prefix-checked: `/\host` and `//host` both leave the origin.
 */
export const safeFileUrl = (url?: string | null): string | null => {
	const value = String(url || "").trim();
	if (!value || typeof window === "undefined") return null;
	try {
		const parsed = new URL(value, window.location.origin);
		if (parsed.origin !== window.location.origin) return null;
		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return null;
	}
};

/** Codes `api.ts` gives failures that never reached the server's answer. */
const TRANSPORT_CODES = new Set(["TIMEOUT", "TRANSPORT_ERROR", "ABORTED"]);

/**
 * The reason to show for a failed call: the server's own words for a refusal,
 * the caller's sentence for a lost connection (the transport messages are
 * untranslated English and say nothing about what to do next).
 */
export const describeError = (error: unknown, fallback: string): string => {
	if (isApiEnvelopeError(error) && TRANSPORT_CODES.has(error.code)) return fallback;
	const message = (error as { message?: unknown } | null)?.message;
	return typeof message === "string" && message.trim() ? message.trim() : fallback;
};

export type CreditTone = "neutral" | "positive" | "warning" | "negative";

interface ComplianceDisplay {
	tone: CreditTone;
	label: string;
}

const COMPLIANCE: Record<CreditCompliance, ComplianceDisplay> = {
	Faltante: { tone: "warning", label: "Paperwork pending" },
	Completo: { tone: "positive", label: "Paperwork complete" },
	Bloqueado: { tone: "negative", label: "Paperwork blocked" },
};

/** Tone and English source label for a compliance value; `__()` it at render. */
export const complianceDisplay = (compliance?: string | null): ComplianceDisplay =>
	COMPLIANCE[compliance as CreditCompliance] ?? COMPLIANCE.Faltante;
