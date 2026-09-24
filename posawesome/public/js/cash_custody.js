/* global format_currency, cint */
/* Shared Desk actions use the same custody API as POS; permissions stay server-side.
   The Desk surface keeps the POS contract: one request ID per instruction, the exact
   same payload on retry, no invented balances and no field the server ignores. */
window.posaCashCustody = (function () {
const SUPERVISOR_ROLES = ['POS Awesome Supervisor', 'POS Manager', 'Sales Manager', 'Accounts Manager', 'System Manager'];
const BAG_STATES = {
 Unverified: {label: 'Awaiting verification', color: 'orange', next: 'Another person counts this bag and verifies or receives it. Nobody can verify a bag they prepared.'},
 Available: {label: 'Available in the safe', color: 'blue', next: 'A cashier can receive it from Cash custody, or a supervisor can send it to the bank or return it to loose safe cash.'},
 Disputed: {label: 'Held for review', color: 'red', next: 'A supervisor reviews the difference on the latest count. The bag becomes available again once the correction is posted.'},
 Issued: {label: 'Issued to a drawer', color: 'green', next: 'The cashier returns this cash at closing as counted takings.'},
 'In Transit': {label: 'In transit to the bank', color: 'purple', next: 'Confirm the bank receipt, or return the undeposited bag if the trip failed.'},
 Deposited: {label: 'Deposited at the bank', color: 'green', next: ''},
 Unpacked: {label: 'Returned to loose safe cash', color: 'grey', next: ''},
 Transferred: {label: 'Moved to the off-site safe', color: 'grey', next: ''},
};
// Whole sealed bags may leave the safe for its configured off-site cash ledger only from these states.
const TRANSFERABLE = ['Available', 'Unverified'];
const COUNT_STATES = {
 Draft: {label: 'Saved draft', color: 'orange', next: 'Closing the shift records this count as final evidence.'},
 Final: {label: 'Final count', color: 'green', next: ''},
 Exception: {label: 'Difference pending review', color: 'red', next: 'A supervisor who did not perform this count reviews the difference and posts the correction.'},
 Reviewed: {label: 'Difference reviewed', color: 'blue', next: ''},
};
const SCOPES = {Drawer: 'Drawer count', Safe: 'Safe count', Bag: 'Bag count'};
const ACTIONS = {
 prepare: {title: 'Prepare float bag', primary: 'Prepare bag', seal: true, count: true, manager: true,
  help: 'Count the cash you are sealing into this bag. Preparation reserves loose safe cash; it does not create money. Another person verifies or receives it.',
  noteHint: 'Optional. It is printed on the handover slip.'},
 count_safe: {title: 'Count safe', primary: 'Record safe count', count: true, manager: true,
  help: 'Count all physical safe cash, including sealed bags. Exclude money in transit to the bank.',
  noteHint: 'Required when your count differs from the balance recorded in the ledger.'},
 verify: {title: 'Verify bag', primary: 'Record verification', count: true, manager: true, expected: (frm) => frm.doc.amount,
  help: 'Count the sealed cash independently. A difference holds the bag for supervisor review and changes no drawer cash.',
  noteHint: 'Required when your count differs from the sealed amount.'},
 dispatch: {title: 'Send to bank', primary: 'Send to bank', note: true, manager: true,
  help: 'Records the bag as in transit to the bank. Cash moves from the safe to the transit account until you confirm the bank receipt.'},
 unpack: {title: 'Return to loose safe cash', primary: 'Return to safe cash', note: true, manager: true,
  help: 'Opens this bag back into loose safe cash. The seal is consumed; a new package needs a new seal.'},
 confirm_bank: {title: 'Confirm bank receipt', primary: 'Confirm deposit', reference: true, manager: true,
  help: 'Records the bank receipt reference. Cash moves from the transit account to the bank account.'},
 return_bank: {title: 'Return undeposited bag', primary: 'Return bag', note: true, manager: true,
  help: 'The trip failed and the cash is back in the safe. The bag must be verified again before it can leave.'},
 review: {title: 'Review difference', primary: 'Record review', note: true, manager: true,
  help: 'Posts the counted correction against the cash over / short account and closes the exception. The original count is never rewritten.'},
 // The server derives amount and destination; the payload is only {bag, note}. A bot calling
 // the same command must itself confirm the physical move before sending it.
 transfer_safe: {title: 'Move whole bag off-site', primary: 'Record the off-site transfer', note: true, manager: true, transfer: true,
  noteLabel: 'Who moved the bag, from where to where, and how it was confirmed',
  help: 'Record a move that already happened. The amount comes from the bag and the destination from this safe\'s settings. Nothing is counted or verified.'},
};
const STYLE = `.posa-custody{font-size:13px}
.posa-custody .posa-tiles{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.posa-custody .posa-tile{flex:1 1 150px;min-width:140px;border:1px solid var(--border-color,#d8dfe7);border-radius:8px;padding:8px 12px}
.posa-custody .posa-tile dt{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted,#6a7681);font-weight:400}
.posa-custody .posa-tile dd{margin:2px 0 0;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.posa-custody .posa-tile.posa-lead dd{font-size:22px}
.posa-custody .posa-next{margin:0 0 12px;padding:8px 12px;border-left:3px solid var(--primary,#0097a7);background:var(--bg-light-gray,#f4f6f8);border-radius:0 6px 6px 0}
.posa-custody .posa-alert{margin:0 0 12px;padding:8px 12px;border-radius:6px;background:#fff6e6;border:1px solid #f0c674;color:#5a3c00}
.posa-custody table{width:100%;border-collapse:collapse;margin-bottom:12px;font-variant-numeric:tabular-nums}
.posa-custody th,.posa-custody td{padding:8px;border-bottom:1px solid var(--border-color,#d8dfe7);text-align:right}
.posa-custody th:first-child,.posa-custody td:first-child{text-align:left}
.posa-custody tfoot td{font-weight:600;border-top:2px solid var(--text-color,#1f272e);border-bottom:none}
.posa-custody dl.posa-meta{display:grid;grid-template-columns:minmax(120px,190px) 1fr;gap:4px 14px;margin:0 0 12px}
.posa-custody dl.posa-meta dt{color:var(--text-muted,#6a7681);font-weight:400}
.posa-custody dl.posa-meta dd{margin:0}
.posa-custody h5{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted,#6a7681);margin:0 0 6px}
.posa-custody a{display:inline-block;min-height:32px;padding:4px 0}
.posa-custody .posa-muted{color:var(--text-muted,#6a7681)}
@media (max-width:600px){.posa-custody dl.posa-meta{grid-template-columns:1fr;gap:2px}
.posa-custody dl.posa-meta dd{margin:0 0 6px}}
.posa-custody-dialog .posa-summary{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 12px;border:1px solid var(--border-color,#d8dfe7);border-radius:8px;margin-bottom:6px}
.posa-custody-dialog .posa-summary b{font-size:20px;font-variant-numeric:tabular-nums}
.posa-custody-dialog .posa-help{margin-bottom:10px;color:var(--text-muted,#6a7681)}
.posa-custody-dialog .posa-feedback{padding:8px 12px;border-radius:6px;margin-bottom:10px}
.posa-custody-dialog .posa-feedback.red{background:#fdecec;border:1px solid #e79c9c;color:#7a1c1c}
.posa-custody-dialog .posa-feedback.orange{background:#fff6e6;border:1px solid #f0c674;color:#5a3c00}
.posa-custody-dialog .modal-footer .btn{min-height:44px;padding-left:18px;padding-right:18px}
.posa-custody-dialog .posa-route{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:10px;align-items:center;padding:8px 12px;border-radius:8px;background:var(--bg-light-gray,#f4f6f8);margin-bottom:6px}
.posa-custody-dialog .posa-route span{display:grid;gap:2px;min-width:0;overflow-wrap:anywhere}
.posa-custody-dialog .posa-route small{color:var(--text-muted,#6a7681)}
.posa-custody-dialog .posa-warning,.posa-custody .posa-warning{margin:0 0 10px;padding:8px 12px;border-radius:6px;background:#fff6e6;border:1px solid #f0c674;color:#5a3c00;font-weight:600}`;

function esc(value) {
 return frappe.utils.escape_html(value === undefined || value === null ? '' : String(value));
}
function money(value, currency) {
 return format_currency(flt(value), currency);
}
function phrase(map, value) {
 return map[value] ? __(map[value].label || map[value]) : __(value || '');
}
function slug(doctype) {
 return frappe.router && frappe.router.slug ? frappe.router.slug(doctype) : String(doctype).toLowerCase().replace(/ /g, '-');
}
function formLink(doctype, name, label) {
 if (!name) return '';
 return '<a href="/app/' + slug(doctype) + '/' + encodeURIComponent(name) + '">' + esc(label || name) + '</a>';
}
function listLink(doctype, filters, label) {
 const query = Object.keys(filters).map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(filters[key])).join('&');
 return '<a href="/app/' + slug(doctype) + '?' + query + '">' + esc(label) + '</a>';
}
function canManage() {
 // Display hint only; `service.command` re-checks every action server-side.
 return SUPERVISOR_ROLES.some((role) => frappe.user.has_role(role));
}
function requestId() {
 if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
 const bytes = new Uint8Array(16);
 window.crypto.getRandomValues(bytes);
 return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function style() {
 if (document.getElementById('posa-custody-style')) return;
 const tag = document.createElement('style');
 tag.id = 'posa-custody-style';
 tag.textContent = STYLE;
 document.head.appendChild(tag);
}

/* ----- unconfirmed requests: one key per register + action, shared with the POS view ----- */
function storeKey(profile, action) {
 return 'cash-custody-request:' + frappe.session.user + ':' + profile + ':' + action;
}
function unreadable() {
 return new Error(__('Saved cash recovery details cannot be read. Keep this browser’s data and ask a supervisor to review cash history before continuing.'));
}
function loadPending(profile, action) {
 let raw;
 try { raw = localStorage.getItem(storeKey(profile, action)); } catch (e) { throw unreadable(); }
 if (raw === null) return null;
 try {
  const saved = JSON.parse(raw);
  if (typeof saved.body !== 'string' || typeof saved.request_id !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(saved.request_id)) throw Error();
  const body = JSON.parse(saved.body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
  return {request_id: saved.request_id, body: body};
 } catch (e) { throw unreadable(); }
}
function savePending(profile, action, body, id) {
 try { localStorage.setItem(storeKey(profile, action), JSON.stringify({body: JSON.stringify(body), request_id: id})); }
 catch (e) { throw new Error(__('This browser cannot save cash recovery details. No cash action was sent. Enable browser storage and retry.')); }
}
function clearPending(profile, action) {
 try { localStorage.removeItem(storeKey(profile, action)); } catch (e) { /* storage already unusable */ }
}
function pendingActions(profile) {
 const prefix = storeKey(profile, '');
 const found = [];
 let total = 0;
 try { total = localStorage.length; } catch (e) { return found; }
 for (let index = 0; index < total; index++) {
  let key;
  try { key = localStorage.key(index); } catch (e) { break; }
  if (!key || key.indexOf(prefix) !== 0) continue;
  const action = key.slice(prefix.length);
  if (!ACTIONS[action]) continue;  // POS-only actions need terminal context; Desk must not replay them.
  found.push(action);
 }
 return found;
}
/* Unconfirmed actions that name this bag. A transfer whose response was lost leaves the bag
   in a state with no button for that action, so the form must still offer the replay. */
function pendingForBag(profile, bag) {
 return pendingActions(profile).filter((action) => {
  try {
   const saved = loadPending(profile, action);
   return Boolean(saved && saved.body.bag === bag);
  } catch (e) { return false; }
 });
}
/* Latest read of the safe: destination, availability and this bag's current state.
   history_limit=0 keeps it small; unresolved bags are always returned in full. */
async function transferContext(profile) {
 const response = await frappe.call({method: 'posawesome.posawesome.api.cash_custody.service.context',
  args: {pos_profile: profile, history_limit: 0}});
 return (response && response.message) || null;
}
function transferRoute(from, to, account) {
 return '<div class="posa-route"><span><small>' + esc(__('From')) + '</small><b>' + esc(from) + '</b></span>'
  + '<span aria-hidden="true">→</span><span><small>' + esc(__('To')) + '</small><b>' + esc(to) + '</b>'
  + (account && account !== to ? '<small>' + esc(account) + '</small>' : '') + '</span></div>';
}
function unverifiedWarning(preparer) {
 return '<p class="posa-warning">' + esc(__('This bag was never independently verified. It leaves with only the count by {0} and stays marked unverified.')
  .replace('{0}', preparer || __('the preparer'))) + '</p>';
}
function serverMessage(error) {
 let raw = error && (error.responseJSON || error);
 let messages = raw && raw._server_messages;
 if (!messages && error && error.responseText) {
  try { messages = JSON.parse(error.responseText)._server_messages; } catch (e) { messages = null; }
 }
 try { messages = JSON.parse(messages); } catch (e) { /* already a list or unusable */ }
 if (Array.isArray(messages)) {
  return messages.map((entry) => {
   try { return JSON.parse(entry).message; } catch (e) { return entry; }
  }).join(' ');
 }
 return typeof messages === 'string' ? messages : '';
}

/* ----- read-only summaries ----- */
function parseCount(frm) {
 try {
  const parsed = JSON.parse(frm.doc.count_json || '{}');
  return parsed && typeof parsed === 'object' ? parsed : {};
 } catch (e) { return null; }
}
function tile(label, value, lead) {
 return '<div class="posa-tile' + (lead ? ' posa-lead' : '') + '"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>';
}
function meta(pairs) {
 const rows = pairs.filter((pair) => pair[1] !== undefined && pair[1] !== null && pair[1] !== '')
  .map((pair) => '<dt>' + esc(__(pair[0])) + '</dt><dd>' + (pair[2] ? pair[1] : esc(pair[1])) + '</dd>').join('');
 return rows ? '<dl class="posa-meta">' + rows + '</dl>' : '';
}
function countTable(count, currency) {
 const rows = (count && count.denominations || []).filter((row) => row && flt(row.value) > 0);
 let body = '';
 if (rows.length) {
  let total = 0;
  let pieces = 0;
  const lines = rows.map((row) => {
   const amount = Math.round(flt(row.value) * 100) * cint(row.quantity) / 100;
   total += amount;
   pieces += cint(row.quantity);
   return '<tr><td>' + esc(money(row.value, currency)) + '</td><td>' + esc(cint(row.quantity)) + '</td><td>' + esc(money(amount, currency)) + '</td></tr>';
  }).join('');
  body += '<h5>' + esc(__('Count evidence')) + '</h5><table><thead><tr><th>' + esc(__('Denomination')) + '</th><th>'
   + esc(__('Quantity')) + '</th><th>' + esc(__('Amount')) + '</th></tr></thead><tbody>' + lines
   + '</tbody><tfoot><tr><td>' + esc(__('Counted notes and coins')) + '</td><td>' + esc(pieces) + '</td><td>'
   + esc(money(total, currency)) + '</td></tr></tfoot></table>';
 }
 if (count && count.source === 'manual') {
  body += '<p class="posa-next"><b>' + esc(__('Manual count')) + '</b>: ' + esc(count.reason || __('No reason was recorded.')) + '</p>';
 } else if (!rows.length) {
  body += '<p class="posa-muted">' + esc(__('No denomination detail was recorded for this count.')) + '</p>';
 }
 return body;
}
function nextStep(map, state) {
 const entry = map[state];
 return entry && entry.next ? '<p class="posa-next">' + esc(__('Next')) + ': ' + esc(__(entry.next)) + '</p>' : '';
}
function pendingBanner(profile) {
 const actions = pendingActions(profile);
 if (!actions.length) return '';
 return '<p class="posa-alert">' + esc(__('A cash action has an unconfirmed result. Retry it before moving the money again.'))
  + ' <b>' + esc(actions.map((action) => __(ACTIONS[action].title)).join(', ')) + '</b></p>';
}
function section(frm, key, label, html) {
 const marker = 'posa-custody-' + key;
 const root = frm.dashboard && frm.dashboard.wrapper ? $(frm.dashboard.wrapper) : $(frm.page && frm.page.wrapper || document.body);
 // add_section appends; without this the summary stacks up on every refresh.
 root.find('.' + marker).each(function () {
  const parent = $(this).closest('.form-dashboard-section');
  (parent.length ? parent : $(this)).remove();
 });
 frm.dashboard.add_section('<div class="posa-custody ' + marker + '">' + html + '</div>', label, 'form-dashboard-section ' + marker + '-outer');
}

return {
 ACTIONS: ACTIONS,
 BAG_STATES: BAG_STATES,
 COUNT_STATES: COUNT_STATES,
 TRANSFERABLE: TRANSFERABLE,
 canManage: canManage,
 pendingForBag: pendingForBag,

 indicator(frm) {
  const map = frm.doc.doctype === 'POS Cash Bag' ? BAG_STATES : COUNT_STATES;
  const entry = map[frm.doc.state];
  if (entry) frm.page.set_indicator(__(entry.label), entry.color);
 },

 async render(frm) {
  style();
  frm.set_df_property('count_json', 'hidden', 1);
  this.indicator(frm);
  const currency = frm.doc.currency;
  const count = parseCount(frm);
  const isBag = frm.doc.doctype === 'POS Cash Bag';
  let html = pendingBanner(frm.doc.pos_profile);
  if (isBag) {
   html += '<div class="posa-tiles">'
    + tile(__('Declared amount'), esc(money(frm.doc.amount, currency)), true)
    + tile(__('Purpose'), esc(__(frm.doc.purpose)))
    + tile(__('Bag seal / ID'), esc(frm.doc.seal))
    + tile(__('State'), esc(phrase(BAG_STATES, frm.doc.state)))
    + '</div>' + nextStep(BAG_STATES, frm.doc.state);
   // The state alone must never read as a verified hand-over.
   if (frm.doc.state === 'Transferred' && !frm.doc.verified_by) {
    html += '<p class="posa-warning">' + esc(__("Never independently verified. This bag left the safe with only the preparer's count; any recount happens off-site, outside POS.")) + '</p>';
   }
  } else {
   const difference = flt(frm.doc.difference);
   const wording = !difference ? __('No difference') : (difference > 0 ? __('Over') : __('Short'));
   // A draft count has no expected amount yet; closing or verification sets it.
   const compared = frm.doc.state !== 'Draft' && frm.doc.expected_amount !== undefined && frm.doc.expected_amount !== null;
   html += '<div class="posa-tiles">'
    + tile(__('Counted amount'), esc(money(frm.doc.amount, currency)), true)
    + (compared ? tile(__('Expected'), esc(money(frm.doc.expected_amount, currency)))
     + tile(wording, esc(money(Math.abs(difference), currency))) : '')
    + tile(__('Scope'), esc(__(SCOPES[frm.doc.scope] || frm.doc.scope)))
    + '</div>' + nextStep(COUNT_STATES, frm.doc.state);
  }
  if (count === null) {
   html += '<p class="posa-alert">' + esc(__('The stored count evidence could not be read. Print the record or ask a supervisor to review its history.')) + '</p>';
  } else {
   html += countTable(count, currency);
  }
  html += isBag ? meta([
   ['Prepared by', frm.doc.prepared_by],
   ['Verified by', frm.doc.verified_by || (frm.doc.state === 'Transferred' ? __('Never independently verified') : '')],
   ['Received by', frm.doc.received_by],
   ['Moved to', formLink('Account', frm.doc.transfer_account), true], ['Moved by', frm.doc.transferred_by],
   ['Moved on', frm.doc.transferred_on && frappe.datetime && frappe.datetime.str_to_user
    ? frappe.datetime.str_to_user(frm.doc.transferred_on) : frm.doc.transferred_on],
   ['Register', frm.doc.pos_profile], ['Safe', formLink('POS Cash Safe', frm.doc.safe), true],
  ]) : meta([
   ['Counted by', frm.doc.counted_by], ['Reviewed by', frm.doc.reviewed_by],
   ['Register', frm.doc.pos_profile], ['Safe', formLink('POS Cash Safe', frm.doc.safe), true],
   ['Difference note', frm.doc.note], ['Review', frm.doc.review_note],
  ]);
  const links = isBag ? [
   ['Opening shift', formLink('POS Opening Shift', frm.doc.opening_shift), true],
   ['Receiving shift', formLink('POS Opening Shift', frm.doc.receiving_shift), true],
   ['Drawer deposit movement', formLink('POS Cash Movement', frm.doc.cash_movement), true],
   ['Drawer receipt movement', formLink('POS Cash Movement', frm.doc.receipt_movement), true],
   ['Bank transit journal', formLink('Journal Entry', frm.doc.dispatch_journal), true],
   ['Bank deposit journal', formLink('Journal Entry', frm.doc.deposit_journal), true],
   ['Bank receipt reference', frm.doc.deposit_reference],
   ['Transfer journal', formLink('Journal Entry', frm.doc.transfer_journal), true],
  ] : [
   ['Cash bag', formLink('POS Cash Bag', frm.doc.bag), true],
   ['Opening shift', formLink('POS Opening Shift', frm.doc.opening_shift), true],
   ['Closing shift', formLink('POS Closing Shift', frm.doc.closing_shift), true],
   ['Correction journal', formLink('Journal Entry', frm.doc.journal_entry), true],
  ];
  const linked = meta(links.filter((row) => row[1]));
  if (linked) html += '<h5>' + esc(__('Linked records')) + '</h5>' + linked;
  if (isBag) html += await bagCounts(frm);
  section(frm, 'summary', __('Cash custody'), html);
 },

 async renderSafe(frm) {
  style();
  frm.page.set_indicator(frm.doc.enabled ? __('Custody active') : __('Not active'), frm.doc.enabled ? 'green' : 'grey');
  let html = pendingBanner(frm.doc.pos_profile);
  if (!frm.doc.enabled) {
   html += '<p class="posa-alert">' + esc(__('Cash custody is off for this register. Enable it with no open shift and a reconciled, empty drawer account; cash actions stay unavailable until then.')) + '</p>';
  }
  html += '<div class="posa-tiles">'
   + tile(__('Suggested float'), esc(money(frm.doc.float_target, frm.doc.currency)))
   + tile(__('Drawer cash limit'), esc(money(frm.doc.drawer_limit, frm.doc.currency)))
   + '</div>';
  let bags = null;
  try {
   bags = await frappe.db.get_list('POS Cash Bag', {filters: {safe: frm.doc.name}, fields: ['state', 'amount'], limit: 500});
  } catch (e) { bags = null; }
  if (bags === null) {
   html += '<p class="posa-alert">' + esc(__('The bag queue could not be loaded. Open the cash bag list to review it.')) + '</p>';
  } else if (!bags.length) {
   html += '<p class="posa-muted">' + esc(__('No cash bags yet. A supervisor can prepare the first float from the safe.')) + '</p>';
  } else {
   const totals = {};
   bags.forEach((bag) => {
    totals[bag.state] = totals[bag.state] || {count: 0, amount: 0};
    totals[bag.state].count += 1;
    totals[bag.state].amount += flt(bag.amount);
   });
   html += '<h5>' + esc(__('Bags')) + '</h5><table><thead><tr><th>' + esc(__('State')) + '</th><th>'
    + esc(__('Quantity')) + '</th><th>' + esc(__('Amount')) + '</th></tr></thead><tbody>'
    + Object.keys(totals).map((state) => '<tr><td>'
     + listLink('POS Cash Bag', {safe: frm.doc.name, state: state}, phrase(BAG_STATES, state))
     + '</td><td>' + esc(totals[state].count) + '</td><td>' + esc(money(totals[state].amount, frm.doc.currency))
     + '</td></tr>').join('')
    + '</tbody></table>'
    + '<p class="posa-muted">' + esc(__('Bag totals are recorded custody evidence, not the ledger balance. Open Cash custody in POS or the safe ledger for balances.')) + '</p>';
  }
  section(frm, 'safe', __('Cash custody'), html);
 },

 printBags(names, closing) {
  const dialog = new frappe.ui.Dialog({title: __('Print bag labels'), fields: [
   {fieldname: 'layout', fieldtype: 'Select', label: __('Paper format'), default: 'ticket', reqd: 1,
    options: [{value: 'ticket', label: __('80 mm receipt')}, {value: 'label', label: __('100 × 76 mm label')},
     {value: 'slip', label: __('Handover sheet')}]}],
   primary_action_label: __('Print'), primary_action: (values) => {
    dialog.hide();
    this.printRequest(closing ? 'closing_labels' : 'bag_labels',
     Object.assign({layout: values.layout}, closing ? {closing_shift: closing} : {names: JSON.stringify(names)}),
     closing || __('Cash bag labels'));
   }});
  dialog.show();
 },
 printClosing(name) { this.printBags([], name); },
 print(frm, layout) {
  return this.printRequest('evidence', {doctype: frm.doc.doctype, name: frm.doc.name, layout: layout || 'slip'}, frm.doc.seal || frm.doc.name);
 },
 async printRequest(method, args, title) {
  let html = '';
  try {
   const response = await frappe.call({method: 'posawesome.posawesome.api.cash_custody.printing.' + method, args: args});
   html = response && response.message;
  } catch (e) { html = ''; }
  if (!html) {
   frappe.msgprint({title: __('Cash custody'), indicator: 'red',
    message: __('The evidence could not be prepared. The custody record is unchanged; printing is not the cash transaction.')});
   return;
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('title', title);
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = html;
  frame.onload = () => {
   try {
    frame.contentWindow.onafterprint = () => frame.remove();
    frame.contentWindow.focus();
    setTimeout(() => frame.contentWindow.print(), 60);
    setTimeout(() => { if (frame.parentNode) frame.remove(); }, 120000);
   } catch (e) {
    frame.remove();
    frappe.msgprint({title: __('Cash custody'), indicator: 'orange',
     message: __('This browser blocked the print window. The custody record is saved; print it again when the printer is ready.')});
   }
  };
  document.body.appendChild(frame);
 },

 async action(frm, name) {
  const spec = ACTIONS[name];
  if (!spec) return;
  style();
  const profile = frm.doc.pos_profile;
  let saved = null;
  try { saved = loadPending(profile, name); } catch (error) {
   frappe.msgprint({title: __('Cash custody'), indicator: 'red', message: error.message});
   return;
  }
  const currency = frm.doc.currency;
  // A fresh transfer reads the safe first: the supervisor confirms the destination and amount
  // the server will use, and a bag that already moved is refused before any request exists.
  // A saved request is replayed as is, whatever the bag's state now says.
  let transfer = null;
  if (spec.transfer) {
   if (frm.doc.doctype !== 'POS Cash Bag') return;
   if (saved) {
    transfer = {amount: frm.doc.amount, from: frm.doc.safe, to: frm.doc.transfer_account || __('Off-site cash account'),
     bag: frm.doc};
   } else {
    let ctx = null;
    try { ctx = await transferContext(profile); } catch (e) { ctx = null; }
    if (!ctx) {
     frappe.msgprint({title: __(spec.title), indicator: 'red',
      message: esc(__('The transfer details could not be loaded. Nothing was sent. Try again when connected.'))});
     return;
    }
    const bag = (ctx.bags || []).find((row) => row.name === frm.doc.name);
    if (!bag || TRANSFERABLE.indexOf(bag.state) < 0) {
     frappe.msgprint({title: __(spec.title), indicator: 'orange',
      message: esc(__('This bag is no longer a sealed bag in the safe. The record was reloaded and nothing was sent.'))});
     try { await frm.reload_doc(); } catch (e) { /* the message already says to reload */ }
     return;
    }
    if (!ctx.can_transfer) {
     frappe.msgprint({title: __(spec.title), indicator: 'orange',
      message: esc(ctx.transfer_blocker || __('The off-site cash account for this safe is not ready.'))
       + (ctx.can_manage && ctx.safe ? '<br>' + formLink('POS Cash Safe', ctx.safe, __("Open this safe's settings")) : '')});
     return;
    }
    transfer = {amount: bag.amount, from: ctx.safe, to: ctx.offsite_cash_account_name || ctx.offsite_cash_account,
     account: ctx.offsite_cash_account, bag: bag};
   }
  }
  const expected = spec.expected ? flt(spec.expected(frm)) : null;
  const fields = [{fieldtype: 'HTML', fieldname: 'help'}, {fieldtype: 'HTML', fieldname: 'feedback'}];
  if (transfer) {
   fields.push({fieldtype: 'HTML', fieldname: 'transfer'});
   // Required here and in POS; never sent or stored. It is the actor's word, not a count.
   fields.push({fieldname: 'physical_done', fieldtype: 'Check', default: 0,
    label: __('I confirm the whole bag, sealed and unopened, has already physically left for {0}.').replace('{0}', transfer.to)});
  }
  if (spec.seal) {
   fields.push({fieldname: 'seal', fieldtype: 'Data', label: __('Bag seal / ID'), reqd: 1,
    description: __('Use the printed seal. 3–80 letters, digits or hyphens; each package needs a new one.')});
   fields.push({fieldname: 'purpose', fieldtype: 'Select', label: __('Purpose'), default: 'Float', reqd: 1,
    options: [{label: __('Float'), value: 'Float'}, {label: __('Takings'), value: 'Takings'}]});
  }
  if (spec.count) {
   fields.push({fieldtype: 'Section Break', label: __('Count cash')});
   fields.push({fieldname: 'denominations', fieldtype: 'Table', label: __('Denominations'), in_place_edit: true, data: [],
    fields: [{fieldname: 'value', fieldtype: 'Currency', label: __('Denomination'), in_list_view: 1, reqd: 1, columns: 5},
             {fieldname: 'quantity', fieldtype: 'Int', label: __('Quantity'), in_list_view: 1, reqd: 1, columns: 4}]});
   fields.push({fieldname: 'manual_total', fieldtype: 'Check', label: __('Enter a manual total'), default: 0});
   fields.push({fieldname: 'manual_amount', fieldtype: 'Currency', label: __('Counted amount'), depends_on: 'manual_total'});
   fields.push({fieldname: 'manual_reason', fieldtype: 'Data', label: __('Why was the total overridden?'), depends_on: 'manual_total',
    description: __('At least 8 characters.')});
   fields.push({fieldtype: 'HTML', fieldname: 'totals'});
  }
  if (spec.reference) {
   fields.push({fieldname: 'reference', fieldtype: 'Data', label: __('Bank receipt reference'), reqd: 1,
    description: __('Deposit slip or bank confirmation number.')});
  }
  if (spec.note || spec.noteHint) {
   fields.push({fieldname: 'note', fieldtype: 'Small Text', label: __(spec.noteLabel || 'Reason / handover note'), reqd: spec.note ? 1 : 0,
    description: spec.note ? __('At least 8 characters.') : __(spec.noteHint)});
  }

  let pending = saved ? saved.body : null;
  let id = saved ? saved.request_id : requestId();
  const dialog = new frappe.ui.Dialog({title: __(spec.title), fields: fields, size: spec.count ? 'large' : 'small',
   primary_action_label: __(spec.primary), primary_action: () => submit()});
  dialog.$wrapper.addClass('posa-custody-dialog');

  const field = (fieldname) => dialog.fields_dict[fieldname];
  const feedback = (tone, message) => {
   const area = field('feedback');
   if (area) area.$wrapper.html(message ? '<div class="posa-feedback ' + tone + '">' + esc(message) + '</div>' : '');
  };
  const rows = () => {
   const grid = field('denominations') && field('denominations').grid;
   return (grid && grid.get_data ? grid.get_data() : dialog.get_value('denominations')) || [];
  };
  const countedMinor = () => {
   if (cint(dialog.get_value('manual_total'))) return Math.round(flt(dialog.get_value('manual_amount')) * 100);
   return rows().reduce((sum, row) => sum + Math.round(flt(row.value) * 100) * cint(row.quantity), 0);
  };
  const counting = () => (cint(dialog.get_value('manual_total'))
   ? flt(dialog.get_value('manual_amount')) > 0
   : rows().some((row) => flt(row.value) > 0));
  const totals = () => {
   if (!spec.count || !field('totals')) return;
   const counted = countedMinor() / 100;
   let html = '<div class="posa-summary"><span>' + esc(__('Counted amount')) + '</span><b>' + esc(money(counted, currency)) + '</b></div>';
   // An untouched dialog is not a shortage: the verdict waits until something is counted.
   if (expected !== null && !counting()) {
    html += '<div class="posa-help">' + esc(__('Expected')) + ': ' + esc(money(expected, currency)) + '</div>';
    if (field('note')) dialog.set_df_property('note', 'reqd', 0);
   } else if (expected !== null) {
    const difference = Math.round(counted * 100 - expected * 100) / 100;
    const wording = !difference ? __('No difference') : (difference > 0 ? __('Over') : __('Short'));
    html += '<div class="posa-help">' + esc(__('Expected')) + ': ' + esc(money(expected, currency)) + ' · '
     + esc(wording) + (difference ? ' ' + esc(money(Math.abs(difference), currency)) : '') + '</div>';
    if (field('note')) {
     dialog.set_df_property('note', 'reqd', difference ? 1 : 0);
     dialog.set_df_property('note', 'description', difference
      ? __('Count differs. The bag is held for supervisor review; drawer cash was not changed.')
      : __(spec.noteHint || ''));
    }
   }
   field('totals').$wrapper.html(html);
  };
  const lock = () => {
   fields.forEach((entry) => {
    if (!entry.fieldname || entry.fieldtype === 'HTML' || entry.fieldtype === 'Section Break') return;
    try { dialog.set_df_property(entry.fieldname, 'read_only', 1); } catch (e) { /* control already gone */ }
   });
   try { dialog.get_primary_btn().text(__('Retry unconfirmed action')); } catch (e) { /* older dialog API */ }
  };
  const restore = (body) => {
   ['seal', 'purpose', 'reference', 'note'].forEach((key) => {
    if (body[key] !== undefined && field(key)) dialog.set_value(key, body[key]);
   });
   const count = body.count || {};
   if (field('denominations') && Array.isArray(count.denominations)) {
    dialog.set_value('denominations', count.denominations.map((row) => ({value: row.value, quantity: row.quantity})));
   }
   if (count.source === 'manual' && field('manual_total')) {
    dialog.set_value('manual_total', 1);
    dialog.set_value('manual_amount', count.amount);
    dialog.set_value('manual_reason', count.reason);
   }
  };
  const build = (values) => {
   if (transfer && !cint(values.physical_done)) {
    feedback('red', __('Confirm that the whole sealed bag has already physically left before recording the transfer.'));
    return null;
   }
   const payload = {pos_profile: profile};
   if (frm.doc.doctype === 'POS Cash Bag') payload.bag = frm.doc.name;
   if (frm.doc.doctype === 'POS Cash Count') payload.cash_count = frm.doc.name;
   if (spec.seal) {
    payload.seal = (values.seal || '').trim();
    payload.purpose = values.purpose || 'Float';
   }
   if (spec.reference) payload.reference = (values.reference || '').trim();
   if (field('note')) payload.note = (values.note || '').trim();
   if (spec.count) {
    const denominations = rows().filter((row) => flt(row.value) > 0)
     .map((row) => ({value: flt(row.value), quantity: cint(row.quantity)}));
    const manual = cint(values.manual_total);
    if (!manual && !denominations.length) {
     feedback('red', __('Add at least one denomination, or enter a manual total with a reason.'));
     return null;
    }
    if (manual && (values.manual_reason || '').trim().length < 8) {
     feedback('red', __('Explain the manual count override (at least 8 characters).'));
     return null;
    }
    payload.count = manual
     ? {source: 'manual', amount: flt(values.manual_amount), reason: (values.manual_reason || '').trim(), denominations: denominations}
     : {source: 'denominations', denominations: denominations};
   }
   if (field('note') && field('note').df.reqd && payload.note.length < 8) {
    feedback('red', __('Describe the reason in 8 to 1000 characters.'));
    return null;
   }
   return payload;
  };
  const finish = async (result) => {
   await frm.reload_doc();
   frappe.show_alert({message: __('Cash action recorded.') + (result.amount === undefined ? '' : ' ' + money(result.amount, currency)),
    indicator: 'green'}, 7);
   if (result.journal_entry) {
    frappe.show_alert({message: __(name === 'review' ? 'Correction journal' : 'Journal Entry') + ': ' + formLink('Journal Entry', result.journal_entry), indicator: 'blue'}, 10);
   }
   if (result.state === 'Disputed' && result.cash_count) {
    frappe.msgprint({title: __('Review difference'), indicator: 'orange',
     message: esc(__('Count differs. The bag is held for supervisor review; drawer cash was not changed.'))
      + '<br>' + formLink('POS Cash Count', result.cash_count)});
    return;
   }
   if (result.bag && result.bag !== frm.doc.name) frappe.set_route('Form', 'POS Cash Bag', result.bag);
   else if (result.cash_count && result.cash_count !== frm.doc.name && frm.doc.doctype !== 'POS Cash Bag') {
    frappe.set_route('Form', 'POS Cash Count', result.cash_count);
   }
  };
  const submit = async () => {
   feedback('', '');
   totals();  // Grid edits commit on blur; re-read them before deciding what the server needs.
   if (!pending) {
    const values = dialog.get_values();
    if (!values) {
     feedback('red', __('Complete the highlighted fields before confirming.'));
     return;
    }
    pending = build(values);
    if (!pending) return;
   }
   try { savePending(profile, name, pending, id); } catch (error) {
    pending = null;
    feedback('red', error.message);
    return;
   }
   dialog.disable_primary_action();
   let confirmed = false;
   try {
    const response = await frappe.call({method: 'posawesome.posawesome.api.cash_custody.service.command',
     args: {action: name, payload: Object.assign({}, pending, {request_id: id})}});
    if (!response || response.exc) throw Object.assign(new Error('refused'), {status: 417, responseJSON: response});
    confirmed = true;
    clearPending(profile, name);
    dialog.hide();
    await finish(response.message || {});
   } catch (error) {
    if (confirmed) {
     frappe.msgprint({title: __('Cash action recorded.'), indicator: 'orange',
      message: __('The cash action was saved, but the screen could not refresh. Refresh the record; do not move the cash again.')});
     return;
    }
    const status = Number(error && (error.status || error.statusCode)) || 0;
    if (status >= 400 && status < 500) {
     // The server refused and rolled back: nothing moved, so the details can be corrected and sent again.
     clearPending(profile, name);
     pending = null;
     feedback('red', serverMessage(error) || __('The cash action was refused and nothing was recorded. Correct the details and confirm again.'));
    } else {
     lock();
     feedback('orange', __('The server did not confirm this action. Retry sends the same request; it never records the transfer twice. Do not move the cash again.'));
    }
   } finally { dialog.enable_primary_action(); }
  };

  field('help').$wrapper.html('<div class="posa-help">' + esc(__(spec.help)) + '</div>');
  if (transfer) {
   field('transfer').$wrapper.html('<div class="posa-summary"><span>' + esc(__('Amount leaving the safe')) + '</span><b>'
    + esc(money(transfer.amount, currency)) + '</b></div>'
    + transferRoute(__('Safe') + ': ' + (transfer.from || ''), transfer.to, transfer.account)
    + (transfer.bag.verified_by ? '<p class="posa-help">' + esc(__('Verified by')) + ': ' + esc(transfer.bag.verified_by) + '</p>'
     : unverifiedWarning(transfer.bag.prepared_by)));
  }
  if (spec.count) {
   dialog.$wrapper.on('change focusout click', () => setTimeout(totals, 50));
  }
  dialog.show();
  if (pending) {
   restore(pending);
   // The physical move was confirmed when this request was first sent; the replay is identical.
   if (field('physical_done')) dialog.set_value('physical_done', 1);
   lock();
   feedback('orange', __('This action has an unconfirmed result from an earlier attempt. Retry checks the same request; it never records the transfer twice.'));
  }
  totals();
 },

 list(frm, doctype, filters) {
  frappe.set_route('List', doctype, Object.assign({safe: frm.doc.safe || frm.doc.name}, filters || {}));
 },
};

async function bagCounts(frm) {
 let counts;
 try {
  counts = await frappe.db.get_list('POS Cash Count', {filters: {bag: frm.doc.name},
   fields: ['name', 'state', 'amount', 'difference', 'counted_by', 'creation'], order_by: 'creation desc', limit: 20});
 } catch (e) {
  return '<p class="posa-alert">' + esc(__('The counts for this bag could not be loaded.')) + '</p>';
 }
 if (!counts || !counts.length) {
  return '<p class="posa-muted">' + esc(canManage() ? __('No count is recorded for this bag yet.')
   : __('No count of yours is recorded for this bag. Counts by other people are visible to supervisors.')) + '</p>';
 }
 return '<h5>' + esc(__('Counts and exceptions')) + '</h5><table><thead><tr><th>' + esc(__('Count')) + '</th><th>'
  + esc(__('Counted by')) + '</th><th>' + esc(__('Amount')) + '</th><th>' + esc(__('Difference')) + '</th></tr></thead><tbody>'
  + counts.map((row) => '<tr><td>' + formLink('POS Cash Count', row.name, phrase(COUNT_STATES, row.state))
   + '</td><td>' + esc(row.counted_by) + '</td><td>' + esc(money(row.amount, frm.doc.currency)) + '</td><td>'
   + esc(flt(row.difference) ? money(row.difference, frm.doc.currency) : __('No difference')) + '</td></tr>').join('')
  + '</tbody></table>';
}
})();
