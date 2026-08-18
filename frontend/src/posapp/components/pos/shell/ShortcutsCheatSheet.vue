<template>
	<v-dialog v-model="visible" max-width="720" scrollable class="shortcuts-cheatsheet">
		<v-card data-testid="shortcuts-cheatsheet">
			<v-card-title class="shortcuts-title">
				{{ __("Keyboard shortcuts") }}
			</v-card-title>

			<v-card-text class="shortcuts-body">
				<div v-for="section in sections" :key="section.category" class="shortcuts-section">
					<div class="shortcuts-section-label">{{ __(section.label) }}</div>
					<div
						v-for="entry in section.entries"
						:key="entry.actionId"
						class="shortcuts-row"
						:data-action="entry.actionId"
					>
						<div class="shortcuts-row-text">
							<span class="shortcuts-row-label">{{ __(entry.label) }}</span>
							<span v-if="entry.hint" class="shortcuts-row-hint">{{ __(entry.hint) }}</span>
						</div>
						<div class="shortcuts-row-keys">
							<kbd v-for="chord in entry.chords" :key="chord" class="shortcuts-key">{{
								chord
							}}</kbd>
						</div>
					</div>
				</div>
			</v-card-text>

			<v-card-actions class="shortcuts-actions">
				<!-- The keymap is a versioned artifact: an operator reporting
				     "my keys are wrong" can read which revision they are on. -->
				<span class="shortcuts-keymap-id" data-testid="shortcuts-keymap-id">
					{{ keymapId }} · v{{ keymapVersion }}
				</span>
				<v-spacer />
				<v-btn variant="text" data-testid="shortcuts-close" @click="visible = false">{{
					__("Close")
				}}</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";

import { activeCheatSheet, getActiveKeymap } from "../../../shortcuts";
import eventBusPlugin from "../../../bus";

// @ts-ignore — Frappe's global translator; absent in unit tests.
const __ = window.__ || ((value: string) => value);

const visible = ref(false);
const sections = computed(() => activeCheatSheet());
const keymapId = computed(() => getActiveKeymap().keymapId);
const keymapVersion = computed(() => getActiveKeymap().version);

const open = () => {
	visible.value = true;
};

// Injected in the app; the imported singleton is the same emitter and keeps
// the component mountable in a bare unit test.
const eventBus = (inject("eventBus", null) as typeof eventBusPlugin | null) || eventBusPlugin;

onMounted(() => {
	eventBus.on("show_shortcuts_cheatsheet", open);
});

onBeforeUnmount(() => {
	eventBus.off("show_shortcuts_cheatsheet", open);
});
</script>

<style scoped>
/* Dark mode: every colour pairs background WITH text — a bare background
   inherits the light theme's dark ink and becomes unreadable at night. */
.shortcuts-title {
	font-size: 1.05rem;
	font-weight: 600;
}

.shortcuts-section {
	margin-bottom: 18px;
}

.shortcuts-section-label {
	font-size: 0.75rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.7;
	margin-bottom: 6px;
}

.shortcuts-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	padding: 5px 0;
}

.shortcuts-row-text {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.shortcuts-row-hint {
	font-size: 0.75rem;
	opacity: 0.65;
}

.shortcuts-row-keys {
	display: flex;
	gap: 6px;
	flex-shrink: 0;
}

.shortcuts-key {
	font-family: inherit;
	font-size: 0.78rem;
	white-space: nowrap;
	padding: 2px 8px;
	border-radius: 5px;
	border: 1px solid rgba(148, 163, 184, 0.45);
	background: rgba(148, 163, 184, 0.16);
	color: inherit;
}

.shortcuts-keymap-id {
	font-size: 0.72rem;
	opacity: 0.6;
	padding-inline-start: 12px;
}
</style>
