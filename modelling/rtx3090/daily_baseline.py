"""Daily matched quotes and an explicitly historical baseline.

The observed index is never clipped. Only the baseline's adaptation is bounded.
Reference bands are empirical monitoring envelopes, not probability guarantees.
"""
import numpy as np
import pandas as pd
from indices import MATCH_KEYS


def daily_quotes(segment,daily,minimum_observations=1):
    s=segment.copy()
    s['day']=s.timestamp.dt.floor('D')
    s=s[s.day.isin(daily.index[daily.usable])]
    s['configuration']=s.groupby(MATCH_KEYS,dropna=False,sort=True).ngroup()
    members=s[['configuration']+MATCH_KEYS].drop_duplicates()
    q=s.groupby(['configuration','day']).agg(price=('price_usd_hour','median'),
        observations=('scan','size'),first=('timestamp','min'),last=('timestamp','max')).reset_index()
    q['span_hours']=(q['last']-q['first']).dt.total_seconds()/3600
    return q[q.observations.ge(minimum_observations)].merge(members,on='configuration',validate='many_to_one')


def chain_daily(quotes,daily,base_day='2026-04-30',minimum_pairs=20,minimum_hosts=10):
    """Adjacent calendar days only. An invalid link breaks subsequent levels."""
    valid_days=daily.index[daily.usable]
    dates=pd.date_range(valid_days.min(),valid_days.max(),freq='D')
    prices=quotes.pivot(index='configuration',columns='day',values='price').reindex(columns=dates)
    obs=quotes.pivot(index='configuration',columns='day',values='observations').reindex(columns=dates)
    members=quotes[['configuration']+MATCH_KEYS].drop_duplicates().set_index('configuration')
    records,audit=[],[]
    for before,day in zip(dates[:-1],dates[1:]):
        p=prices[[before,day]].dropna().rename(columns={before:'previous_price',day:'price'}).join(members)
        p=p[~p.machine_id.duplicated(keep=False)].copy()
        p['previous_observations']=obs.loc[p.index,before]
        p['observations']=obs.loc[p.index,day]
        p['day'],p['previous_day']=day,before
        p['log_change']=np.log(p.price/p.previous_price)
        if not np.isfinite(p.log_change).all():raise ValueError('Invalid matched price ratio')
        host=p.groupby('host_id').log_change.mean()
        eligible=(len(p)>=minimum_pairs and len(host)>=minimum_hosts and
                  daily.loc[[before,day],'usable'].all())
        records.append(dict(day=day,matched_machines=len(p),matched_hosts=len(host),eligible=eligible,
            log_change=float(p.log_change.mean()) if eligible else np.nan,
            host_log_change=float(host.mean()) if eligible else np.nan,
            singleton_share=float(((p.observations==1)|(p.previous_observations==1)).mean()),
            host_up_share=float((host>np.log(1.01)).mean()),
            host_down_share=float((host<np.log(.99)).mean())))
        audit.append(p.reset_index())
    out=pd.DataFrame(records).set_index('day').reindex(dates).rename_axis('day')
    for source,target in [('log_change','matched_index'),('host_log_change','equal_host_index')]:
        changes=out[source].copy();changes.iloc[0]=0.
        log_level=changes.cumsum(skipna=False)
        base=log_level.loc[pd.Timestamp(base_day,tz='UTC')]
        if not np.isfinite(base):raise ValueError('Base day is not connected by valid daily links')
        out[target]=100*np.exp(log_level-base)
    return out,pd.concat(audit,ignore_index=True)


def level_path(index,half_life,update_cap=np.inf):
    """Predict from the prior state, score, THEN update. Never smooth backward."""
    if half_life<=0 or update_cap<=0:raise ValueError('Positive half-life and cap required')
    alpha=1-2**(-1/half_life)
    state=None;rows=[]
    for day,value in index.items():
        if pd.isna(value):
            rows.append(dict(day=day,baseline=np.nan,residual=np.nan));continue
        if not np.isfinite(value) or value<=0:raise ValueError('Index levels must be positive and finite')
        y=float(np.log(value))
        if state is None:state=y
        error=y-state
        rows.append(dict(day=day,baseline=np.exp(state),residual=error))
        state+=alpha*np.clip(error,-update_cap,update_cap)
    return pd.DataFrame(rows).set_index('day')


def fit_baseline(index,half_lives=(7,14,28),calibration_start='2026-03-01',
                 tuning_start='2026-04-01',evaluation_start='2026-05-01'):
    """Choose memory with April absolute errors; freeze parameters before May.

    March errors set the update cap. April's 95th percentile absolute error
    defines a symmetric log envelope. April both tunes and calibrates, so it is
    not an independent validation set. Evaluation remains retrospective.
    """
    start,tune,evaluate=[pd.Timestamp(v,tz='UTC') for v in
                         [calibration_start,tuning_start,evaluation_start]]
    past=index[index.index<evaluate]
    candidates=[]
    for h in half_lives:
        initial=level_path(past,h)
        train=initial.loc[(initial.index>=start)&(initial.index<tune),'residual'].dropna()
        if len(train)<20:raise ValueError('Need at least 20 calibration days')
        scale=1.482602218505602*np.median(abs(train-train.median()))
        cap=max(3*scale,float(np.quantile(abs(train),.95)))
        if cap<=0:raise ValueError('No historical variation to calibrate adaptation')
        fitted=level_path(past,h,cap)
        april=fitted.loc[(fitted.index>=tune)&(fitted.index<evaluate),'residual'].dropna()
        if len(april)<20:raise ValueError('Need at least 20 tuning days')
        width=float(np.quantile(abs(april),.95))
        if width<=0:raise ValueError('No residual variation to calibrate envelope')
        candidates.append(dict(half_life=h,alpha=1-2**(-1/h),update_cap=cap,
            scale=float(scale),width=width,april_mae_log=float(abs(april).mean()),
            calibration_days=len(train),tuning_days=len(april)))
    comparison=pd.DataFrame(candidates)
    params=comparison.loc[comparison.april_mae_log.idxmin()].to_dict()
    params.update(calibration_start=calibration_start,tuning_start=tuning_start,evaluation_start=evaluation_start)
    result=apply_baseline(index,params)
    return result,params,comparison


def apply_baseline(index,params):
    result=level_path(index,params['half_life'],params['update_cap'])
    result['observed']=index
    result['lower']=result.baseline*np.exp(-params['width'])
    result['upper']=result.baseline*np.exp(params['width'])
    result['deviation_pct']=100*np.expm1(result.residual)
    result['status']=pd.Series(pd.NA,index=result.index,dtype='Int64')
    scored=(result.index>=pd.Timestamp(params['evaluation_start'],tz='UTC'))&result.residual.notna()
    result.loc[scored,'status']=np.where(result.loc[scored,'residual']>params['width'],1,
        np.where(result.loc[scored,'residual'] < -params['width'],-1,0))
    return result


def episodes(result,minimum_days=3):
    """Consecutive same-direction departures; no bridging of missing/normal days.

    Start is retrospective; confirmation is available only on the third day.
    These are excursions under this rule, not classified market regimes.
    """
    records=[];active=[];direction=0
    def finish():
        if len(active)<minimum_days:return
        block=result.loc[active]
        peak_day=block.residual.abs().idxmax()
        records.append(dict(start=active[0],end=active[-1],confirmed=active[minimum_days-1],
            days=len(active),direction='Above' if direction==1 else 'Below',
            peak_day=peak_day,peak_deviation_pct=float(block.loc[peak_day,'deviation_pct']),
            ongoing=active[-1]==result.index[-1]))
    previous=None
    for day,row in result.iterrows():
        status=0 if pd.isna(row.status) else int(row.status)
        contiguous=previous is not None and day-previous==pd.Timedelta(days=1)
        if status!=direction or not contiguous:
            finish();active=[];direction=status
        if status:active.append(day)
        previous=day
    finish()
    return pd.DataFrame(records,columns=['start','end','confirmed','days','direction','peak_day',
                                        'peak_deviation_pct','ongoing'])


def host_breadth(quotes,reference_start='2026-04-01',reference_end='2026-05-01',
                 minimum_reference_days=5,threshold=.10):
    """One vote per observed host with eligible April-reference configurations."""
    a,b=[pd.Timestamp(t,tz='UTC') for t in [reference_start,reference_end]]
    ref=quotes[(quotes.day>=a)&(quotes.day<b)].groupby('configuration').agg(
        reference_price=('price','median'),reference_days=('day','nunique'))
    ref=ref[ref.reference_days>=minimum_reference_days]
    q=quotes[quotes.day>=b].join(ref,on='configuration').dropna(subset=['reference_price'])
    q['log_relative']=np.log(q.price/q.reference_price)
    hosts=q.groupby(['day','host_id']).agg(log_relative=('log_relative','median'),
                                          machines=('machine_id','nunique')).reset_index()
    hosts['above']=hosts.log_relative>np.log1p(threshold)
    hosts['below']=hosts.log_relative<np.log1p(-threshold)
    total=quotes[quotes.day>=b].groupby('day').host_id.nunique()
    result=hosts.groupby('day').agg(reference_hosts=('host_id','size'),
        above_hosts=('above','sum'),below_hosts=('below','sum'))
    result['above_share']=result.above_hosts/result.reference_hosts
    result['below_share']=result.below_hosts/result.reference_hosts
    result['all_observed_hosts']=total
    result['reference_coverage']=result.reference_hosts/total
    return result,hosts


def host_leave_one_out(pairs,day):
    p=pairs[pairs.day.eq(pd.Timestamp(day,tz='UTC'))]
    records=[]
    for host in p.host_id.unique():
        rest=p.loc[p.host_id.ne(host),'log_change']
        records.append(dict(day=day,excluded_host=int(host),remaining_machines=len(rest),
                            daily_change_pct=float(100*np.expm1(rest.mean()))))
    return pd.DataFrame(records)
