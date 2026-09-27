from pathlib import Path
import os,json
ROOT=Path(__file__).resolve().parent
os.environ['MPLCONFIGDIR']=str(ROOT/'.cache')
import pandas as pd,numpy as np,pyarrow as pa
pa.set_cpu_count(2);pa.set_io_thread_count(2)
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
OUT=ROOT/'results';OUT.mkdir(exist_ok=True)
s=pd.read_parquet(ROOT/'data/snapshots.parquet');m=pd.read_parquet(ROOT/'data/snapshot_meta.parquet')
print('loaded',s.shape,flush=True)
assert not s.duplicated(['snapshot_id','ask_id']).any()
s['month']=s.timestamp.dt.year*100+s.timestamp.dt.month
monthly=s.groupby('month').price_usd_hour.agg(['median','count']);monthly.to_csv(OUT/'monthly.csv')
print(monthly,flush=True)
scans=s.groupby('snapshot_id').agg(timestamp=('timestamp','first'),rows=('ask_id','size'),median=('price_usd_hour','median'),machines=('machine_id','nunique')).sort_values('timestamp').reset_index()
scans['scan']=np.arange(len(scans));scans['gap_sec']=scans.timestamp.diff().dt.total_seconds()
meta=m[['snapshot_id','status','logger_version']].drop_duplicates('snapshot_id')
scans=scans.merge(meta,on='snapshot_id',how='left',validate='one_to_one')
s=s.merge(scans[['snapshot_id','scan']],on='snapshot_id',validate='many_to_one')
# Same ask_id within successive observed snapshots, never infer transactions.
prev=s[['scan','ask_id','price_usd_hour']].copy();prev['scan']+=1
matched=s[['scan','ask_id','price_usd_hour']].merge(prev,on=['scan','ask_id'],suffixes=('_now','_before'),validate='one_to_one')
matched['changed']=~np.isclose(matched.price_usd_hour_now,matched.price_usd_hour_before,atol=1e-9,rtol=0)
paired=matched.groupby('scan').agg(common=('ask_id','size'),repriced=('changed','sum'),common_now=('price_usd_hour_now','median'),common_before=('price_usd_hour_before','median'))
scans=scans.join(paired,on='scan')
scans['median_before']=scans['median'].shift()
scans['median_change_pct']=100*(scans['median']/scans.median_before-1)
scans['common_median_change']=scans.common_now-scans.common_before
scans['composition_remainder']=scans['median']-scans.median_before-scans.common_median_change
scans['eligible']=(scans.gap_sec.between(300,900)&scans.status.eq('ok')&scans.status.shift().eq('ok')&scans.logger_version.eq(scans.logger_version.shift())&scans.common.ge(32))
scans.to_csv(OUT/'scan_metrics.csv',index=False)
candidates=scans[scans.eligible&scans.repriced.eq(0)&scans.median_change_pct.ge(15)].sort_values('median_change_pct',ascending=False)
candidates.to_csv(OUT/'composition_candidates.csv',index=False)
print('candidates',candidates[['timestamp','rows','common','repriced','median_before','median','median_change_pct']].head().to_string(index=False),flush=True)
summary={'rows':len(s),'scans':len(scans),'machines':s.machine_id.nunique(),'scan_rows_median':float(scans.rows.median()),'scan_rows_max':int(scans.rows.max()),'fraction_scans_64_rows':float(scans.rows.eq(64).mean()),'missing_scan_metadata':int(scans.status.isna().sum()),'meta_status':m.status.value_counts().to_dict(),'logger_versions':m.logger_version.value_counts().to_dict(),'same_scan_machine_duplicates':int(s.duplicated(['snapshot_id','machine_id']).sum()),'composition_candidates':len(candidates),'eligible_pairs':int(scans.eligible.sum())}
if len(candidates):
 e=candidates.iloc[0];k=int(e.scan)
 pair=s[s.scan.isin([k-1,k])].copy()
 common=set(pair[pair.scan==k-1].ask_id)&set(pair[pair.scan==k].ask_id)
 pair['membership']=np.where(pair.ask_id.isin(common),'Present in both',np.where(pair.scan==k,'Entering view','Leaving view'))
 pair.to_csv(OUT/'example_offer_rows.csv',index=False)
 # Check matched-offer specification stability; price identity alone does not guarantee identical terms.
 props=['machine_id','host_id','verified','cpu_cores','cpu_ram','gpu_ram','geo_country','geo_region','disk_space']
 a=pair[(pair.scan==k-1)&pair.ask_id.isin(common)].set_index('ask_id')[props].sort_index()
 b=pair[(pair.scan==k)&pair.ask_id.isin(common)].set_index('ask_id')[props].sort_index()
 same=(a.eq(b)|(a.isna()&b.isna())).all(axis=1)
 summary['example']={'timestamp':str(e.timestamp),'gap_sec':float(e.gap_sec),'before_median':float(e.median_before),'after_median':float(e['median']),'change_pct':float(e.median_change_pct),'common':int(e.common),'repriced':int(e.repriced),'common_with_changed_specs':int((~same).sum()),'before_count':len(pair[pair.scan==k-1]),'after_count':len(pair[pair.scan==k])}
 fig,axes=plt.subplots(1,2,figsize=(11,4),sharey=True)
 colors={'Present in both':'#547a80','Entering view':'#bd7735','Leaving view':'#a84837'}
 for ax,n,title in zip(axes,[k-1,k],['Before','Ten minutes later']):
  q=pair[pair.scan==n].sort_values('price_usd_hour').reset_index(drop=True)
  for label,c in colors.items():
   z=q[q.membership==label];ax.scatter(z.index+1,z.price_usd_hour,c=c,label=label,s=22)
  med=q.price_usd_hour.median();ax.axhline(med,color='#333',ls='--',lw=1);ax.set(title=f'{title}: median ${med:.4f}/h',xlabel='Offer price rank (our sorting)')
  ax.spines[['top','right']].set_visible(False)
 axes[0].set_ylabel('Listed offer price, USD/hour');axes[1].legend(fontsize=8)
 fig.suptitle(f'Visible median moves; {len(common)} continuing offers keep the same price\n{e.timestamp} — no rental inference',fontsize=11)
 plt.tight_layout();fig.savefig(OUT/'composition_example.png',dpi=160);plt.close(fig)
(OUT/'summary.json').write_text(json.dumps(summary,indent=2,default=int))
print(json.dumps(summary,indent=2,default=int),flush=True)
