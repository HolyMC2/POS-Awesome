# Cash photo evidence

POS owns bag and count photos. Open Cash bags & safe from the POS quick menu or
opening-shift dialog, choose a bag/count and use Take photo or Choose photo. Desk
bag/count forms offer Photo evidence too. After a successful closing, the handover
shows photo controls for each bag and the drawer count beside the printable labels.

Photos are optional evidence; they never replace counting or repeat the closing.
The parent record keeps its amounts, state and modified time. Capture the bag seal
and cash before sealing when possible. Once stored, photos cannot be removed,
reattached or made public through ordinary File or attachment actions.

- Up to six JPEG/PNG/WebP photos per bag or count.
- Large mobile photos up to 30 MB are resized before upload; server input limit is
  5 MB. Server independently decodes/re-encodes, limits dimensions and strips EXIF/GPS.
- Private file access follows the parent register/company and the cashier's own
  count permissions, including native File download and list paths.
- Retry resends the same bytes and returns the same stored photo, even after a lost
  response. It cannot duplicate a cash action. An unconfirmed photo stays in this
  browser tab across POS record changes; return to that record and retry. Reloading
  or closing the tab loses unsent photos and prompts first.
- Photos remain attached when a whole sealed bag moves off-site.

Verification: `test_photos.py`, `frontend/tests/cashPhotos.spec.ts`, and the native
rollback-only `posawesome.posawesome.api.cash_custody.lab_photos.run` on a lab site.
