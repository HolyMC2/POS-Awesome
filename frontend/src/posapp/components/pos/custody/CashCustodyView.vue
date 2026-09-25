<template>
	<section class="custody" data-testid="cash-custody" :aria-busy="busy ? 'true' : 'false'">
		<header class="custody__header">
			<div>
				<h2>{{ __("Cash custody") }}</h2>
				<p class="custody__context">
					<span class="chip chip--role">{{ canManage ? __("Supervisor") : __("Cashier") }}</span>
					<span
						>{{ __("Register") }}: <b>{{ profile || __("None selected") }}</b></span
					>
					<span :class="opening ? 'ok' : 'muted'">{{
						opening ? __("Drawer open") : __("No open drawer")
					}}</span>
					<span v-if="data" class="muted">{{ __("Safe") }}: {{ data.safe }}</span>
				</p>
			</div>
			<button class="btn" @click="profile ? load() : loadSafes()" :disabled="busy" data-testid="custody-refresh">
				{{ busy ? __("Refreshing…") : __("Refresh") }}
			</button>
		</header>

		<p v-if="!profile" class="notice">{{ __("Select a register to manage its cash.") }}</p>
		<label v-if="!ui.posProfile?.name && safeOptions.length" class="search">
			<span>{{ __("Register") }}</span>
			<select v-model="selectedProfile" data-testid="custody-register-select" :disabled="busy">
				<option value="">{{ __("Select a register to manage its cash.") }}</option>
				<option v-for="safe in safeOptions" :key="safe.name" :value="safe.pos_profile">{{ safe.pos_profile }} · {{ safe.title }}</option>
			</select>
		</label>

		<section v-if="pending.length" class="panel panel--pending" aria-labelledby="custody-pending">
			<h3 id="custody-pending">{{ __("Unconfirmed cash action") }}</h3>
			<p>
				{{ __("A cash action has an unconfirmed result. Retry it before moving the money again.") }}
			</p>
			<button
				v-for="entry in pending"
				:key="entry.action"
				class="btn btn--warning"
				:disabled="busy"
				@click="retry(entry)"
			>
				{{ __("Retry unconfirmed action") }}: {{ __(labels[entry.action] || entry.action) }}
				<small>{{ describePending(entry) }}</small>
			</button>
		</section>

		<p v-if="pendingWarning" class="panel panel--error" role="alert">{{ pendingWarning }}</p>

		<div class="custody__live" aria-live="polite">
			<div v-if="error" class="panel panel--error" role="alert">
				<p>{{ error }}</p>
				<p v-if="unconfirmed">
					{{
						__(
							"The connection failed before the result was known. Do not move the cash again — use Retry unconfirmed action above.",
						)
					}}
				</p>
				<button v-if="!action" class="btn" :disabled="busy" @click="load">
					{{ __("Try again") }}
				</button>
			</div>
			<div v-if="success" class="panel panel--success" role="status">
				<p>{{ success }}</p>
				<p v-if="successNext" class="muted">{{ successNext }}</p>
				<p v-if="successJournal">
					<a
						:href="deskLink('Journal Entry', successJournal)"
						target="_blank"
						rel="noopener"
						data-testid="custody-success-journal"
						>{{ __("Journal Entry") }} {{ successJournal }} ↗</a
					>
				</p>
			</div>
			<div v-if="staleDraft" class="panel panel--warning" data-testid="custody-stale-draft">
				<p>
					{{
						__(
							"An unsent cash form was saved on this device, but it no longer matches the cash records. It was not reopened and nothing was sent.",
						)
					}}
				</p>
				<p class="muted">{{ staleSummary }}</p>
				<button class="btn" @click="discardStale">
					{{ __("Discard the unsent form") }}
				</button>
			</div>
			<p v-if="draftNotice" class="notice" data-testid="custody-draft-notice">
				{{ draftNotice }}
			</p>
			<div
				v-if="draftWarning"
				class="panel panel--error"
				role="alert"
				data-testid="custody-draft-warning"
			>
				<p>{{ draftWarning }}</p>
				<button v-if="corruptDraft" class="btn" @click="discardCorrupt">
					{{ __("Discard the damaged saved form") }}
				</button>
			</div>
		</div>

		<p v-if="busy && !data" class="notice">{{ __("Loading the custody queue…") }}</p>

		<template v-if="data">
			<section class="starters custody__quick-tasks" aria-labelledby="custody-start">
				<h3 id="custody-start">{{ __("Start a cash task") }}</h3>
				<!-- Each task says what it does before anyone presses it. -->
				<ul class="starter-grid" data-testid="custody-starters">
					<li class="starter">
						<a
							class="btn"
							:href="bagListLink"
							target="_blank"
							rel="noopener"
							data-testid="cash-bag-list-link"
							aria-describedby="custody-starter-list"
						>
							{{ __("Bag list & labels") }} ↗
						</a>
						<small id="custody-starter-list" class="starter__help">{{ __(starterHelp.list) }}</small>
					</li>
					<li v-if="canManage" class="starter">
						<button
							class="btn btn--emphasis"
							aria-describedby="custody-starter-prepare"
							@click="start('prepare')"
						>
							{{ __("Prepare float bag") }}
						</button>
						<small id="custody-starter-prepare" class="starter__help">{{ __(starterHelp.prepare) }}</small>
					</li>
					<li class="starter">
						<button
							class="btn btn--emphasis"
							:disabled="!opening"
							:title="opening ? undefined : __('Open your register shift first.')"
							aria-describedby="custody-starter-drop"
							@click="start('drop')"
						>
							{{ __("Return bag to safe") }}
						</button>
						<small id="custody-starter-drop" class="starter__help">{{ __(starterHelp.drop) }}</small>
					</li>
					<li v-if="canManage" class="starter">
						<button class="btn" aria-describedby="custody-starter-count" @click="start('count_safe')">
							{{ __("Count safe") }}
						</button>
						<small id="custody-starter-count" class="starter__help">{{ __(starterHelp.count_safe) }}</small>
					</li>
				</ul>
				<p v-if="!opening" class="muted">
					{{ __("Open your register shift to move cash between the drawer and the safe.") }}
				</p>
				<div class="custody__next-tasks" aria-labelledby="custody-guidance">
					<h3 v-if="canManage" id="custody-guidance">{{ __("What needs you now") }}</h3>
					<ul v-if="tasks.length" class="tasks">
						<li v-for="task in tasks" :key="task.id">
							<button class="task" @click="focusTask(task)">
								<span>{{ task.text }}</span>
								<b v-if="task.count">{{ task.count }}</b>
							</button>
						</li>
					</ul>
					<p v-else>{{ idleGuidance }}</p>
				</div>
			</section>
			<CashDrawerGuidance
				ref="drawerGuidance"
				:profile="profile"
				:opening="opening"
				@request-return="start('drop')"
			/>

			<details class="balances" :open="canManage">
				<summary>{{ __("Safe balances") }}</summary>
				<dl class="summary">
					<div>
						<dt>{{ __("Safe balance") }}</dt>
						<dd>
							{{ money(data.balance) }}
							<small class="muted">{{ __("All cash the ledger places in this safe, sealed bags included") }}</small>
						</dd>
					</div>
					<div>
						<dt>{{ __("Loose cash available") }}</dt>
						<dd>
							{{ money(data.loose_balance) }}
							<small class="muted">{{ __("Not reserved by a sealed bag") }}</small>
						</dd>
					</div>
					<div>
						<dt>{{ __("Bank deposits in transit") }}</dt>
						<dd>
							{{ money(data.in_transit) }}
							<small class="muted">{{ __("Awaiting a bank receipt") }}</small>
						</dd>
					</div>
				</dl>
				<dl class="targets" data-testid="custody-targets">
					<div>
						<dt>{{ __("Suggested float") }}: {{ money(data.float_target) }}</dt>
						<dd class="muted">{{ __("How much cash a drawer should start its shift with.") }}</dd>
					</div>
					<div>
						<dt>{{ __("Drawer cash limit") }}: {{ money(data.drawer_limit) }}</dt>
						<dd class="muted">
							{{
								__(
									"Above this, seal the extra cash and return it to the safe. It is guidance and never blocks a sale.",
								)
							}}
						</dd>
					</div>
				</dl>
			</details>
			<div class="workspace">
				<div class="queue-column">
					<div class="tabs" role="tablist" :aria-label="__('Cash custody queues')">
						<button
							v-for="tab in tabs"
							:key="tab.id"
							role="tab"
							:id="`custody-tab-${tab.id}`"
							:aria-selected="queue === tab.id ? 'true' : 'false'"
							:aria-controls="`custody-list-${tab.id}`"
							:class="['tab', { 'tab--on': queue === tab.id }]"
							@click="queue = tab.id"
						>
							{{ tab.label }} <b>{{ tab.total }}</b>
						</button>
					</div>

					<label class="search"
						><span class="sr-only">{{ searchLabel }}</span>
						<input
							type="search"
							ref="queueSearch"
							v-model="search"
							:placeholder="searchLabel"
							:aria-label="searchLabel"
					/></label>

					<div class="filters" role="group" :aria-label="__('Filter the queue')">
						<button
							v-for="option in filterOptions"
							:key="option.id"
							:class="['filter', { 'filter--on': filter === option.id }]"
							:aria-pressed="filter === option.id ? 'true' : 'false'"
							@click="filter = option.id"
						>
							{{ option.label }} <b>{{ option.count }}</b>
						</button>
					</div>
					<p class="muted filters__help" data-testid="custody-filter-help">{{ filterHelp }}</p>

					<div
						role="tabpanel"
						:id="`custody-list-${queue}`"
						:aria-labelledby="`custody-tab-${queue}`"
					>
						<p
							v-if="historyMeta?.history_has_more"
							class="notice"
							data-testid="custody-history-notice"
						>
							{{
								__(
									"All pending work is shown. Completed history here is limited to the most recent records.",
								)
							}}
							<a :href="historyLink" target="_blank" rel="noopener">{{
								__("Open full cash history")
							}}</a>
						</p>
						<ul class="queue">
							<li v-for="bag in queue === 'bags' ? visibleBags : []" :key="bag.name">
								<button
									:class="['record', { 'record--on': selectedBag?.name === bag.name }]"
									:aria-current="selectedBag?.name === bag.name ? 'true' : undefined"
									@click="selectBag(bag)"
								>
									<strong>{{ bag.seal }}</strong>
									<span class="record__meta">
										<span :class="['chip', chipTone(bag.state)]">{{
											__(bagStates[bag.state] || bag.state)
										}}</span>
										<span>{{ __(bag.purpose) }}</span>
										<span v-if="bag.state === 'Transferred' && bag.transfer_account">
											→ {{ bag.transfer_account }}
										</span>
										<span class="muted">{{ when(bag.modified) }}</span>
									</span>
									<b class="money">{{ money(bag.amount) }}</b>
								</button>
							</li>
							<li v-for="row in queue === 'counts' ? visibleCounts : []" :key="row.name">
								<button
									:class="['record', { 'record--on': selectedCount?.name === row.name }]"
									:aria-current="selectedCount?.name === row.name ? 'true' : undefined"
									@click="selectCount(row)"
								>
									<strong>{{ countTitle(row) }}</strong>
									<span class="record__meta">
										<span :class="['chip', chipTone(row.state)]">{{
											__(countStates[row.state] || row.state)
										}}</span>
										<span>{{ row.counted_by }}</span>
										<span class="muted">{{ when(row.modified) }}</span>
									</span>
									<b class="money"
										>{{ money(row.amount)
										}}<em v-if="Number(row.difference)" class="diff">{{
											differenceLabel(row.difference)
										}}</em></b
									>
								</button>
							</li>
						</ul>

						<p v-if="queue === 'bags' && !visibleBags.length" class="notice">
							<template v-if="!data.bags.length">{{
								__(
									"No cash bags yet. A supervisor can prepare the first float from the safe.",
								)
							}}</template>
							<template v-else>{{ __("No bag matches this filter or search.") }}</template>
							<button v-if="data.bags.length" class="btn btn--link" @click="clearFilters">
								{{ __("Show all bags") }}
							</button>
						</p>
						<p v-if="queue === 'counts' && !visibleCounts.length" class="notice">
							<template v-if="!data.counts.length">{{
								__("No counts recorded yet for this safe.")
							}}</template>
							<template v-else>{{ __("No count matches this filter or search.") }}</template>
							<button v-if="data.counts.length" class="btn btn--link" @click="clearFilters">
								{{ __("Show all counts") }}
							</button>
						</p>
						<p v-if="queue === 'counts' && !canManage" class="muted">
							{{
								__(
									"You see the counts you recorded. A supervisor sees every count of this safe.",
								)
							}}
						</p>
						<details class="custody__legend" data-testid="custody-state-legend">
							<summary>
								{{ queue === "bags" ? __("What each bag state means") : __("What each count state means") }}
							</summary>
							<dl>
								<div v-for="row in stateLegend" :key="row.state">
									<dt>
										<span :class="['chip', chipTone(row.state)]">{{ __(row.label) }}</span>
									</dt>
									<dd>{{ __(row.help) }}</dd>
								</div>
							</dl>
						</details>
					</div>
				</div>

				<div v-if="selectedBag || selectedCount || action" class="detail">
					<button v-if="!action" type="button" class="btn custody__back" @click="returnToQueue">
						<v-icon icon="mdi-arrow-left" size="18" />{{ __("Back to cash queue") }}
					</button>

					<template v-if="selectedBag && !action">
						<article class="record-detail" :key="selectedBag.name">
							<div class="record-detail__head">
								<h3 tabindex="-1" ref="recordHeading">
									{{ __("Bag") }} {{ selectedBag.seal }}
								</h3>
								<span :class="['chip', chipTone(selectedBag.state)]">{{
									__(bagStates[selectedBag.state] || selectedBag.state)
								}}</span>
							</div>
							<p class="amount money">{{ money(selectedBag.amount) }}</p>
							<p v-if="bagHelp[selectedBag.state]">
								{{ __(bagHelp[selectedBag.state] ?? "") }}
							</p>
							<!-- An unverified bag that left keeps saying so; the state alone
							     must never read as a verified hand-over. -->
							<p
								v-if="selectedBag.state === 'Transferred' && !selectedBag.verified_by"
								class="panel panel--warning"
								data-testid="custody-transfer-unverified"
							>
								{{
									__(
										"Never independently verified. This bag left the safe with only the preparer's count; any recount happens off-site, outside POS.",
									)
								}}
							</p>
							<dl
								v-if="selectedBag.state === 'Transferred'"
								class="trail"
								data-testid="custody-transfer-record"
							>
								<div>
									<dt>{{ __("Moved to") }}</dt>
									<dd>{{ selectedBag.transfer_account || "—" }}</dd>
								</div>
								<div>
									<dt>{{ __("Moved by") }}</dt>
									<dd>{{ selectedBag.transferred_by || "—" }}</dd>
								</div>
								<div>
									<dt>{{ __("Moved on") }}</dt>
									<dd>{{ when(selectedBag.transferred_on) || "—" }}</dd>
								</div>
								<div>
									<dt>{{ __("Transfer journal") }}</dt>
									<dd>
										<a
											v-if="selectedBag.transfer_journal"
											:href="deskLink('Journal Entry', selectedBag.transfer_journal)"
											target="_blank"
											rel="noopener"
											>{{ selectedBag.transfer_journal }} ↗</a
										>
										<a
											v-else
											:href="deskLink('POS Cash Bag', selectedBag.name)"
											target="_blank"
											rel="noopener"
											>{{ __("Open the bag record") }} ↗</a
										>
									</dd>
								</div>
							</dl>

							<!-- Every action says what it does to the money before it is pressed. -->
							<ul class="action-list" data-testid="custody-bag-actions">
								<li v-for="option in bagActions" :key="option.action" class="action-list__row">
									<button
										:class="['btn', option.primary ? 'btn--emphasis' : '']"
										:disabled="!option.enabled"
										:aria-describedby="`custody-bag-help-${option.action}`"
										@click="option.run ? option.run() : start(option.action, true)"
									>
										{{ __(option.labelKey) }}
									</button>
									<small :id="`custody-bag-help-${option.action}`" class="action-list__help">{{
										__(helpFor(option.action))
									}}</small>
								</li>
								<li class="action-list__row">
									<button
										class="btn"
										:disabled="printing"
										aria-describedby="custody-bag-help-print"
										@click="printRecord('POS Cash Bag', selectedBag.name)"
									>
										{{ printing ? __("Preparing…") : __("Print handover") }}
									</button>
									<small id="custody-bag-help-print" class="action-list__help">{{
										__(actionHelp.print_handover)
									}}</small>
								</li>
								<li class="action-list__row">
									<button
										class="btn"
										:disabled="printing"
										aria-describedby="custody-bag-help-label"
										@click="printRecord('POS Cash Bag', selectedBag.name, 'label')"
									>
										{{ __("Print bag label") }}
									</button>
									<small id="custody-bag-help-label" class="action-list__help">{{
										__(actionHelp.print_label)
									}}</small>
								</li>
							</ul>
							<CashPhotos :key="selectedBag.name" doctype="POS Cash Bag" :name="selectedBag.name" />
							<details class="custody__history">
								<summary>{{ __("Details and history") }}</summary>
								<dl class="trail">
									<div>
										<dt>{{ __("Purpose") }}</dt>
										<dd>{{ __(selectedBag.purpose) }}</dd>
									</div>
									<div>
										<dt>{{ __("Prepared by") }}</dt>
										<dd>{{ selectedBag.prepared_by || "—" }}</dd>
									</div>
									<div>
										<dt>{{ __("Verified by") }}</dt>
										<dd>
											{{
												selectedBag.verified_by ||
												(doneBagStates.includes(selectedBag.state)
													? __("Never independently verified")
													: __("Not verified yet"))
											}}
										</dd>
									</div>
									<div v-if="selectedBag.opening_shift">
										<dt>{{ __("Shift") }}</dt>
										<dd>{{ selectedBag.opening_shift }}</dd>
									</div>
									<div>
										<dt>{{ __("Last movement") }}</dt>
										<dd>{{ when(selectedBag.modified) }}</dd>
									</div>
									<div>
										<dt>{{ __("Record") }}</dt>
										<dd class="muted">{{ selectedBag.name }}</dd>
									</div>
								</dl>
							</details>
							<p v-for="reason in bagBlockers" :key="reason" class="muted blocker">
								{{ reason }}
							</p>
							<p v-if="transferBlocked" class="muted blocker" data-testid="custody-transfer-blocker">
								{{ __("Whole-bag transfer off-site is unavailable") }}:
								{{
									data.transfer_blocker ||
									__("The off-site cash account for this safe is not ready.")
								}}
								<a :href="deskLink('POS Cash Safe', data.safe)" target="_blank" rel="noopener"
									>{{ __("Open this safe's settings") }} ↗</a
								>
							</p>
						</article>
					</template>

					<template v-if="selectedCount && !action">
						<article class="record-detail" :key="selectedCount.name">
							<div class="record-detail__head">
								<h3 tabindex="-1" ref="recordHeading">{{ countTitle(selectedCount) }}</h3>
								<span :class="['chip', chipTone(selectedCount.state)]">{{
									__(countStates[selectedCount.state] || selectedCount.state)
								}}</span>
							</div>
							<p class="amount money">{{ money(selectedCount.amount) }}</p>
							<dl class="trail">
								<div v-if="selectedCount.expected_amount != null">
									<dt>{{ __("Expected") }}</dt>
									<dd>{{ money(selectedCount.expected_amount) }}</dd>
								</div>
								<div v-if="Number(selectedCount.difference)">
									<dt>{{ __("Difference") }}</dt>
									<dd class="diff">{{ differenceLabel(selectedCount.difference) }}</dd>
								</div>
								<div>
									<dt>{{ __("Counted by") }}</dt>
									<dd>{{ selectedCount.counted_by }}</dd>
								</div>
								<div v-if="selectedCount.bag">
									<dt>{{ __("Bag") }}</dt>
									<dd>{{ bagSeal(selectedCount.bag) }}</dd>
								</div>
								<div v-if="selectedCount.opening_shift">
									<dt>{{ __("Shift") }}</dt>
									<dd>{{ selectedCount.opening_shift }}</dd>
								</div>
								<div v-if="selectedCount.closing_shift">
									<dt>{{ __("Closing") }}</dt>
									<dd>{{ selectedCount.closing_shift }}</dd>
								</div>
								<div>
									<dt>{{ __("Recorded") }}</dt>
									<dd>{{ when(selectedCount.modified) }}</dd>
								</div>
								<div>
									<dt>{{ __("Record") }}</dt>
									<dd class="muted">{{ selectedCount.name }}</dd>
								</div>
							</dl>
							<p v-if="selectedCount.note">{{ selectedCount.note }}</p>
							<CashPhotos :key="selectedCount.name" doctype="POS Cash Count" :name="selectedCount.name" />
							<table v-if="evidence && evidence.denominations.length">
								<caption class="sr-only">
									{{
										__("Count evidence")
									}}
								</caption>
								<thead>
									<tr>
										<th scope="col">{{ __("Denomination") }}</th>
										<th scope="col">{{ __("Quantity") }}</th>
										<th scope="col">{{ __("Amount") }}</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="row in evidence.denominations" :key="row.value">
										<td>{{ money(row.value) }}</td>
										<td>{{ row.quantity }}</td>
										<td class="money">{{ money(row.value * row.quantity) }}</td>
									</tr>
								</tbody>
							</table>
							<p v-if="evidence && evidence.source === 'manual'">
								{{ __("Manual count") }}: {{ evidence.reason }}
							</p>
							<p v-if="!evidence" class="muted">
								{{
									__(
										"The stored count evidence could not be read here. Open the record in Desk.",
									)
								}}
							</p>
							<ul class="action-list" data-testid="custody-count-actions">
								<li v-if="canManage && selectedCount.state === 'Exception'" class="action-list__row">
									<button
										class="btn btn--emphasis"
										:disabled="isMine(selectedCount.counted_by)"
										aria-describedby="custody-count-help-review"
										@click="start('review', true)"
									>
										{{ __("Review difference") }}
									</button>
									<small id="custody-count-help-review" class="action-list__help">{{
										__(actionHelp.review)
									}}</small>
								</li>
								<li
									v-if="selectedCount.state === 'Draft' && isMine(selectedCount.counted_by)"
									class="action-list__row"
								>
									<button class="btn" aria-describedby="custody-count-help-closing" @click="goToClosing">
										{{ __("Continue in Close shift") }}
									</button>
									<small id="custody-count-help-closing" class="action-list__help">{{
										__(actionHelp.continue_closing)
									}}</small>
								</li>
								<li class="action-list__row">
									<button
										class="btn"
										:disabled="printing"
										aria-describedby="custody-count-help-print"
										@click="printRecord('POS Cash Count', selectedCount.name)"
									>
										{{ printing ? __("Preparing…") : __("Print count evidence") }}
									</button>
									<small id="custody-count-help-print" class="action-list__help">{{
										__(actionHelp.print_count)
									}}</small>
								</li>
							</ul>
							<p
								v-if="
									canManage &&
									selectedCount.state === 'Exception' &&
									isMine(selectedCount.counted_by)
								"
								class="muted blocker"
							>
								{{ __("Another supervisor must review a difference you counted.") }}
							</p>
							<p v-if="!canManage && selectedCount.state === 'Exception'" class="muted blocker">
								{{
									__(
										"A supervisor reviews this difference. The cash stays where it is until then.",
									)
								}}
							</p>
						</article>
					</template>

					<p v-if="!selectedBag && !selectedCount && !action" class="notice">
						{{
							__(
								"Select a bag or a count from the queue to see its custody trail and the actions allowed now.",
							)
						}}
					</p>

					<form
						v-if="action"
						ref="formEl"
						@submit.prevent="submit"
						:aria-busy="busy ? 'true' : 'false'"
					>
						<h3 tabindex="-1" ref="formHeading">{{ formTitle }}</h3>
						<p v-if="formHelp">{{ formHelp }}</p>
						<p v-if="action === 'prepare'" class="muted">
							{{ __("Loose cash available") }}: {{ money(data.loose_balance) }}
						</p>
						<p v-if="action === 'count_safe'" class="muted">
							{{ __("Ledger balance to reconcile") }}: {{ money(data.balance) }}
						</p>
						<p v-if="action === 'review' && selectedCount" class="muted">
							{{ __("Counted") }}: {{ money(selectedCount.amount) }} · {{ __("Expected") }}:
							{{ money(selectedCount.expected_amount) }} ·
							<span class="diff">{{ differenceLabel(selectedCount.difference) }}</span>
						</p>
						<p v-if="overLoose" class="panel panel--warning" role="status">
							{{
								__(
									"This is more than the unallocated safe cash. Verify a deposit or unpack an available bag first.",
								)
							}}
						</p>
						<template v-if="['prepare', 'drop'].includes(action)">
							<label
								>{{ __("Bag seal / ID")
								}}<input
									v-model="seal"
									required
									minlength="3"
									maxlength="80"
									pattern="[A-Za-z0-9_-]{3,80}"
									aria-describedby="custody-seal-hint"
									:title="__('Use 3 to 80 letters, digits, hyphens or underscores.')"
							/></label>
							<p id="custody-seal-hint" class="muted hint">
								{{
									__(
										"Write this seal on the physical bag. Each bag keeps its own unique seal.",
									)
								}}
							</p>
							<label
								>{{ __("Purpose")
								}}<select v-model="purpose" aria-describedby="custody-purpose-hint">
									<option value="Float">{{ __("Float for the next drawer") }}</option>
									<option value="Takings">{{ __("Takings for the bank") }}</option>
								</select></label
							>
							<p id="custody-purpose-hint" class="muted hint">{{ __(purposeHelp) }}</p>
						</template>
						<div
							v-if="transferDirection"
							class="custody__direction"
							data-testid="custody-transfer-direction"
						>
							<span
								><small>{{ __("From") }}</small
								><strong>{{ transferDirection.from }}</strong></span
							>
							<v-icon icon="mdi-arrow-right" size="22" aria-hidden="true" />
							<span
								><small>{{ __("To") }}</small
								><strong>{{ transferDirection.to }}</strong></span
							>
						</div>
						<template v-if="action === 'transfer_safe' && selectedBag">
							<!-- Everything the server will derive, shown before anyone confirms.
							     Nothing here is editable: the amount is the bag's and the
							     destination is the safe's configured off-site ledger. -->
							<dl class="summary" data-testid="custody-transfer-summary">
								<div>
									<dt>{{ __("Amount leaving the safe") }}</dt>
									<dd class="money">{{ money(selectedBag.amount) }}</dd>
								</div>
								<div>
									<dt>{{ __("Destination") }}</dt>
									<dd class="custody__destination">
										{{ transferTarget.name }}
										<small v-if="transferTarget.account !== transferTarget.name" class="muted">{{
											transferTarget.account
										}}</small>
									</dd>
								</div>
							</dl>
							<p
								v-if="!selectedBag.verified_by"
								class="panel panel--warning"
								role="status"
								data-testid="custody-transfer-unverified-warning"
							>
								{{
									__(
										"This bag was never independently verified. It leaves with only the count by {0} and stays marked unverified.",
									).replace("{0}", selectedBag.prepared_by || __("the preparer"))
								}}
							</p>
							<p v-else class="muted">
								{{ __("Verified by") }}: {{ selectedBag.verified_by }}
							</p>
							<label class="custody__confirm">
								<input
									type="checkbox"
									required
									:checked="transferConfirmed"
									data-testid="custody-transfer-confirm"
									@change="confirmTransfer(($event.target as HTMLInputElement).checked)"
								/>
								<span>{{
									__(
										"I confirm the whole bag, sealed and unopened, has already physically left for {0}.",
									).replace("{0}", transferTarget.name)
								}}</span>
							</label>
						</template>
						<CashCountEditor
							v-if="['prepare', 'drop', 'receive', 'verify', 'count_safe'].includes(action)"
							v-model="count"
							:currency="data.currency"
							:title="__(countTitles[action] || 'Count cash')"
						/>
						<p v-if="expectedForAction !== null" :class="['muted', { diff: mismatch }]">
							{{ __("Expected") }}: {{ money(expectedForAction) }} · {{ __("Counted") }}:
							{{ money(counted) }}
							<template v-if="mismatch">
								· {{ differenceLabel(counted - expectedForAction) }}</template
							>
						</p>
						<p v-if="mismatch && action === 'receive'" class="panel panel--warning" role="status">
							{{
								__(
									"A mismatch records an exception and does not add cash to your drawer. A supervisor reviews it.",
								)
							}}
						</p>
						<template v-if="action === 'confirm_bank'">
							<label
								>{{ __("Bank receipt reference")
								}}<input
									v-model="reference"
									required
									maxlength="140"
									aria-describedby="custody-reference-hint"
							/></label>
							<p id="custody-reference-hint" class="muted hint">
								{{ __("Copy the reference printed on the bank deposit slip.") }}
							</p>
						</template>
						<template v-else>
							<label
								>{{ noteLabel
								}}<textarea
									v-model="note"
									rows="3"
									maxlength="1000"
									:required="noteRequired"
									:minlength="noteRequired ? 8 : 0"
									aria-describedby="custody-note-hint"
								/>
							</label>
							<p v-if="noteRequired" id="custody-note-hint" class="muted hint">
								{{ __("At least 8 characters. This reason stays in the audit trail.") }}
							</p>
						</template>
						<p v-if="action === 'review'" class="muted">
							{{
								__(
									"The review posts the difference between the cash account and the cash over/short account. The original count stays unchanged.",
								)
							}}
						</p>
						<p class="muted">
							{{
								__(
									"Submitted cash actions remain in the audit trail. A failed connection can be retried without recording the transfer twice.",
								)
							}}
						</p>
						<div class="actions">
							<!-- Accented only when this screen owns the main action. Hosted by
							     the shell, the band below carries the very same Confirm, and two
							     accented copies of one action read as two different ones. -->
							<button
								type="submit"
								:class="['btn', { custody__primary: !bandHosted }]"
								:disabled="busy"
								data-testid="custody-confirm"
							>
								{{ busy ? __("Saving…") : confirmText }}
							</button>
							<button type="button" class="btn" @click="cancel" :disabled="busy">
								{{ __("Cancel") }}
							</button>
						</div>
					</form>
				</div>
			</div>
		</template>
	</section>
</template>
<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useUIStore } from "../../../stores/uiStore";
import { read, command, emptyCount, pendingActions, printEvidence, amount } from "./api";
import { clearDraft, draftKey, readDraft, writeDraft, type CustodyDraft } from "./draft";
import CashCountEditor from "./CashCountEditor.vue";
import CashPhotos from "./CashPhotos.vue";
import CashDrawerGuidance from "./CashDrawerGuidance.vue";
const drawerGuidance = ref<InstanceType<typeof CashDrawerGuidance> | null>(null);
import type { BandState } from "../../../composables/pos/shell/bandState";
import { DESTINATION_SURFACE, type DestinationSurface } from "../shell/destinations/surfaceContext";
const __ = (s: string) => (window as any).__?.(s) || s;
/**
 * The shell's band, published the way every other hosted surface publishes it
 * (`InvoiceLedgerSurface`, `CobroSurface`, `ClosingDialog`): one number, one
 * action, emitted upward and relayed by `DestinationHost`. Without it the
 * register kept wearing the sale's «VOLVER A LA VENTA · $0.00» under a screen
 * that is not selling anything.
 */
const emit = defineEmits<{ band: [BandState | null] }>();
const ui = useUIStore();
const router = useRouter();
const queueSearch = ref<HTMLInputElement | null>(null);
const selectedProfile = ref("");
const safeOptions = ref<{ name: string; title: string; pos_profile: string; company: string }[]>([]);
const profile = computed(() => ui.posProfile?.name || selectedProfile.value);
const opening = computed(() => ui.posOpeningShift?.name);
const pending = ref<{ action: string; payload: any }[]>([]);
const data = ref<any>(null),
	error = ref(""),
	success = ref(""),
	successNext = ref(""),
	successJournal = ref(""),
	pendingWarning = ref(""),
	busy = ref(false),
	printing = ref(false),
	queue = ref("bags"),
	filter = ref("active"),
	search = ref(""),
	selectedBag = ref<any>(null),
	selectedCount = ref<any>(null),
	action = ref(""),
	lastAction = ref(""),
	seal = ref(""),
	purpose = ref("Float"),
	note = ref(""),
	reference = ref(""),
	count = ref<any>(emptyCount()),
	draftNotice = ref(""),
	draftWarning = ref(""),
	staleDraft = ref<CustodyDraft | null>(null),
	draftStorageOk = ref(true),
	draftHandedOff = ref(false),
	corruptDraft = ref(false),
	formHeading = ref<HTMLElement | null>(null),
	formEl = ref<HTMLFormElement | null>(null),
	recordHeading = ref<HTMLElement | null>(null);
const labels: Record<string, string> = {
	prepare: "Prepare float bag",
	drop: "Return bag to safe",
	receive: "Receive into drawer",
	verify: "Verify bag",
	unpack: "Return to loose safe cash",
	dispatch: "Send to bank",
	confirm_bank: "Confirm bank receipt",
	return_bank: "Return undeposited bag",
	count_safe: "Count safe",
	review: "Review difference",
	transfer_safe: "Move whole bag off-site",
};
/** Plain-language state names, the same words Desk and the printed slips use.
    The raw state stays visible on the record in Desk. */
const bagStates: Record<string, string> = {
	Unverified: "Awaiting verification",
	Available: "Verified in safe",
	Disputed: "Held for supervisor review",
	Issued: "Issued to a drawer",
	"In Transit": "In transit to the bank",
	Deposited: "Deposited at the bank",
	Unpacked: "Returned to loose safe cash",
	Transferred: "Moved to the off-site safe",
};
const bagHelp: Record<string, string> = {
	Unverified: "Another person must count this bag before it can be used or sent to the bank.",
	Available: "Counted by a second person. It can start a drawer, go to the bank, or be unpacked.",
	Disputed: "The counts did not match. A supervisor recounts or reviews the difference.",
	Issued: "This cash is in the drawer. It returns to the safe as a sealed bag at closing.",
	"In Transit": "The bag left for the bank. Record the bank receipt once the deposit is done.",
	Deposited: "The bank receipt is recorded. This bag is closed evidence.",
	Unpacked: "The cash went back to loose safe funds. This bag is closed evidence.",
	Transferred:
		"The sealed bag left the safe whole for the off-site cash account. This bag is closed evidence.",
};
const countStates: Record<string, string> = {
	Draft: "Saved draft",
	Final: "Final count",
	Exception: "Difference pending review",
	Reviewed: "Difference reviewed",
};
const countHelp: Record<string, string> = {
	Draft: "Saved during a closing that is not finished. Closing the shift makes it final.",
	Final: "Recorded evidence of the cash that was counted. Nothing is pending.",
	Exception:
		"The count did not match what was expected. A supervisor who did not count it reviews the difference.",
	Reviewed: "A supervisor posted the difference. The count itself stays as it was recorded.",
};
/** What each way into a cash task does, shown under its button. */
const starterHelp = {
	list: "Opens every bag of this safe in Desk to print labels or handover sheets.",
	prepare: "Seals loose cash from the safe as the starting cash for a drawer.",
	drop: "Seals cash from your open drawer and sends it to the safe.",
	count_safe: "Counts every note and coin in the safe against the ledger balance.",
};
/** What each record action does to the money, shown beside its button. */
const actionHelp = {
	receive: "Count this bag and add its cash to your open drawer.",
	verify: "Recount a bag another person sealed. A match makes it usable; a difference holds it for review.",
	open_dispute: "Open the count that did not match and settle the difference.",
	dispatch:
		"The bag leaves for the bank. Its cash waits as a deposit in transit until the bank receipt is recorded.",
	unpack: "Open the bag and return its cash to the safe's loose cash. The seal is used up.",
	confirm_bank: "Record the deposit slip reference. The cash moves from in transit to the bank account.",
	return_bank: "The bank trip failed. The bag goes back to the safe and must be verified again.",
	transfer_safe: "Record that the sealed bag already left the safe, whole, for the off-site cash account.",
	review: "Post the difference to cash over/short and close it. The count itself is never changed.",
	continue_closing: "Finish this drawer count in Close shift, where the shift is closed.",
	print_handover: "A full page with the bag's count, the people involved and signature lines.",
	print_label: "A 100 × 76 mm tag for the sealed bag with its seal, amount and purpose.",
	print_count: "A full page with the counted notes and coins, the difference and signature lines.",
} satisfies Record<string, string>;
const helpFor = (action: string): string => (actionHelp as Record<string, string>)[action] ?? "";
const purposeHelp = "A float bag waits in the safe to start a drawer. A takings bag is sent to the bank.";
const countScopes: Record<string, string> = {
	Drawer: "Drawer count",
	Bag: "Bag count",
	Safe: "Safe count",
};
const countTitles: Record<string, string> = {
	prepare: "Count the cash going into the bag",
	drop: "Count the cash you are sealing",
	receive: "Count the cash you received",
	verify: "Independent verification count",
	count_safe: "Count every note and coin in the safe",
};
const doneBagStates = ["Issued", "Deposited", "Unpacked", "Transferred"];
/** States a sealed bag may leave the safe from, whole, for the off-site ledger. */
const transferableBagStates = ["Available", "Unverified"];
const sessionUser = () => (window as any).frappe?.session?.user || "";
const isMine = (user?: string) => Boolean(user) && user === sessionUser();
const canManage = computed(() => Boolean(data.value?.can_manage));
const bags = computed<any[]>(() => data.value?.bags || []);
const counts = computed<any[]>(() => data.value?.counts || []);
const historyMeta = computed(() => data.value?.queues?.[queue.value]);
const bagListLink = computed(() => `/app/pos-cash-bag?${new URLSearchParams({ safe: data.value?.safe || "" })}`);
const deskLink = (doctype: string, name: string) =>
	`/app/${doctype.toLowerCase().replace(/ /g, "-")}/${encodeURIComponent(name || "")}`;
const historyLink = computed(() => {
	const filters = new URLSearchParams({ safe: data.value?.safe || "" });
	if (queue.value === "counts" && !canManage.value) filters.set("counted_by", sessionUser());
	return `/app/${queue.value === "counts" ? "pos-cash-count" : "pos-cash-bag"}?${filters}`;
});
const money = (v: any) =>
	new Intl.NumberFormat(undefined, { style: "currency", currency: data.value?.currency || "MXN" }).format(
		Number(v) || 0,
	);
const differenceLabel = (value: any) => {
	const delta = Number(value) || 0;
	return delta > 0 ? `${__("Over by")} ${money(delta)}` : `${__("Short by")} ${money(Math.abs(delta))}`;
};
function when(value: any) {
	if (!value) return "";
	const parsed = new Date(String(value).replace(" ", "T"));
	if (Number.isNaN(parsed.getTime())) return String(value);
	return parsed.toLocaleString(undefined, {
		day: "2-digit",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}
const bagSeal = (name: string) => bags.value.find((b) => b.name === name)?.seal || name;
const countTitle = (row: any) =>
	`${__(countScopes[row.scope] || row.scope)}${row.bag ? ` · ${bagSeal(row.bag)}` : ""}`;
const chipTone = (state: string) =>
	({
		Unverified: "chip--warn",
		Disputed: "chip--bad",
		Exception: "chip--bad",
		Available: "chip--good",
		Deposited: "chip--good",
		Final: "chip--good",
		Reviewed: "chip--good",
		Issued: "chip--info",
		"In Transit": "chip--info",
		Draft: "chip--muted",
		Unpacked: "chip--muted",
		Transferred: "chip--muted",
	})[state] || "chip--muted";

// Queues -------------------------------------------------------------------
const receivableBags = computed(() =>
	bags.value.filter((b) => b.state === "Available" || (b.state === "Unverified" && !isMine(b.prepared_by))),
);
const bagsToVerify = computed(() =>
	bags.value.filter((b) => ["Unverified", "Disputed"].includes(b.state) && !isMine(b.prepared_by)),
);
const bagsForBank = computed(() =>
	bags.value.filter((b) => b.state === "Available" && b.purpose === "Takings"),
);
const bagsInTransit = computed(() => bags.value.filter((b) => b.state === "In Transit"));
const reviewableCounts = computed(() =>
	counts.value.filter((c) => c.state === "Exception" && !isMine(c.counted_by)),
);
const bagNeedsMe = (bag: any) =>
	canManage.value
		? bagsToVerify.value.includes(bag) || bag.state === "In Transit" || bagsForBank.value.includes(bag)
		: Boolean(opening.value) && receivableBags.value.includes(bag);
const countNeedsMe = (row: any) => canManage.value && reviewableCounts.value.includes(row);
const matches = (row: any, fields: string[], extra: string[] = []) => {
	const term = search.value.trim().toLowerCase();
	if (!term) return true;
	return [...fields.map((field) => row[field]), ...extra].some((value) =>
		String(value ?? "")
			.toLowerCase()
			.includes(term),
	);
};
const bagPool = (id: string) =>
	bags.value.filter((bag) => {
		if (id === "action") return bagNeedsMe(bag);
		if (id === "active") return !doneBagStates.includes(bag.state);
		if (id === "done") return doneBagStates.includes(bag.state);
		return true;
	});
const countPool = (id: string) =>
	counts.value.filter((row) => {
		if (id === "action") return countNeedsMe(row);
		if (id === "active") return ["Draft", "Exception"].includes(row.state);
		if (id === "done") return ["Final", "Reviewed"].includes(row.state);
		return true;
	});
const visibleBags = computed(() =>
	bagPool(filter.value).filter((bag) =>
		matches(
			bag,
			[
				"seal",
				"state",
				"purpose",
				"prepared_by",
				"verified_by",
				"opening_shift",
				"name",
				"transfer_account",
				"transferred_by",
			],
			// What the row shows, so "off-site" or a destination name finds it too.
			[__(bagStates[bag.state] || bag.state)],
		),
	),
);
const visibleCounts = computed(() =>
	countPool(filter.value).filter((row) =>
		matches(row, ["scope", "state", "counted_by", "bag", "opening_shift", "closing_shift", "name"]),
	),
);
const tabs = computed(() => [
	{ id: "bags", label: __("Bags"), total: bags.value.length },
	{ id: "counts", label: __("Counts and exceptions"), total: counts.value.length },
]);
const filterOptions = computed(() => {
	const pool = queue.value === "bags" ? bagPool : countPool;
	return [
		{ id: "action", label: __("Needs me"), count: pool("action").length },
		{ id: "active", label: __("Open"), count: pool("active").length },
		{ id: "done", label: __("Completed"), count: pool("done").length },
		{ id: "all", label: __("All"), count: pool("all").length },
	];
});
/** One sentence under the filters: which records the chosen filter shows. */
const filterHelpKeys: Record<string, Record<string, string>> = {
	bags: {
		action: "Bags waiting for something you can do now.",
		active: "Bags still in the safe, held for review or in transit to the bank.",
		done: "Closed bags: issued to a drawer, deposited, returned to loose cash or moved off-site.",
		all: "Every bag of this safe.",
	},
	counts: {
		action: "Differences waiting for your review.",
		active: "Counts saved as drafts and differences still pending review.",
		done: "Final counts and reviewed differences.",
		all: "Every count of this safe you can see.",
	},
};
const filterHelp = computed(() => __(filterHelpKeys[queue.value]?.[filter.value] || ""));
/** The legend under the queue: every state of the open queue and what it means. */
const stateLegend = computed(() =>
	queue.value === "bags"
		? Object.keys(bagStates).map((state) => ({ state, label: bagStates[state]!, help: bagHelp[state] || "" }))
		: Object.keys(countStates).map((state) => ({ state, label: countStates[state]!, help: countHelp[state] || "" })),
);
const searchLabel = computed(() =>
	queue.value === "bags"
		? __("Search by seal, state, person or destination")
		: __("Search counts by scope, shift or person"),
);
function clearFilters() {
	filter.value = "all";
	search.value = "";
}

// Guidance -----------------------------------------------------------------
/** `text` is what the list shows; `labelKey` is the same sentence untranslated,
    so the band can hand it to `ActionBand`'s own `__()` without translating it
    twice. */
type Task = { id: string; text: string; labelKey: string; count: number; queue: string; pick?: any };
const task = (fields: Omit<Task, "text">): Task => ({ ...fields, text: __(fields.labelKey) });
const tasks = computed<Task[]>(() => {
	const list: Task[] = [];
	if (!data.value) return list;
	if (canManage.value) {
		if (bagsToVerify.value.length)
			list.push(
				task({
					id: "verify",
					labelKey: "Bags waiting for your independent count",
					count: bagsToVerify.value.length,
					queue: "bags",
					pick: bagsToVerify.value[0],
				}),
			);
		if (reviewableCounts.value.length)
			list.push(
				task({
					id: "review",
					labelKey: "Differences waiting for your review",
					count: reviewableCounts.value.length,
					queue: "counts",
					pick: reviewableCounts.value[0],
				}),
			);
		if (bagsForBank.value.length)
			list.push(
				task({
					id: "bank",
					labelKey: "Verified takings ready to leave for the bank",
					count: bagsForBank.value.length,
					queue: "bags",
					pick: bagsForBank.value[0],
				}),
			);
		if (bagsInTransit.value.length)
			list.push(
				task({
					id: "transit",
					labelKey: "Bags in transit waiting for a bank receipt",
					count: bagsInTransit.value.length,
					queue: "bags",
					pick: bagsInTransit.value[0],
				}),
			);
	}
	if (opening.value && receivableBags.value.length)
		list.push(
			task({
				id: "receive",
				labelKey: "Bags you can count and receive into the drawer",
				count: receivableBags.value.length,
				queue: "bags",
				pick: receivableBags.value[0],
			}),
		);
	return list;
});
/** Raw, so the band can reuse the same sentence the panel prints. */
const idleGuidanceKey = computed(() => {
	if (!opening.value && !canManage.value)
		return "Open your register shift before receiving or returning cash.";
	if (opening.value && !receivableBags.value.length && !canManage.value)
		return "No bag is ready for you. Ask a supervisor to prepare a float bag from the safe.";
	return "Nothing is waiting. Seal and return drawer cash whenever the drawer holds more than it should.";
});
const idleGuidance = computed(() => __(idleGuidanceKey.value));
function focusTask(task: Task) {
	queue.value = task.queue;
	filter.value = "action";
	search.value = "";
	if (!task.pick) return;
	if (task.queue === "bags") selectBag(task.pick);
	else selectCount(task.pick);
}

// Selected record ----------------------------------------------------------
/** Shared by the detail buttons and by draft restore, so a restored form can
    never offer an action the selected bag does not allow right now. */
function actionsForBag(bag: any) {
	if (!bag) return [] as any[];
	const list: any[] = [];
	if (["Available", "Unverified"].includes(bag.state))
		list.push({
			action: "receive",
			labelKey: "Receive into drawer",
			primary: true,
			enabled: Boolean(opening.value) && !(isMine(bag.prepared_by) && bag.state !== "Available"),
		});
	if (canManage.value && ["Unverified", "Disputed"].includes(bag.state))
		list.push({
			action: "verify",
			labelKey: "Verify bag",
			primary: bag.state === "Unverified",
			enabled: !isMine(bag.prepared_by),
		});
	if (canManage.value && bag.state === "Disputed") {
		const dispute = counts.value.find((c) => c.bag === bag.name && c.state === "Exception");
		list.push({
			action: "open_dispute",
			labelKey: "Review difference",
			primary: true,
			enabled: Boolean(dispute) && !isMine(dispute?.counted_by),
			run: () => dispute && selectCount(dispute),
		});
	}
	if (canManage.value && bag.state === "Available") {
		list.push({
			action: "dispatch",
			labelKey: "Send to bank",
			primary: bag.purpose === "Takings",
			enabled: true,
		});
		list.push({ action: "unpack", labelKey: "Return to loose safe cash", enabled: true });
	}
	if (canManage.value && bag.state === "In Transit") {
		list.push({
			action: "confirm_bank",
			labelKey: "Confirm bank receipt",
			primary: true,
			enabled: true,
		});
		list.push({ action: "return_bank", labelKey: "Return undeposited bag", enabled: true });
	}
	// Terminal and supervisor-only, so never the band's suggested next step. With
	// no usable destination the button stays visible but disabled, and the
	// server's reason is shown next to it.
	if (canManage.value && transferableBagStates.includes(bag.state))
		list.push({
			action: "transfer_safe",
			labelKey: "Move whole bag off-site",
			enabled: Boolean(data.value?.can_transfer),
			band: false,
		});
	return list;
}
const bagActions = computed(() => actionsForBag(selectedBag.value));
const transferBlocked = computed(
	() =>
		Boolean(selectedBag.value) &&
		canManage.value &&
		transferableBagStates.includes(selectedBag.value.state) &&
		!data.value?.can_transfer,
);
const bagBlockers = computed(() => {
	const bag = selectedBag.value;
	const list: string[] = [];
	if (!bag) return list;
	if (["Available", "Unverified"].includes(bag.state) && !opening.value)
		list.push(__("Open your register shift to receive this bag into a drawer."));
	if (bag.state === "Unverified" && isMine(bag.prepared_by))
		list.push(__("You counted this bag. Another person must verify or receive it."));
	if (bag.state === "Disputed" && isMine(bag.prepared_by) && canManage.value)
		list.push(__("Another supervisor must settle a bag you counted."));
	if (bag.state === "Disputed" && !canManage.value)
		list.push(__("A supervisor recounts or reviews this bag. Drawer cash was not changed."));
	if (doneBagStates.includes(bag.state))
		list.push(__("This bag is closed evidence. Print it or open the record for the full history."));
	if (!canManage.value && ["Available", "In Transit"].includes(bag.state) && !opening.value)
		list.push(__("Bank handling and unpacking are supervisor actions."));
	return list;
});
const evidence = computed(() => {
	if (!selectedCount.value?.count_json) return null;
	try {
		const parsed = JSON.parse(selectedCount.value.count_json);
		return { denominations: parsed.denominations || [], source: parsed.source, reason: parsed.reason };
	} catch {
		return null;
	}
});

// Form ---------------------------------------------------------------------
const counted = computed(() => amount(count.value));
const expectedForAction = computed(() => {
	if (["receive", "verify"].includes(action.value) && selectedBag.value)
		return Number(selectedBag.value.amount) || 0;
	if (action.value === "count_safe" && data.value) return Number(data.value.balance) || 0;
	return null;
});
const mismatch = computed(
	() =>
		expectedForAction.value !== null &&
		Math.round(counted.value * 100) !== Math.round(expectedForAction.value * 100),
);
const overLoose = computed(
	() =>
		action.value === "prepare" &&
		data.value &&
		Math.round(counted.value * 100) > Math.round(Number(data.value.loose_balance) * 100),
);
const noteRequired = computed(() => {
	if (["unpack", "dispatch", "return_bank", "review", "transfer_safe"].includes(action.value)) return true;
	return mismatch.value;
});
const noteLabel = computed(() => {
	const map: Record<string, string> = {
		unpack: "Why is this cash going back to loose safe funds?",
		dispatch: "Bank run details: who takes the bag and where",
		return_bank: "Why is the bag coming back undeposited?",
		review: "Review decision and reason",
		transfer_safe: "Who moved the bag, from where to where, and how it was confirmed",
	};
	if (map[action.value]) return __(map[action.value]!);
	if (noteRequired.value) return __("Explain the difference");
	return __("Reason / handover note (optional)");
});
const formTitle = computed(() => {
	const bag = selectedBag.value;
	const map: Record<string, string> = {
		prepare: __("Prepare a float bag from the safe"),
		drop: __("Seal drawer cash and return it to the safe"),
		receive: __("Receive and count this bag into your drawer"),
		verify: __("Verify another person's bag count"),
		unpack: __("Return the bag contents to loose safe cash"),
		dispatch: __("Send the bag to the bank"),
		confirm_bank: __("Confirm the bank receipt"),
		return_bank: __("Return the undeposited bag to the safe"),
		count_safe: __("Count the safe"),
		review: __("Review the counted difference"),
		transfer_safe: __("Move the whole sealed bag off-site"),
	};
	const title = map[action.value] || __(labels[action.value] || action.value);
	return bag &&
		["receive", "verify", "unpack", "dispatch", "confirm_bank", "return_bank", "transfer_safe"].includes(
			action.value,
		)
		? `${title} — ${bag.seal}`
		: title;
});
const transferDirection = computed(() => {
	const drawer = `${__("Register")}: ${profile.value || ""}`;
	const safe = `${__("Safe")}: ${data.value?.safe || ""}`;
	const bag = selectedBag.value ? `${__("Bag")} ${selectedBag.value.seal}` : __("Sealed bag");
	const routes: Record<string, { from: string; to: string }> = {
		receive: { from: bag, to: drawer },
		drop: { from: drawer, to: safe },
		prepare: { from: safe, to: __("Float bag") },
		dispatch: { from: safe, to: __("Bank deposits in transit") },
		confirm_bank: { from: __("Bank deposits in transit"), to: __("Bank") },
		return_bank: { from: __("Bank deposits in transit"), to: safe },
		unpack: { from: bag, to: __("Loose cash available") },
		transfer_safe: { from: safe, to: transferTarget.value.name },
	};
	return routes[action.value] || null;
});

const formHelp = computed(() => {
	const map: Record<string, string> = {
		prepare: "Preparation reserves cash that is already in the safe. It does not create money.",
		drop: "The drawer decreases by the counted amount and the sealed bag waits for verification in the safe.",
		receive:
			"Count the money received. A mismatch records an exception and does not add cash to your drawer.",
		verify: "Count the bag yourself. A matching count makes it available; a difference disputes it.",
		unpack: "The sealed bag is consumed. Its cash returns to unallocated safe funds.",
		dispatch: "Cash moves to the bank transit account until you record the bank receipt.",
		confirm_bank: "This posts transit cash to the bank account with the deposit reference.",
		return_bank: "The bag comes back to the safe and must be verified again before it moves.",
		count_safe:
			"Count all physical safe cash, including sealed bags. Exclude money in transit to the bank.",
		review: "Post the difference and close the review. The counts stay as recorded evidence.",
		transfer_safe:
			"Record a move that already happened. The amount comes from the bag and the destination from this safe's settings. Nothing is counted or verified.",
	};
	return map[action.value] ? __(map[action.value]!) : "";
});
/** The verb of the one Confirm this form has, untranslated. The screen adds the
    counted money after it; the band prints that money as its own figure, so both
    places say the same thing without translating the sentence twice. */
const confirmVerbs: Record<string, string> = {
	prepare: "Prepare the bag",
	drop: "Return this cash to the safe",
	receive: "Receive into the drawer",
	verify: "Record the verification count",
	count_safe: "Record the safe count",
	unpack: "Return the contents to loose safe cash",
	dispatch: "Send the bag to the bank",
	confirm_bank: "Record the bank receipt",
	return_bank: "Return the bag to the safe",
	review: "Post the difference and close the review",
	transfer_safe: "Record the off-site transfer",
};
/** The actions whose Confirm names the amount the cashier just counted. */
const countedActions = ["prepare", "drop", "receive", "verify", "count_safe"];
const confirmVerbKey = computed(() => confirmVerbs[action.value] || "Confirm cash action");
const confirmText = computed(() => {
	const text = __(confirmVerbKey.value);
	if (countedActions.includes(action.value)) return `${text} · ${money(counted.value)}`;
	if (action.value === "transfer_safe") return `${text} · ${money(selectedBag.value?.amount)}`;
	return text;
});

// Whole-bag transfer ---------------------------------------------------------
/** Where the server will send the bag, as this screen last read it. The write
    rechecks the destination; this is what the supervisor confirms against. */
const transferTarget = computed(() => {
	const account = data.value?.offsite_cash_account || "";
	return {
		account,
		name: data.value?.offsite_cash_account_name || account || __("Off-site cash account"),
	};
});
/** The confirmation belongs to one bag, amount and destination. If a refresh
    changes any of them, the box empties and has to be ticked again. It is never
    saved with the draft and never sent: it is not a count and not evidence. */
const transferIdentity = computed(() =>
	selectedBag.value
		? [selectedBag.value.name, selectedBag.value.amount, transferTarget.value.account].join("|")
		: "",
);
const transferAck = ref("");
const transferConfirmed = computed(
	() => Boolean(transferIdentity.value) && transferAck.value === transferIdentity.value,
);
function confirmTransfer(checked: boolean) {
	transferAck.value = checked ? transferIdentity.value : "";
}
/** The server derives a transfer's amount and destination and refuses any other
    field, so that payload carries only the bag and the reason. */
function payloadFor(name: string) {
	if (name === "transfer_safe")
		return { pos_profile: profile.value, bag: selectedBag.value?.name, note: note.value };
	return {
		pos_profile: profile.value,
		...(["receive", "drop"].includes(name) ? { opening_shift: opening.value } : {}),
		bag: selectedBag.value?.name,
		cash_count: selectedCount.value?.name,
		count: count.value,
		seal: seal.value,
		purpose: purpose.value,
		note: note.value,
		reference: reference.value,
	};
}

// Data ---------------------------------------------------------------------
async function load() {
	if (!profile.value) return;
	busy.value = true;
	error.value = "";
	try {
		readPending();
		data.value = await read("context", { pos_profile: profile.value });
		reselect();
		revalidateOpenForm();
		restoreDraft();
		void drawerGuidance.value?.refresh();
	} catch (e: any) {
		error.value = e.message || __("The cash custody queue could not be loaded.");
		keepDraftThroughReadFailure();
	} finally {
		busy.value = false;
	}
}
function readPending() {
	try {
		pending.value = pendingActions(profile.value!);
		pendingWarning.value = "";
	} catch {
		pending.value = [];
		pendingWarning.value = __(
			"Saved recovery information for this register could not be read. Check the cash records in Desk before repeating any cash action.",
		);
	}
}
function reselect() {
	if (selectedBag.value)
		selectedBag.value = bags.value.find((b) => b.name === selectedBag.value.name) || null;
	if (selectedCount.value)
		selectedCount.value = counts.value.find((c) => c.name === selectedCount.value.name) || null;
}
const unconfirmed = computed(() => pending.value.some((entry) => entry.action === lastAction.value));
function describePending(entry: { action: string; payload: any }) {
	const parts: string[] = [];
	if (entry.payload?.seal) parts.push(entry.payload.seal);
	if (entry.payload?.count) parts.push(money(amount(entry.payload.count)));
	else if (entry.payload?.bag) parts.push(bagSeal(entry.payload.bag));
	return parts.join(" · ");
}
async function focus(target: "form" | "record") {
	await nextTick();
	(target === "form" ? formHeading.value : recordHeading.value)?.focus();
}
const hasDraft = computed(() =>
	Boolean(
		action.value &&
			(seal.value ||
				note.value ||
				reference.value ||
				counted.value ||
				count.value.denominations?.length),
	),
);
// Unsent form ---------------------------------------------------------------
// Navigating away, reloading or losing the tab must not silently erase work the
// cashier typed but never sent. The form is kept per user + register + shift and
// only comes back once the server context proves the task is still allowed.
const draftScope = computed(() => draftKey(sessionUser(), profile.value, opening.value));
/** The scope the open form was typed in. The register or the shift can change
    under a mounted screen; the work stays with the scope that produced it and is
    never copied into the new one. */
const formScope = ref<string | null>(null);
const writeScope = () => formScope.value || draftScope.value;
const draftFields = () => ({
	action: action.value,
	bag: selectedBag.value?.name || null,
	cash_count: selectedCount.value?.name || null,
	seal: seal.value,
	purpose: purpose.value,
	note: note.value,
	reference: reference.value,
	count: count.value,
	saved_at: new Date().toISOString(),
});
function persistDraft() {
	const key = writeScope();
	// `handedOff`: a command owns this work now — see `releaseDraftForSubmit`.
	// `corruptDraft`: damaged saved work is evidence until somebody discards it
	// on purpose, so nothing may write over it.
	if (!key || !action.value || !draftStorageOk.value) return;
	if (draftHandedOff.value || corruptDraft.value) return;
	try {
		writeDraft(key, draftFields());
		formScope.value = key;
	} catch {
		draftStorageOk.value = false;
		draftWarning.value = __(
			"This browser cannot keep your unsent cash form. Nothing was sent. Finish this action now or write the count down before leaving this screen.",
		);
	}
}
watch([action, seal, purpose, note, reference, count, selectedBag, selectedCount], persistDraft, {
	deep: true,
});
function dropDraft() {
	const key = writeScope();
	if (!key || clearDraft(key)) {
		staleDraft.value = null;
		draftNotice.value = "";
		formScope.value = null;
		corruptDraft.value = false;
		return true;
	}
	draftWarning.value = __(
		"The saved copy of this cash form could not be removed from this browser. Do not send another cash action from this device until a supervisor checks the cash records in Desk.",
	);
	return false;
}
function discardStale() {
	dropDraft();
}
/** The only way past a damaged record: the worker says so, and it goes. */
function discardCorrupt() {
	const key = writeScope();
	if (key && !clearDraft(key)) {
		draftWarning.value = __(
			"The damaged saved cash form could not be removed from this browser. Ask a supervisor to check the cash records in Desk.",
		);
		return;
	}
	corruptDraft.value = false;
	draftWarning.value = "";
	persistDraft();
}
/**
 * Hand the work to the command layer. The unsent form has to be off this device
 * before the request leaves: if it survived, a reload could reopen a prepare or
 * a drop that the server already recorded and the same physical cash would move
 * twice. A browser that refuses to delete it gets no cash action at all.
 */
function releaseDraftForSubmit() {
	if (corruptDraft.value) {
		error.value = __("Discard the damaged saved cash form before sending a cash action.");
		return false;
	}
	const key = writeScope();
	if (key && !clearDraft(key)) {
		error.value = __(
			"This browser will not release the saved copy of this form, so no cash action was sent and no cash moved. Reopen the browser and try again.",
		);
		return false;
	}
	draftHandedOff.value = true;
	formScope.value = null;
	staleDraft.value = null;
	draftNotice.value = "";
	return true;
}
/**
 * After a command, who owns this work? If `api.ts` kept an unconfirmed record
 * for the action, the retry path owns it and no draft may shadow it. If it kept
 * nothing — an explicit server refusal, or a request that never left — then the
 * form on screen is unsent work again and is saved as such.
 */
function takeBackUnsentWork(name: string) {
	draftHandedOff.value = false;
	if (!action.value) return;
	if (pending.value.some((entry) => entry.action === name) || pendingWarning.value) {
		draftHandedOff.value = true;
		return;
	}
	formScope.value = draftScope.value;
	persistDraft();
}
/** Starting a new task must not paper over work that is still on this device. */
function mayReplaceSavedWork() {
	if (corruptDraft.value) {
		error.value = __("Discard the damaged saved cash form before starting another cash task.");
		return false;
	}
	if (staleDraft.value) {
		error.value = __("Copy or discard the unsent cash form kept from before, then start the new task.");
		return false;
	}
	return true;
}
const staleSummary = computed(() => {
	const saved = staleDraft.value;
	if (!saved) return "";
	const parts = [__(labels[saved.action] || saved.action)];
	if (saved.seal) parts.push(saved.seal);
	let counted = 0;
	try {
		counted = amount({ ...emptyCount(), ...saved.count });
	} catch {
		counted = 0;
	}
	if (counted) parts.push(money(counted));
	if (saved.note) parts.push(saved.note);
	return parts.join(" · ");
});
/** The server context decides: a stale record or a lost permission never
    reopens as a usable form. */
function draftStillAllowed(name: string, bag: any, row: any) {
	if (row)
		return name === "review" && canManage.value && row.state === "Exception" && !isMine(row.counted_by);
	if (bag) return actionsForBag(bag).some((o: any) => o.action === name && o.enabled && !o.run);
	if (["prepare", "count_safe"].includes(name)) return canManage.value;
	if (name === "drop") return Boolean(opening.value);
	return false;
}
function reportUnreadableDraft() {
	corruptDraft.value = true;
	draftWarning.value = __(
		"An unsent cash form saved on this device could not be read. It was left untouched and no new work is being saved over it. Check the cash records in Desk, then discard it here.",
	);
}
/** A refresh can reveal that somebody else moved this bag first. The open form
    stops being a live cash action; the typed work stays visible to copy or
    discard, and nothing was sent. */
function revalidateOpenForm() {
	if (!action.value || !data.value) return;
	if (draftStillAllowed(action.value, selectedBag.value, selectedCount.value)) return;
	staleDraft.value = draftFields();
	action.value = "";
	draftNotice.value = "";
}
/** Called only after a successful context read. */
function restoreDraft() {
	if (action.value || staleDraft.value || !data.value) return;
	const key = draftScope.value;
	if (!key) return;
	const found = readDraft(key);
	if (found.state === "unreadable") return reportUnreadableDraft();
	if (found.state === "empty") return;
	if (pending.value.length || pendingWarning.value) {
		draftNotice.value = __(
			"Your unsent cash form is still saved. It reopens once the unconfirmed cash action is resolved.",
		);
		return;
	}
	const saved = found.draft;
	const bag = saved.bag ? bags.value.find((b) => b.name === saved.bag) || null : null;
	const row = saved.cash_count ? counts.value.find((c) => c.name === saved.cash_count) || null : null;
	if ((saved.bag && !bag) || (saved.cash_count && !row) || !draftStillAllowed(saved.action, bag, row)) {
		staleDraft.value = saved;
		draftNotice.value = "";
		return;
	}
	staleDraft.value = null;
	formScope.value = key;
	selectedBag.value = bag;
	selectedCount.value = row;
	seal.value = saved.seal;
	purpose.value = saved.purpose || "Float";
	note.value = saved.note;
	reference.value = saved.reference;
	count.value = { ...emptyCount(), ...saved.count };
	action.value = saved.action;
	queue.value = row ? "counts" : "bags";
	draftNotice.value = __("Your unsent cash form was restored. Nothing was sent — check it and confirm.");
}
/**
 * The register or the opening shift changed while this screen stayed mounted.
 * The work belongs to the scope it was typed in: it stays saved there, the
 * screen starts clean for the new one, and nothing is carried across.
 */
watch(draftScope, (next, previous) => {
	if (next === previous) return;
	persistDraft();
	action.value = "";
	seal.value = "";
	note.value = "";
	reference.value = "";
	purpose.value = "Float";
	count.value = emptyCount();
	selectedBag.value = null;
	selectedCount.value = null;
	formScope.value = null;
	draftHandedOff.value = false;
	corruptDraft.value = false;
	staleDraft.value = null;
	draftNotice.value = "";
	draftWarning.value = "";
	load();
});
/** A failed read must not cost the cashier the work already typed. */
function keepDraftThroughReadFailure() {
	if (action.value) return;
	const key = draftScope.value;
	if (!key) return;
	const found = readDraft(key);
	if (found.state === "unreadable") return reportUnreadableDraft();
	if (found.state === "draft")
		draftNotice.value = __(
			"Your unsent cash form is still saved on this device. It reopens when the custody queue loads again.",
		);
}

function mayChangeTask() {
	if (busy.value) return false;
	if (pending.value.length || pendingWarning.value) {
		error.value =
			pendingWarning.value || __("Resolve the unconfirmed cash action before starting another task.");
		return false;
	}
	if (hasDraft.value) {
		error.value = __("Finish or cancel your current cash action before choosing another.");
		focus("form");
		return false;
	}
	return true;
}
function start(next: string, keep = false) {
	if (!mayChangeTask()) return;
	if (!mayReplaceSavedWork()) return;
	action.value = next;
	error.value = "";
	success.value = "";
	successNext.value = "";
	successJournal.value = "";
	transferAck.value = "";
	draftHandedOff.value = false;
	formScope.value = draftScope.value;
	staleDraft.value = null;
	draftNotice.value = "";
	count.value = emptyCount();
	note.value = "";
	seal.value = "";
	reference.value = "";
	purpose.value = next === "drop" ? "Takings" : "Float";
	if (!keep) {
		selectedBag.value = null;
		selectedCount.value = null;
	}
	focus("form");
}
function cancel() {
	if (!dropDraft()) return;
	action.value = "";
	error.value = "";
	count.value = emptyCount();
	note.value = "";
	seal.value = "";
	reference.value = "";
	transferAck.value = "";
	draftHandedOff.value = false;
}
function returnToQueue() {
	if (!mayChangeTask()) return;
	selectedBag.value = null;
	selectedCount.value = null;
	nextTick(() => {
		queueSearch.value?.focus();
		queueSearch.value?.scrollIntoView?.({ block: "nearest" });
	});
}
function selectBag(bag: any) {
	if (!mayChangeTask()) return;
	selectedBag.value = bag;
	selectedCount.value = null;
	action.value = "";
	queue.value = "bags";
	focus("record");
}
function selectCount(row: any) {
	if (!mayChangeTask()) return;
	selectedCount.value = row;
	selectedBag.value = null;
	action.value = "";
	queue.value = "counts";
	focus("record");
}
function goToClosing() {
	Promise.resolve(router?.push("/closing")).catch(() => {
		error.value = __("Close shift could not be opened from here. Use the Close Shift destination.");
	});
}
/** The server's actual destination, by name when it is the one this screen read. */
function destinationName(account?: string) {
	if (!account) return transferTarget.value.name;
	return account === data.value?.offsite_cash_account ? transferTarget.value.name : account;
}
const transferredUnverified = (name?: string) => !bags.value.find((b) => b.name === name)?.verified_by;
function describeResult(name: string, result: any) {
	const value = money(result?.amount);
	if (result?.state === "Disputed")
		return {
			message: __("Count differs. The bag is held for supervisor review; drawer cash was not changed."),
			next: __("A supervisor recounts the bag or reviews the difference."),
		};
	const map: Record<string, { message: string; next: string }> = {
		prepare: {
			message: `${__("Float bag prepared and reserved in the safe.")} ${value}`,
			next: __("Another person verifies or receives it. You cannot verify your own bag."),
		},
		drop: {
			message: `${__("Cash sealed and returned to the safe.")} ${value}`,
			next: __("Your drawer decreased by this amount. A supervisor verifies the bag."),
		},
		receive: {
			message: `${__("Bag received into your drawer.")} ${value}`,
			next: __("Sell as usual. Return the drawer to the safe in sealed bags at closing."),
		},
		verify: {
			message: __("Bag verified and available in the safe."),
			next: __("It can start a drawer, go to the bank, or be unpacked into loose safe cash."),
		},
		unpack: {
			message: __("Bag unpacked. Its cash is loose safe funds again."),
			next: __("Prepare a new bag with a new seal when the cash moves again."),
		},
		dispatch: {
			message: __("Bag is on the way to the bank."),
			next: __("Record the bank receipt reference when the deposit is confirmed."),
		},
		confirm_bank: {
			message: __("Bank receipt recorded. The deposit left the transit account."),
			next: __("Print the evidence if the bank copy needs it."),
		},
		return_bank: {
			message: __("Undeposited bag returned to the safe."),
			next: __("It must be verified again before it can move."),
		},
		count_safe: {
			message: __("Safe count recorded."),
			next: __("A difference becomes an exception for an independent review."),
		},
		review: {
			message: __("Difference reviewed and posted."),
			next: __("The original counts stay as evidence."),
		},
		transfer_safe: {
			message: `${__("Whole bag moved to {0}.").replace("{0}", destinationName(result?.transfer_account))} ${value}`,
			next: transferredUnverified(result?.bag)
				? __(
						"The bag stays marked as never independently verified. Print the handover for the off-site safe.",
					)
				: __("Print the handover for the off-site safe."),
		},
	};
	return map[name] || { message: __("Cash action recorded."), next: "" };
}
async function submit() {
	if (busy.value) return;
	if (pending.value.length || pendingWarning.value) {
		error.value =
			pendingWarning.value || __("Resolve the unconfirmed cash action before starting another task.");
		return;
	}
	if (action.value === "transfer_safe" && !transferConfirmed.value) {
		error.value = __(
			"Confirm that the whole sealed bag has already physically left before recording the transfer.",
		);
		return;
	}
	// Handover: the unsent form must be off this device BEFORE the request goes
	// out, or a reload could offer the same physical transfer a second time.
	// From here the pending-command layer in `api.ts` owns recovery.
	if (!releaseDraftForSubmit()) return;
	busy.value = true;
	error.value = "";
	success.value = "";
	successNext.value = "";
	successJournal.value = "";
	const name = action.value;
	lastAction.value = name;
	try {
		const result = await command(name, payloadFor(name));
		const described = describeResult(name, result);
		success.value = described.message;
		successNext.value = described.next;
		successJournal.value = name === "transfer_safe" ? result?.journal_entry || "" : "";
		action.value = "";
		staleDraft.value = null;
		draftNotice.value = "";
		await load();
		if (result?.bag) selectedBag.value = bags.value.find((b) => b.name === result.bag) || null;
		else if (result?.cash_count)
			selectedCount.value = counts.value.find((c) => c.name === result.cash_count) || null;
		if (result?.bag) queue.value = "bags";
	} catch (e: any) {
		error.value = e.message || __("The cash action could not be completed.");
	} finally {
		busy.value = false;
		readPending();
		takeBackUnsentWork(name);
	}
}
async function retry(entry: { action: string; payload: any }) {
	if (busy.value) return;
	if (!releaseDraftForSubmit()) return;
	busy.value = true;
	error.value = "";
	lastAction.value = entry.action;
	try {
		const result = await command(entry.action, entry.payload);
		const described = describeResult(entry.action, result);
		success.value = described.message;
		successNext.value = described.next;
		successJournal.value = entry.action === "transfer_safe" ? result?.journal_entry || "" : "";
		action.value = "";
		dropDraft();
		await load();
		if (result?.bag) {
			selectedBag.value = bags.value.find((b) => b.name === result.bag) || null;
			selectedCount.value = null;
			queue.value = "bags";
		} else if (result?.cash_count) {
			selectedCount.value = counts.value.find((c) => c.name === result.cash_count) || null;
			selectedBag.value = null;
			queue.value = "counts";
		}
		focus("record");
	} catch (e: any) {
		error.value = e.message || __("The retry did not complete.");
	} finally {
		busy.value = false;
		readPending();
		takeBackUnsentWork(entry.action);
	}
}
async function printRecord(doctype: string, name: string, layout: "slip" | "label" = "slip") {
	printing.value = true;
	error.value = "";
	try {
		await printEvidence(doctype, name, layout);
	} catch (e: any) {
		error.value = e.message || __("The evidence could not be printed. The cash record is unchanged.");
	} finally {
		printing.value = false;
	}
}
// The shell's band ---------------------------------------------------------
/**
 * Hosted by the rail, this screen owns the band lane (§17.7): one number, one
 * action. The number is the money the cashier is looking at — the amount being
 * confirmed, the selected bag, the unconfirmed transfer — and the action is the
 * SAME one the screen already offers, never a second, looser path to a cash
 * command. Nothing here sends a command by itself: a selected record's action
 * opens its form, exactly as pressing the record's own button does.
 */
const hostedSurface = inject<DestinationSurface | null>(DESTINATION_SURFACE, null);
/** True when `DestinationHost` renders this view, i.e. the shell draws a band. */
const bandHosted = computed(() => Boolean(hostedSurface));
type BandPress = { state: BandState; run: () => void };
/**
 * The honest fallback: there is nothing to do on this screen right now, so the
 * one true verb is leaving it. `sale.return` is answered by the shell itself,
 * which is why this press does nothing locally.
 */
const backToSale = (labelKey: string, labelParams?: (string | number)[], value = 0): BandPress => ({
	state: {
		kind: "custody",
		tone: "neutral",
		value,
		labelKey,
		labelParams,
		primaryAction: { id: "sale.return", labelKey: "Back to sale" },
		primaryEnabled: true,
	},
	run: () => {},
});
const custodyPress = (
	labelKey: string,
	value: number,
	actionLabelKey: string,
	enabled: boolean,
	run: () => void,
	extra: { labelParams?: (string | number)[]; tone?: BandState["tone"] } = {},
): BandPress => ({
	state: {
		kind: "custody",
		tone: extra.tone || "neutral",
		value,
		labelKey,
		labelParams: extra.labelParams,
		primaryAction: { id: "custody.primary", labelKey: actionLabelKey },
		primaryEnabled: enabled,
	},
	run,
});
/** The money a form is about to confirm: what was counted, or the record's own
    amount for the actions that move a sealed bag without recounting it. */
const formAmount = computed(() => {
	if (countedActions.includes(action.value)) return counted.value;
	return Number(selectedBag.value?.amount ?? selectedCount.value?.amount ?? 0) || 0;
});
/** The same guards `submit()` applies, so the band cannot offer a press the
    form would refuse. */
const formSubmittable = computed(
	() => !busy.value && !pending.value.length && !pendingWarning.value && !corruptDraft.value,
);
/** …and the ones `start()` applies before opening another task. */
const canStartTask = computed(
	() =>
		!busy.value &&
		!pending.value.length &&
		!pendingWarning.value &&
		!corruptDraft.value &&
		!staleDraft.value,
);
const nextBagStep = computed(() => {
	const allowed = bagActions.value.filter((option: any) => option.enabled && option.band !== false);
	const option = allowed.find((o: any) => o.primary) || allowed[0];
	if (!option) return null;
	return {
		labelKey: option.labelKey as string,
		run: () => (option.run ? option.run() : start(option.action, true)),
	};
});
const nextCountStep = computed(() => {
	const row = selectedCount.value;
	if (!row) return null;
	if (canManage.value && row.state === "Exception" && !isMine(row.counted_by))
		return { labelKey: "Review difference", run: () => start("review", true) };
	if (row.state === "Draft" && isMine(row.counted_by))
		return { labelKey: "Continue in Close shift", run: goToClosing };
	return null;
});
function pendingAmount(entry: { action: string; payload: any }) {
	try {
		if (entry.payload?.count) return amount({ ...emptyCount(), ...entry.payload.count });
	} catch {
		/* a damaged saved payload is not a number; the seal below still is */
	}
	return Number(bags.value.find((b) => b.name === entry.payload?.bag)?.amount) || 0;
}
/** Press the form's own Confirm, native validation included. */
function submitFromBand() {
	const form = formEl.value;
	if (!form) return;
	if (typeof form.requestSubmit === "function") {
		form.requestSubmit();
		return;
	}
	if (form.checkValidity()) void submit();
	else form.reportValidity();
}
const bandPress = computed<BandPress>(() => {
	if (!data.value)
		return backToSale(
			profile.value ? "Loading the custody queue…" : "Select a register to manage its cash.",
		);
	// An unconfirmed transfer outranks everything: until it is replayed the
	// screen refuses every other task, so the band must lead to the retry and
	// never to a second command for the same physical cash.
	const entry = pending.value[0];
	if (entry)
		return custodyPress(
			"Unconfirmed cash action",
			pendingAmount(entry),
			"Retry unconfirmed action",
			!busy.value,
			() => void retry(entry),
			{ tone: "warning" },
		);
	if (action.value)
		return custodyPress(
			labels[action.value] || action.value,
			formAmount.value,
			confirmVerbKey.value,
			formSubmittable.value,
			submitFromBand,
			{ tone: mismatch.value || overLoose.value ? "warning" : "neutral" },
		);
	const bag = selectedBag.value;
	if (bag) {
		const step = nextBagStep.value;
		const amountOf = Number(bag.amount) || 0;
		return step
			? custodyPress("Bag {0}", amountOf, step.labelKey, canStartTask.value, step.run, {
					labelParams: [bag.seal],
				})
			: backToSale("Bag {0}", [bag.seal], amountOf);
	}
	const row = selectedCount.value;
	if (row) {
		const step = nextCountStep.value;
		const labelKey = countScopes[row.scope] || row.scope;
		const amountOf = Number(row.amount) || 0;
		return step
			? custodyPress(labelKey, amountOf, step.labelKey, canStartTask.value, step.run)
			: backToSale(labelKey, undefined, amountOf);
	}
	// Nothing selected, but something is waiting: point at it rather than at a
	// zero. The press only SELECTS the record — the cash action stays behind its
	// own form.
	const first = tasks.value[0];
	if (first?.pick)
		return custodyPress(
			first.labelKey,
			Number(first.pick.amount) || 0,
			"Open the first one",
			canStartTask.value,
			() => focusTask(first),
		);
	return backToSale(idleGuidanceKey.value);
});
const bandState = computed(() => bandPress.value.state);
watch(bandState, (state) => emit("band", state), { immediate: true });
function bandPrimary() {
	if (!bandPress.value.state.primaryEnabled) return;
	bandPress.value.run();
}
// The shell forwards the press through the bus, the way the ledger's selected
// draft does. With no shell listening the screen's own buttons still do
// everything — the band is an extra lane, never the only way in.
const eventBus = inject<any>("eventBus", null);
onMounted(() => eventBus?.on("custody:primary", bandPrimary));
onBeforeUnmount(() => {
	eventBus?.off("custody:primary", bandPrimary);
	// The band belongs to this surface. Left standing, it would offer a cash
	// action over whatever the register shows next.
	emit("band", null);
});

async function loadSafes() {
	if (profile.value) return load();
	busy.value = true;
	try {
		safeOptions.value = await read("safes", {});
		if (safeOptions.value.length === 1) selectedProfile.value = safeOptions.value[0]!.pos_profile;
		else if (!safeOptions.value.length) error.value = __("No cash safe is configured for your registers. Ask a manager to configure cash custody.");
	} catch (e: any) {
		error.value = e.message || __("The cash custody queue could not be loaded.");
	} finally { busy.value = false; }
}
onMounted(loadSafes);
</script>
<style scoped>
.custody .custody__header {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
}
.custody__header > .btn {
	align-self: start;
}
.starter-grid {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
	gap: 12px;
}
.starter {
	display: grid;
	gap: 6px;
	align-content: start;
}
.starter .btn {
	width: 100%;
}
.starter__help,
.action-list__help {
	font-size: 13px;
	line-height: 1.35;
	color: var(--pos-text-secondary);
}
.action-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: 10px;
}
.action-list__row {
	display: grid;
	grid-template-columns: minmax(180px, max-content) minmax(0, 1fr);
	gap: 12px;
	align-items: center;
}
.action-list__row .btn {
	width: 100%;
}
.filters__help {
	margin: 0;
	font-size: 13px;
}
.custody__legend summary {
	min-height: 44px;
	padding: 10px 0;
	cursor: pointer;
	color: var(--pos-text-secondary);
}
.custody__legend dl {
	display: grid;
	gap: 8px;
	margin: 0;
}
.custody__legend dl > div {
	display: grid;
	grid-template-columns: minmax(150px, max-content) minmax(0, 1fr);
	gap: 10px;
	align-items: start;
}
.custody__legend dd {
	margin: 0;
	font-size: 13px;
	color: var(--pos-text-secondary);
}
@media (max-width: 599.98px) {
	.action-list__row,
	.custody__legend dl > div {
		grid-template-columns: minmax(0, 1fr);
		gap: 4px;
	}
}
.custody__next-tasks {
	margin-top: 12px;
}
.custody__next-tasks .tasks {
	margin: 0;
}
.custody__history summary {
	min-height: 44px;
	padding: 10px 0;
	cursor: pointer;
	color: var(--pos-text-secondary);
}
.custody__back {
	margin-bottom: 12px;
}

.custody__quick-tasks {
	padding: 14px;
	margin-bottom: 16px;
	border: 1px solid var(--pos-border);
	border-radius: 12px;
	background: var(--pos-card-bg);
}
.custody__direction {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	gap: 12px;
	align-items: center;
	padding: 12px;
	border-radius: 10px;
	background: var(--pos-primary-container);
}
.custody__direction span {
	display: grid;
	gap: 4px;
	min-width: 0;
	overflow-wrap: anywhere;
}
.custody__direction small {
	color: var(--pos-text-secondary);
}
.custody__destination small {
	display: block;
	overflow-wrap: anywhere;
}
.custody__confirm {
	grid-template-columns: auto minmax(0, 1fr);
	align-items: start;
	gap: 12px;
	padding: 12px;
	border: 1px solid var(--pos-border);
	border-radius: var(--pos-radius-sm);
	background: var(--pos-surface-muted);
	cursor: pointer;
	font-weight: 600;
}
.custody__confirm input {
	width: 24px;
	height: 24px;
	min-height: 24px;
	margin: 2px 0 0;
	padding: 0;
}
@keyframes cash-task-arrive {
	from {
		opacity: 0.4;
		transform: translateY(4px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}
.record-detail,
.custody form,
.panel--success {
	animation: cash-task-arrive 150ms ease-out;
}
.custody .btn {
	transition:
		background-color 120ms,
		border-color 120ms;
}
.custody .btn:active:not(:disabled) {
	transform: translateY(1px);
}
@media (prefers-reduced-motion: reduce) {
	.record-detail,
	.custody form,
	.panel--success {
		animation: none;
	}
	.custody .btn {
		transition: none;
	}
	.custody .btn:active:not(:disabled) {
		transform: none;
	}
}

.custody {
	padding: 20px;
	overflow: auto;
	height: 100%;
	color: var(--pos-text-primary);
	background: var(--pos-bg-secondary);
	font-size: 15px;
}
.balances {
	margin-bottom: 16px;
}
.balances > summary {
	cursor: pointer;
	padding: 12px 0;
	min-height: 48px;
	font-weight: 600;
}
.custody__header {
	display: flex;
	gap: 12px;
	justify-content: space-between;
	align-items: flex-start;
	flex-wrap: wrap;
	margin-bottom: 16px;
}
.custody__context {
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
	align-items: center;
	color: var(--pos-text-secondary);
	margin: 0;
}
h2,
h3,
p {
	margin: 0 0 12px;
}
h2 {
	font-size: 24px;
	font-weight: 700;
	margin-bottom: 6px;
}
h3 {
	font-size: 18px;
	font-weight: 600;
}
.muted {
	color: var(--pos-text-secondary);
}
.ok {
	color: var(--pos-primary-variant);
	font-weight: 600;
}
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
	white-space: nowrap;
	border: 0;
}
.money {
	font-variant-numeric: tabular-nums;
}
.notice {
	padding: 14px;
	border: 1px dashed var(--pos-border);
	border-radius: var(--pos-radius-sm);
	color: var(--pos-text-secondary);
	background: var(--pos-surface-muted);
}
.panel {
	padding: 14px 16px;
	border-radius: var(--pos-radius-sm);
	border: 1px solid var(--pos-border);
	background: var(--pos-card-bg);
	margin-bottom: 16px;
	display: grid;
	gap: 10px;
}
.panel p {
	margin: 0;
}
.panel--error {
	border-color: var(--pos-error);
	background: var(--pos-error-container);
	color: var(--pos-text-primary);
}
.panel--success {
	border-color: var(--pos-success);
	background: var(--pos-success-container);
}
.panel--warning {
	border-color: var(--pos-warning);
	background: var(--pos-warning-container);
}
.panel--pending {
	border-color: var(--pos-warning);
	background: var(--pos-warning-container);
	border-left-width: 6px;
}
.panel--guidance {
	border-left: 6px solid var(--pos-primary);
}
.tasks {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: 8px;
}
.task {
	width: 100%;
	min-height: 48px;
	display: flex;
	gap: 12px;
	align-items: center;
	justify-content: space-between;
	text-align: left;
	padding: 10px 14px;
	border: 1px solid var(--pos-border);
	border-radius: var(--pos-radius-sm);
	background: var(--pos-surface-muted);
	color: inherit;
	font: inherit;
	cursor: pointer;
}
.task b {
	/* A count is a figure, not the screen's primary action: ink and a rule,
	   never the accent fill (`tests/singleAccent.spec.ts`). */
	background: var(--pos-primary-container);
	color: var(--pos-text-primary);
	border: 1px solid var(--pos-border);
	border-radius: 999px;
	min-width: 28px;
	padding: 2px 9px;
	text-align: center;
}
.summary {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 12px;
	margin: 0 0 8px;
}
.summary > div {
	padding: 16px;
	border: 1px solid var(--pos-border);
	border-radius: var(--pos-radius-sm);
	background: var(--pos-card-bg);
}
.summary dt {
	color: var(--pos-text-secondary);
}
.summary dd {
	margin: 6px 0 0;
	font-size: 24px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}
.summary dd small {
	display: block;
	margin-top: 4px;
	font-size: 13px;
	font-weight: 400;
}
.targets {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 8px 16px;
	margin: 0 0 16px;
}
.targets dt {
	font-weight: 600;
}
.targets dd {
	margin: 2px 0 0;
	font-size: 13px;
}
.workspace {
	display: grid;
	grid-template-columns: minmax(280px, 1fr) minmax(360px, 1.4fr);
	gap: 20px;
	align-items: start;
}
.queue-column {
	display: grid;
	gap: 10px;
	align-content: start;
}
.tabs {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}
.tab {
	min-height: 48px;
	padding: 10px 16px;
	border: 1px solid var(--pos-border);
	border-radius: var(--pos-radius-sm);
	background: var(--pos-card-bg);
	color: inherit;
	font: inherit;
	cursor: pointer;
}
.tab b {
	color: var(--pos-text-secondary);
	margin-inline-start: 6px;
}
.tab--on {
	border-color: var(--pos-primary);
	background: var(--pos-primary-container);
	font-weight: 700;
}
.tab--on b {
	color: inherit;
}
.filters {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}
.filter {
	min-height: 40px;
	padding: 6px 12px;
	border: 1px solid var(--pos-border);
	border-radius: 999px;
	background: var(--pos-card-bg);
	color: var(--pos-text-secondary);
	font: inherit;
	cursor: pointer;
}
.filter--on {
	border-color: var(--pos-primary);
	color: var(--pos-text-primary);
	background: var(--pos-primary-container);
	font-weight: 600;
}
.search input {
	width: 100%;
}
.queue {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: 8px;
	max-height: min(58vh, 620px);
	overflow: auto;
}
.record {
	width: 100%;
	text-align: left;
	display: grid;
	gap: 6px;
	min-height: 64px;
	padding: 12px 14px;
	border: 1px solid var(--pos-border);
	border-radius: var(--pos-radius-sm);
	background: var(--pos-card-bg);
	color: inherit;
	font: inherit;
	cursor: pointer;
}
.record:hover {
	background: var(--pos-hover-bg);
}
.record--on {
	border-color: var(--pos-primary);
	box-shadow: inset 3px 0 0 var(--pos-primary);
	background: var(--pos-primary-container);
}
.record strong {
	font-size: 16px;
}
.record__meta {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	align-items: center;
	font-size: 13px;
	color: var(--pos-text-secondary);
}
.record b {
	font-size: 17px;
	font-weight: 700;
}
.diff {
	color: var(--pos-error);
	font-style: normal;
	margin-inline-start: 8px;
	font-weight: 600;
}
.chip {
	display: inline-block;
	padding: 2px 10px;
	border-radius: 999px;
	font-size: 12px;
	font-weight: 600;
	border: 1px solid var(--pos-border);
	background: var(--pos-surface-muted);
	color: var(--pos-text-secondary);
}
.chip--role {
	border-color: var(--pos-primary);
	color: var(--pos-primary-variant);
	background: var(--pos-primary-container);
}
.chip--good {
	border-color: var(--pos-success);
	color: var(--pos-button-success-text);
	background: var(--pos-success-container);
}
.chip--warn {
	border-color: var(--pos-warning);
	color: var(--pos-button-warning-text);
	background: var(--pos-warning-container);
}
.chip--bad {
	border-color: var(--pos-error);
	color: var(--pos-error);
	background: var(--pos-error-container);
}
.chip--info {
	border-color: var(--pos-info);
	color: var(--pos-info);
	background: var(--pos-info-container);
}
.detail {
	display: grid;
	gap: 16px;
	align-content: start;
	padding: 16px;
	border: 1px solid var(--pos-border);
	border-radius: var(--pos-radius-md);
	background: var(--pos-card-bg);
}
.detail > * {
	margin: 0;
}
.starters {
	display: grid;
	gap: 10px;
	padding-bottom: 14px;
	border-bottom: 1px solid var(--pos-divider);
}
.starters h3 {
	margin: 0;
}
.record-detail {
	display: grid;
	gap: 12px;
}
.record-detail h3 {
	margin: 0;
}
.record-detail__head {
	display: flex;
	gap: 10px;
	align-items: center;
	flex-wrap: wrap;
}
.amount {
	font-size: 26px;
	font-weight: 700;
	margin: 0;
}
.trail {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
	gap: 10px;
	margin: 0;
}
.trail dt {
	font-size: 13px;
	color: var(--pos-text-secondary);
}
.trail dd {
	margin: 2px 0 0;
	word-break: break-word;
}
.blocker {
	font-size: 14px;
}
.actions {
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
}
form {
	display: grid;
	gap: 14px;
	padding-top: 14px;
	border-top: 1px solid var(--pos-divider);
}
form p {
	margin: 0;
}
label {
	display: grid;
	gap: 6px;
}
label small,
.hint {
	font-size: 13px;
}
.hint {
	margin-top: -8px;
}
table {
	width: 100%;
	border-collapse: collapse;
}
th,
td {
	text-align: left;
	padding: 6px 8px;
	border-bottom: 1px solid var(--pos-divider);
}
td.money,
th:last-child,
td:last-child {
	text-align: right;
}
.btn,
input,
select,
textarea {
	font: inherit;
	color: inherit;
	background: var(--pos-card-bg);
	border: 1px solid var(--pos-border);
	border-radius: var(--pos-radius-xs);
	padding: 10px 14px;
	min-height: 48px;
}
input,
select,
textarea {
	background: var(--pos-input-bg);
}
.btn {
	cursor: pointer;
	font-weight: 600;
	display: inline-flex;
	gap: 8px;
	align-items: center;
	justify-content: center;
}
.btn small {
	font-weight: 400;
	color: inherit;
	opacity: 0.85;
}
/* The one accent fill on this screen: the button that actually moves cash.
   Everything else that deserves weight gets the tonal container instead, so
   the single-accent invariant keeps meaning something here. */
.custody__primary {
	background: var(--pos-primary);
	border-color: var(--pos-primary);
	color: var(--pos-on-primary);
}
.btn--emphasis {
	background: var(--pos-primary-container);
	border-color: var(--pos-primary);
	color: var(--pos-text-primary);
}
.btn--warning {
	background: var(--pos-button-warning-bg);
	border-color: var(--pos-button-warning-border);
	color: var(--pos-button-warning-text);
	justify-content: flex-start;
	text-align: left;
	flex-wrap: wrap;
}
.btn--link {
	border: 0;
	background: none;
	color: var(--pos-primary-variant);
	text-decoration: underline;
	min-height: 44px;
	padding: 4px 8px;
}
.btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
:focus-visible {
	outline: 2px solid var(--pos-primary);
	outline-offset: 2px;
	box-shadow: var(--pos-focus-ring);
}
@media (max-width: 1099.98px) {
	.detail {
		grid-row: 1;
	}
	.workspace {
		grid-template-columns: 1fr;
	}
	.queue {
		max-height: none;
	}
	.summary dd {
		font-size: 21px;
	}
}
</style>
