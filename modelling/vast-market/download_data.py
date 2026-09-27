"""Fetch the two inputs at the repository revision recorded by the initial inspection."""
from pathlib import Path
import json, urllib.request, shutil, hashlib
ROOT=Path(__file__).resolve().parent
revision=json.loads((ROOT/'source-manifest.json').read_text())['sha']
base=f'https://huggingface.co/datasets/MarcusLammers/vast-rtx3090-market-6mo/resolve/{revision}/data/'
data=ROOT/'data';data.mkdir(exist_ok=True)
for name in ['snapshots.parquet','snapshot_meta.parquet']:
    path=data/name
    if not path.exists():
        temp=path.with_suffix('.part')
        with urllib.request.urlopen(base+name,timeout=120) as src,temp.open('wb') as dst:shutil.copyfileobj(src,dst)
        temp.rename(path)
    with path.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
    print(name,digest)
