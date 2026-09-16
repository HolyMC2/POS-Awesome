// Queue -> bag -> the one action its state allows -> evidence. Permissions stay server-side.
const POSA_BAG_ACTIONS = {
 Unverified: ['verify'],
 Disputed: ['verify'],
 Available: ['dispatch', 'unpack'],
 'In Transit': ['confirm_bank', 'return_bank'],
};

frappe.ui.form.on('POS Cash Bag', {
 refresh(frm) {
  if (frm.is_new()) return;
  frappe.require('/assets/posawesome/js/cash_custody.js', () => {
   const custody = window.posaCashCustody;
   custody.render(frm);
   frm.add_custom_button(__('Print bag label'), () => custody.print(frm, 'label'));
   frm.add_custom_button(__('Print count evidence'), () => custody.print(frm, 'slip'));
   frm.add_custom_button(__('Bags in this safe'), () => custody.list(frm, 'POS Cash Bag'), __('Queues'));
   frm.add_custom_button(__('Counts and exceptions'), () => custody.list(frm, 'POS Cash Count'), __('Queues'));
   if (!custody.canManage()) return;
   // Nobody verifies their own preparation; the server refuses it, so do not offer it here.
   const actions = (POSA_BAG_ACTIONS[frm.doc.state] || [])
    .filter((action) => !(action === 'verify' && frm.doc.prepared_by === frappe.session.user));
   actions.forEach((action, index) => frm.add_custom_button(__(custody.ACTIONS[action].title),
    () => custody.action(frm, action), index ? __('More') : null));
   if (actions.length) frm.change_custom_button_type(__(custody.ACTIONS[actions[0]].title), null, 'primary');
  });
 },
});
