<template>
	<v-app-bar
		flat
		:height="isNarrow ? 56 : isMobile ? 64 : 56"
		:class="[
			'pos-navbar-enhanced elevation-2 pos-themed-card pos-theme-immediate',
			rtlClasses,
			isRtl ? 'rtl-app-bar' : 'ltr-app-bar',
			isMobile ? 'mobile-navbar' : 'desktop-navbar',
		]"
		:style="[rtlStyles, { flexDirection: isRtl ? 'row-reverse' : 'row' }]"
	>
		<!-- Brand Section (left in LTR, right in RTL) -->
		<div :class="['pos-navbar-brand-section', isRtl ? 'rtl-brand-section' : 'ltr-brand-section']">
			<v-app-bar-nav-icon
				v-if="showNavIcon"
				ref="navIcon"
				@click="$emit('nav-click')"
				:aria-label="__('Toggle navigation drawer')"
				:size="isMobile ? 'default' : 'large'"
				:class="['pos-text-primary nav-icon', isRtl ? 'rtl-nav-icon' : 'ltr-nav-icon']"
			/>

			<v-img
				:src="posLogo"
				:alt="brand.name"
				:max-width="isMobile ? 24 : 32"
				:class="['pos-navbar-logo', isRtl ? 'rtl-logo' : 'ltr-logo']"
				loading="lazy"
			/>

			<v-toolbar-title
				@click="$emit('go-desk')"
				@keydown.enter="$emit('go-desk')"
				:class="[
					'text-h6 font-weight-bold text-primary pos-navbar-title',
					isRtl ? 'rtl-title' : 'ltr-title',
				]"
				style="cursor: pointer; text-decoration: none"
				tabindex="0"
				:aria-label="__('Go to Frappe Desk')"
				role="button"
			>
				<template v-if="isMobile">
					<span class="pos-navbar-title-compact">{{ brand.wordmarkCompact }}</span>
				</template>
				<template v-else>
					<span class="font-weight-light pos-navbar-title-light">{{ brand.wordmarkLight }}</span
					><span class="pos-navbar-title-bold">{{ brand.wordmarkBold }}</span>
				</template>
			</v-toolbar-title>
		</div>

		<!-- The register status line replaces the spacer rather than sitting
		     beside it: it IS the middle of the bar. Convergence checklist item
		     A — the artboard states the register's condition in words on this
		     row, where we previously carried it as icons further right. -->
		<RegisterStatusLine :input="registerStatusInput" />

		<!-- Actions Section (right in LTR, left in RTL) -->
		<div :class="['pos-navbar-actions-section', isRtl ? 'rtl-actions-section' : 'ltr-actions-section']">
			<!-- Mobile: Show only essential items, others in menu -->
			<template v-if="isMobile">
				<!-- Always visible status indicator -->
				<slot name="status-indicator"></slot>

				<!-- Offline Invoices with higher priority on mobile -->
				<div
					:class="[
						'primary-actions-cluster mobile-primary-actions',
						isRtl ? 'rtl-primary-actions' : 'ltr-primary-actions',
					]"
				>
					<v-btn
						icon
						size="small"
						:class="[
							'offline-invoices-btn mobile-btn pos-themed-button',
							isRtl ? 'rtl-offline-btn' : 'ltr-offline-btn',
							{ 'has-pending': pendingInvoices > 0 },
							{ 'has-dead-letter': attentionCount > 0 },
						]"
						:aria-label="__('View offline invoices') + ` (${pendingInvoices})` + (attentionCount > 0 ? ` — ${attentionCount} ` + __('need attention') : '')"
						@click="$emit('show-offline-invoices')"
					>
						<v-badge
							v-if="pendingInvoices > 0 || attentionCount > 0"
							:content="attentionCount > 0 ? attentionCount : pendingInvoices"
							color="error"
							floating
						>
							<v-icon class="pos-text-primary">mdi-file-document-multiple-outline</v-icon>
						</v-badge>
						<v-icon v-else class="pos-text-primary">mdi-file-document-multiple-outline</v-icon>
						<v-tooltip activator="parent" location="bottom">
							{{ __("Offline Invoices") }} ({{ pendingInvoices }})
							<template v-if="attentionCount > 0">
								— {{ attentionCount }} {{ __("need attention") }}
							</template>
						</v-tooltip>
					</v-btn>

					<!-- Notification bell centered between offline invoices and menu -->
					<div class="notification-wrapper">
						<slot name="notification-bell"></slot>
					</div>

					<!-- Mobile Menu - contains all other items -->
					<div class="menu-wrapper">
						<slot name="menu"></slot>
					</div>
				</div>
			</template>

			<!-- Desktop: Show all items normally -->
			<template v-else>
				<!-- Enhanced connectivity status indicator (kept outside info menu) -->
				<div class="gadget-wrapper status-gadget">
					<slot name="status-indicator"></slot>
				</div>

				<NavbarInfoGadgets
					:class="['info-gadgets-wrapper', isRtl ? 'rtl-info-gadgets' : 'ltr-info-gadgets']"
				>
					<!-- Cache Usage Meter -->
					<template #cache-usage-meter>
						<slot name="cache-usage-meter"></slot>
					</template>

					<!-- Database Usage Gadget -->
					<template #db-usage-gadget>
						<slot name="db-usage-gadget"></slot>
					</template>

					<!-- CPU Load Gadget -->
					<template #cpu-gadget>
						<slot name="cpu-gadget"></slot>
					</template>
				</NavbarInfoGadgets>

				<div :class="['profile-section', isRtl ? 'rtl-profile-section' : 'ltr-profile-section']">
					<v-chip
						v-if="cashierChipLabel"
						variant="outlined"
						:class="[
							'profile-chip cashier-chip pos-themed-card',
							isRtl ? 'rtl-profile-chip' : 'ltr-profile-chip',
						]"
						data-test="cashier-chip"
						tabindex="0"
						role="button"
						:title="cashierChipTitle"
						@click="$emit('open-employee-switch')"
						@keydown.enter="$emit('open-employee-switch')"
					>
						<v-icon
							:start="!isRtl"
							:end="isRtl"
							:class="['pos-text-primary', isRtl ? 'rtl-profile-icon' : 'ltr-profile-icon']"
						>
							mdi-account-switch-outline
						</v-icon>
						<!-- The chip states the CASHIER and nothing else. Its meta
						     line used to carry the POS profile, which the register
						     status line on this same row now states — so the bar
						     read "Doco Ventas" twice, three inches apart. The name
						     stays here because here it is the label of a control:
						     clicking it switches cashier. -->
						<span
							:class="[
								'profile-chip__content',
								isRtl ? 'rtl-profile-text' : 'ltr-profile-text',
							]"
						>
							<span class="pos-text-primary profile-chip__title">
								{{ cashierChipLabel }}
							</span>
						</span>
					</v-chip>
				</div>

				<div
					:class="[
						'primary-actions-cluster desktop-primary-actions',
						isRtl ? 'rtl-primary-actions' : 'ltr-primary-actions',
					]"
				>
					<v-btn
						icon
						:class="[
							'offline-invoices-btn pos-themed-button',
							isRtl ? 'rtl-offline-btn' : 'ltr-offline-btn',
							{ 'has-pending': pendingInvoices > 0 },
							{ 'has-dead-letter': attentionCount > 0 },
						]"
						:aria-label="__('View offline invoices') + ` (${pendingInvoices})` + (attentionCount > 0 ? ` — ${attentionCount} ` + __('need attention') : '')"
						:aria-describedby="'offline-invoices-tooltip'"
						@click="$emit('show-offline-invoices')"
						@keydown.enter="$emit('show-offline-invoices')"
						tabindex="0"
					>
						<v-badge
							v-if="pendingInvoices > 0 || attentionCount > 0"
							:content="attentionCount > 0 ? attentionCount : pendingInvoices"
							color="error"
							floating
						>
							<v-icon class="pos-text-primary">mdi-file-document-multiple-outline</v-icon>
						</v-badge>
						<v-icon v-else class="pos-text-primary">mdi-file-document-multiple-outline</v-icon>
						<v-tooltip
							id="offline-invoices-tooltip"
							activator="parent"
							:location="isRtl ? 'bottom start' : 'bottom end'"
							:open-delay="500"
							:close-delay="200"
						>
							{{ __("Offline Invoices") }} ({{ pendingInvoices }})
							<template v-if="attentionCount > 0">
								— {{ attentionCount }} {{ __("need attention") }}
							</template>
						</v-tooltip>
					</v-btn>

					<!-- Notification bell between offline invoices and menu -->
					<div class="notification-wrapper">
						<slot name="notification-bell"></slot>
					</div>

					<!-- Menu component slot -->
					<div class="menu-wrapper">
						<slot name="menu"></slot>
					</div>
				</div>
			</template>
		</div>

		<!-- Glass Morphism Loading Bar -->
		<transition name="loading-fade">
			<div v-if="loadingActive" class="loading-container">
				<div class="glass-card">
					<span class="loading-message">{{ loadingMessage }}</span>
					<div v-if="!loadingIndeterminate" class="progress-badge">{{ loadingProgress }}%</div>
				</div>
				<v-progress-linear
					:model-value="loadingProgress"
					:indeterminate="loadingIndeterminate"
					color="primary"
					height="4"
					absolute
					location="bottom"
					class="glass-progress"
				/>
			</div>
		</transition>
	</v-app-bar>
</template>

<script>
import { useRtl } from "../../composables/core/useRtl";
import { computed, onBeforeUnmount, ref } from "vue";
import { useSyncStore } from "../../stores/syncStore";
import { useUIStore } from "../../stores/uiStore";
import { useInvoiceStore } from "../../stores/invoiceStore";
import { useOnlineStatus } from "../../composables/core/useOnlineStatus";
import { usePrintHealthShared } from "../../composables/core/usePrintHealthShared";
import posLogo from "../pos/pos.png";
import NavbarInfoGadgets from "./NavbarInfoGadgets.vue";
import RegisterStatusLine from "./RegisterStatusLine.vue";
import { useRegisterFacts } from "./useRegisterFacts";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";
import { BRAND } from "../../../brand";

/** Display only shows HH:mm, so a minute is the tightest useful tick. */
const CLOCK_TICK_MS = 30_000;

export default {
	name: "NavbarAppBar",
	components: {
		NavbarInfoGadgets,
		RegisterStatusLine,
	},
	setup() {
		const { isRtl, rtlStyles, rtlClasses } = useRtl();
		// Offline sales needing operator attention must be impossible to miss —
		// read both counts straight from the store (no prop threading).
		// try/catch: unit tests mount this component without a pinia.
		let syncStore = null;
		try {
			syncStore = useSyncStore();
		} catch {
			syncStore = null;
		}
		const attentionCount = computed(
			() =>
				(syncStore?.deadLetterCount || 0) +
				(syncStore?.draftReviewCount || 0),
		);

		// Same try/catch discipline as syncStore above — every one of these is
		// absent when a spec mounts this component without a pinia, and the
		// status line must degrade to "nothing to say" rather than throwing
		// inside the app bar.
		let uiStore = null;
		try {
			uiStore = useUIStore();
		} catch {
			uiStore = null;
		}
		let invoiceStore = null;
		try {
			invoiceStore = useInvoiceStore();
		} catch {
			invoiceStore = null;
		}
		let onlineStatus = null;
		try {
			onlineStatus = useOnlineStatus();
		} catch {
			onlineStatus = null;
		}
		let printHealth = null;
		try {
			printHealth = usePrintHealthShared();
		} catch {
			printHealth = null;
		}

		const now = ref(new Date());
		const clockTimer = setInterval(() => {
			now.value = new Date();
		}, CLOCK_TICK_MS);
		onBeforeUnmount(() => clearInterval(clockTimer));

		// The two facts the strip was drawn with and used to pass `null` for.
		// Same try/catch discipline as the stores above: `useFormat` and
		// `useVerticalStore` are both absent when a spec mounts this bar, and
		// the register facts must then simply be the `null` they already were.
		let registerFacts = null;
		try {
			const { formatCurrency, currencySymbol } = useFormat();
			let verticalStore = null;
			try {
				verticalStore = useVerticalStore();
			} catch {
				verticalStore = null;
			}
			registerFacts = useRegisterFacts({
				openingShift: () => uiStore?.posOpeningShift?.name || null,
				posProfile: () => uiStore?.posProfile || null,
				hasCapability: (capability) => Boolean(verticalStore?.has?.(capability)),
				formatMoney: (value) =>
					`${currencySymbol(uiStore?.posProfile?.currency)}${formatCurrency(value)}`,
				// `Balance` already resolves to «Saldo», which is the artboard's
				// own word for this chip — so the chip reads right in Spanish
				// without a new translation row.
				saldoWord: () => (typeof __ === "function" ? __("Balance") : "Saldo"),
			});
			registerFacts.start();
			onBeforeUnmount(() => registerFacts?.stop?.());
		} catch {
			registerFacts = null;
		}

		return {
			navTicketsToday: registerFacts?.ticketsToday ?? ref(null),
			navSaldoLabel: registerFacts?.saldoLabel ?? ref(null),
			isRtl,
			rtlStyles,
			rtlClasses,
			posLogo,
			attentionCount,
			brand: BRAND,
			navUiStore: uiStore,
			navInvoiceStore: invoiceStore,
			navOnlineStatus: onlineStatus,
			navPrintHealth: printHealth,
			navSyncStore: syncStore,
			navNow: now,
		};
	},
	data() {
		return {
			windowWidth: window.innerWidth,
			resizeRafId: null,
		};
	},
	mounted() {
		this.updateWindowWidth();
		window.addEventListener("resize", this.updateWindowWidth, { passive: true });
		this.$el.addEventListener("keydown", this.handleKeyboardNavigation, { passive: false });
	},
	beforeUnmount() {
		window.removeEventListener("resize", this.updateWindowWidth);
		if (this.$el && this.$el.removeEventListener) {
			this.$el.removeEventListener("keydown", this.handleKeyboardNavigation);
		}
		if (this.resizeRafId) {
			cancelAnimationFrame(this.resizeRafId);
			this.resizeRafId = null;
		}
	},
	props: {
		/**
		 * The hamburger. Off while the register shell shows the rail (roadmap
		 * §17.7: the rail is the only desktop nav); on for every page that has
		 * no rail and below the rail breakpoint, where the drawer IS the nav.
		 */
		showNavIcon: { type: Boolean, default: true },
		posProfile: {
			type: Object,
			default: () => ({}),
		},
		pendingInvoices: {
			type: Number,
			default: 0,
		},
		loadingProgress: {
			type: Number,
			default: 0,
		},
		loadingActive: {
			type: Boolean,
			default: false,
		},
		loadingIndeterminate: {
			type: Boolean,
			default: false,
		},
		loadingMessage: {
			type: String,
			default: "Loading app data...",
		},
		cashierName: {
			type: String,
			default: "",
		},
	},
	computed: {
		appBarColor() {
			return this.$theme.isDark ? this.$vuetify.theme.themes.dark.colors.surface : "white";
		},

		displayName() {
			// Show POS profile name if available, otherwise show user name
			if (this.posProfile && this.posProfile.name) {
				return this.posProfile.name;
			}

			// Fallback to Frappe user
			if (frappe.session && frappe.session.user_fullname) {
				return frappe.session.user_fullname;
			}

			if (frappe.session && frappe.session.user) {
				return frappe.session.user;
			}

			return "User";
		},

		cashierChipLabel() {
			// First given name only. This is the LABEL OF A CONTROL — clicking
			// it switches cashier — and «Marco Antonio Ponce Valdez» spent
			// ~150px of the bar restating what the cashier already knows about
			// themselves; at 1920 that was part of what pushed the status chips
			// under the connection button (owner screenshot, 08-24). The full
			// name stays on the chip's tooltip.
			const full = String(this.cashierChipTitle || "").trim();
			return full.split(/\s+/)[0] || full;
		},

		cashierChipTitle() {
			return this.cashierName || this.displayName;
		},


		/**
		 * Everything the status strip needs, gathered from stores that already
		 * hold it. Nothing here fetches — see the report for the two values the
		 * artboard shows that have no read model yet (`31 tickets hoy` and the
		 * saldo balance).
		 */
		registerStatusInput() {
			const shift = this.navUiStore?.posOpeningShift || null;
			const profile = this.posProfile || this.navUiStore?.posProfile || {};
			return {
				context: shift ? "sale" : "opening",
				ticketName: this.navInvoiceStore?.invoiceDoc?.name || null,
				profileName: profile?.name || null,
				// No "Caja 2" equivalent exists in the data today — reported
				// rather than invented, because a made-up till label on a
				// multi-register tenant is worse than none.
				registerLabel: null,
				cashierName: this.cashierName || null,
				shiftStart: shift?.period_start_date || null,
				now: this.navNow,
				locale: this.statusLocale,
			// Counted for this register's shift AND today's posting date, through
				// Frappe's own permission-checked COUNT — see `useRegisterFacts`.
				// `null` still omits the chip whenever the read has not landed or
				// could not be made; a `0` would be a claim about the day's trade.
				ticketsToday: this.navTicketsToday ?? null,
				printerStatus: this.navPrintHealth?.rollup?.value || "unknown",
				usesSilentPrint: Boolean(profile?.posa_silent_print),
				online: this.navOnlineStatus?.isOnline?.value !== false,
				pendingCount: this.navSyncStore?.pendingInvoicesCount || 0,
			// The pouch balance, and ONLY on a register that sells airtime
				// and whose manager has left the balance visible. Both gates live
				// in `useRegisterFacts`; a register without recargas never even
				// asks the server for it.
				saldoLabel: this.navSaldoLabel ?? null,
				// Below the rail's breakpoint the strip sheds the clock, the
				// day's count and the printer, matching the mobile artboards.
				compact: this.windowWidth < 1100,
				// 1359 is where the CSS ladder drops the day's count, and where
				// a long profile name starts pushing the chips out of their own
				// box (measured). The identity gives up its own least essential
				// word at the same point rather than being exempt from the
				// ladder the chips obey.
				narrow: this.windowWidth < 1360,
			};
		},

		statusLocale() {
			try {
				return (
					document?.documentElement?.lang ||
					(frappe?.boot?.lang ? String(frappe.boot.lang) : null) ||
					null
				);
			} catch {
				return null;
			}
		},

		// Mobile breakpoint detection
		isMobile() {
			return this.windowWidth < 768;
		},

		isNarrow() {
			return this.windowWidth < 480;
		},

		isTablet() {
			return this.windowWidth >= 768 && this.windowWidth < 1024;
		},

		isDesktop() {
			return this.windowWidth >= 1024;
		},
	},

	methods: {
		updateWindowWidth() {
			if (this.resizeRafId) {
				cancelAnimationFrame(this.resizeRafId);
			}
			this.resizeRafId = requestAnimationFrame(() => {
				this.windowWidth = window.innerWidth;
			});
		},

		// Enhanced accessibility helper
		handleKeyboardNavigation(event) {
			if (event.key === "Tab") {
				// Ensure proper tab order
				const focusableElements = this.$el.querySelectorAll(
					'button, [tabindex="0"], [role="button"]',
				);
				if (focusableElements.length > 0) {
					// Tab navigation is handled by browser, just ensure visibility
					this.$nextTick(() => {
						const activeElement = document.activeElement;
						if (activeElement && this.$el.contains(activeElement)) {
							activeElement.scrollIntoView({
								block: "nearest",
								inline: "nearest",
							});
						}
					});
				}
			}
		},
	},
	emits: ["nav-click", "go-desk", "show-offline-invoices", "open-employee-switch"],
};
</script>

<style scoped>
/* Enhanced Navbar Styling */
.pos-navbar-enhanced {
	background-image: linear-gradient(
		135deg,
		var(--pos-bg-primary) 0%,
		var(--pos-bg-secondary) 100%
	) !important;
	background-color: var(--pos-bg-primary) !important;
	border-bottom: 2px solid var(--pos-border) !important;
	backdrop-filter: blur(10px);
	transition: all 0.3s ease;
	padding-bottom: 4px !important;
	overflow: visible !important;
	color: var(--pos-text-primary) !important;
}

/* RTL/LTR App Bar Layout */
.rtl-app-bar {
	direction: rtl;
}

.ltr-app-bar {
	direction: ltr;
}

/* Brand Section Styling */
.pos-navbar-brand-section {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-direction: row;
	/* Default to normal row */
	flex: 1 1 auto;
	min-width: 0;
	max-width: 100%;
}

.pos-navbar-title-compact {
	font-weight: 600;
	font-size: 1.05rem;
	letter-spacing: 0.03em;
}

.rtl-brand-section {
	flex-direction: row-reverse;
}

.ltr-brand-section {
	flex-direction: row;
	/* Explicit normal row for LTR */
}

/* Actions Section Styling */
.pos-navbar-actions-section {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-direction: row;
	/* Default to normal row */
	min-width: 0;
}

.rtl-actions-section {
	flex-direction: row-reverse;
}

.ltr-actions-section {
	flex-direction: row;
	/* Explicit normal row for LTR */
}

.primary-actions-cluster {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	flex-shrink: 0;
	min-width: 0;
}

.mobile-primary-actions {
	gap: 6px;
}

.rtl-primary-actions {
	flex-direction: row-reverse;
}

.ltr-primary-actions {
	flex-direction: row;
}

.primary-actions-cluster .offline-invoices-btn,
.primary-actions-cluster .notification-wrapper,
.primary-actions-cluster .menu-wrapper {
	order: 0;
}

.notification-wrapper,
.menu-wrapper {
	display: flex;
	align-items: center;
	justify-content: center;
}

/* LTR Actions ordering for proper sequence */
.status-gadget {
	order: 1;
}

.ltr-info-gadgets {
	order: 2;
}

.ltr-actions-section .profile-section {
	order: 3;
}

.ltr-actions-section .primary-actions-cluster {
	order: 4;
}

/* RTL adjustments for gadgets - reverse the order */
.rtl-info-gadgets {
	order: 4;
}

.rtl-actions-section .profile-section {
	order: 3;
}

.rtl-actions-section .primary-actions-cluster {
	order: 1;
}

.pos-navbar-enhanced:hover {
	box-shadow: 0 4px 20px var(--pos-shadow) !important;
}

/* Logo Styling */
.pos-navbar-logo {
	transition: transform 0.3s ease;
}

.rtl-logo {
	margin-left: 12px;
	margin-right: 0;
}

.ltr-logo {
	margin-right: 12px;
	margin-left: 0;
	order: 0;
}

.pos-navbar-logo:hover {
	transform: scale(1.05);
}

@media (max-width: 960px) {
	.pos-navbar-brand-section {
		gap: 8px;
		min-width: 0;
	}
	.pos-navbar-actions-section {
		gap: 6px;
	}
}

@media (max-width: 768px) {
	.mobile-navbar .pos-navbar-actions-section {
		gap: 4px;
	}
	.pos-navbar-title-compact {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
}

@media (max-width: 600px) {
	.pos-navbar-title {
		font-size: 1rem !important;
	}
	.nav-icon {
		margin-inline-end: 0;
	}
}

/* Brand Title Styling */
.pos-navbar-title {
	text-decoration: none !important;
	border-bottom: none !important;
	transition: color 0.3s ease;
	white-space: nowrap;
	overflow: hidden !important;
	text-overflow: ellipsis;
	display: flex;
	align-items: center;
	min-width: 0;
	max-width: 100%;
	flex: 1 1 auto;
	/* Use same blue as Menu button - matching gradient blue */
	color: #1976d2 !important;
}

.pos-navbar-title:hover {
	text-decoration: none !important;
	opacity: 0.8;
}

.rtl-title {
	text-align: right;
	order: -1;
	/* Moves title before logo in RTL */
	flex-direction: row-reverse;
}

.ltr-title {
	text-align: left;
	order: 0;
	/* Normal order in LTR */
	flex-direction: row;
}

/* Title Text Styling */
.pos-navbar-title-light {
	font-weight: 300 !important;
	letter-spacing: 0.5px;
	margin-right: 2px;
	display: inline-block;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.pos-navbar-title-bold {
	font-weight: 700 !important;
	letter-spacing: 0.25px;
	display: inline-block;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* RTL Title Spacing */
.rtl-title .pos-navbar-title-light {
	margin-left: 2px;
	margin-right: 0;
}

.rtl-title .pos-navbar-title-bold {
	margin-right: 2px;
	margin-left: 0;
}

/* Navigation Icon - Elite Style */
.nav-icon {
	border-radius: 12px;
	padding: 8px;
	transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	min-width: 40px;
	min-height: 40px;
	color: #1976d2 !important;
	background: rgba(25, 118, 210, 0.08) !important;
	border: 1px solid rgba(25, 118, 210, 0.12);
	backdrop-filter: blur(8px);
}

.nav-icon:hover {
	background: rgba(25, 118, 210, 0.12) !important;
	color: #1565c0 !important;
	border-color: rgba(25, 118, 210, 0.2);
	transform: translateY(-1px);
	box-shadow: 0 4px 12px rgba(25, 118, 210, 0.15);
}

.rtl-nav-icon {
	order: 3;
	/* Last in brand section for RTL */
}

.ltr-nav-icon {
	order: 0;
	/* Normal order for LTR */
}

/* Gadget Wrapper Styling for Consistency */
.gadget-wrapper {
	display: flex;
	align-items: center;
	min-height: 40px;
	transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.gadget-wrapper:empty {
	display: none;
}

/* Profile Section */
.profile-section {
	margin: 0;
	order: 2;
	/* Second to last in actions section */
}

.profile-chip {
	color: #1976d2 !important;
	border-color: rgba(25, 118, 210, 0.2) !important;
	background: rgba(25, 118, 210, 0.06) !important;
	backdrop-filter: blur(8px);
}

.rtl-profile-section {
	order: 2;
}

.ltr-profile-section {
	order: 2;
}

.profile-chip {
	font-weight: 500;
	padding: 8px 16px;
	border-radius: 20px;
	transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	display: flex;
	align-items: center;
	gap: 8px;
}

.profile-chip__content {
	display: flex;
	flex-direction: column;
	gap: 1px;
	min-width: 0;
}

.profile-chip__title {
	font-weight: 600;
	line-height: 1.1;
}

.profile-chip__meta {
	font-size: 0.72rem;
	line-height: 1.1;
	color: var(--pos-text-secondary);
	white-space: nowrap;
}

.profile-chip:hover {
	transform: translateY(-1px);
	background: rgba(25, 118, 210, 0.1) !important;
	border-color: rgba(25, 118, 210, 0.25) !important;
	box-shadow: 0 4px 12px rgba(25, 118, 210, 0.12);
}

/* RTL Profile Chip Styling */
.rtl-profile-chip {
	flex-direction: row-reverse;
	text-align: right;
}

.ltr-profile-chip {
	flex-direction: row;
	text-align: left;
}

/* Profile Icon Positioning */
.rtl-profile-icon {
	margin-left: 8px;
	margin-right: 0;
	order: 2;
}

.ltr-profile-icon {
	margin-right: 8px;
	margin-left: 0;
	order: 0;
	/* Keep normal order for LTR */
}

/* Profile Text Positioning */
.rtl-profile-text {
	order: 1;
	text-align: right;
	margin-right: 4px;
}

.ltr-profile-text {
	order: 0;
	/* Keep normal order for LTR */
	text-align: left;
	margin-left: 4px;
}

/* Override Vuetify's default chip styles for better RTL spacing */
.rtl-profile-chip :deep(.v-chip__content) {
	flex-direction: row-reverse;
	gap: 8px;
}

.ltr-profile-chip :deep(.v-chip__content) {
	flex-direction: row;
	gap: 8px;
}

/* Force proper icon spacing in Vuetify chips */
.rtl-profile-chip :deep(.v-icon) {
	margin-left: 6px !important;
	margin-right: 0 !important;
}

.ltr-profile-chip :deep(.v-icon) {
	margin-right: 6px !important;
	margin-left: 0 !important;
}

/* Offline Invoices Button Enhancement - Elite Style */
/* SPEC A: dead-lettered sales — the button itself pulses so the state
   is visible even without hovering the tooltip. */
.offline-invoices-btn.has-dead-letter {
	animation: dead-letter-pulse 1.6s ease-in-out infinite;
}

@keyframes dead-letter-pulse {
	0%, 100% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.55); }
	50% { box-shadow: 0 0 0 7px rgba(244, 67, 54, 0); }
}

.offline-invoices-btn {
	position: relative;
	transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	padding: 4px;
	min-width: 40px;
	min-height: 40px;
	background: rgba(25, 118, 210, 0.08) !important;
	border: 1px solid rgba(25, 118, 210, 0.12);
	border-radius: 12px;
	backdrop-filter: blur(8px);
}

.offline-invoices-btn .pos-text-primary {
	color: #1976d2 !important;
}

/* Elite styling for navbar text and icons */
.pos-navbar-enhanced .pos-text-primary {
	color: #1976d2 !important;
}

/* Ensure profile text and icons use elite colors */
.profile-chip .pos-text-primary,
.profile-chip .ltr-profile-text,
.profile-chip .rtl-profile-text {
	color: #1976d2 !important;
	font-weight: 500;
}

/* Navbar icons with refined styling */
.pos-navbar-enhanced .v-icon.pos-text-primary,
.pos-navbar-enhanced .mdi-menu-down,
.pos-navbar-enhanced .v-icon--end.pos-text-primary {
	color: #1976d2 !important;
	transition: color 0.25s ease;
}

.pos-navbar-enhanced .v-icon.pos-text-primary:hover {
	color: #1565c0 !important;
}

.rtl-offline-btn {
	order: 3;
	/* Last in actions section for RTL */
}

.ltr-offline-btn {
	order: 3;
	/* Last in actions section for LTR */
}

.offline-invoices-btn:hover {
	transform: translateY(-1px);
	background: rgba(25, 118, 210, 0.12) !important;
	border-color: rgba(25, 118, 210, 0.2);
	box-shadow: 0 4px 12px rgba(25, 118, 210, 0.15);
}

.offline-invoices-btn:hover .pos-text-primary {
	color: #1565c0 !important;
}

.offline-invoices-btn.has-pending {
	animation: pulse 2s infinite;
}

@keyframes pulse {
	0% {
		box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.4);
	}

	70% {
		box-shadow: 0 0 0 10px rgba(244, 67, 54, 0);
	}

	100% {
		box-shadow: 0 0 0 0 rgba(244, 67, 54, 0);
	}
}

/* ===== GLASS MORPHISM LOADING BAR ===== */
.loading-container {
	position: absolute;
	bottom: 0;
	left: 0;
	right: 0;
	z-index: 1000;
}

.glass-card {
	position: absolute;
	top: -40px;
	left: 12px;
	right: 12px;
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 8px 16px;

	/* Glass morphism effect */
	background: color(from Canvas r g b / 0.8);
	backdrop-filter: blur(20px);
	border-radius: 12px;
	border: 1px solid color(from Canvas r g b / 0.1);

	/* System shadows */
	box-shadow:
		0 8px 32px color(from CanvasText r g b / 0.1),
		0 1px 0 color(from Canvas r g b / 0.5) inset;
}

.loading-message {
	font-size: 12px;
	font-weight: 500;
	color: AccentColor;
	flex: 1;
}

.progress-badge {
	font-size: 11px;
	font-weight: 600;
	color: Canvas;
	background: AccentColor;
	padding: 2px 8px;
	border-radius: 8px;
	min-width: 32px;
	text-align: center;
}

.glass-progress {
	border-radius: 0 !important;
	backdrop-filter: blur(10px);
}

.glass-progress :deep(.v-progress-linear__background) {
	background: color(from CanvasText r g b / 0.1) !important;
}

.glass-progress :deep(.v-progress-linear__determinate) {
	background: AccentColor !important;
	box-shadow: 0 0 12px color(from AccentColor r g b / 0.3);
}

/* Smooth transitions */
.loading-fade-enter-active,
.loading-fade-leave-active {
	transition: all 0.3s ease;
}

.loading-fade-enter-from {
	opacity: 0;
	transform: translateY(8px);
}

.loading-fade-leave-to {
	opacity: 0;
	transform: translateY(-4px);
}

/* Dark theme fallback for older browsers */
@media (prefers-color-scheme: dark) {
	.glass-card {
		background: rgba(30, 30, 30, 0.8);
		border-color: rgba(255, 255, 255, 0.1);
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.2),
			0 1px 0 rgba(255, 255, 255, 0.1) inset;
	}

	.loading-message {
		color: var(--pos-primary);
	}

	.progress-badge {
		background: var(--pos-primary);
		color: var(--pos-text-primary);
	}
}

/* Mobile Navbar Styles */
.mobile-navbar {
	padding: 0 8px !important;
}

/* Track content size, allow shrinking. The old `flex: 1` (basis 0%)
   collapsed the brand box to the leftover ~35px and its ~110px of
   content painted straight across the status button — the overlapped
   wordmark in the phone screenshots. */
.mobile-navbar .pos-navbar-brand-section {
	gap: 8px;
	flex: 0 1 auto;
	min-width: 0;
}

.mobile-navbar .pos-navbar-logo {
	max-width: 28px !important;
}

/* Shrinkable WITH Vuetify's own placeholder ellipsis (do not restore
   the old `overflow: visible` override — it made the wordmark paint
   over the status button instead of truncating). Space is freed at
   phone width by hiding the logo bitmap and collapsing the saldo chip
   to icon-only, so in practice the title never needs to truncate. */
.mobile-navbar .pos-navbar-title {
	font-size: 1rem !important;
	flex: 0 1 auto;
	max-width: none;
	min-width: 0;
}

.mobile-navbar .pos-navbar-actions-section {
	gap: 6px;
}

.mobile-navbar .mobile-btn {
	min-width: 36px !important;
	min-height: 36px !important;
	padding: 6px !important;
}

.mobile-navbar .nav-icon {
	min-width: 36px !important;
	min-height: 36px !important;
	padding: 6px !important;
}

/* Desktop Navbar Styles */
.desktop-navbar {
	padding: 0 16px 4px !important;
}

/* Enhanced mobile responsiveness */
@media (max-width: 480px) {
	/* Height comes from the :height prop (isNarrow) — VAppBar reserves
	   layout space from the measured toolbar, so forcing height here
	   made paint (56) and reserved space (64) disagree by 8px. */
	.mobile-navbar {
		padding: 0 4px !important;
	}

	.mobile-navbar .pos-navbar-brand-section {
		gap: 6px;
	}

	.mobile-navbar .pos-navbar-title {
		font-size: 0.9rem !important;
	}

	/* Hide hamburger icon text on very small screens */
	.mobile-navbar .v-app-bar-nav-icon .v-icon {
		font-size: 20px !important;
	}
}

/* The wordmark and the logo bitmap are the same Desk link — the bitmap
   is redundant at phone width and its ~36px go to the search/actions. */
@media (max-width: 600px) {
	.mobile-navbar .pos-navbar-logo {
		display: none !important;
	}
}

/* Touch-friendly interactions for mobile */
@media (hover: none) and (pointer: coarse) {
	.nav-icon,
	.offline-invoices-btn,
	.mobile-btn {
		min-width: 44px !important;
		min-height: 44px !important;
		-webkit-tap-highlight-color: rgba(25, 118, 210, 0.1);
	}

	.pos-navbar-title {
		min-height: 44px;
		display: flex;
		align-items: center;
	}
}

/* Reduced motion accessibility */
@media (prefers-reduced-motion: reduce) {
	.pos-navbar-enhanced,
	.nav-icon,
	.offline-invoices-btn,
	.profile-chip,
	.pos-navbar-logo,
	.gadget-wrapper {
		transition: none !important;
		animation: none !important;
	}

	.offline-invoices-btn.has-pending {
		animation: none !important;
	}
}

/* Tablet optimizations */
@media (min-width: 768px) and (max-width: 1023px) {
	.pos-navbar-actions-section {
		gap: 6px;
	}

	.profile-chip {
		padding: 6px 12px !important;
		font-size: 0.9rem !important;
	}
}

/* Original responsive adjustments for loading bar */
@media (max-width: 768px) {
	.glass-card {
		padding: 6px 12px;
		left: 8px;
		right: 8px;
	}

	.loading-message {
		font-size: 11px;
	}

	.progress-badge {
		font-size: 10px;
		padding: 1px 6px;
		min-width: 28px;
	}
}

/* High DPI display adjustments */
@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
	.mobile-navbar .pos-navbar-logo,
	.mobile-navbar .v-icon {
		image-rendering: -webkit-optimize-contrast;
		image-rendering: crisp-edges;
	}
}

/* Landscape mobile adjustments */
@media (max-height: 500px) and (orientation: landscape) {
	.mobile-navbar {
		height: 48px !important;
	}

	.mobile-navbar .pos-navbar-title {
		font-size: 0.8rem !important;
	}

	.mobile-navbar .mobile-btn,
	.mobile-navbar .nav-icon {
		min-width: 28px !important;
		min-height: 28px !important;
	}
}
</style>
