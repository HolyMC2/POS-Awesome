/**
 * Getting a credit document from the cashier's camera or files to the server.
 *
 * A phone camera writes 3–20 MB JPEGs at 4000 px and more; the provider needs
 * a legible ID or contract, not the sensor's full resolution. So an image
 * whose longest side is over 2560 px, or whose file is over 1.5 MB, is
 * re-encoded as a JPEG (quality 0.85) on a canvas before it is sent. A PDF
 * travels exactly as chosen.
 *
 * The size limit applies to what is SENT: a PDF over it is refused before it
 * is read, while an image is refused only when even its re-encoded copy is
 * over it — refusing the camera's own file would refuse most phones.
 *
 * Everything but the canvas work is pure and exported for the specs; the
 * browser pieces (`decodeImage`, `encodeJpeg`) can be replaced through
 * `prepareUpload`'s options.
 */

export const DEFAULT_MAX_UPLOAD_MB = 10;
export const MAX_IMAGE_EDGE = 2560;
export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
export const JPEG_QUALITY = 0.85;

/** Image types the server stores as they are. Others are re-encoded or refused. */
export const IMAGE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
export const PDF_TYPE = "application/pdf";
/** «Upload file»: photos the server keeps as they are, and PDFs. */
export const FILE_ACCEPT = [...IMAGE_TYPES, PDF_TYPE].join(",");
/** «Take photo»: whatever the camera writes; it is re-encoded when needed. */
export const CAMERA_ACCEPT = "image/*";

export type UploadRefusal = "too-large" | "unsupported" | "unreadable";

export class UploadRefusedError extends Error {
	reason: UploadRefusal;
	limitMb: number;

	constructor(reason: UploadRefusal, limitMb: number) {
		super(reason);
		this.name = "UploadRefusedError";
		this.reason = reason;
		this.limitMb = limitMb;
	}
}

export interface PreparedUpload {
	filename: string;
	/** Base64 bytes, without the `data:` prefix. */
	content: string;
	bytes: number;
	type: string;
}

interface FileFacts {
	name?: string;
	type?: string;
	size: number;
}

/** The limit in MB, falling back to the default for a missing or silly value. */
export const uploadLimitMb = (maxUploadMb?: number | null): number => {
	const value = Number(maxUploadMb);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_UPLOAD_MB;
};

export const exceedsLimit = (bytes: number, maxUploadMb?: number | null): boolean =>
	bytes > uploadLimitMb(maxUploadMb) * 1024 * 1024;

/** Some Android pickers hand a PDF over with no type at all. */
export const isPdf = (file: FileFacts): boolean =>
	file.type === PDF_TYPE || (!file.type && /\.pdf$/i.test(file.name || ""));

export const isImage = (file: FileFacts): boolean => String(file.type || "").startsWith("image/");

/** Whether an image must be re-encoded before it is sent. */
export const needsDownscale = (
	image: { width: number; height: number },
	file: { size: number; type?: string },
): boolean =>
	Math.max(image.width, image.height) > MAX_IMAGE_EDGE ||
	file.size > MAX_IMAGE_BYTES ||
	!IMAGE_TYPES.includes(String(file.type || ""));

/** The size that fits the longest side within `maxEdge`. Never enlarges. */
export const fitWithin = (width: number, height: number, maxEdge = MAX_IMAGE_EDGE) => {
	const ratio = Math.min(1, maxEdge / Math.max(width, height, 1));
	return {
		width: Math.max(1, Math.round(width * ratio)),
		height: Math.max(1, Math.round(height * ratio)),
	};
};

/** `IMG_2041.HEIC` → `IMG_2041.jpg`; a nameless camera shot gets a name. */
export const jpegName = (name?: string | null): string => {
	const base = String(name || "").trim().replace(/\.[^./\\]*$/, "");
	return `${base || "photo"}.jpg`;
};

/** The bytes after the comma of a `data:` URL; anything else is returned as is. */
export const base64FromDataUrl = (value: string): string => {
	const comma = value.indexOf(",");
	return value.startsWith("data:") && comma !== -1 ? value.slice(comma + 1) : value;
};

export const readAsDataUrl = (blob: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ""));
		reader.onerror = () => reject(reader.error || new Error("unreadable"));
		reader.readAsDataURL(blob);
	});

export interface DecodedImage {
	width: number;
	height: number;
	source: CanvasImageSource;
	close(): void;
}

export type ImageDecoder = (_file: Blob) => Promise<DecodedImage | null>;
export type ImageEncoder = (
	_image: DecodedImage,
	_size: { width: number; height: number },
	_quality: number,
) => Promise<Blob | null>;

/** `null` when this browser cannot read the image (no decoder, or a format it lacks). */
export const decodeImage: ImageDecoder = async (file) => {
	if (typeof createImageBitmap !== "function") return null;
	try {
		const bitmap = await createImageBitmap(file);
		return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
	} catch {
		return null;
	}
};

export const encodeJpeg: ImageEncoder = (image, size, quality) =>
	new Promise((resolve) => {
		const canvas = document.createElement("canvas");
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext("2d");
		if (!context) {
			resolve(null);
			return;
		}
		// JPEG has no alpha: a transparent PNG would otherwise turn black.
		context.fillStyle = "#fff";
		context.fillRect(0, 0, size.width, size.height);
		context.drawImage(image.source, 0, 0, size.width, size.height);
		canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
	});

const packed = async (blob: Blob, filename: string, type: string): Promise<PreparedUpload> => {
	let dataUrl: string;
	try {
		dataUrl = await readAsDataUrl(blob);
	} catch {
		throw new UploadRefusedError("unreadable", 0);
	}
	return { filename, content: base64FromDataUrl(dataUrl), bytes: blob.size, type };
};

export interface PrepareOptions {
	maxUploadMb?: number | null;
	decode?: ImageDecoder;
	encode?: ImageEncoder;
}

/**
 * Turn the chosen file into the upload payload, or throw `UploadRefusedError`
 * with the reason the cashier is shown.
 */
export async function prepareUpload(file: File, options: PrepareOptions = {}): Promise<PreparedUpload> {
	const limitMb = uploadLimitMb(options.maxUploadMb);
	const refuse = (reason: UploadRefusal) => new UploadRefusedError(reason, limitMb);

	if (isPdf(file)) {
		if (exceedsLimit(file.size, limitMb)) throw refuse("too-large");
		return packed(file, file.name || "document.pdf", PDF_TYPE);
	}
	if (!isImage(file)) throw refuse("unsupported");

	const storable = IMAGE_TYPES.includes(file.type);
	const decoded = await (options.decode ?? decodeImage)(file);
	if (!decoded) {
		// Nothing to measure or re-encode with: send the original only when the
		// server can keep it as it is.
		if (!storable) throw refuse("unsupported");
		if (exceedsLimit(file.size, limitMb)) throw refuse("too-large");
		return packed(file, file.name || jpegName(""), file.type);
	}
	try {
		if (!needsDownscale(decoded, file)) {
			if (exceedsLimit(file.size, limitMb)) throw refuse("too-large");
			return await packed(file, file.name || jpegName(""), file.type);
		}
		const size = fitWithin(decoded.width, decoded.height);
		const blob = await (options.encode ?? encodeJpeg)(decoded, size, JPEG_QUALITY);
		if (!blob) {
			if (!storable) throw refuse("unreadable");
			if (exceedsLimit(file.size, limitMb)) throw refuse("too-large");
			return await packed(file, file.name || jpegName(""), file.type);
		}
		if (exceedsLimit(blob.size, limitMb)) throw refuse("too-large");
		return await packed(blob, jpegName(file.name), "image/jpeg");
	} finally {
		decoded.close();
	}
}
