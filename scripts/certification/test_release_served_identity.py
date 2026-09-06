"""A local rebuild cannot certify an older static copy or HTTP deployment."""
import json
import pathlib
import shutil
import sys
import tempfile
import unittest
import urllib.parse
from unittest.mock import patch

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from release_identity import served_build_identity,digest,_http_asset


class ServedIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=pathlib.Path(self.temp.name);self.build=root/'built';self.served=root/'served'
        self.build.mkdir();self.served.mkdir()
        self.manifest={'version':'candidate-new','assets':{'web_entry':'/assets/posawesome/dist/js/web-entry-new.js','posawesome':'/assets/posawesome/dist/js/posawesome-new.js'}}
        (self.build/'version.json').write_text(json.dumps(self.manifest))
        (self.build/'web-entry-new.js').write_text('import "./posawesome-new.js";')
        (self.build/'posawesome-new.js').write_text('export const candidate="new";')
        (self.build/'chunk.js').write_text('export const component=1;')
        shutil.copytree(self.build,self.served,dirs_exist_ok=True)
        self.http={p.name:p.read_bytes() for p in self.build.iterdir()}
        self.urls=[]

    def fetch(self,url):
        self.urls.append(url)
        return self.http[pathlib.PurePosixPath(urllib.parse.urlsplit(url).path).name]

    def capture(self):
        return served_build_identity(self.build,self.served,'cert-test.lab.xoloitzcuintles.com',self.fetch)

    def test_matches_served_files_and_public_manifest_and_both_entries(self):
        (self.served/'old-retained.js').write_text('historical offline asset')
        result=self.capture()
        self.assertEqual(result['version'],'candidate-new')
        self.assertEqual(result['manifest_sha256'],digest((self.build/'version.json').read_bytes()))
        self.assertEqual(len(self.urls),3)
        self.assertTrue(all('pos_certification=' in url for url in self.urls))
        self.assertEqual(set(result),{'version','manifest_sha256','assets_sha256'})

    def test_new_built_manifest_with_stale_materialized_copy_is_rejected(self):
        (self.served/'version.json').write_text(json.dumps(dict(self.manifest,version='old')))
        with self.assertRaisesRegex(ValueError,'materialized served'):self.capture()
        self.assertEqual(self.urls,[])

    def test_matching_manifest_cannot_hide_stale_nonentry_served_chunk(self):
        (self.served/'chunk.js').write_text('old component')
        with self.assertRaisesRegex(ValueError,'materialized served'):self.capture()

    def test_public_manifest_must_match_even_when_local_copies_match(self):
        self.http['version.json']=json.dumps(dict(self.manifest,version='old')).encode()
        with self.assertRaisesRegex(ValueError,'HTTP manifest'):self.capture()

    def test_matching_http_manifest_cannot_hide_old_entry_bundle(self):
        for name in ('web-entry-new.js','posawesome-new.js'):
            with self.subTest(name=name):
                before=self.http[name];self.http[name]=b'old served JavaScript'
                with self.assertRaisesRegex(ValueError,'HTTP entry bundle'):self.capture()
                self.http[name]=before

    def test_missing_served_asset_and_missing_manifest_entry_fail_closed(self):
        (self.served/'chunk.js').unlink()
        with self.assertRaisesRegex(ValueError,'materialized served'):self.capture()
        shutil.copyfile(self.build/'chunk.js',self.served/'chunk.js')
        self.manifest['assets'].pop('web_entry')
        raw=json.dumps(self.manifest).encode()
        (self.build/'version.json').write_bytes(raw);(self.served/'version.json').write_bytes(raw);self.http['version.json']=raw
        with self.assertRaisesRegex(ValueError,'web entry bundle'):self.capture()

    def test_manifest_cannot_redirect_asset_probe_to_external_origin(self):
        self.manifest['assets']['web_entry']='https://external.invalid/private'
        raw=json.dumps(self.manifest).encode()
        (self.build/'version.json').write_bytes(raw);(self.served/'version.json').write_bytes(raw);self.http['version.json']=raw
        with self.assertRaisesRegex(ValueError,"site's POS asset directory"):self.capture()
        self.assertFalse(any('external.invalid' in url for url in self.urls))

    def test_http_client_rejects_redirected_origin_and_requests_fresh_bytes(self):
        response=unittest.mock.MagicMock();response.__enter__.return_value=response
        response.status=200;response.geturl.return_value='https://external.invalid/assets/posawesome/dist/js/version.json'
        with patch('release_identity.urllib.request.urlopen',return_value=response) as request:
            with self.assertRaisesRegex(ValueError,'origin/path'):
                _http_asset('https://cert-test.lab.xoloitzcuintles.com/assets/posawesome/dist/js/version.json')
        self.assertEqual(request.call_args.args[0].get_header('Cache-control'),'no-cache')


if __name__=='__main__':unittest.main()
