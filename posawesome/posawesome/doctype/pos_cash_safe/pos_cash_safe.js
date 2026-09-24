// The safe record is the supervisor's entry point: queues first, then the two cash actions.
frappe.ui.form.on('POS Cash Safe', {
 refresh(frm) {
  if (frm.is_new()) return;
  frappe.require('/assets/posawesome/js/cash_custody.js?v=20260923-offsite-transfer', () => {
   const custody = window.posaCashCustody;
   custody.renderSafe(frm);
   frm.add_custom_button(__('Bags'), () => custody.list(frm, 'POS Cash Bag'), __('Queues'));
   frm.add_custom_button(__('Counts and exceptions'), () => custody.list(frm, 'POS Cash Count', {state: 'Exception'}), __('Queues'));
   frm.add_custom_button(__('Cash custody history'), () => custody.list(frm, 'POS Cash Custody Event'), __('Queues'));
   // Custody commands need an enabled safe; the server refuses otherwise and the panel says why.
   if (!frm.doc.enabled || !custody.canManage()) return;
   frm.add_custom_button(__('Prepare float bag'), () => custody.action(frm, 'prepare'));
   frm.add_custom_button(__('Count safe'), () => custody.action(frm, 'count_safe'));
   frm.change_custom_button_type(__('Prepare float bag'), null, 'primary');
  });
 },
});
