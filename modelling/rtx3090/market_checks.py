"""Measurement and reference-rule checks for the daily market study.

These ranges describe choices and observed-sample influence, not sampling
confidence intervals. No check fills a missing price link.
"""
import itertools
import numpy as np
import pandas as pd
from daily_baseline import chain_daily,level_path,apply_baseline,episodes,fit_baseline


def direct_reference(quotes,dates,base_day='2026-04-30',minimum_pairs=20,minimum_hosts=10):
    base=pd.Timestamp(base_day,tz='UTC')
    ref=quotes.loc[quotes.day.eq(base),['configuration','price','observations']].rename(
        columns={'price':'reference_price','observations':'reference_observations'})
    matched=quotes[quotes.day.ge(base)].merge(ref,on='configuration',validate='many_to_one')
    # Use the same within-pair ambiguity rule as the daily chain.
    matched=matched[~matched.duplicated(['day','machine_id'],keep=False)].copy()
    matched['log_relative']=np.log(matched.price/matched.reference_price)
    if not np.isfinite(matched.log_relative).all():raise ValueError('Invalid direct price relative')
    out=matched.groupby('day').agg(log_relative=('log_relative','mean'),
        machines=('machine_id','nunique'),hosts=('host_id','nunique'))
    out['eligible']=out.machines.ge(minimum_pairs)&out.hosts.ge(minimum_hosts)
    out['direct_index']=100*np.exp(out.log_relative.where(out.eligible))
    return out.reindex(dates),matched


def omit_hosts_from_chain(pairs,index,base_day='2026-04-30',minimum_pairs=20,minimum_hosts=10):
    """Omit each observed host from every link, preserving all coverage rules."""
    dates=index.index
    totals=pairs.groupby('day').agg(total=('log_change','sum'),n=('machine_id','size'),
                                   hosts=('host_id','nunique')).reindex(dates)
    by_host=pairs.groupby(['day','host_id']).log_change.agg(['sum','size'])
    paths={};audit=[]
    for host in sorted(pairs.host_id.unique()):
        own=by_host.xs(host,level='host_id').reindex(dates).fillna(0.)
        n=totals.n-own['size']
        hosts=totals.hosts-own['size'].gt(0).astype(int)
        eligible=n.ge(minimum_pairs)&hosts.ge(minimum_hosts)&index.eligible.fillna(False)
        change=((totals.total-own['sum'])/n).where(eligible)
        change.iloc[0]=0.
        cumulative=change.cumsum(skipna=False)
        base=cumulative.loc[pd.Timestamp(base_day,tz='UTC')]
        path=100*np.exp(cumulative-base) if np.isfinite(base) else cumulative*np.nan
        paths[int(host)]=path
        failed=dates[1:][~eligible.iloc[1:].to_numpy()]
        audit.append(dict(excluded_host=int(host),complete=bool(path.notna().all()),
            first_invalid_day=str(failed[0].date()) if len(failed) else None,
            minimum_machines=int(n.iloc[1:].min()),minimum_hosts=int(hosts.iloc[1:].min())))
    return pd.DataFrame(paths,index=dates),pd.DataFrame(audit)


def coverage_sensitivity(quotes,daily,base_day='2026-04-30',minimum_counts=(1,2,3,6),
                         minimum_pairs=20,minimum_hosts=10):
    records=[];all_links=[]
    for count in minimum_counts:
        q=quotes[quotes.observations.ge(count)]
        links,pairs=chain_daily(q,daily,base_day,minimum_pairs,minimum_hosts)
        descriptive=pairs.groupby('day').log_change.mean()
        links['unthresholded_change_pct']=100*np.expm1(descriptive)
        links['minimum_observations']=count
        all_links.append(links.reset_index())
        breaks=links.index[1:][~links.eligible.iloc[1:].fillna(False).to_numpy(dtype=bool)]
        records.append(dict(minimum_observations=count,
            supported_links=int(links.eligible.fillna(False).sum()),total_links=len(links)-1,
            first_break=str(breaks[0].date()) if len(breaks) else None,
            connected_days=int(links.matched_index.notna().sum()),
            minimum_matched_machines=int(links.matched_machines.min())))
    return pd.DataFrame(records),pd.concat(all_links,ignore_index=True)


def baseline_sensitivity(series,parameters,candidates,half_lives=(7,14,28),
                         cap_multipliers=(.5,1.,2.,np.inf),quantiles=(.90,.95,.99),
                         persistence_days=(1,3,5),anchor_day='2026-05-30'):
    """Full preset grid; select no variant using the observed event outcome.

    Each changed cap has its envelope recalibrated on April residuals. Report
    the positive episode containing the diagnostic anchor date, if one exists.
    The anchor locates an episode retrospectively; it never enters fitting.
    """
    tune=pd.Timestamp(parameters['tuning_start'],tz='UTC')
    evaluate=pd.Timestamp(parameters['evaluation_start'],tz='UTC')
    anchor=pd.Timestamp(anchor_day,tz='UTC')
    rows=[];masks=[];variant=0
    for half_life,cap_multiple in itertools.product(half_lives,cap_multipliers):
        candidate=candidates.set_index('half_life').loc[half_life]
        cap=float(candidate.update_cap*cap_multiple)
        trace=level_path(series,half_life,cap)
        april=trace.loc[(trace.index>=tune)&(trace.index<evaluate),'residual'].dropna()
        for quantile,persistence in itertools.product(quantiles,persistence_days):
            width=float(np.quantile(abs(april),quantile))
            p={**parameters,'half_life':half_life,'update_cap':cap,'width':width}
            model=apply_baseline(series,p)
            event=episodes(model,minimum_days=persistence)
            above=event[event.direction.eq('Above')]
            selected=above[(above.start<=anchor)&(above.end>=anchor)]
            row=dict(variant=variant,half_life=half_life,
                cap_multiplier='uncapped' if np.isinf(cap_multiple) else str(cap_multiple),
                quantile=quantile,persistence_days=persistence,width=width,
                contains_anchor=not selected.empty,start=None,end=None,confirmed=None,days=0)
            mask=pd.Series(False,index=series.index,name=variant)
            for _,e in above.iterrows():mask.loc[e.start:e.end]=True
            masks.append(mask)
            if not selected.empty:
                e=selected.iloc[0]
                row.update(start=str(e.start.date()),end=str(e.end.date()),confirmed=str(e.confirmed.date()),days=int(e.days))
            rows.append(row);variant+=1
    agreement=100*pd.concat(masks,axis=1).mean(axis=1)
    agreement.loc[agreement.index<evaluate]=np.nan
    return pd.DataFrame(rows),agreement.rename('settings_above_pct')


def depth_baseline(depth):
    """Model log(1 + listings); display original units and allow observed zeros."""
    shifted,parameters,candidates=fit_baseline(depth+1)
    model=shifted.copy()
    for column in ['observed','baseline','lower','upper']:
        model[column]=(model[column]-1).clip(lower=0)
    model['deviation_listings']=model.observed-model.baseline
    model=model.drop(columns='deviation_pct')
    event=episodes(shifted)
    event=event.rename(columns={'peak_deviation_pct':'peak_shifted_ratio_pct'})
    event['peak_deviation_listings']=[float(model.loc[d,'deviation_listings']) for d in event.peak_day]
    return model,parameters,candidates,event


def recovery_thresholds(daily,reference_start='2026-04-01',reference_end='2026-05-01',
                        after='2026-05-29',thresholds=(.5,.8,.9),persistence=3):
    """Descriptive recovery rule, with no smoothing or price-index input."""
    start,end,bottom=[pd.Timestamp(s,tz='UTC') for s in [reference_start,reference_end,after]]
    rows=[]
    for column in ['availability','affordable_availability']:
        values=daily[column].where(daily.usable)
        reference=float(values.loc[(values.index>=start)&(values.index<end)].median())
        if not np.isfinite(reference) or reference<=0:raise ValueError('Positive April reference required')
        after_values=values.loc[values.index>=bottom]
        for threshold in thresholds:
            passed=after_values.ge(threshold*reference)&after_values.notna()
            confirm=passed.rolling(persistence,min_periods=persistence).sum().eq(persistence)
            day=confirm[confirm].index[0] if confirm.any() else pd.NaT
            rows.append(dict(series=column,threshold=threshold,april_median=reference,
                recovery_start=day-pd.Timedelta(days=persistence-1),confirmed=day))
    return pd.DataFrame(rows)


def pre_event_holdout(series):
    """Small honest holdout; useful audit, insufficient for a coverage guarantee."""
    path,p,_=fit_baseline(series,evaluation_start='2026-04-21')
    holdout=path.loc['2026-04-21':'2026-04-30'].dropna(subset=['residual'])
    return dict(half_life=p['half_life'],days=len(holdout),
        outside_days=int(holdout.status.ne(0).sum()),
        mean_absolute_log_error=float(holdout.residual.abs().mean()),
        range_width_log=p['width'],range_calibration_days=p['tuning_days'])
