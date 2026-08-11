/**
 * Pure RFC (Registro Federal de Contribuyentes) validation — TS port of
 * emc's fiscal/validation/rfc.py so the stamp form can reject a typo'd RFC
 * on keystroke instead of after a server round trip. The server remains
 * authoritative: every stamp path re-runs the same checks in Python.
 *
 * The prize is the dígito verificador: a mod-11 checksum over the SAT
 * base-37 alphabet that catches transpositions a plain regex passes but
 * the PAC rejects. Verified against GODE561231GR8 (PF) and SAT970701NN3
 * (PM), same as the Python module.
 */

// Position = value. space → 37, Ñ → 38. Used for the check-digit weighting.
const ALPHABET = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ";

export const GENERIC_NATIONAL = "XAXX010101000"; // público en general
export const GENERIC_FOREIGN = "XEXX010101000"; // residente en el extranjero

// 3 letters (moral) or 4 (física), 6-digit date, 3-char homoclave.
const SHAPE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

export interface RfcIssue {
	code: string;
	message: string;
}

export function normalizeRfc(rfc: string | null | undefined): string {
	if (!rfc) return "";
	return rfc.trim().toUpperCase().replace(/-/g, "").replace(/ /g, "");
}

export function rfcKind(rfc: string | null | undefined): "PF" | "PM" | null {
	const r = normalizeRfc(rfc);
	if (r.length === 13) return "PF";
	if (r.length === 12) return "PM";
	return null;
}

export function isGenericRfc(rfc: string | null | undefined): boolean {
	const r = normalizeRfc(rfc);
	return r === GENERIC_NATIONAL || r === GENERIC_FOREIGN;
}

export function rfcCheckDigit(base: string): string {
	let b = base.toUpperCase();
	if (b.length === 11) b = ` ${b}`; // left-pad moral to 12 positions
	if (b.length !== 12) return "";
	let total = 0;
	for (let i = 0; i < b.length; i += 1) {
		const value = ALPHABET.indexOf(b.charAt(i));
		if (value < 0) return "";
		total += value * (13 - i);
	}
	const dv = 11 - (total % 11);
	if (dv === 11) return "0";
	if (dv === 10) return "A";
	return String(dv);
}

function hasValidChecksum(rfc: string): boolean {
	if (rfc.length !== 12 && rfc.length !== 13) return false;
	const computed = rfcCheckDigit(rfc.slice(0, -1));
	return Boolean(computed) && computed === rfc.slice(-1);
}

function hasValidDate(rfc: string): boolean {
	const yymmdd = rfc.slice(-9, -3);
	if (!/^\d{6}$/.test(yymmdd)) return false;
	const month = Number(yymmdd.slice(2, 4));
	const day = Number(yymmdd.slice(4, 6));
	return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Failing checks for an RFC — empty array means well-formed. */
export function validateRfc(rfc: string | null | undefined): RfcIssue[] {
	const r = normalizeRfc(rfc);
	if (!r) {
		return [{ code: "RFC-001", message: "Falta el RFC." }];
	}
	if (rfcKind(r) === null || !SHAPE.test(r)) {
		return [
			{
				code: "RFC-001",
				message: `El RFC «${r}» no tiene una forma válida (12 o 13 caracteres).`,
			},
		];
	}
	const issues: RfcIssue[] = [];
	if (!hasValidDate(r)) {
		issues.push({
			code: "RFC-002",
			message: `La fecha embebida en el RFC «${r}» no es válida.`,
		});
	}
	if (!isGenericRfc(r) && !hasValidChecksum(r)) {
		const expected = rfcCheckDigit(r.slice(0, -1));
		const hint = expected ? ` (dígito esperado: ${expected})` : "";
		issues.push({
			code: "RFC-003",
			message: `El dígito verificador del RFC «${r}» es incorrecto${hint}.`,
		});
	}
	return issues;
}

export function isValidRfc(rfc: string | null | undefined): boolean {
	return validateRfc(rfc).length === 0;
}
