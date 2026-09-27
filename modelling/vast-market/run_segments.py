"""Build, execute and render the notebook from the editable percent-format source."""
from pathlib import Path
import os, sys, json
ROOT=Path(__file__).resolve().parent
os.environ['MPLCONFIGDIR']=str(ROOT/'.cache'/'matplotlib')
os.environ['JUPYTER_CONFIG_DIR']=str(ROOT/'.cache'/'jupyter-config')
os.environ['JUPYTER_RUNTIME_DIR']=str(ROOT/'.cache'/'jupyter-runtime')
os.environ['IPYTHONDIR']=str(ROOT/'.cache'/'ipython')
os.environ['JUPYTER_PATH']=str(ROOT/'.cache'/'jupyter')
from nbclient import NotebookClient
import nbformat
from nbconvert import HTMLExporter
kernel=ROOT/'.cache'/'jupyter'/'kernels'/'vast-segments'
kernel.mkdir(parents=True,exist_ok=True)
(kernel/'kernel.json').write_text(json.dumps({'argv':[sys.executable,'-m','ipykernel_launcher','-f','{connection_file}'],'display_name':'Vast market segments','language':'python'}))
source=(ROOT/'segment_study.py').read_text()
cells=[]
for chunk in source.split('# %%'):
    if not chunk.strip(): continue
    if chunk.startswith(' [markdown]'):
        text='\n'.join(line[2:] if line.startswith('# ') else '' if line=='#' else line for line in chunk.splitlines()[1:]).strip()
        cells.append(nbformat.v4.new_markdown_cell(text))
    else: cells.append(nbformat.v4.new_code_cell(chunk.strip()))
nb=nbformat.v4.new_notebook(cells=cells,metadata={'kernelspec':{'name':'vast-segments','display_name':'Vast market segments','language':'python'}})
path=ROOT/'market_segments.ipynb'
nbformat.write(nb,path)
client=NotebookClient(nb,timeout=600,kernel_name='vast-segments',resources={'metadata':{'path':str(ROOT)}})
try:
    client.execute()
finally:
    nbformat.write(nb,path)
body,_=HTMLExporter(template_name='lab').from_notebook_node(nb)
(ROOT/'market_segments.html').write_text(body)
print('Executed',len(cells),'cells; wrote notebook and HTML',flush=True)
