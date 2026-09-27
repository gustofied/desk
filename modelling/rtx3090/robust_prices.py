"""A two-part robust estimator for matched weekly asking-price changes.

Unchanged quotes remain a point mass at zero. Estimate location/scale only among
repricing machines, and bound tail contributions around that contemporaneous
location. This is a descriptive benchmark, not a price forecast or error labeler.
"""
import numpy as np
import pandas as pd
from scipy.optimize import brentq

ZERO_TOLERANCE = 1e-8
MAD_TO_SIGMA = 1.482602218505602


def calibrate_scale(pairs, calibration_end='2026-04-06'):
    """Use only price links whose entire second week precedes the cutoff."""
    end = pd.Timestamp(calibration_end, tz='UTC')
    training = pairs[pairs.week + pd.Timedelta(days=7) <= end]
    r = np.log(training.price_relative.to_numpy(dtype=float))
    if not np.isfinite(r).all():
        raise ValueError('Calibration price relatives must be finite and positive')
    changed = r[np.abs(r) > ZERO_TOLERANCE]
    if len(changed) < 20:
        raise ValueError('At least 20 nonzero calibration changes are required')
    scale = MAD_TO_SIGMA * np.median(np.abs(changed - np.median(changed)))
    if scale <= ZERO_TOLERANCE:
        raise ValueError('Calibration changes have no usable robust dispersion')
    return dict(scale_floor=float(scale), calibration_end=calibration_end,
                training_pairs=len(r), training_changes=len(changed),
                unchanged_share=float(np.mean(np.abs(r) <= ZERO_TOLERANCE)))


def fit_week(log_changes, scale_floor, k=1.345, flag_cut=3.5, minimum_changed=8):
    """Huber location among movers; preserve the observed frequency of repricing.

    With few movers, a zero-change anchor replaces an underidentified peer fit.
    The projected log change is mu + clip(r-mu, -k*s, k*s). A fitted Huber mu
    makes its mean equal mu; the sparse fallback gives bounded influence even
    when just one otherwise unchanged quote is corrupted. Flags do not delete rows.
    """
    r = np.asarray(log_changes, dtype=float)
    if not len(r) or not np.isfinite(r).all():
        raise ValueError('Provide finite log price changes')
    if not np.isfinite([scale_floor,k,flag_cut]).all() or min(scale_floor,k,flag_cut) <= 0:
        raise ValueError('Positive finite scale and positive cutoffs are required')
    changed = np.abs(r) > ZERO_TOLERANCE
    values = r[changed]
    enough = len(values) >= minimum_changed
    scale = max(scale_floor, MAD_TO_SIGMA * np.median(np.abs(values-np.median(values)))) if enough else scale_floor
    location = 0.
    if enough:
        if np.ptp(values) < 1e-12:
            location = float(values[0])
        else:
            location = float(brentq(lambda m: np.clip((values-m)/scale,-k,k).sum(),
                                    values.min(),values.max(),xtol=1e-12))
    adjusted = np.zeros(len(r))
    adjusted[changed] = location + np.clip(values-location,-k*scale,k*scale)
    z = np.full(len(r),np.nan)
    z[changed] = (values-location)/scale
    weights = np.ones(len(r))
    weights[changed] = np.minimum(1., k/np.maximum(np.abs(z[changed]),1e-15))
    flags = changed & (np.abs(z) > flag_cut)
    summary = dict(n=len(r), changed=int(changed.sum()), change_share=float(changed.mean()),
        up_share=float(np.mean(r>ZERO_TOLERANCE)), down_share=float(np.mean(r < -ZERO_TOLERANCE)),
        location=location, scale=float(scale), sparse_fallback=not enough,
        ordinary_log_change=float(r.mean()), robust_log_change=float(adjusted.mean()),
        lower_review=location-flag_cut*scale, upper_review=location+flag_cut*scale,
        flagged=int(flags.sum()), downweighted=int((weights < 1.-1e-10).sum()))
    detail = pd.DataFrame(dict(log_change=r, changed=changed, residual_z=z,
                              weight=weights, review_flag=flags, adjusted_log_change=adjusted))
    return summary, detail


def chain(log_changes, base_week):
    """The first row is the starting level; a missing subsequent link breaks it."""
    increments = log_changes.copy()
    increments.iloc[0] = 0.
    levels = increments.cumsum(skipna=False)
    base = levels.loc[pd.Timestamp(base_week,tz='UTC')]
    if not np.isfinite(base):
        raise ValueError('Base week is not connected by valid links')
    return 100*np.exp(levels-base)


def fit_history(pairs, links, calibration, base_week='2026-04-27', k=1.345,
                flag_cut=3.5, scale_multiplier=1., minimum_changed=8):
    records, details = [], []
    for week, group in pairs.groupby('week',sort=True):
        summary, detail = fit_week(np.log(group.price_relative),
            calibration['scale_floor']*scale_multiplier,k,flag_cut,minimum_changed)
        summary['week'] = week
        records.append(summary)
        detail.index = group.index
        details.append(pd.concat([group,detail],axis=1))
    result = pd.DataFrame(records).set_index('week').reindex(links.index)
    valid = links.eligible.fillna(False).astype(bool)
    result.loc[~valid,['ordinary_log_change','robust_log_change']] = np.nan
    result['ordinary_index'] = chain(result.ordinary_log_change,base_week)
    result['robust_index'] = chain(result.robust_log_change,base_week)
    result['phase'] = np.where(result.index + pd.Timedelta(days=7) <= pd.Timestamp(calibration['calibration_end'],tz='UTC'),
        'calibration',np.where(result.index < pd.Timestamp('2026-05-04',tz='UTC'),'validation','evaluation'))
    return result, pd.concat(details,ignore_index=True)


def entrant_diagnostic(raw, segment, scans, daily, first_seen_cutoff='2026-05-01',
                       start='2026-05-25', end='2026-06-01'):
    """Counterfactual scan/day medians removing machines first seen during May.

    A new machine ID means first observed in this capped sample, not newly
    installed hardware. Metadata validation and usable-day rules stay unchanged.
    """
    t0,t1,cutoff = [pd.Timestamp(x,tz='UTC') for x in [start,end,first_seen_cutoff]]
    first = raw.groupby('machine_id').timestamp.min()
    s = segment[(segment.timestamp>=t0)&(segment.timestamp<t1)].copy()
    s['day'] = s.timestamp.dt.floor('D')
    s = s[s.day.isin(daily.index[daily.usable])]
    s['new_to_sample'] = s.machine_id.map(first).ge(cutoff)
    usable_days = daily.index[daily.usable & (daily.index>=t0) & (daily.index<t1)]
    grid = scans[scans.valid & scans.day.isin(usable_days)][['scan','day']].copy()
    values = []
    for label,frame in [('All qualifying listings',s),('Seen before May',s[~s.new_to_sample])]:
        medians = frame.groupby('scan').price_usd_hour.median()
        joined = grid.join(medians.rename('price'),on='scan')
        price = joined.groupby('day').price.median().median()
        values.append(dict(sample=label,asking_price=float(price),observations=len(frame),
                           machines=frame.machine_id.nunique(),empty_scan_share=float(joined.price.isna().mean())))
    diagnostics = dict(new_observation_share=float(s.new_to_sample.mean()),
        new_machines=int(s.loc[s.new_to_sample,'machine_id'].nunique()),
        new_hosts=int(s.loc[s.new_to_sample,'host_id'].nunique()),
        first_seen_cutoff=first_seen_cutoff,peak_week=start)
    return pd.DataFrame(values),diagnostics


def stress_tests(scale_floor,k=1.345):
    """Known artificial inputs, never presented as observed market data."""
    scenarios = {
        'No price changes':np.zeros(100),
        'One quote ×10; 99 unchanged':np.r_[np.log(10.),np.zeros(99)],
        '40 machines +20%; 60 unchanged':np.r_[np.repeat(np.log(1.2),40),np.zeros(60)],
        'Every machine +20%':np.repeat(np.log(1.2),100),
        'Every machine −20%':np.repeat(np.log(.8),100),
    }
    rows=[]
    for name,changes in scenarios.items():
        fit,_=fit_week(changes,scale_floor,k)
        rows.append(dict(scenario=name,ordinary_pct=100*np.expm1(fit['ordinary_log_change']),
                         robust_pct=100*np.expm1(fit['robust_log_change']),flags=fit['flagged']))
    return pd.DataFrame(rows)


def corruption_validation(pairs,scale_floor,k=1.345,seed=23,trials=100):
    """Inject a known ×10 error into one matched quote in each April trial.

    Measure sensitivity relative to the same estimator on the unaltered week.
    This does not establish that any real-world quote is an error.
    """
    rng=np.random.default_rng(seed)
    april=pairs[(pairs.week>=pd.Timestamp('2026-04-06',tz='UTC')) &
                (pairs.week<pd.Timestamp('2026-05-04',tz='UTC'))]
    rows=[]
    for week,group in april.groupby('week',sort=True):
        original=np.log(group.price_relative.to_numpy(dtype=float))
        baseline,_=fit_week(original,scale_floor,k)
        for trial in range(trials):
            altered=original.copy()
            j=int(rng.integers(len(altered)))
            altered[j]+=np.log(10.)
            fit,_=fit_week(altered,scale_floor,k)
            row=dict(week=week,trial=trial,machine_id=int(group.iloc[j].machine_id))
            for name in ['ordinary','robust']:
                key=f'{name}_log_change'
                row[f'{name}_error_pp']=100*abs(np.expm1(fit[key])-np.expm1(baseline[key]))
            rows.append(row)
    return pd.DataFrame(rows)


def parameter_sensitivity(pairs,links,calibration,base_week='2026-04-27',peak_week='2026-05-25'):
    """Report every preset alternative; never pick the flattest result."""
    rows=[]
    for k in [1.,1.345,2.]:
        for scale_multiplier in [.5,1.,2.]:
            weekly,_=fit_history(pairs,links,calibration,base_week,k=k,
                                 scale_multiplier=scale_multiplier)
            rows.append(dict(k=k,scale_multiplier=scale_multiplier,
                peak_index=float(weekly.loc[peak_week,'robust_index']),
                final_index=float(weekly.robust_index.iloc[-1])))
    return pd.DataFrame(rows)
