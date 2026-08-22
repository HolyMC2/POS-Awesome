/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const configDir = dirname(fileURLToPath(import.meta.url));

function loadLocalEnvFile(filename = ".env.local") {
	const envPath = resolve(configDir, filename);
	if (!existsSync(envPath)) {
		return;
	}

	const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		const separatorIndex = trimmed.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}

		const key = trimmed.slice(0, separatorIndex).trim();
		if (!key || process.env[key] !== undefined) {
			continue;
		}

		let value = trimmed.slice(separatorIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		process.env[key] = value;
	}
}

loadLocalEnvFile();

const baseURL = process.env.POSA_SMOKE_BASE_URL || "http://127.0.0.1:8000";

export default defineConfig({
	testDir: "./tests",
	// `visual/**` is the design-evidence lane (docs/POS-RIEL-Y-CAJON-BUILD.md
	// §5). It captures rather than asserts, so it is opt-in by grep/path and
	// never gates CI — a redesign is judged against the canvas by eye.
	testMatch: ["smoke/**/*.spec.ts", "e2e/**/*.spec.ts", "visual/**/*.spec.ts"],
	timeout: 120000,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [["github"], ["html", { open: "never" }]]
		: "list",
	use: {
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
		// Lab + dev sites use self-signed certs; production runs land
		// on a real CA so this only loosens the local/lab path.
		ignoreHTTPSErrors: true,
	},
});
