<template>
	<v-row justify="center">
		<!-- The variant picker, in the register's design language (owner ask
		     2026-08-26: «better ui/ux for the variables, like the cafeteria
		     artwork»). Fullscreen on the compact band (the flows-sheet
		     breakpoint), a centred sheet on the desk. The money path is
		     untouched: a tapped card still rides add_item into Invoice.vue. -->
		<v-dialog v-model="dialogVisible" v-bind="dialogProps">
			<v-card
				class="variantes pos-themed-card"
				:class="{ 'variantes--full': dialogProps.fullscreen }"
			>
				<header class="variantes__head">
					<div class="variantes__title-copy">
						<h2 class="variantes__title" data-testid="variantes-title">
							{{ (parentItem && parentItem.item_name) || __("Variants") }}
						</h2>
						<p class="variantes__meta">{{ metaLine }}</p>
					</div>
					<button
						type="button"
						class="variantes__close"
						data-testid="variantes-close"
						:aria-label="__('Close')"
						@click="close_dialog"
					>
						<v-icon icon="mdi-close" :size="20" />
					</button>
				</header>

				<div class="variantes__body">
					<!-- One section per attribute. An attribute with MANY values
					     (Modelo celular) grows its own filter field and a bounded,
					     scrollable chip cloud — a phone catalogue can carry dozens
					     of models, and an unbounded wrap buried the grid. -->
					<section
						v-for="attr in attributeGroups"
						:key="attr.attribute"
						class="variantes__attr"
						:data-attr="attr.attribute"
					>
						<div class="variantes__attr-head">
							<span class="variantes__attr-label">{{ attr.attribute }}</span>
							<label v-if="isLargeAttr(attr)" class="variantes__attr-search">
								<v-icon icon="mdi-magnify" :size="15" aria-hidden="true" />
								<input
									v-model="attrQuery[attr.attribute]"
									type="text"
									:placeholder="__('Search')"
									:aria-label="`${__('Search')} ${attr.attribute}`"
								/>
							</label>
						</div>
						<div class="variantes__chips" :class="{ 'variantes__chips--cloud': isLargeAttr(attr) }">
							<button
								v-for="value in visibleAttrValues(attr)"
								:key="value.abbr"
								type="button"
								class="variantes__chip"
								:class="{ 'variantes__chip--on': filters[attr.attribute] === value.attribute_value }"
								:aria-pressed="filters[attr.attribute] === value.attribute_value ? 'true' : 'false'"
								@click="toggleAttr(attr.attribute, value.attribute_value)"
							>
								{{ value.attribute_value }}
							</button>
							<button
								v-if="filters[attr.attribute]"
								type="button"
								class="variantes__chip variantes__chip--clear"
								@click="clearFilter(attr.attribute)"
							>
								{{ __("Clear") }}
							</button>
						</div>
					</section>

					<div v-if="displayItems.length" class="variantes__grid" data-testid="variantes-grid">
						<button
							v-for="item in displayItems"
							:key="item.item_code"
							type="button"
							class="variantes-card"
							:data-variant="item.item_code"
							@click="add_item(item)"
						>
							<span class="variantes-card__media" aria-hidden="true">
								<img
									:src="item.image || placeholderImage"
									alt=""
									loading="lazy"
									class="variantes-card__img"
								/>
							</span>
							<span class="variantes-card__name">{{ variantLabel(item) }}</span>
							<span class="variantes-card__price">{{
								formatCurrencySafe(item.price_list_rate ?? item.rate ?? 0)
							}}</span>
						</button>
						<div v-intersect="loadMore"></div>
					</div>
					<p v-else class="variantes__empty">{{ __("No items found") }}</p>
				</div>
			</v-card>
		</v-dialog>
	</v-row>
</template>

<script>
import { ensurePosProfile } from "../../../../utils/pos_profile";
import _ from "lodash";
import placeholderImage from "../placeholder-image.png";
import { getCurrentInstance } from "vue";
import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";
import { useUIStore } from "../../../stores/uiStore.js";
import { useInvoiceStore } from "../../../stores/invoiceStore.js";
export default {
	setup() {
		const { proxy } = getCurrentInstance();
		const eventBus = proxy?.eventBus;
		const uiStore = useUIStore();
		const invoiceStore = useInvoiceStore();
		// The flows-sheet breakpoint (1100): the compact band gets the picker
		// fullscreen, the desk gets a centred sheet.
		const { dialogProps } = useDialogFullscreen({ maxWidth: 760, breakpoint: 1100 });
		return { uiStore, invoiceStore, eventBus, dialogProps };
	},
	data: () => ({
		// varaintsDialog: false, // Removed in favor of store state
		parentItem: null,
		items: null,
		filters: {},
		filterdItems: [],
		pos_profile: null,
		attributes_meta: {},
		displayCount: 100,
		placeholderImage,
		/** Per-attribute value filter — only drawn for LARGE attributes. */
		attrQuery: {},
	}),

	computed: {
		variantsItems() {
			if (!this.parentItem || !Array.isArray(this.items)) {
				return [];
			}
			return this.items.filter((item) => item.variant_of == this.parentItem.item_code);
		},
		displayItems() {
			return this.filterdItems.slice(0, this.displayCount);
		},
		dialogVisible: {
			get() {
				return this.uiStore.variantsDialog;
			},
			set(val) {
				if (!val) this.uiStore.closeVariants();
			},
		},
		metaLine() {
			const translate =
				typeof window !== "undefined" && window.__ ? window.__ : (text) => text;
			return `${this.filterdItems.length} ${translate("Variants")}`;
		},
		/**
		 * The attribute sections the picker draws. `attributes_meta` is the
		 * declared answer, but `get_item_variants` returns it EMPTY for some
		 * templates (Case Cute Brillo on the mirror) — while every variant
		 * still carries its own `item_attributes`. So the groups fall back to
		 * a union derived from the variants themselves; without this the
		 * whole point of the picker (filter by Color / Modelo) vanished
		 * exactly on the templates with the most options.
		 */
		attributeGroups() {
			const declared = this.parentItem && this.parentItem.attributes;
			if (Array.isArray(declared) && declared.length) return declared;
			const groups = new Map();
			for (const item of this.variantsItems) {
				for (const attr of this.parseItemAttributes(item)) {
					const name = attr && attr.attribute;
					const value = attr && attr.attribute_value;
					if (!name || value == null || value === "") continue;
					if (!groups.has(name)) groups.set(name, new Set());
					groups.get(name).add(String(value));
				}
			}
			return Array.from(groups.entries()).map(([attribute, values]) => ({
				attribute,
				values: Array.from(values).map((value) => ({
					attribute_value: value,
					abbr: value,
				})),
			}));
		},
	},

	watch: {
		items: {
			handler() {
				this.filterdItems = this.variantsItems;
				this.displayCount = 100;
			},
			deep: true,
		},
		parentItem() {
			this.filterdItems = this.variantsItems;
			this.displayCount = 100;
		},
		attributes_meta: {
			handler(newVal) {
				if (this.parentItem && newVal && Object.keys(newVal).length) {
					this.parentItem.attributes = Object.keys(newVal).map((attr) => ({
						attribute: attr,
						values: newVal[attr].map((v) => ({ attribute_value: v, abbr: v })),
					}));
				} else if (this.parentItem) {
					this.parentItem.attributes = [];
				}
				this.$nextTick(() => {
					this.filterdItems = this.variantsItems;
					this.displayCount = 100;
				});
			},
			deep: true,
		},
		filters: {
			handler() {
				this.updateFiltredItems();
			},
			deep: true,
		},
		// Watch for new data from store
		"uiStore.variantsData": {
			async handler(data) {
				if (!data) return;
				const { item, items, profile, attrsMeta } = data;

				this.parentItem = item || null;
				if (!this.parentItem) return;
				this.items = Array.isArray(items) ? items : [];
				this.filters = {};
				this.attributes_meta = attrsMeta || this.attributes_meta;

				if (
					!this.parentItem.attributes &&
					this.attributes_meta &&
					Object.keys(this.attributes_meta).length
				) {
					this.parentItem.attributes = Object.keys(this.attributes_meta).map((attr) => ({
						attribute: attr,
						values: this.attributes_meta[attr].map((v) => ({ attribute_value: v, abbr: v })),
					}));
				}

				if (profile) {
					this.pos_profile = profile;
				} else {
					this.pos_profile = await ensurePosProfile();
				}

				if (!this.items || this.items.length === 0) {
					const parentCode = item.item_code || item.code || item.name;
					await this.fetchVariants(parentCode, this.pos_profile);
				}

				this.$nextTick(() => {
					this.filterdItems = this.variantsItems;
					this.displayCount = 100;
				});
			},
			deep: true,
			// The component lazy-mounts (Pos.vue v-if="variantsDialog" +
			// defineAsyncComponent) AFTER openVariants() has already set
			// variantsData, so a non-immediate watcher never saw the first
			// payload — the dialog opened blank (regression in 6f1f6296).
			immediate: true,
		},
	},

	methods: {
		close_dialog() {
			this.uiStore.closeVariants();
		},
		formatCurrency(value) {
			return this.$options.mixins[0].methods.formatCurrency.call(this, value, 2);
		},
		formatCurrencySafe(val) {
			const mixinFn =
				this.$options.mixins &&
				this.$options.mixins[0] &&
				this.$options.mixins[0].methods &&
				this.$options.mixins[0].methods.formatCurrency;

			if (mixinFn) {
				return mixinFn.call(this, val, 2);
			}
			return new Intl.NumberFormat("en-PK", {
				minimumFractionDigits: 0,
				maximumFractionDigits: 2,
			}).format(val);
		},
		applyCurrencyConversionToItem(item) {
			if (!item) return;
			if (!item.original_rate) {
				item.original_rate = item.price_list_rate ?? item.rate ?? 0;
				item.original_currency = item.currency || (this.pos_profile && this.pos_profile.currency);
			}
			// Use original_rate as price list rate in item's currency
			item.base_price_list_rate = item.price_list_rate ?? item.original_rate ?? 0;
			item.base_rate = item.base_rate || item.base_price_list_rate;
			item.rate = item.price_list_rate ?? item.rate ?? 0;
			item.currency = item.currency || (this.pos_profile && this.pos_profile.currency);
		},
		async fetchVariants(code, profile) {
			try {
				const res = await frappe.call({
					method: "posawesome.posawesome.api.items.get_item_variants",
					args: {
						pos_profile: JSON.stringify(profile || this.pos_profile || {}),
						parent_item_code: code,
					},
				});
				if (res.message) {
					const variants = res.message.variants || res.message;
					this.attributes_meta = res.message.attributes_meta || this.attributes_meta;
					const existingCodes = new Set((this.items || []).map((it) => it.item_code));
					const newItems = variants.filter((it) => !existingCodes.has(it.item_code));
					await Promise.all(newItems.map((it) => this.fetchVariantRate(it)));
					this.items = (this.items || []).concat(newItems);
				}
			} catch (e) {
				console.error("Failed to fetch variants", e);
			}
		},
		updateFiltredItems: _.debounce(function () {
			this.$nextTick(() => {
				const values = [];
				Object.entries(this.filters).forEach(([, value]) => {
					if (value) {
						values.push(value);
					}
				});

				if (!values.length) {
					this.filterdItems = this.variantsItems;
				} else {
					const itemsList = [];
					this.filterdItems = [];
					this.variantsItems.forEach((item) => {
						let apply = true;
						let attrs = [];
						if (Array.isArray(item.item_attributes)) {
							attrs = item.item_attributes;
						} else if (
							typeof item.item_attributes === "string" &&
							item.item_attributes.trim().startsWith("[")
						) {
							try {
								attrs = JSON.parse(item.item_attributes);
							} catch {
								attrs = [];
							}
						}
						for (const [attrName, val] of Object.entries(this.filters)) {
							if (!val) continue;
							const found = attrs.find(
								(a) => a.attribute === attrName && String(a.attribute_value) === String(val),
							);
							if (!found) {
								apply = false;
								break;
							}
						}
						if (apply && !itemsList.includes(item.item_code)) {
							this.filterdItems.push(item);
							itemsList.push(item.item_code);
						}
					});
				}
				this.displayCount = 100;
			});
		}, 200),
		clearFilter(attr) {
			this.filters[attr] = null;
			this.$nextTick(() => {
				this.filterdItems = this.variantsItems;
				this.displayCount = 100;
			});
		},
		/** > 10 values earns its own filter field and a bounded chip cloud —
		 *  a phone catalogue's Modelo attribute can carry dozens of models. */
		isLargeAttr(attr) {
			return (attr?.values?.length || 0) > 10;
		},
		visibleAttrValues(attr) {
			const values = attr?.values || [];
			const q = String(this.attrQuery[attr.attribute] || "")
				.trim()
				.toLowerCase();
			if (!q) return values;
			return values.filter((value) =>
				String(value.attribute_value).toLowerCase().includes(q),
			);
		},
		toggleAttr(attribute, value) {
			// Tap again to clear; the deep `filters` watcher re-filters.
			this.filters[attribute] = this.filters[attribute] === value ? null : value;
		},
		/** One parse for the label, the derived groups and nothing else —
		 *  `updateFiltredItems` keeps its own copy in the debounce closure. */
		parseItemAttributes(item) {
			if (Array.isArray(item?.item_attributes)) return item.item_attributes;
			if (
				typeof item?.item_attributes === "string" &&
				item.item_attributes.trim().startsWith("[")
			) {
				try {
					return JSON.parse(item.item_attributes);
				} catch {
					return [];
				}
			}
			return [];
		},
		/** «iPhone 16 Pro · Azul Cielo», not the template's name on every
		 *  card. Attribute values first; else the item_name with the
		 *  template's own name trimmed off its front. */
		variantLabel(item) {
			const attrs = this.parseItemAttributes(item);
			const values = attrs.map((a) => a && a.attribute_value).filter(Boolean);
			if (values.length) return values.join(" · ");
			const parent = String(this.parentItem?.item_name || "").trim();
			const name = String(item.item_name || item.item_code || "").trim();
			if (parent && name.toLowerCase().startsWith(parent.toLowerCase())) {
				const rest = name
					.slice(parent.length)
					.replace(/^[\s·:,–—-]+/, "")
					.trim();
				if (rest) return rest;
			}
			return name;
		},
		loadMore() {
			if (this.displayCount < this.filterdItems.length) {
				this.displayCount += 100;
			}
		},
		async fetchVariantRate(item) {
			if (!this.pos_profile) {
				this.pos_profile = await ensurePosProfile();
			}
			if (!this.pos_profile.warehouse) {
				try {
					const res = await frappe.call({
						method: "posawesome.posawesome.api.utils.get_default_warehouse",
						args: { company: this.pos_profile.company },
					});
					if (res.message) {
						this.pos_profile.warehouse = res.message;
					}
				} catch (e) {
					console.error("Failed to fetch default warehouse", e);
				}
			}
			try {
				const res = await frappe.call({
					method: "posawesome.posawesome.api.items.get_item_detail",
					args: {
						warehouse: item.warehouse || this.pos_profile.warehouse,
						price_list: this.pos_profile.selling_price_list,
						company: this.pos_profile.company,
						item: JSON.stringify({
							item_code: item.item_code,
							pos_profile: this.pos_profile.name,
							qty: item.qty || 1,
							uom: item.uom || item.stock_uom,
							doctype: this.pos_profile.create_pos_invoice_instead_of_sales_invoice
								? "POS Invoice"
								: "Sales Invoice",
						}),
					},
				});
				if (res.message) {
					const data = res.message;
					item.rate = data.price_list_rate;
					item.price_list_rate = data.price_list_rate;
					item.base_rate = data.price_list_rate;
					item.base_price_list_rate = data.price_list_rate;
					item.currency = data.currency || data.price_list_currency || this.pos_profile.currency;
					this.applyCurrencyConversionToItem(item);
				}
			} catch (e) {
				console.error("Failed to fetch variant rate", e);
			}
		},
		async add_item(item) {
			await this.fetchVariantRate(item);
			const payload = { ...item, code: item.item_code };
			// Using event bus to trigger logic-heavy add_item in Invoice.vue
			if (this.eventBus) {
				this.eventBus.emit("add_item", payload);
			} else {
				// Fallback to store if eventBus is missing (should not happen)
				this.invoiceStore.addItem(payload);
			}
			this.close_dialog();
		},
	},

	created() {
		// Event listeners removed - using store watchers
	},
	beforeUnmount() {
		// Cleanup if needed
	},
};
</script>

<style scoped>
/* The register vocabulary (mbrowse / mobile-nav tokens): the picker is the
 * catalogue's own design, one level deeper. */
.variantes {
	display: flex;
	flex-direction: column;
	max-height: 84vh;
	border-radius: 16px;
	background: var(--reg-surface-sunken, #f8f9fa);
	overflow: hidden;
}

.variantes--full {
	max-height: 100%;
	height: 100%;
	border-radius: 0;
}

.variantes__head {
	flex: none;
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 12px 14px 10px;
	background: var(--reg-surface, #ffffff);
	border-bottom: 1px solid var(--reg-divider, #eceff3);
}

.variantes__title-copy {
	flex: 1;
	min-width: 0;
	line-height: 1.2;
}

.variantes__title {
	margin: 0;
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.variantes__meta {
	margin: 1px 0 0;
	font-size: 11px;
	color: var(--reg-text-muted, #667085);
}

.variantes__close {
	flex: none;
	display: grid;
	place-items: center;
	width: 40px;
	height: 40px;
	border: 0;
	border-radius: 10px;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-primary, #212121);
	cursor: pointer;
}

.variantes__body {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 10px 14px 14px;
}

.variantes__attr {
	margin-bottom: 8px;
}

.variantes__attr-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding: 4px 0 5px;
}

.variantes__attr-label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #8b93a0);
}

.variantes__attr-search {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 4px 9px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.08));
	border-radius: 999px;
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-muted, #667085);
}

.variantes__attr-search input {
	width: 110px;
	border: 0;
	outline: none;
	background: transparent;
	font: inherit;
	font-size: 12px;
	color: var(--reg-text-primary, #212121);
}

.variantes__chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

/* A LARGE attribute's cloud is bounded and scrolls; unbounded, thirty Modelo
 * chips buried the variant grid below the fold. */
.variantes__chips--cloud {
	max-height: 122px;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding-right: 2px;
}

.variantes__chip {
	min-height: 36px;
	padding: 6px 13px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.1));
	border-radius: 999px;
	background: var(--reg-surface, #ffffff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 12.5px;
	font-weight: 600;
	cursor: pointer;
}

.variantes__chip--on {
	border-color: var(--reg-accent, #0097a7);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
}

.variantes__chip--clear {
	border-style: dashed;
	color: var(--reg-text-muted, #667085);
}

.variantes__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
	gap: 8px;
	margin-top: 6px;
}

.variantes-card {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 8px;
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: 12px;
	background: var(--reg-surface, #ffffff);
	text-align: left;
	font: inherit;
	cursor: pointer;
}

.variantes-card:active {
	transform: scale(0.98);
}

.variantes-card__media {
	display: grid;
	place-items: center;
	height: 78px;
	border-radius: 8px;
	background: var(--reg-surface-muted, #f2f4f7);
	overflow: hidden;
}

.variantes-card__img {
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
}

.variantes-card__name {
	font-size: 12.5px;
	font-weight: 700;
	line-height: 1.25;
	color: var(--reg-text-primary, #212121);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.variantes-card__price {
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.variantes__empty {
	margin: 0;
	padding: 26px 0;
	text-align: center;
	font-size: 12.5px;
	color: var(--reg-text-muted, #9aa2ae);
}
</style>
