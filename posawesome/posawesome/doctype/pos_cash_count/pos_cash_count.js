// A count is evidence: read it, print it, and review a difference from here.
frappe.ui.form.on('POS Cash Count', {
 refresh(frm) {
  if (frm.is_new()) return;
  frm.add_custom_button(__('Photo evidence'), () => {
   frappe.require('/assets/posawesome/js/cash_photos.js?v=20260923-photo-evidence', () => window.posaCashPhotos.open(frm.doctype, frm.doc.name));
  });
  frappe.require('/assets/posawesome/js/cash_custody.js?v=20260923-offsite-transfer', () => {
   const custody = window.posaCashCustody;
   custody.render(frm);
   frm.add_custom_button(__('Print count evidence'), () => custody.print(frm, 'slip'));
   frm.add_custom_button(__('Counts and exceptions'), () => custody.list(frm, 'POS Cash Count'), __('Queues'));
   frm.add_custom_button(__('Bags in this safe'), () => custody.list(frm, 'POS Cash Bag'), __('Queues'));
   if (frm.doc.state !== 'Exception' || !custody.canManage()) return;
   // Reviewing your own discrepancy is refused server-side; the record already explains who is next.
   if (frm.doc.counted_by === frappe.session.user) return;
   frm.add_custom_button(__('Review difference'), () => custody.action(frm, 'review'));
   frm.change_custom_button_type(__('Review difference'), null, 'primary');
  });
 },
});
