import hashlib
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock

from native_loop.screenshots import seal_attachments, record_integrity

loader=importlib.machinery.SourceFileLoader('test_xctest_publisher',str(Path(__file__).with_name('pr-screenshots')))
spec=importlib.util.spec_from_loader(loader.name,loader)
publisher=importlib.util.module_from_spec(spec)
loader.exec_module(publisher)
TEST='ArcadiaMobileUITests/FixtureTests/testCapture'
NAME='Current app window'

class XCTestPublication(unittest.TestCase):
    def fixture(self, root, stage='after'):
        directory=root/'artifacts'/('test-'+stage);directory.mkdir(parents=True)
        source=root/'source';source.mkdir(exist_ok=True)
        raw=io.BytesIO()
        with tarfile.open(fileobj=raw,mode='w:gz') as archive:
            for name,data in [('Arcadia/Arcadia/View.swift',stage.encode()),('Arcadia/Arcadia.xcodeproj/project.pbxproj',b'project')]:
                item=tarfile.TarInfo(name);item.size=len(data);item.mode=0o644;archive.addfile(item,io.BytesIO(data))
        sha=hashlib.sha256(raw.getvalue()).hexdigest();(source/('source-'+sha+'.tgz')).write_bytes(raw.getvalue())
        task_path=root/'manifest.json'
        task=json.loads(task_path.read_text()) if task_path.exists() else {'owner':'arcadia-native-loop-v1','runs':[]}
        task['runs'].append({'id':directory.name,'operation':'test','status':'passed','platform':'duo','source_sha256':sha})
        task_path.write_text(json.dumps(task))
        (directory/'verification.json').write_text(json.dumps({'verified':True,'source_sha256':sha,'results':[{'identifier':TEST,'result':'Passed'}]}))
        (directory/'source-integrity.json').write_text(json.dumps({'source_sha256':sha,'unchanged_after_test':True}))
        attachments=directory/'tests-attachments';attachments.mkdir()
        (attachments/'app.png').write_bytes(b'\x89PNG\r\n\x1a\n'+stage.encode())
        (attachments/'manifest.json').write_text(json.dumps([{'testIdentifier':'FixtureTests/testCapture','attachments':[{'exportedFileName':'app.png','suggestedHumanReadableName':NAME+'_1','isAssociatedWithFailure':False}]}]))
        seal_attachments(directory)
        return directory

    def update(self,path,**fields):
        data=json.loads(path.read_text());data.update(fields);path.write_text(json.dumps(data))

    def test_successful_sealed_test_image_retains_native_source_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root)
            data,record=publisher.read_xctest_capture('duo',directory,TEST,NAME)
            self.assertEqual(data,(directory/'tests-attachments/app.png').read_bytes())
            self.assertEqual(record['run_id'],directory.name)
            self.assertEqual(record['capture_method'],'xctest-app-window')
            self.assertEqual(record['test_identifier'],TEST)
            self.assertEqual(record['sha256'],hashlib.sha256(data).hexdigest())

    def test_edited_image_is_rejected_and_cannot_be_resealed(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=self.fixture(Path(tmp));proof=(directory/'verification.json').read_bytes()
            with (directory/'tests-attachments/app.png').open('ab') as stream:stream.write(b'tampered')
            with self.assertRaisesRegex(ValueError,'guest seal'):publisher.read_xctest_capture('duo',directory,TEST,NAME)
            with self.assertRaisesRegex(ValueError,'Previously sealed'):seal_attachments(directory)
            self.assertEqual((directory/'verification.json').read_bytes(),proof)

    def test_missing_seal_or_changed_attachment_manifest_is_rejected(self):
        for mode in ['missing','changed']:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                directory=self.fixture(Path(tmp))
                if mode=='missing':self.update(directory/'verification.json',attachment_manifest_sha256=None)
                else:(directory/'tests-attachments/manifest.json').write_text('[]')
                with self.assertRaisesRegex(ValueError,'manifest changed'):publisher.read_xctest_capture('duo',directory,TEST,NAME)

    def test_skipped_failed_or_different_test_does_not_supply_evidence(self):
        for result in ['Skipped','Failed','OtherTest']:
            with self.subTest(result=result),tempfile.TemporaryDirectory() as tmp:
                directory=self.fixture(Path(tmp))
                self.update(directory/'verification.json',results=[{'identifier':TEST if result!='OtherTest' else 'Other/test','result':result if result!='OtherTest' else 'Passed'}])
                with self.assertRaisesRegex(ValueError,'did not pass'):publisher.read_xctest_capture('duo',directory,TEST,NAME)

    def test_platform_failure_and_source_mismatch_are_rejected(self):
        for mode in ['platform','failed','source','integrity','archive']:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);directory=self.fixture(root)
                if mode in ['platform','failed']:
                    data=json.loads((root/'manifest.json').read_text());data['runs'][0]['platform' if mode=='platform' else 'status']='iphone' if mode=='platform' else 'failed';(root/'manifest.json').write_text(json.dumps(data))
                elif mode=='source':self.update(directory/'verification.json',source_sha256='0'*64)
                elif mode=='integrity':self.update(directory/'source-integrity.json',unchanged_after_test=False)
                else:
                    with next((root/'source').glob('*.tgz')).open('ab') as stream:stream.write(b'changed archive')
                with self.assertRaises(ValueError):publisher.read_xctest_capture('duo',directory,TEST,NAME)

    def test_source_integrity_detects_changes_to_the_tested_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root)
            workspace=root/'workspace'
            archive=next((root/'source').glob('*.tgz'))
            with tarfile.open(archive) as bundle:bundle.extractall(workspace)
            output=root/'integrity.json'
            record_integrity(workspace,archive,output)
            self.assertTrue(json.loads(output.read_text())['unchanged_after_test'])
            (workspace/'Arcadia/Arcadia/View.swift').write_text('changed during test')
            with self.assertRaisesRegex(ValueError,'changed pinned'):record_integrity(workspace,archive,output)
            self.assertFalse(json.loads(output.read_text())['unchanged_after_test'])

    def test_public_cli_rejects_missing_source_digest_with_a_clear_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root)
            task=json.loads((root/'manifest.json').read_text());task['runs'][0]['source_sha256']=None;(root/'manifest.json').write_text(json.dumps(task))
            self.update(directory/'verification.json',source_sha256=None)
            self.update(directory/'source-integrity.json',source_sha256=None)
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('pr-screenshots')),'--pr','42','--xctest-pair','duo',TEST,NAME,str(directory),str(directory),'--token-file',str(root/'must-not-read')],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('lacks source/run provenance',result.stdout)
            self.assertNotIn('Traceback',result.stderr)

    def test_public_cli_rejects_tampered_image_before_credentials_or_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=self.fixture(Path(tmp));(directory/'tests-attachments/app.png').write_bytes(b'tampered')
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('pr-screenshots')),'--pr','42','--xctest-pair','duo',TEST,NAME,str(directory),str(directory),'--token-file',str(Path(tmp)/'must-not-read')],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0);self.assertIn('guest seal',result.stdout)
            self.assertNotIn('FileNotFoundError',result.stdout)

    def test_verified_xctest_pair_uses_existing_upload_hash_and_render_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);before=self.fixture(root,'before');after=self.fixture(root,'after')
            client=publisher.Publisher('token test-only');pr={'body':'Description','merge_base':'before','head':{'sha':'head','repo':{'full_name':'jj/arcadia'}},'user':{'login':'arcadia-pilot-bot'}}
            expected={stage:publisher.read_xctest_capture('duo',directory,TEST,NAME)[1] for stage,directory in [('before',before),('after',after)]}
            client.trusted_trees=lambda ref:{k:expected['before' if ref=='before' else 'after'][k] for k in ['app_tree_sha','project_sha']}
            assets=[];images={}
            def api(path,method='GET',data=None,content_type=None):
                if method=='POST':
                    index=len(assets)+1;asset={'id':index,'uuid':'00000000-0000-0000-0000-'+str(index).zfill(12),'name':path.split('?name=')[1]};assets.append(asset)
                    images['/attachments/'+asset['uuid']]=data.split(b'\r\n\r\n',1)[1].rsplit(b'\r\n--',1)[0];return asset
                if method=='PATCH':pr.update(data);return pr
                if '/commits?' in path:return []
                if path.endswith('/assets'):return assets
                return pr
            def download(path):
                if path.startswith('/attachments/'):return images[path]
                manifest=json.loads(pr['body'].split('<!-- arcadia-visual-evidence:v1\n')[1].split('\n-->')[0])
                return ''.join(f'<img alt="duo {stage}" src="{pair[stage]["url"]}">' for pair in manifest['pairs'] for stage in ['before','after']).encode()
            client.api=Mock(side_effect=api);client.download=download
            result=client.publish(42,[('duo',before,after)],xctest_selectors={'duo':(TEST,NAME)})
            self.assertEqual(len(assets),2);self.assertEqual(result['pairs'][0]['after']['capture_method'],'xctest-app-window')
            self.assertIn('![duo before]',pr['body']);self.assertIn('![duo after]',pr['body'])

if __name__=='__main__':unittest.main()
