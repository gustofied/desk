"""Execute the model notebook and export a compact preview with expandable code."""
from pathlib import Path
import os,sys,json

ROOT=Path(__file__).resolve().parent
for key,folder in {'MPLCONFIGDIR':'matplotlib','JUPYTER_CONFIG_DIR':'jupyter-config',
                   'JUPYTER_RUNTIME_DIR':'jupyter-runtime','IPYTHONDIR':'ipython',
                   'JUPYTER_PATH':'jupyter'}.items():
    os.environ[key]=str(ROOT/'.cache'/folder)
os.environ['OPENBLAS_NUM_THREADS']='2'
os.environ['OMP_NUM_THREADS']='2'
import nbformat
from nbclient import NotebookClient
from nbconvert import HTMLExporter
from bs4 import BeautifulSoup

kernel=ROOT/'.cache/jupyter/kernels/rtx3090'
kernel.mkdir(parents=True,exist_ok=True)
(kernel/'kernel.json').write_text(json.dumps({'argv':[sys.executable,'-m','ipykernel_launcher','-f','{connection_file}'],
    'display_name':'RTX 3090 market study','language':'python'}))
cells=[]
for chunk in (ROOT/'price_model.py').read_text().split('# %%'):
    if not chunk.strip():continue
    if chunk.startswith(' [markdown]'):
        content='\n'.join(line[2:] if line.startswith('# ') else '' if line=='#' else line
            for line in chunk.splitlines()[1:]).strip()
        cells.append(nbformat.v4.new_markdown_cell(content))
    else:
        cells.append(nbformat.v4.new_code_cell(chunk.strip()))
nb=nbformat.v4.new_notebook(cells=cells,metadata={'kernelspec':{
    'name':'rtx3090','display_name':'RTX 3090 market study','language':'python'}})
client=NotebookClient(nb,timeout=600,kernel_name='rtx3090',resources={'metadata':{'path':str(ROOT)}},
    on_cell_start=lambda cell_index,**kwargs:print(f'Executing {cell_index+1}/{len(cells)}',flush=True))
try:
    client.execute()
finally:
    nbformat.write(nb,ROOT/'price_model.ipynb')
fragment,_=HTMLExporter(template_name='basic').from_notebook_node(nb)
soup=BeautifulSoup(fragment,'html.parser')
for item in soup.select('.prompt,.anchor-link'):item.decompose()
for n,item in enumerate(soup.select('.input'),start=1):
    wrapper=soup.new_tag('details',attrs={'class':'code-cell'})
    title=soup.new_tag('summary');title.string=f'Code {n:02d}'
    item.wrap(wrapper);wrapper.insert(0,title)
for table in soup.find_all('table'):
    table.wrap(soup.new_tag('div',attrs={'class':'table-wrap'}))
images=soup.find_all('img')
assert len(images)==2,f'Expected two charts; got {len(images)}'
for img,alt in zip(images,['RTX 3090 price index and historical baseline, percentage departures, host repricing and daily matching coverage from February through August. The index peaks at 240 on May 30.',
    'Lower, median and upper price changes relative to each configuration’s April price. Lower and upper components have historical baselines; the median has an April reference only. The three panels use different linear scales. A fourth panel shows cohort coverage and capped searches.']):
    img['alt']=alt
style="""
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#ffffff;color:#222222;
font:17px/1.65 Georgia,serif}main{max-width:1040px;margin:0 auto;padding:52px 36px 90px}
h1,h2{font-weight:normal;line-height:1.15;letter-spacing:-.025em}h1{font-size:44px;margin:16px 0}
h2{font-size:29px;margin:44px 0 18px}p{max-width:850px}a{color:inherit;text-underline-offset:3px}
nav,summary,.footer{font:12px/1.6 ui-monospace,monospace;color:#666666}nav{margin-bottom:28px}
img{width:100%;height:auto;display:block;margin:12px 0}.code-cell{margin:16px 0;padding:9px 0;
border-top:1px solid #4b273822}summary{cursor:pointer}pre{overflow:auto;padding:16px;background:#4b273808;
font:12px/1.6 ui-monospace,monospace}code{font-size:.86em}.table-wrap{overflow-x:auto;margin:16px 0}
table{border-collapse:collapse;font:13px/1.6 ui-monospace,monospace;min-width:560px}
td,th{padding:10px 14px;border-bottom:1px solid #4b273822;text-align:right}td:first-child,th:first-child{text-align:left}
th{font-weight:500;color:#666666}.output_subarea{max-width:100%;overflow-x:auto}li{margin:10px 0}
.footer{border-top:1px solid #4b273822;padding-top:20px;margin-top:40px}
@media(max-width:600px){main{padding:24px 18px 50px}h1{font-size:35px}h2{font-size:25px}body{font-size:16px}}
"""
html='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GPU repricing: concentrated or widespread?</title><style>'''+style+'''</style>
<script>window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']]}};</script>
<script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script></head><body><main>
<nav><a href="price_model.ipynb">Jupyter notebook</a> / <a href="price_model.py">Editable source</a></nav>
'''+str(soup)+'''<p class="footer">Executed notebook preview. Expand the code cells to inspect the calculations.</p>
</main></body></html>'''
(ROOT/'price_model.html').write_text(html)
print('Wrote price_model.ipynb and price_model.html',flush=True)
