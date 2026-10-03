"""OCI artifact regression cases based on Docker's published storage format.

Synthetic blobs and mocked runtime; no actual VPS or provider calls.
"""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_recovery_continue import p, pack, oci_fixture

# Shape follows Docker's attestation-storage example, including empty config,
# subject, in-toto layer and unknown/unknown descriptor. Digests are recomputed
# for synthetic bytes; no real customer config or registry authentication.
def artifact_fixture(mode='empty', *, inline_only=False, artifact_type=True, include_image=True):
    entries, image_ids = oci_fixture()
    def put(value, media):
        raw = value if isinstance(value, bytes) else json.dumps(value, separators=(',', ':')).encode()
        digest = p.sha(raw)
        entries['blobs/sha256/' + digest[7:]] = raw
        return {'mediaType': media, 'digest': digest, 'size': len(raw)}
    image_raw = entries['blobs/sha256/' + image_ids['manifest'][7:]]
    image = {'mediaType':'application/vnd.oci.image.manifest.v1+json',
             'digest':image_ids['manifest'], 'size':len(image_raw)}
    if mode == 'empty':
        cfg = put(b'{}', 'application/vnd.oci.empty.v1+json')
        cfg['data'] = 'e30='
        if inline_only: del entries['blobs/sha256/' + cfg['digest'][7:]]
    elif mode == 'legacy':
        cfg = put({'os':'unknown','architecture':'unknown','config':{'Env':['SECRET=not-for-output']}},
                  'application/vnd.oci.image.config.v1+json')
    else:
        cfg = put(b'\x00opaque-binary-not-json\xff', 'application/vnd.example.binary')
    payload = put(b'{"predicate":{"build_arg":"NEVER_PRINT_THIS"}}', 'application/vnd.in-toto+json')
    manifest = {'schemaVersion':2, 'mediaType':'application/vnd.oci.image.manifest.v1+json',
                'config':cfg, 'layers':[payload], 'subject':image}
    if mode == 'empty' and artifact_type:
        manifest['artifactType']='application/vnd.docker.attestation.manifest.v1+json'
    att = put(manifest, 'application/vnd.oci.image.manifest.v1+json')
    att.update(platform={'architecture':'unknown','os':'unknown'}, annotations={
        'vnd.docker.reference.type':'attestation-manifest','vnd.docker.reference.digest':image_ids['manifest']})
    index = put({'schemaVersion':2,'manifests':([image] if include_image else [])+[att]},
                'application/vnd.oci.image.index.v1+json')
    entries['index.json'] = json.dumps({'schemaVersion':2,'manifests':[index]}).encode()
    return entries, {**image_ids, 'index':index['digest'], 'artifact':att['digest'],
                     'artifact_config':cfg['digest'], 'artifact_layer':payload['digest']}, put


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.image = self.dir / 'image.tar'
    def tearDown(self): self.tmp.cleanup()
    def verify(self, entries, ids):
        pack(self.image, entries)
        return p.verify_image_archive(self.image, ids['index'])

    def test_buildkit_empty_config_artifact_not_a_second_image(self):
        entries, ids, _ = artifact_fixture()
        out = self.verify(entries, ids)
        self.assertEqual(out['linked_manifests_verified'],1)
        self.assertEqual(out['artifact_manifests_verified'],1)
        self.assertEqual(out['empty_configs_verified'],1)
        self.assertEqual(out['layer_descriptor_hashes_verified'],2)
        self.assertFalse(out['application_boot_tested'])
        self.assertFalse(out['artifact_semantics_verified'])

    def test_inline_empty_config_accepted_only_at_canonical_hash(self):
        entries, ids, _ = artifact_fixture(inline_only=True)
        self.assertEqual(self.verify(entries,ids)['empty_configs_verified'],1)

    def test_inline_data_never_hides_present_corrupt_blob(self):
        entries, ids, _ = artifact_fixture()
        entries['blobs/sha256/'+ids['artifact_config'][7:]] = b'[]'
        with self.assertRaisesRegex(p.Blocked,'oci_blob_digest_mismatch'): self.verify(entries,ids)

    def test_empty_config_requires_artifact_type(self):
        entries, ids, _ = artifact_fixture(artifact_type=False)
        with self.assertRaisesRegex(p.Blocked,'empty_config_requires_artifact_type'): self.verify(entries,ids)

    def test_legacy_attestation_dummy_config_is_not_runnable(self):
        entries, ids, _ = artifact_fixture('legacy')
        out = self.verify(entries,ids)
        self.assertEqual(out['linked_manifests_verified'],1)
        self.assertEqual(out['artifact_manifests_verified'],1)
        self.assertNotIn('not-for-output',json.dumps(out))

    def test_opaque_binary_config_verified_without_json_parsing(self):
        entries, ids, _ = artifact_fixture('opaque')
        out = self.verify(entries,ids)
        self.assertEqual(out['opaque_configs_verified'],1)
        self.assertEqual(out['linked_manifests_verified'],1)

    def test_artifact_only_archive_cannot_establish_image_identity(self):
        entries, ids, _ = artifact_fixture(include_image=False)
        with self.assertRaisesRegex(p.Blocked,'saved_image_identity_mismatch'): self.verify(entries,ids)

    def test_artifact_manifest_digest_cannot_be_api_image(self):
        entries, ids, _ = artifact_fixture(); pack(self.image,entries)
        with self.assertRaisesRegex(p.Blocked,'saved_image_identity_mismatch'):
            p.verify_image_archive(self.image,ids['artifact'])

    def test_empty_config_digest_cannot_be_api_image(self):
        entries, ids, _ = artifact_fixture(); pack(self.image,entries)
        with self.assertRaisesRegex(p.Blocked,'saved_image_identity_mismatch'):
            p.verify_image_archive(self.image,ids['artifact_config'])

    def test_legacy_attestation_config_cannot_be_api_image(self):
        entries, ids, _ = artifact_fixture('legacy'); pack(self.image,entries)
        with self.assertRaisesRegex(p.Blocked,'saved_image_identity_mismatch'):
            p.verify_image_archive(self.image,ids['artifact_config'])

    def test_artifact_only_subindex_does_not_borrow_sibling_image(self):
        entries, ids, put = artifact_fixture(include_image=False)
        artifact_index = {'mediaType':'application/vnd.oci.image.index.v1+json','digest':ids['index'],
                          'size':len(entries['blobs/sha256/'+ids['index'][7:]])}
        main = {'mediaType':'application/vnd.oci.image.manifest.v1+json','digest':ids['manifest'],
                'size':len(entries['blobs/sha256/'+ids['manifest'][7:]])}
        entries['index.json']=json.dumps({'schemaVersion':2,'manifests':[main,artifact_index]}).encode()
        with self.assertRaisesRegex(p.Blocked,'saved_image_identity_mismatch'): self.verify(entries,ids)

    def test_corrupt_attestation_layer_rejected_not_skipped(self):
        entries, ids, _ = artifact_fixture()
        key='blobs/sha256/'+ids['artifact_layer'][7:]
        entries[key]=b'x'*len(entries[key])
        with self.assertRaisesRegex(p.Blocked,'oci_blob_digest_mismatch'): self.verify(entries,ids)

    def test_missing_attestation_layer_rejected(self):
        entries, ids, _ = artifact_fixture()
        del entries['blobs/sha256/'+ids['artifact_layer'][7:]]
        with self.assertRaisesRegex(p.Blocked,'oci_blob_missing_or_wrong_size'): self.verify(entries,ids)

    def test_failure_diagnostics_never_echo_config_or_payload(self):
        entries, ids, _ = artifact_fixture('legacy')
        del entries['blobs/sha256/'+ids['artifact_layer'][7:]]
        with self.assertRaises(p.Blocked) as raised: self.verify(entries,ids)
        text=json.dumps(raised.exception.diagnostics)
        self.assertIn('layer_descriptors',text)
        self.assertNotIn('SECRET',text); self.assertNotIn('NEVER_PRINT',text)
        self.assertNotIn('not-for-output',text)
        self.assertTrue(all(isinstance(v,(str,int,bool)) for v in raised.exception.diagnostics.values()))

    def test_wrong_size_duplicate_reference_rejected(self):
        entries, ids = oci_fixture()
        root=json.loads(entries['index.json']); dupe=copy.deepcopy(root['manifests'][0]); dupe['size']+=1
        root['manifests'].append(dupe); entries['index.json']=json.dumps(root).encode()
        with self.assertRaisesRegex(p.Blocked,'oci_blob_missing_or_wrong_size'): self.verify(entries,ids)

    def test_runnable_config_must_describe_rootfs(self):
        entries, ids, put = artifact_fixture()
        config=put({'os':'linux','architecture':'amd64'},'application/vnd.oci.image.config.v1+json')
        main=put({'schemaVersion':2,'config':config,'layers':[]},'application/vnd.oci.image.manifest.v1+json')
        root=put({'schemaVersion':2,'manifests':[main]},'application/vnd.oci.image.index.v1+json')
        entries['index.json']=json.dumps({'schemaVersion':2,'manifests':[root]}).encode()
        with self.assertRaisesRegex(p.Blocked,'runnable_rootfs_invalid'): self.verify(entries,{**ids,'index':root['digest']})

    def test_unknown_platform_is_not_runnable(self):
        entries, ids, put=artifact_fixture()
        config=put({'os':'unknown','architecture':'unknown','rootfs':{'type':'layers','diff_ids':[]}},'application/vnd.oci.image.config.v1+json')
        main=put({'schemaVersion':2,'config':config,'layers':[]},'application/vnd.oci.image.manifest.v1+json')
        entries['index.json']=json.dumps({'schemaVersion':2,'manifests':[main]}).encode()
        with self.assertRaisesRegex(p.Blocked,'runnable_platform_missing'): self.verify(entries,{**ids,'index':main['digest']})

    def test_empty_inline_value_must_match_digest(self):
        entries, ids, put=artifact_fixture()
        artifact=json.loads(entries['blobs/sha256/'+ids['artifact'][7:]])
        artifact['config']['data']='W10='
        att=put(artifact,'application/vnd.oci.image.manifest.v1+json')
        entries['index.json']=json.dumps({'schemaVersion':2,'manifests':[att]}).encode()
        with self.assertRaisesRegex(p.Blocked,'invalid_empty_oci_inline_data'): self.verify(entries,ids)

    def test_nonempty_body_cannot_use_empty_config_media_type(self):
        entries, ids, put=artifact_fixture()
        artifact=json.loads(entries['blobs/sha256/'+ids['artifact'][7:]])
        artifact['config']=put(b'{"unexpected":1}','application/vnd.oci.empty.v1+json')
        att=put(artifact,'application/vnd.oci.image.manifest.v1+json')
        entries['index.json']=json.dumps({'schemaVersion':2,'manifests':[att]}).encode()
        with self.assertRaisesRegex(p.Blocked,'invalid_empty_oci_config'): self.verify(entries,ids)

    def test_repeated_verification_does_not_rewrite_archive(self):
        entries,ids,_=artifact_fixture(); pack(self.image,entries)
        before=p.file_hash(self.image)
        p.verify_image_archive(self.image,ids['index']); p.verify_image_archive(self.image,ids['index'])
        self.assertEqual(before,p.file_hash(self.image))


    def _resume_artifact(self, corrupt=False):
        root=self.dir/'recovery'; root.mkdir(mode=0o700)
        directory=root/'20261003T031626Z-synthetic'; directory.mkdir(mode=0o700)
        work=self.dir/'work'; work.mkdir()
        for name in ['compose.yml','.env','Caddyfile']:
            (work/name).write_text('PRIVATE_VALUE_DO_NOT_RETURN')
        entries,ids,_=artifact_fixture()
        expected={**p.EXPECTED,'firbo-api':ids['index']}
        config={'Labels':{'com.docker.compose.project.working_dir':str(work),
                          'com.docker.compose.project':'firbo',
                          'com.docker.compose.project.config_files':str(work/'compose.yml')},
                'Env':['OMNIROUTE_API_KEY=PRIVATE_VALUE_DO_NOT_RETURN']}
        rows={name:{'name':'/'+name,'image':image,'running':True,'config':copy.deepcopy(config),
                    'mounts':[{'Type':'bind','Destination':'/etc/caddy/Caddyfile','Source':str(work/'Caddyfile')}]}
              for name,image in expected.items()}
        if corrupt:
            key='blobs/sha256/'+ids['artifact_layer'][7:]; entries[key]=b'x'*len(entries[key])
        pack(directory/'configuration.private.tar',p.configuration_snapshot(rows))
        pack(directory/'firbo-api-image.private.tar',entries)
        hashes={f.name:p.file_hash(f) for f in directory.iterdir()}
        with patch.object(p,'ROOT',root),patch.object(p,'EXPECTED',expected),patch.object(p,'read_runtime',return_value=rows),patch.object(p.subprocess,'run') as subprocess:
            report,code=p.continue_checkpoint(directory)
            subprocess.assert_not_called()
        self.assertNotIn('PRIVATE_VALUE_DO_NOT_RETURN',json.dumps(report))
        for name,digest in hashes.items(): self.assertEqual(digest,p.file_hash(directory/name))
        self.assertFalse(report['deployment_performed']); self.assertFalse(report['image_reexported'])
        return report,code

    def test_resume_with_artifact_validates_without_reexport(self):
        report,code=self._resume_artifact()
        self.assertEqual(code,0,report)
        self.assertEqual(report['status'],'verified_existing_checkpoint')
        self.assertEqual(report['image_verification']['artifact_manifests_verified'],1)

    def test_resume_failure_returns_redacted_diagnostics(self):
        report,code=self._resume_artifact(corrupt=True)
        self.assertEqual(code,1,report)
        self.assertEqual(report['error'],'oci_blob_digest_mismatch')
        self.assertEqual(report['image_diagnostics']['last_config_kind'],'empty')
        self.assertEqual(report['image_diagnostics']['stage'],'layer_descriptors')


if __name__ == '__main__': unittest.main()
