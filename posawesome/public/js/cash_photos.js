/* Private photo evidence shared by POS, closing handovers and Desk forms. */
(() => {
 const tr = (text) => window.__?.(text) || text;
 // Keep an unconfirmed photo across SPA record/route changes in this tab.
 const pendingPhotos = new Map();
 window.addEventListener('beforeunload', (event) => {
  if (pendingPhotos.size) { event.preventDefault(); event.returnValue = ''; }
 });
 const method = 'posawesome.posawesome.api.cash_custody.photos.';
 const call = async (action, args) => (await frappe.call({ method: method + action, args })).message;
 const make = (tag, text, parent) => {
  const element = document.createElement(tag);
  if (text) element.textContent = tr(text);
  if (parent) parent.append(element);
  return element;
 };
 function mount(host, target) {
  host.replaceChildren();
  host.classList.add('cash-photos');
  const key = [frappe.session?.user || '', target.doctype, target.name].join(':');
  let disposed = false, busy = false, pending = pendingPhotos.get(key) || null, previewUrl = '', data = null;
  const heading = make('h4', 'Photo evidence', host);
  make('p', 'Photograph the cash and the bag seal. Photos are private and do not replace the physical count.', host);
  const status = make('p', '', host);
  status.setAttribute('role', 'status');
  const error = make('p', '', host);
  error.setAttribute('role', 'alert');
  const gallery = make('div', '', host);
  gallery.className = 'cash-photos__gallery';
  const controls = make('div', '', host);
  controls.className = 'cash-photos__controls';
  const camera = make('button', 'Take photo', controls);
  const choose = make('button', 'Choose photo', controls);
  const retry = make('button', 'Retry', controls);
  const discard = make('button', 'Discard unsent photo', controls);
  [camera, choose, retry, discard].forEach((button) => { button.type = 'button'; });
  retry.hidden = discard.hidden = true;
  const preview = make('img', '', host);
  preview.className = 'cash-photos__preview';
  preview.alt = tr('Unsent photo');
  preview.hidden = true;
  const inputs = [true, false].map((capture) => {
   const input = make('input', '', host);
   input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.hidden = true;
   if (capture) input.setAttribute('capture', 'environment');
   input.onchange = () => { const file = input.files?.[0]; input.value = ''; if (file) void select(file); };
   return input;
  });
  camera.onclick = () => inputs[0].click();
  choose.onclick = () => inputs[1].click();
  function state() {
   camera.disabled = choose.disabled = busy || Boolean(pending) || !data?.can_upload || data.photos.length >= data.max_photos;
   retry.disabled = discard.disabled = busy;
   discard.hidden = !pending;
   host.setAttribute('aria-busy', String(busy));
  }
  function clearPending() {
   pendingPhotos.delete(key);
   pending = null;
   if (previewUrl) URL.revokeObjectURL(previewUrl);
   previewUrl = ''; preview.removeAttribute('src'); preview.hidden = true;
  }
  discard.onclick = () => { clearPending(); error.textContent = ''; retry.hidden = true; state(); };
  function render() {
   heading.textContent = `${tr('Photo evidence')} · ${data.photos.length}/${data.max_photos}`;
   gallery.replaceChildren();
   data.photos.forEach((photo) => {
    // Only same-origin private files may become image/link sources.
    if (typeof photo.file_url !== 'string' || !photo.file_url.startsWith('/private/files/')) return;
    const figure = make('figure', '', gallery);
    const link = make('a', '', figure);
    link.href = photo.file_url; link.target = '_blank'; link.rel = 'noopener';
    const img = make('img', '', link);
    img.src = photo.file_url; img.alt = photo.file_name; img.loading = 'lazy';
    const caption = make('figcaption', '', figure);
    caption.textContent = [photo.owner, photo.creation].filter(Boolean).join(' · ');
   });
   status.textContent = data.photos.length ? tr('Saved photos stay linked to this record.') : tr('No photos yet.');
   if (data.photos.length >= data.max_photos) status.textContent += ' ' + tr('Photo limit reached.');
  }
  async function load() {
   busy = true; error.textContent = ''; retry.hidden = true; state();
   try {
    const result = await call('list_photos', target);
    if (disposed) return;
    if (!result || !Array.isArray(result.photos)) throw Error();
    pending = pendingPhotos.get(key) || null;
    data = result; render();
    if (pending) {
     if (!previewUrl) previewUrl = URL.createObjectURL(pending);
     preview.src = previewUrl; preview.hidden = false; retry.hidden = false;
     error.textContent = tr('Photo was not confirmed. Keep this screen open and retry; the cash record is unchanged.');
    }
   } catch {
    if (disposed) return;
    error.textContent = tr('Photos could not be loaded. Retry when connected.'); retry.hidden = false;
   } finally { busy = false; if (!disposed) state(); }
  }
  async function select(file) {
   if (busy || pending || !data?.can_upload) return;
   error.textContent = ''; retry.hidden = true;
   if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    error.textContent = tr('Choose a JPEG, PNG or WebP photo.'); return;
   }
   if (file.size > 30 * 1024 * 1024) {
    error.textContent = tr('This photo is too large. Choose a photo smaller than 5 MB.'); return;
   }
   pending = file;
   pendingPhotos.set(key, pending);
   previewUrl = URL.createObjectURL(file); preview.src = previewUrl; preview.hidden = false;
   if (file.size > data.max_bytes) {
    busy = true; status.textContent = tr('Preparing photo…'); state();
    try {
     const bitmap = await createImageBitmap(file);
     try {
      if (bitmap.width * bitmap.height > 50_000_000) throw Error();
      const ratio = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob || blob.size > data.max_bytes) throw Error();
      pending = new File([blob], 'cash-photo.jpg', { type: 'image/jpeg' });
      pendingPhotos.set(key, pending);
     } finally { bitmap.close(); }
    } catch {
     clearPending(); error.textContent = tr('This photo is too large. Choose a photo smaller than 5 MB.');
    } finally { busy = false; state(); }
   }
   if (disposed) return;
   await upload();
  }
  async function upload() {
   if (!pending || busy) return;
   busy = true; error.textContent = ''; retry.hidden = true; status.textContent = tr('Saving photo…'); state();
   try {
    const file = pending;
    const content = await new Promise((resolve, reject) => {
     const reader = new FileReader();
     reader.onload = () => resolve(String(reader.result).split(',')[1]);
     reader.onerror = reject;
     reader.readAsDataURL(file);
    });
    await call('upload_photo', { ...target, filename: file.name, content });
    clearPending();
    if (disposed) return;
    status.textContent = tr('Photo saved.');
   } catch {
    if (disposed) return;
    error.textContent = tr('Photo was not confirmed. Keep this screen open and retry; the cash record is unchanged.');
    status.textContent = ''; retry.hidden = false;
   } finally { busy = false; if (!disposed) state(); }
   if (!disposed && !pending) await load();
  }
  retry.onclick = () => { if (pending) void upload(); else void load(); };
  state(); void load();
  return {
   hasPending: () => Boolean(pending),
   destroy() { disposed = true; if (previewUrl) URL.revokeObjectURL(previewUrl); },
  };
 }
 if (!document.getElementById('cash-photos-style')) {
  const style = make('style'); style.id = 'cash-photos-style';
  style.textContent = `.cash-photos{min-width:0;margin:16px 0;padding:14px;border:1px solid var(--border-color,#ccc);border-radius:10px;font:inherit}.cash-photos h4{margin:0 0 8px}.cash-photos p{font-size:13px;overflow-wrap:anywhere}.cash-photos [role=alert]{color:var(--red-600,#b42318)}.cash-photos__controls{display:flex;flex-wrap:wrap;gap:8px}.cash-photos button{font:inherit;min-height:44px;padding:8px 12px;border:1px solid var(--border-color,#bbb);border-radius:8px;color:inherit;background:var(--control-bg,transparent);cursor:pointer}.cash-photos button:disabled{opacity:.5;cursor:default}.cash-photos [hidden]{display:none!important}.cash-photos__gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(120px,100%),1fr));gap:8px}.cash-photos figure{margin:0;min-width:0}.cash-photos figure img{width:100%;height:110px;object-fit:cover;border-radius:6px}.cash-photos figcaption{font-size:11px;overflow-wrap:anywhere}.cash-photos__preview{display:block;max-width:100%;max-height:180px;margin-top:12px}.cash-photos :focus-visible{outline:2px solid #4686db;outline-offset:2px}`;
  document.head.append(style);
 }
 function open(doctype, name) {
  const dialog = make('dialog');
  dialog.style.cssText = 'width:min(560px,calc(100vw - 24px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--border-color,#ccc);border-radius:12px;background:var(--fg-color,#fff);color:var(--text-color,#222);padding:16px';
  dialog.setAttribute('aria-label', tr('Photo evidence'));
  make('h3', '', dialog).textContent = name;
  const host = make('div', '', dialog);
  const close = make('button', 'Close', dialog); close.type = 'button';
  close.style.cssText = 'min-height:44px;padding:8px 18px';
  document.body.append(dialog);
  const panel = mount(host, { doctype, name });
  const canClose = () => !panel.hasPending() || window.confirm(tr('A photo is still unsent. Leave without saving it?'));
  close.onclick = () => { if (canClose()) dialog.close(); };
  dialog.addEventListener('cancel', (event) => { if (!canClose()) event.preventDefault(); });
  dialog.addEventListener('close', () => { panel.destroy(); dialog.remove(); }, { once: true });
  dialog.showModal();
 }
 window.posaCashPhotos = { mount, open };
})();
