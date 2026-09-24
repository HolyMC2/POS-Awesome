// Queue -> bag -> the one action its state allows -> evidence. Permissions stay server-side.
const POSA_BAG_ACTIONS = {
 Unverified: ['verify', 'transfer_safe'],
 Disputed: ['verify'],
 Available: ['dispatch', 'unpack', 'transfer_safe'],
 'In Transit': ['confirm_bank', 'return_bank'],
};

frappe.ui.form.on('POS Cash Bag', {
 refresh(frm) {
  if (frm.is_new()) return;
  frm.add_custom_button(__('Photo evidence'), () => {
   frappe.require('/assets/posawesome/js/cash_photos.js', () => window.posaCashPhotos.open(frm.doctype, frm.doc.name));
  });
  frappe.require('/assets/posawesome/js/cash_custody.js', () => {
   const custody = window.posaCashCustody;
   custody.render(frm);
   frm.add_custom_button(__('Print bag label'), () => custody.printBags([frm.doc.name]));
   frm.add_custom_button(__('Print count evidence'), () => custody.print(frm, 'slip'));
   frm.add_custom_button(__('Bags in this safe'), () => custody.list(frm, 'POS Cash Bag'), __('Queues'));
   frm.add_custom_button(__('Counts and exceptions'), () => custody.list(frm, 'POS Cash Count'), __('Queues'));
   if (!custody.canManage()) return;
   // A lost response leaves the bag in a state with no button for that action;
   // the replay must stay reachable, and it outranks any new action.
   const unconfirmed = custody.pendingForBag(frm.doc.pos_profile, frm.doc.name);
   unconfirmed.forEach((action) => frm.add_custom_button(
    __('Retry unconfirmed action') + ': ' + __(custody.ACTIONS[action].title), () => custody.action(frm, action)));
   if (unconfirmed.length) {
    frm.change_custom_button_type(__('Retry unconfirmed action') + ': ' + __(custody.ACTIONS[unconfirmed[0]].title), null, 'primary');
    return;
   }
   // Nobody verifies their own preparation; the server refuses it, so do not offer it here.
   const actions = (POSA_BAG_ACTIONS[frm.doc.state] || [])
    .filter((action) => !(action === 'verify' && frm.doc.prepared_by === frappe.session.user));
   actions.forEach((action, index) => frm.add_custom_button(__(custody.ACTIONS[action].title),
    () => custody.action(frm, action), index ? __('More') : null));
   // Moving a bag off-site is terminal, so it is never the highlighted next step.
   const primary = actions.find((action) => action !== 'transfer_safe');
   if (primary) frm.change_custom_button_type(__(custody.ACTIONS[primary].title), null, 'primary');
  });
 },
});
