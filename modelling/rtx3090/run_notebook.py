"""Execute the editable percent-format notebook and export a self-contained HTML."""
from pathlib import Path
import json
import os
import sys
import base64

ROOT = Path(__file__).resolve().parent
source = sys.argv[1] if len(sys.argv)>1 else 'study.py'
stem = sys.argv[2] if len(sys.argv)>2 else 'rtx3090_market'
for key, folder in {'MPLCONFIGDIR':'matplotlib', 'JUPYTER_CONFIG_DIR':'jupyter-config',
                    'JUPYTER_RUNTIME_DIR':'jupyter-runtime', 'IPYTHONDIR':'ipython',
                    'JUPYTER_PATH':'jupyter'}.items():
    os.environ[key] = str(ROOT / '.cache' / folder)
os.environ['OPENBLAS_NUM_THREADS'] = '2'
os.environ['OMP_NUM_THREADS'] = '2'
import nbformat
from nbclient import NotebookClient
from nbconvert import HTMLExporter
from bs4 import BeautifulSoup

kernel = ROOT / '.cache/jupyter/kernels/rtx3090'
kernel.mkdir(parents=True, exist_ok=True)
(kernel/'kernel.json').write_text(json.dumps({'argv':[sys.executable,'-m','ipykernel_launcher','-f','{connection_file}'],
                                           'display_name':'RTX 3090 market study','language':'python'}))
cells=[]
for chunk in (ROOT/source).read_text().split('# %%'):
    if not chunk.strip():
        continue
    if chunk.startswith(' [markdown]'):
        content='\n'.join(line[2:] if line.startswith('# ') else '' if line=='#' else line
                          for line in chunk.splitlines()[1:]).strip()
        cells.append(nbformat.v4.new_markdown_cell(content))
    else:
        cells.append(nbformat.v4.new_code_cell(chunk.strip()))
nb=nbformat.v4.new_notebook(cells=cells,metadata={'kernelspec':{'name':'rtx3090','display_name':'RTX 3090 market study','language':'python'}})
path=ROOT/f'{stem}.ipynb'
def progress(cell_index, **kwargs):
    print(f'Executing cell {cell_index+1}/{len(cells)}', flush=True)
client=NotebookClient(nb,timeout=600,kernel_name='rtx3090',resources={'metadata':{'path':str(ROOT)}},on_cell_start=progress)
try:
    client.execute()
finally:
    nbformat.write(nb,path)
fragment,_=HTMLExporter(template_name='basic',exclude_input=True).from_notebook_node(nb)
soup=BeautifulSoup(fragment,'html.parser')
for item in soup.select('.prompt, .anchor-link'):
    item.decompose()
# Collapse the full audit in HTML; the notebook always retains it in reading order.
heading=soup.find('h2',string=lambda text: text and text.strip()=='Methodology and source audit')
if heading:
    first=heading.find_parent('div',class_='cell')
    details=soup.new_tag('details')
    title=soup.new_tag('summary');title.string='Methods, source and reproduction'
    details.append(title)
    first.insert_before(details)
    for cell in list(details.find_next_siblings()):
        details.append(cell.extract())
for t in soup.find_all('table'):
    wrap=soup.new_tag('div',attrs={'class':'table-wrap'})
    t.wrap(wrap)
figures = soup.find_all('img')
assert len(figures) == 2, f'Expected two charts, found {len(figures)}'
for img, name in zip(figures, ['01_availability', '02_prices']):
    context=img.find_previous('h2')
    img['alt']='RTX 3090 market chart: '+(context.get_text(' ',strip=True) if context else 'availability and prices')+'. Values and definitions are discussed in adjacent text.'
    # Same two figures, re-typeset for narrow screens rather than shrunk or scrolled.
    picture=soup.new_tag('picture')
    mobile=soup.new_tag('source', attrs={'media':'(max-width:600px)',
        'srcset':'data:image/png;base64,'+base64.b64encode((ROOT/'outputs'/f'{name}_mobile.png').read_bytes()).decode()})
    img.wrap(picture)
    picture.insert(0,mobile)
    img['decoding']='async'
style=(ROOT/'report.css').read_text()
html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="The full February–August 2026 RTX 3090 history: availability at a fixed price and available versus matched asking-price indices on Vast.ai."><title>Available, at what price? — RTX 3090</title><style>'+style+'</style></head><body><a class="skip-link" href="#study">Skip to study</a><main id="study">'+str(soup)+'<footer>COMPUTE MARKETS / RTX 3090 · Reproducible study · 2026</footer></main></body></html>'
(ROOT/f'{stem}.html').write_text(html)
print(f'Executed {len(cells)} cells. Wrote notebook and HTML.',flush=True)
