import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import frappeVueStyle from "../frappe-vue-style";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { buildVersionPayload, getEntryFileName } from "./build-manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveBuildVersion() {
	if (process.env.POSAWESOME_BUILD_VERSION) {
		return process.env.POSAWESOME_BUILD_VERSION;
	}
	// Prefer the current git short-SHA so two rebuilds of the same
	// commit emit the same `version` (and the same hashed entry
	// filenames). Falling back to a timestamp keeps non-git builds
	// working but loses the cross-rebuild stability — every dev
	// rebuild would force every open POS client to reload mid-session.
	try {
		const sha = execSync("git rev-parse --short=12 HEAD", {
			cwd: __dirname,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
		if (sha) {
			return sha;
		}
	} catch {
		// Not a git checkout (CI tarball, sdist, etc.) — fall through.
	}
	return Date.now().toString();
}

const buildVersion = resolveBuildVersion();

function posawesomeBuildVersionPlugin(version) {
	return {
		name: "posawesome-build-version",
		apply: "build",
		async writeBundle(_options, bundle) {
			const versionFile = path.resolve(__dirname, "../posawesome/public/dist/js/version.json");
			await fs.mkdir(path.dirname(versionFile), { recursive: true });
			await fs.writeFile(
				versionFile,
				JSON.stringify(buildVersionPayload(version, bundle), null, 2),
				"utf8",
			);
		},
	};
}

export default defineConfig({
	base: "/assets/posawesome/dist/js/",
	plugins: [
		posawesomeBuildVersionPlugin(buildVersion),
		frappeVueStyle(),
		vue(),
		viteStaticCopy({
			targets: [
				{
					src: "src/posapp/workers",
					dest: "posapp",
				},
				{
					src: "src/libs/*",
					dest: "libs",
				},
				{
					src: "node_modules/jsbarcode/dist/JsBarcode.all.min.js",
					dest: "libs",
				},
				{
					src: "node_modules/html2pdf.js/dist/html2pdf.bundle.min.js",
					dest: "libs",
				},
			],
		}),
	],
	css: {
		postcss: {
			plugins: [tailwindcss(), autoprefixer()],
		},
	},
	build: {
		target: "esnext",
		modulePreload: false,
		outDir: "../posawesome/public/dist/js",
		emptyOutDir: true,
		cssCodeSplit: false,
		// Pos.vue is intentionally not split as a chunk; warn-don't-fail
		// for builds that grow past 500 kB while we keep extracting
		// async dialogs (CameraScanner, NewItemDialog, etc.).
		chunkSizeWarningLimit: 700,
		rollupOptions: {
			input: {
				posawesome: path.resolve(__dirname, "src/posawesome.bundle.ts"),
				"offline/index": path.resolve(__dirname, "src/offline/index.ts"),
				loader: path.resolve(__dirname, "src/loader.ts"),
				// Phase 1 web-route entry — installs the frappe-shim,
				// then dynamically imports the SPA bundle. Served by
				// `posawesome/www/posapp.html` at /posapp (no Frappe
				// Desk shell). Falls back to the legacy `loader` when
				// the SPA boots inside Desk (/app/posapp).
				"web-entry": path.resolve(__dirname, "src/web-entry.ts"),
			},
			external: ["socket.io-client"],
			output: {
				format: "es",
				entryFileNames: getEntryFileName,
				chunkFileNames: "[name]-[hash].js",
				// Hash assets too — entries are now hashed
				// (build-manifest.js) so the un-hashed `posawesome.css`
				// would otherwise be the only file the browser can pin
				// stale across deploys.
				assetFileNames: "[name]-[hash].[ext]",
				manualChunks: (id) => {
					if (!id.includes("node_modules")) {
						return undefined;
					}
					if (id.includes("vuetify")) {
						return "vuetify";
					}
					// Tighten the previous `id.includes('vue')` rule
					// which over-matched and pulled pinia, vue-router,
					// vue-i18n and vue-virtual-scroller into the eager
					// `vue` chunk. Split each one out so they only
					// load when their consumer is needed.
					if (id.includes("/node_modules/pinia/")) {
						return "pinia";
					}
					if (id.includes("/node_modules/vue-router/")) {
						return "vue-router";
					}
					if (id.includes("/node_modules/vue-i18n/")) {
						return "vue-i18n";
					}
					if (id.includes("/node_modules/vue-virtual-scroller/")) {
						return "vue-virtual-scroller";
					}
					if (
						id.includes("/node_modules/vue/") ||
						id.includes("/node_modules/@vue/")
					) {
						return "vue";
					}
					return "vendor";
				},
			},
		},
	},
	// Strip `console.*` and `debugger` from production bundles. The
	// hot-path `console.log`s in CameraScanner / Invoice /
	// BarcodePrinting fire on every frame / cart row / print request.
	// Errors and warnings are kept so production triage stays viable.
	esbuild: {
		drop: ["debugger"],
		pure: ["console.log", "console.debug", "console.trace"],
	},
	worker: {
		format: "es",
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	define: {
		__BUILD_VERSION__: JSON.stringify(buildVersion),
		"process.env.NODE_ENV": '"production"',
		process: '{"env":{}}',
	},
	test: {
		include: ["tests/**/*.spec.{js,ts}", "tests/**/*.test.{js,ts}"],
		exclude: ["tests/smoke/**"],
	},
});
