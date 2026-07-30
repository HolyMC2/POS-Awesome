// @vitest-environment jsdom

import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	SELFTEST_EVENT,
	SELFTEST_STALE_DAYS,
	SELFTEST_STORAGE_KEY,
	SETUP_DONE_STORAGE_KEY,
	compareTrayVersion,
	usePrintHealth,
	type PrintHealthCheck,
	type PrintHealthCheckId,
} from "../src/posapp/composables/core/usePrintHealth";
import { EMPTY_BUNDLE_INFO } from "../src/posapp/services/qzBundle";

const bundleWith = (overrides: Record<string, any> = {}) => ({
	...EMPTY_BUNDLE_INFO,
	available: true,
	qz_version: "2.2.5",
	platforms: {
		win: { filename: "qz-win.zip", size: 108_000_000, sha256: "abc", present: true },
	},
	...overrides,
});

const makeStorage = () => {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		_data: data,
	};
};

const byId = (checks: PrintHealthCheck[], id: PrintHealthCheckId) =>
	checks.find((check) => check.id === id)!;

const NOW = new Date("2026-07-30T12:00:00.000Z");

const healthyDeps = (overrides: Record<string, any> = {}) => ({
	connected: ref(true),
	printers: ref(["Counter Printer"]),
	selectedPrinter: ref("Counter Printer"),
	pinnedPrinter: () => "Counter Printer",
	loadBundleInfo: vi.fn(async () => bundleWith()),
	loadQzVersion: vi.fn(async () => "2.2.5"),
	probeSigning: vi.fn(async () => ({ certificate: true, signature: true, error: "" })),
	track: vi.fn(),
	storage: makeStorage(),
	platform: "win" as const,
	now: () => NOW,
	...overrides,
});

describe("usePrintHealth", () => {
	beforeEach(() => {
		delete (globalThis as any).__;
	});

	it("reports the six spec checks in order", async () => {
		const health = usePrintHealth(healthyDeps());
		await health.refresh();

		expect(health.checks.value.map((c) => c.id)).toEqual([
			"bundle",
			"connection",
			"version",
			"signing",
			"printer",
			"selftest",
		]);
	});

	it("rolls up green once every check passes and the test is confirmed", async () => {
		const health = usePrintHealth(healthyDeps());
		await health.refresh();
		health.recordSelfTest(true, "manual");

		expect(health.checks.value.map((c) => c.status)).toEqual([
			"ok",
			"ok",
			"ok",
			"ok",
			"ok",
			"ok",
		]);
		expect(health.rollup.value).toBe("ok");
	});

	it("rolls up to the worst status: fail beats warn beats unknown", async () => {
		const failing = usePrintHealth(healthyDeps({ connected: ref(false) }));
		await failing.refresh();
		expect(failing.rollup.value).toBe("fail");

		const warning = usePrintHealth(healthyDeps({ loadQzVersion: vi.fn(async () => "2.2.4") }));
		await warning.refresh();
		warning.recordSelfTest(true, "manual");
		expect(warning.rollup.value).toBe("warn");

		const unknown = usePrintHealth(healthyDeps());
		await unknown.refresh();
		// Nothing failing or warning, but the self-test has never been run.
		expect(unknown.rollup.value).toBe("unknown");
	});

	describe("bundle", () => {
		it("is ok when an archive is really published", async () => {
			const health = usePrintHealth(healthyDeps());
			await health.refresh();
			expect(byId(health.checks.value, "bundle").status).toBe("ok");
		});

		it("is unknown — never an error — when no manifest is published", async () => {
			// A shop that installed QZ Tray by hand prints fine; absence of a
			// bundle must not read as "this till is broken".
			const health = usePrintHealth(
				healthyDeps({ loadBundleInfo: vi.fn(async () => ({ ...EMPTY_BUNDLE_INFO })) }),
			);
			await health.refresh();
			expect(byId(health.checks.value, "bundle").status).toBe("unknown");
		});
	});

	describe("version", () => {
		it("is ok on an exact match", async () => {
			const health = usePrintHealth(healthyDeps());
			await health.refresh();
			expect(byId(health.checks.value, "version").status).toBe("ok");
		});

		it("warns on patch drift", async () => {
			const health = usePrintHealth(healthyDeps({ loadQzVersion: vi.fn(async () => "2.2.4") }));
			await health.refresh();
			const check = byId(health.checks.value, "version");
			expect(check.status).toBe("warn");
			expect(check.detail).toBe("2.2.4 → 2.2.5");
		});

		it("fails on minor or major drift", async () => {
			const minor = usePrintHealth(healthyDeps({ loadQzVersion: vi.fn(async () => "2.1.5") }));
			await minor.refresh();
			expect(byId(minor.checks.value, "version").status).toBe("fail");

			const major = usePrintHealth(healthyDeps({ loadQzVersion: vi.fn(async () => "1.2.5") }));
			await major.refresh();
			expect(byId(major.checks.value, "version").status).toBe("fail");
		});

		it("warns rather than guesses when either side is unreadable", async () => {
			const health = usePrintHealth(healthyDeps({ loadQzVersion: vi.fn(async () => "") }));
			await health.refresh();
			expect(byId(health.checks.value, "version").status).toBe("warn");
		});
	});

	describe("signing", () => {
		it("is ok when certificate and signature both come back non-empty", async () => {
			const health = usePrintHealth(healthyDeps());
			await health.refresh();
			expect(byId(health.checks.value, "signing").status).toBe("ok");
		});

		it("fails with the server hint when the certificate is missing", async () => {
			const health = usePrintHealth(
				healthyDeps({
					probeSigning: vi.fn(async () => ({
						certificate: false,
						signature: false,
						error: "get_certificate returned empty",
					})),
				}),
			);
			await health.refresh();
			const check = byId(health.checks.value, "signing");
			expect(check.status).toBe("fail");
			expect(check.detail).toBe("get_certificate returned empty");
			expect(check.hint).toMatch(/Setup QZ Certificate/);
		});

		it("fails when the certificate exists but signing returns empty", async () => {
			const health = usePrintHealth(
				healthyDeps({
					probeSigning: vi.fn(async () => ({
						certificate: true,
						signature: false,
						error: "sign_message returned empty",
					})),
				}),
			);
			await health.refresh();
			expect(byId(health.checks.value, "signing").status).toBe("fail");
		});

		it("is unknown before the first probe runs", () => {
			const health = usePrintHealth(healthyDeps());
			expect(byId(health.checks.value, "signing").status).toBe("unknown");
		});
	});

	describe("printer", () => {
		it("is ok with nothing selected when exactly one printer exists", async () => {
			// qzTray already auto-persists the only printer; no decision to make.
			const health = usePrintHealth(
				healthyDeps({
					printers: ref(["Only Printer"]),
					selectedPrinter: ref(""),
					pinnedPrinter: () => "",
				}),
			);
			await health.refresh();
			const check = byId(health.checks.value, "printer");
			expect(check.status).toBe("ok");
			expect(check.detail).toBe("Only Printer");
		});

		it("fails with nothing selected when several printers exist", async () => {
			const health = usePrintHealth(
				healthyDeps({
					printers: ref(["A", "B"]),
					selectedPrinter: ref(""),
					pinnedPrinter: () => "",
				}),
			);
			await health.refresh();
			expect(byId(health.checks.value, "printer").status).toBe("fail");
		});

		it("fails when the chosen printer is not installed on this terminal", async () => {
			// The silent-queue pathology: prints report success, paper never moves.
			const health = usePrintHealth(
				healthyDeps({
					printers: ref(["Back Office"]),
					selectedPrinter: ref(""),
					pinnedPrinter: () => "Counter Printer",
				}),
			);
			await health.refresh();
			expect(byId(health.checks.value, "printer").status).toBe("fail");
		});

		it("falls back to the profile pin when nothing is locally selected", async () => {
			const health = usePrintHealth(
				healthyDeps({
					printers: ref(["Counter Printer", "Back Office"]),
					selectedPrinter: ref(""),
					pinnedPrinter: () => "Counter Printer",
				}),
			);
			await health.refresh();
			expect(byId(health.checks.value, "printer").status).toBe("ok");
		});

		it("is unknown rather than fail when the tray is down and the list is empty", async () => {
			const health = usePrintHealth(
				healthyDeps({ connected: ref(false), printers: ref([]), selectedPrinter: ref("") }),
			);
			await health.refresh();
			expect(byId(health.checks.value, "printer").status).toBe("unknown");
		});
	});

	describe("selftest", () => {
		it("is unknown when the terminal has never been tested", async () => {
			const health = usePrintHealth(healthyDeps());
			await health.refresh();
			expect(byId(health.checks.value, "selftest").status).toBe("unknown");
		});

		it("fails when the operator reported nothing printed", async () => {
			const health = usePrintHealth(healthyDeps());
			await health.refresh();
			health.recordSelfTest(false, "manual");
			expect(byId(health.checks.value, "selftest").status).toBe("fail");
			expect(health.rollup.value).toBe("fail");
		});

		it("warns once a passing test is older than the staleness window", async () => {
			const storage = makeStorage();
			const stale = new Date(NOW.getTime() - (SELFTEST_STALE_DAYS + 1) * 86_400_000);
			storage.setItem(
				SELFTEST_STORAGE_KEY,
				JSON.stringify({ ok: true, at: stale.toISOString(), printer: "Counter Printer" }),
			);

			const health = usePrintHealth(healthyDeps({ storage }));
			await health.refresh();
			expect(byId(health.checks.value, "selftest").status).toBe("warn");
		});

		it("stays ok inside the staleness window", async () => {
			const storage = makeStorage();
			const recent = new Date(NOW.getTime() - 3 * 86_400_000);
			storage.setItem(
				SELFTEST_STORAGE_KEY,
				JSON.stringify({ ok: true, at: recent.toISOString(), printer: "Counter Printer" }),
			);

			const health = usePrintHealth(healthyDeps({ storage }));
			await health.refresh();
			expect(byId(health.checks.value, "selftest").status).toBe("ok");
		});

		it("treats an unparseable timestamp as stale, not as fresh", () => {
			const storage = makeStorage();
			storage.setItem(SELFTEST_STORAGE_KEY, JSON.stringify({ ok: true, at: "not-a-date" }));

			const health = usePrintHealth(healthyDeps({ storage }));
			expect(byId(health.checks.value, "selftest").status).toBe("warn");
		});
	});

	describe("recordSelfTest", () => {
		it("emits pos:print_selftest in the shape get_qz_fleet reads, with the source", async () => {
			const deps = healthyDeps();
			const health = usePrintHealth(deps);
			await health.refresh();

			health.recordSelfTest(true, "wizard");

			expect(deps.track).toHaveBeenCalledWith(SELFTEST_EVENT, 1, {
				ok: 1,
				printer: "Counter Printer",
				qz_version: "2.2.5",
				source: "wizard",
			});
		});

		it("carries the manual source from the dialog", async () => {
			const deps = healthyDeps();
			const health = usePrintHealth(deps);
			await health.refresh();

			health.recordSelfTest(false, "manual");

			expect(deps.track).toHaveBeenCalledWith(
				SELFTEST_EVENT,
				0,
				expect.objectContaining({ ok: 0, source: "manual" }),
			);
		});

		it("persists under the spec's storage key so a reload remembers", async () => {
			const storage = makeStorage();
			const health = usePrintHealth(healthyDeps({ storage }));
			await health.refresh();
			health.recordSelfTest(true, "manual");

			expect(JSON.parse(storage._data.get(SELFTEST_STORAGE_KEY)!)).toMatchObject({
				ok: true,
				printer: "Counter Printer",
			});

			const reloaded = usePrintHealth(healthyDeps({ storage }));
			expect(reloaded.lastSelfTest.value?.ok).toBe(true);
		});

		it("still emits telemetry when localStorage refuses the write", async () => {
			const deps = healthyDeps({
				storage: {
					getItem: () => null,
					setItem: () => {
						throw new Error("QuotaExceeded");
					},
				},
			});
			const health = usePrintHealth(deps);
			await health.refresh();

			expect(() => health.recordSelfTest(true, "manual")).not.toThrow();
			expect(deps.track).toHaveBeenCalled();
		});

		it("treats corrupt stored state as never tested instead of throwing", () => {
			const storage = makeStorage();
			storage.setItem(SELFTEST_STORAGE_KEY, "{not json");
			expect(usePrintHealth(healthyDeps({ storage })).lastSelfTest.value).toBeNull();
		});
	});

	describe("setup-done flag", () => {
		it("reports and records that the wizard has been completed", () => {
			const storage = makeStorage();
			const health = usePrintHealth(healthyDeps({ storage }));

			expect(health.isSetupDone()).toBe(false);
			health.markSetupDone();
			expect(health.isSetupDone()).toBe(true);
			expect(storage._data.get(SETUP_DONE_STORAGE_KEY)).toBe("1");
		});
	});

	it("flags checking while a refresh is in flight", async () => {
		const health = usePrintHealth(healthyDeps());
		const pending = health.refresh();
		expect(health.checking.value).toBe(true);
		await pending;
		expect(health.checking.value).toBe(false);
	});
});

describe("compareTrayVersion", () => {
	it("classifies the drift", () => {
		expect(compareTrayVersion("2.2.5", "2.2.5")).toBe("exact");
		expect(compareTrayVersion("2.2.4", "2.2.5")).toBe("patch");
		expect(compareTrayVersion("2.2.6", "2.2.5")).toBe("patch");
		expect(compareTrayVersion("2.1.5", "2.2.5")).toBe("minor");
		expect(compareTrayVersion("1.2.5", "2.2.5")).toBe("major");
	});

	it("treats a missing trailing segment as zero", () => {
		expect(compareTrayVersion("2.2", "2.2.0")).toBe("exact");
		expect(compareTrayVersion("2.2", "2.2.1")).toBe("patch");
	});

	it("returns unknown when either side is unparseable", () => {
		// A false "your printer software is wrong" trains operators to ignore
		// the panel, which costs more than the missing signal.
		expect(compareTrayVersion("", "2.2.5")).toBe("unknown");
		expect(compareTrayVersion("unknown", "2.2.5")).toBe("unknown");
		expect(compareTrayVersion("2.2.5", "")).toBe("unknown");
	});
});
