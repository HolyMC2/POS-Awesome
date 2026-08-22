import { mergeConfig } from "vite";
import viteConfig from "./vite.config.js";

export default mergeConfig(viteConfig, {
	test: {
		include: [
			"tests/**/*.spec.{js,ts}",
			"tests/**/*.test.{js,ts}",
			"src/**/__tests__/**/*.{js,ts}",
		],
		// Playwright lanes, all three of them. `visual/**` joined the list when
		// the design-evidence lane was added — vitest happily collected it and
		// then failed on Playwright's `test` fixture, which reads as 29 mystery
		// unit failures rather than as a misrouted spec.
		exclude: ["tests/smoke/**", "tests/e2e/**", "tests/visual/**"],
	},
});
