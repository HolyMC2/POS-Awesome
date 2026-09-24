"""Rollback-only real Frappe check of cash photo evidence. Never run outside *.lab.*.

Needs one existing POS Cash Bag and POS Cash Count (lab_drill.run(persist=True)
leaves both). Everything written here, including files on disk, is rolled back.

    bench --site doco-mirror.lab.xoloitzcuintles.com execute \\
        posawesome.posawesome.api.cash_custody.lab_photos.run
"""
import base64
import io
import json
import uuid

import frappe

from . import photos as p


def _jpeg(color, maker=None):
    from PIL import Image
    image, exif, out = Image.new('RGB', (64, 32), color), Image.Exif(), io.BytesIO()
    exif[0x0112] = 6
    if maker:
        exif[0x010F] = maker
    image.save(out, 'JPEG', exif=exif.tobytes())
    return base64.b64encode(out.getvalue()).decode()


def run():
    if '.lab.' not in frappe.local.site:
        raise RuntimeError('Lab-only check')
    user = frappe.session.user
    try:
        return _run()
    finally:
        frappe.db.rollback()
        frappe.set_user(user)


def _run():
    frappe.set_user('Administrator')
    bag = frappe.get_all('POS Cash Bag', fields=['name', 'pos_profile', 'modified', 'amount', 'state'],
                         order_by='creation desc', limit_page_length=1)
    count = frappe.get_all('POS Cash Count', fields=['name', 'counted_by'], order_by='creation desc', limit_page_length=1)
    if not bag or not count:
        raise RuntimeError('Create custody records first: lab_drill.run(persist=True)')
    bag = bag[0]
    suffix, checks, findings = uuid.uuid4().hex[:7], [], {}
    users = []
    for tag in ['insider', 'outsider']:
        user = frappe.get_doc(dict(doctype='User', email=f'photo-{tag}-{suffix}@lab.invalid', first_name='Photo QA ' + tag,
                                   send_welcome_email=0, enabled=1, user_type='System User'))
        user.append('roles', {'role': 'POS User'})
        user.append('roles', {'role': 'Sales User'})
        users.append(user.insert(ignore_permissions=True).name)
    profile = frappe.get_doc('POS Profile', bag.pos_profile)
    # QA fixtures disable their profile after creating bags; enable it only inside this rollback.
    profile.disabled = 0
    profile.append('applicable_for_users', {'user': users[0]})
    profile.save(ignore_permissions=True)

    def actor(user):
        frappe.set_user(user)
        frappe.local._posa_scope_cache = {}

    def check(label, condition):
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    def denied(label, callback):
        frappe.db.savepoint('photo_denied')
        try:
            callback()
        except (frappe.ValidationError, frappe.PermissionError):
            frappe.db.rollback(save_point='photo_denied')
            frappe.clear_messages()
            checks.append(label)
        else:
            raise AssertionError(label + ' was accepted')

    actor(users[0])
    first = p.upload_photo('POS Cash Bag', bag.name, 'a.jpg', _jpeg((200, 20, 20), 'LAB-SECRET-MAKER'))
    stored = frappe.get_doc('File', first['name'])
    content = stored.get_content(encodings=[])
    check('photo is private', stored.is_private == 1 and first['file_url'].startswith('/private/files/'))
    check('photo is marked on the bag', (stored.attached_to_doctype, stored.attached_to_name,
          stored.attached_to_field) == ('POS Cash Bag', bag.name, p.PHOTO_FIELD))
    check('metadata stripped', b'LAB-SECRET-MAKER' not in content and content[:2] == b'\xff\xd8')
    check('owner is the uploader', first['owner'] == users[0])
    check('retry returns the same photo', p.upload_photo('POS Cash Bag', bag.name, 'a.jpg', _jpeg((200, 20, 20), 'LAB-SECRET-MAKER')) == first)
    check('insider may download', stored.is_downloadable())
    after = frappe.db.get_value('POS Cash Bag', bag.name, ['modified', 'amount', 'state'], as_dict=True)
    check('bag untouched', (after.modified, after.amount, after.state) == (bag.modified, bag.amount, bag.state))
    if count[0].counted_by != users[0]:
        denied("another cashier's count stays hidden", lambda: p.list_photos('POS Cash Count', count[0].name))

    actor(users[1])
    denied('other register cannot list', lambda: p.list_photos('POS Cash Bag', bag.name))
    denied('other register cannot upload', lambda: p.upload_photo('POS Cash Bag', bag.name, 'b.jpg', _jpeg((1, 2, 3))))
    check('other register cannot download', not frappe.get_doc('File', first['name']).is_downloadable())
    # Framework probes, reported rather than asserted: generic File behaviour
    # outside this module's hooks.
    findings['file_list_rows_visible_to_other_register'] = len(frappe.get_list(
        'File', filters={'attached_to_field': p.PHOTO_FIELD}, pluck='name'))
    check('other register cannot list photo metadata', findings['file_list_rows_visible_to_other_register'] == 0)
    frappe.db.savepoint('photo_probe')
    try:
        alias = frappe.get_doc(dict(doctype='File', file_url=first['file_url'], is_private=1,
                                    file_name='alias-' + suffix + '.jpg')).insert()
        findings['url_alias_insert'] = 'ALLOWED; downloadable=' + str(bool(alias.is_downloadable()))
    except Exception as exc:
        findings['url_alias_insert'] = 'blocked: ' + type(exc).__name__
    check('private URL alias refused', findings['url_alias_insert'].startswith('blocked:'))
    frappe.db.rollback(save_point='photo_probe')
    frappe.clear_messages()

    actor('Administrator')
    denied('generic marked insert refused', lambda: frappe.get_doc(dict(doctype='File', file_name='x.jpg', is_private=1,
        attached_to_doctype='POS Cash Bag', attached_to_name=bag.name, attached_to_field=p.PHOTO_FIELD,
        content=base64.b64decode(_jpeg((9, 9, 9))))).insert())

    def change(**values):
        doc = frappe.get_doc('File', first['name'])
        doc.update(values)
        doc.save()
    denied('photo cannot be made public', lambda: change(is_private=0))
    denied('photo cannot be detached', lambda: change(attached_to_field=None, attached_to_name=None, attached_to_doctype=None))
    denied('photo cannot be deleted', lambda: frappe.delete_doc('File', first['name']))
    from frappe.desk.form.utils import remove_attach
    frappe.form_dict.update(fid=first['name'], dt='POS Cash Bag', dn=bag.name)
    denied('sidebar removal refused', remove_attach)

    actor(users[0])
    for index in range(1, p.MAX_PHOTOS):
        p.upload_photo('POS Cash Bag', bag.name, 'n.jpg', _jpeg((index * 40, 90, 90)))
    listed = p.list_photos('POS Cash Bag', bag.name)
    check('limit reached', len(listed['photos']) == p.MAX_PHOTOS and not listed['can_upload'])
    denied('seventh photo refused', lambda: p.upload_photo('POS Cash Bag', bag.name, 'n.jpg', _jpeg((5, 250, 5))))
    actor('Administrator')
    print(json.dumps({'checks': checks, 'passed': len(checks), 'findings': findings,
                      'site': frappe.local.site, 'rolled_back': True}))
    frappe.db.rollback()
    return {'checks': checks, 'findings': findings}
