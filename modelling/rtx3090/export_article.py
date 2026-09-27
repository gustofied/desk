"""Export the article figures and daily series from the executed research outputs."""
from pathlib import Path
import json
import os

ROOT = Path(__file__).resolve().parent
os.environ.setdefault('MPLCONFIGDIR', str(ROOT / '.cache' / 'matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
from charts import article_price_figure, article_breadth_figure

# Embed chart lettering so browsers retain the Matplotlib typeface.
matplotlib.rcParams['svg.fonttype'] = 'path'

OUT = ROOT / 'outputs' / 'daily'
PUBLIC = ROOT / 'outputs' / 'publication'


def dated(name):
    frame = pd.read_csv(OUT / name, index_col=0)
    frame.index = pd.to_datetime(frame.index, utc=True)
    return frame


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)
    summary = json.loads((OUT / 'summary.json').read_text())
    model = dated('daily_baseline.csv')
    breadth = dated('host_breadth.csv')
    hosts = pd.read_csv(OUT / 'host_reference_audit.csv')
    hosts['day'] = pd.to_datetime(hosts.day, utc=True)
    hosts['doubled'] = hosts.log_relative.gt(np.log(2))
    doubling = hosts.groupby('day').agg(doubled_hosts=('doubled', 'sum'),
                                       eligible_hosts=('host_id', 'size'))
    if not doubling.eligible_hosts.equals(breadth.reference_hosts):
        raise ValueError('Seller populations differ between breadth calculations')
    breadth['doubled_hosts'] = doubling.doubled_hosts
    breadth['doubled_share'] = doubling.doubled_hosts / doubling.eligible_hosts
    for compact in [False, True]:
        suffix = '-mobile' if compact else ''
        figures = {
            'price-baseline': article_price_figure(model, compact=compact),
            'seller-breadth': article_breadth_figure(breadth, compact=compact),
        }
        for name, fig in figures.items():
            for extension in ['svg', 'png']:
                target = PUBLIC / f'{name}{suffix}.{extension}'
                fig.savefig(target, dpi=170,
                            bbox_inches='tight', pad_inches=.06, transparent=True)
                if extension == 'svg':
                    target.write_text('\n'.join(line.rstrip() for line in target.read_text().splitlines()) + '\n')
            plt.close(fig)
    series = model[['observed', 'baseline', 'lower', 'upper', 'deviation_pct',
                    'matched_machines', 'matched_hosts']].copy()
    series = series.rename(columns={'observed': 'price_index'})
    series = series.join(breadth[['reference_hosts', 'above_hosts', 'below_hosts', 'doubled_hosts']])
    series.index = series.index.strftime('%Y-%m-%d')
    series.index.name = 'date'
    series.to_csv(PUBLIC / 'daily-prices.csv')
    # A local script also works in file previews, without a fetch request.
    rows = json.loads(series.reset_index().to_json(orient='records', double_precision=15))
    (PUBLIC / 'story-data.js').write_text(
        '// Generated from the executed notebook outputs by export_article.py.\n'
        'window.gpuPriceStudy = ' + json.dumps({'rows': rows}, allow_nan=False,
                                              separators=(',', ':')) + ';\n')
    metadata = {
        'source': 'https://huggingface.co/datasets/MarcusLammers/vast-rtx3090-market-6mo',
        'source_license': 'CC BY 4.0',
        'input_sha256': summary['input_sha256'],
        'period': [summary['first_day'], summary['last_day']],
        'index_base': 'April 30, 2026 = 100',
        'measurement': 'Matched posted rental quotes',
        'parameters': summary['parameters'],
    }
    (PUBLIC / 'summary.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(f'Article assets written to {PUBLIC}')


if __name__ == '__main__':
    main()
