<template>
	<!-- The below-the-rail-boundary nav, redrawn in the register's own
	     vocabulary (roadmap §17.7). R11 replaced the hamburger drawer with the
	     rail on desktop and left "the drawer stays the nav" below the boundary;
	     this panel is that drawer catching up: the same rows the rail's «Más»
	     flyout draws (icon tile, label, one-line hint), sourced from the same
	     destination registry, instead of NavbarDrawer's hand-kept list. The
	     items themselves still arrive from Navbar.vue with its gating (gift
	     cards flag, the supervisor probe) — this component only draws them. -->
	<v-navigation-drawer
		v-model="drawerOpen"
		temporary
		width="312"
		:location="isRtl ? 'right' : 'left'"
		:class="['mobile-nav', rtlClasses]"
		data-testid="mobile-nav-panel"
	>
		<div class="mobile-nav__shell">
			<div>
				<div class="mobile-nav__header">
					<v-avatar v-if="companyImg" size="32" rounded="lg">
						<v-img :src="companyImg" alt="" />
					</v-avatar>
					<span class="mobile-nav__identity">
						<span class="mobile-nav__company">{{ company }}</span>
						<span v-if="subtitle" class="mobile-nav__register">{{ subtitle }}</span>
					</span>
				</div>

				<div class="mobile-nav__title">{{ __("Register") }}</div>
				<nav :aria-label="__('Register navigation')">
					<button
						v-for="entry in enrichedItems"
						:key="entry.to"
						type="button"
						class="mobile-nav__tool"
						:class="{ 'mobile-nav__tool--on': entry.active }"
						:data-nav-destination="entry.id || undefined"
						:aria-current="entry.active ? 'page' : undefined"
						@click="navigate(entry)"
					>
						<span class="mobile-nav__tool-icon" aria-hidden="true">
							<v-icon :icon="entry.icon" :size="20" />
						</span>
						<span class="mobile-nav__tool-copy">
							<span class="mobile-nav__tool-label">{{ entry.label }}</span>
							<span v-if="entry.hint" class="mobile-nav__tool-hint">{{ entry.hint }}</span>
						</span>
					</button>

					<!-- «More» — the rail's Más flyout, as a collapsed group: the
					     tools pages stay one tap away without crowding the rows a
					     cashier reaches for all day. Auto-expanded while one of
					     its rows is the active destination, so the lit row is
					     never hidden behind its own toggle. -->
					<template v-if="enrichedMoreItems.length">
						<button
							type="button"
							class="mobile-nav__tool"
							data-testid="mobile-nav-more"
							:aria-expanded="moreOpen ? 'true' : 'false'"
							@click="moreOpen = !moreOpen"
						>
							<span class="mobile-nav__tool-icon" aria-hidden="true">
								<v-icon icon="mdi-dots-grid" :size="20" />
							</span>
							<span class="mobile-nav__tool-copy">
								<span class="mobile-nav__tool-label">{{ __("More") }}</span>
								<span class="mobile-nav__tool-hint">{{ __("Register tools") }}</span>
							</span>
							<v-icon
								class="mobile-nav__more-chevron"
								:icon="moreOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'"
								:size="18"
								aria-hidden="true"
							/>
						</button>
						<div v-show="moreOpen" class="mobile-nav__more-group">
							<button
								v-for="entry in enrichedMoreItems"
								:key="entry.to"
								type="button"
								class="mobile-nav__tool"
								:class="{ 'mobile-nav__tool--on': entry.active }"
								:data-nav-destination="entry.id || undefined"
								:aria-current="entry.active ? 'page' : undefined"
								@click="navigate(entry)"
							>
								<span class="mobile-nav__tool-icon" aria-hidden="true">
									<v-icon :icon="entry.icon" :size="20" />
								</span>
								<span class="mobile-nav__tool-copy">
									<span class="mobile-nav__tool-label">{{ entry.label }}</span>
									<span v-if="entry.hint" class="mobile-nav__tool-hint">{{ entry.hint }}</span>
								</span>
							</button>
						</div>
					</template>
				</nav>
			</div>

			<div v-if="footerAction" class="mobile-nav__footer" data-test="drawer-footer-settings">
				<div class="mobile-nav__divider" role="separator"></div>
				<div class="mobile-nav__title">{{ __("Settings") }}</div>
				<button
					type="button"
					class="mobile-nav__tool"
					data-test="drawer-footer-action"
					@click="handleFooterActionClick"
				>
					<span class="mobile-nav__tool-icon" aria-hidden="true">
						<v-icon :icon="footerAction.icon" :size="20" />
					</span>
					<span class="mobile-nav__tool-copy">
						<span class="mobile-nav__tool-label">{{ footerAction.text }}</span>
						<span v-if="footerAction.subtitle" class="mobile-nav__tool-hint">
							{{ footerAction.subtitle }}
						</span>
					</span>
				</button>
			</div>
		</div>
	</v-navigation-drawer>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useRtl } from "../../composables/core/useRtl";
import { DESTINATIONS } from "../../composables/pos/shell/destinationRegistry";
import { getRailDestination } from "../../composables/pos/shell/railDestinations";
import { useVerticalStore } from "../../stores";

defineOptions({ name: "MobileNavPanel" });

const props = defineProps({
	drawer: Boolean,
	company: String,
	companyImg: String,
	subtitle: { type: String, default: "" },
	items: { type: Array, default: () => [] },
	moreItems: { type: Array, default: () => [] },
	footerAction: { type: Object, default: null },
});

const emit = defineEmits(["update:drawer", "open-settings"]);

const { isRtl, rtlClasses } = useRtl();
// Optional on purpose: unit tests mount the navbar without a router, and
// vue-router's composables answer undefined rather than throwing there.
const router = useRouter();
const route = useRoute();
const verticalStore = useVerticalStore();

const drawerOpen = ref(props.drawer);
watch(
	() => props.drawer,
	(value) => {
		drawerOpen.value = value;
	},
);
watch(drawerOpen, (value) => emit("update:drawer", value));

/** Registry row for a router path, so label/icon/hint stay single-sourced. */
const DESTINATION_BY_PATH = new Map(DESTINATIONS.map((d) => [d.path, d]));

/**
 * The items arrive as Navbar.vue's `{ text, icon, to }` (its gating already
 * applied). Where the path names a registry destination, the registry's
 * label, icon and hint win — resolved through `verticalStore.t()` so a
 * preset's renames (Explorar → Menú) hold here exactly as on the rail.
 */
const enrichEntry = (item) => {
	const destination = DESTINATION_BY_PATH.get(item.to);
	const rail = destination ? getRailDestination(destination.id) : undefined;
	return {
		to: item.to,
		id: destination?.id,
		icon: rail?.icon || item.icon,
		label: rail ? verticalStore.t(rail.label) : item.text,
		hint: rail?.hint ? verticalStore.t(rail.hint) : "",
		active: route?.path === item.to,
	};
};

const enrichedItems = computed(() => props.items.map(enrichEntry));
const enrichedMoreItems = computed(() => props.moreItems.map(enrichEntry));

/**
 * Collapsed each time the drawer opens — the group is the panel's attic —
 * UNLESS the active destination lives inside it: a toggle that hides the
 * row it just lit reads as navigation that went nowhere.
 */
const moreOpen = ref(false);
watch(drawerOpen, (open) => {
	if (open) {
		moreOpen.value = enrichedMoreItems.value.some((entry) => entry.active);
	}
});

const navigate = (entry) => {
	drawerOpen.value = false;
	if (router && route?.path !== entry.to) {
		router.push(entry.to);
	}
};

const handleFooterActionClick = () => {
	drawerOpen.value = false;
	emit("open-settings");
};
</script>

<style scoped>
/* The rail flyout's vocabulary (RailToolsMenu.vue), on the mobile sheet. The
 * drawer renders inside the v-layout, not teleported to <body>, so the
 * --pos-* theme names resolve; fallbacks mirror the flyout's literals. */
.mobile-nav :deep(.v-navigation-drawer__content) {
	display: flex;
	flex-direction: column;
}

.mobile-nav__shell {
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	flex: 1;
	padding: 10px 8px 12px;
	background: var(--pos-surface-raised, #ffffff);
}

.mobile-nav__header {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 10px 12px;
}

.mobile-nav__identity {
	display: flex;
	flex-direction: column;
	gap: 1px;
	min-width: 0;
}

.mobile-nav__company {
	font-size: 13.5px;
	font-weight: 700;
	line-height: 1.2;
	color: var(--pos-text-primary, #16222a);
}

.mobile-nav__register {
	font-size: 11.5px;
	line-height: 1.25;
	color: var(--pos-text-muted, #667085);
}

.mobile-nav__title {
	padding: 8px 10px 6px;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--pos-text-muted, #8b93a0);
}

.mobile-nav__divider {
	height: 1px;
	margin: 6px 6px 2px;
	background: var(--pos-border, #dfe4ea);
}

.mobile-nav__tool {
	position: relative;
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	min-height: 54px;
	padding: 9px 10px;
	border: 0;
	border-radius: 10px;
	background: transparent;
	color: var(--pos-text-primary, #16222a);
	text-align: left;
	cursor: pointer;
}

.mobile-nav__tool:hover,
.mobile-nav__tool:focus-visible {
	background: var(--reg-rail-pressed, #e3e8ee);
	outline: none;
}

.mobile-nav__tool:focus-visible {
	box-shadow: inset 0 0 0 2px var(--pos-primary-variant, #00838f);
}

.mobile-nav__tool--on {
	background: var(--reg-rail-tool-on, #eef7f8);
}

.mobile-nav__tool-icon {
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	flex: none;
	border-radius: 9px;
	background: var(--reg-rail-surface, #f2f4f7);
	color: var(--reg-rail-label-active, #00646f);
}

.mobile-nav__tool-copy {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.mobile-nav__tool-label {
	font-size: 13.5px;
	font-weight: 700;
	line-height: 1.2;
}

.mobile-nav__tool-hint {
	font-size: 11.5px;
	line-height: 1.25;
	color: var(--pos-text-muted, #667085);
}

/* Logical property, not margin-left: the drawer flips for RTL. */
.mobile-nav__more-chevron {
	margin-inline-start: auto;
	flex: none;
	color: var(--pos-text-muted, #667085);
}

.mobile-nav__more-group {
	display: flex;
	flex-direction: column;
}
</style>
