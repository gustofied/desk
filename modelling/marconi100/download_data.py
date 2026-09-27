"""Download two public rack archives, verify publisher MD5, extract regular Parquet files."""
from pathlib import Path
import hashlib
import json
import shutil
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)
manifest = json.loads((ROOT / 'source-manifest.json').read_text())
for rack in (0, 5):
    item = next(f for f in manifest['files'] if f['key'] == f'{rack}.tar')
    archive = DATA / item['key']
    if not archive.exists():
        temporary = archive.with_suffix('.part')
        print('Downloading', item['links']['self'], flush=True)
        with urllib.request.urlopen(item['links']['self'], timeout=120) as src, temporary.open('wb') as dst:
            shutil.copyfileobj(src, dst)
        temporary.rename(archive)
    digest = hashlib.file_digest(archive.open('rb'), 'md5').hexdigest()
    assert 'md5:' + digest == item['checksum'], f'Checksum mismatch: {archive}'
    with tarfile.open(archive) as tar:
        for member in tar:
            if member.isfile() and member.name.endswith('.parquet'):
                destination = DATA / Path(member.name).name
                with tar.extractfile(member) as src, destination.open('wb') as dst:
                    shutil.copyfileobj(src, dst)
    print('Verified and extracted rack', rack, flush=True)
