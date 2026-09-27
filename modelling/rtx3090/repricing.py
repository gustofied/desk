"""Daily distribution comparisons and a small, predeclared forecast experiment.

April-relative quantiles measure dispersion of repricing, not cheap/premium tiers.
Matching is on consecutive calendar dates, with missing links kept missing.
No prices are imputed and no quantile changes are chained into an index.
"""
import numpy as np
import pandas as pd
from daily_baseline import fit_baseline


def daily_transitions(rows, dates, minimum_observations=1,
                      minimum_machines=20, minimum_hosts=10,
                      probabilities=(.1, .5, .9, .95)):
    dates = pd.DatetimeIndex(pd.to_datetime(dates, utc=True)).sort_values()
    if dates.has_duplicates or len(dates) < 2:
        raise ValueError('At least two distinct dates required')
    if rows.duplicated(['day', 'machine_id']).any():
        raise ValueError('One configuration per machine and date required')
    data = rows[rows.day.isin(dates) & rows.observations.ge(minimum_observations)].copy()
    if not np.isfinite(data.relative).all() or data.relative.le(0).any():
        raise ValueError('Positive finite price relatives required')
    group = data.groupby('day')
    counts = group.agg(machines=('machine_id', 'nunique'), hosts=('host_id', 'nunique'))
    full = group.relative.quantile(probabilities).unstack().reindex(index=dates, columns=probabilities)
    counts = counts.reindex(dates, fill_value=0)
    full_ok = counts.machines.ge(minimum_machines) & counts.hosts.ge(minimum_hosts)
    full.loc[~full_ok, :] = np.nan

    prior = data[['day', 'configuration', 'machine_id', 'host_id', 'relative']].copy()
    prior['day'] += pd.Timedelta(days=1)
    pairs = data.merge(prior, on=['day', 'configuration', 'machine_id', 'host_id'],
                       suffixes=('_after', '_before'), validate='one_to_one')
    pair_group = pairs.groupby('day')
    matched_counts = pair_group.agg(machines=('machine_id', 'nunique'), hosts=('host_id', 'nunique'))
    matched_counts = matched_counts.reindex(dates, fill_value=0)
    paired_ok = (matched_counts.machines.ge(minimum_machines)
                 & matched_counts.hosts.ge(minimum_hosts))
    matched_before = pair_group.relative_before.quantile(probabilities).unstack().reindex(index=dates, columns=probabilities)
    matched_after = pair_group.relative_after.quantile(probabilities).unstack().reindex(index=dates, columns=probabilities)
    matched_before.loc[~paired_ok, :] = np.nan
    matched_after.loc[~paired_ok, :] = np.nan
    frames = []
    previous_dates = dates - pd.Timedelta(days=1)
    before_counts = counts.reindex(previous_dates, fill_value=0)
    for probability in probabilities:
        frame = pd.DataFrame(dict(day=dates, before=previous_dates, percentile=probability,
            visible_before=full[probability].reindex(previous_dates).to_numpy(),
            visible_after=full[probability].to_numpy(),
            matched_before=matched_before[probability].to_numpy(),
            matched_after=matched_after[probability].to_numpy(),
            listed_before=before_counts.machines.to_numpy(), listed_after=counts.machines.to_numpy(),
            matched_machines=matched_counts.machines.to_numpy(),
            matched_hosts=matched_counts.hosts.to_numpy(), eligible=paired_ok.to_numpy()))
        frame['visible_change_pp'] = frame.visible_after-frame.visible_before
        frame['matched_change_pp'] = frame.matched_after-frame.matched_before
        frame['difference_pp'] = frame.visible_change_pp-frame.matched_change_pp
        frame['entered'] = frame.listed_after-frame.matched_machines
        frame['exited'] = frame.listed_before-frame.matched_machines
        frames.append(frame[frame.day.ne(dates.min())])
    return pd.concat(frames, ignore_index=True).sort_values(['day', 'percentile']).reset_index(drop=True)


def transition_host_sensitivity(rows, dates):
    """Recompute every daily comparison omitting one whole host at a time.

    A missing gated result stays missing. Bounds are sensitivity ranges, not CIs.
    """
    records = []
    for host in sorted(rows.host_id.unique()):
        frame = daily_transitions(rows[rows.host_id.ne(host)], dates)
        records.append(frame[['day', 'percentile', 'matched_change_pp', 'eligible']]
                       .assign(excluded_host=host))
    paths = pd.concat(records, ignore_index=True)
    summary = paths.groupby(['day', 'percentile']).agg(
        omission_min=('matched_change_pp', 'min'), omission_max=('matched_change_pp', 'max'),
        valid_omissions=('eligible', 'sum'), attempted_omissions=('excluded_host', 'size')).reset_index()
    return summary, paths


def forecast_comparison(components, evaluation_start='2026-05-01'):
    """Historical replay: persistence, existing EWMA, and log AR(1) + weekend.

    Coefficients fit through April 30 only; predictions use the prior day's actual
    component. Score a mean forecast with squared log error. This measures forecast
    loss, not the ability to preserve a prolonged level-shift monitoring signal.
    """
    cutoff = pd.Timestamp(evaluation_start, tz='UTC')
    predictions, parameters = [], []
    for component in ['lower', 'median', 'upper']:
        series = components[component].sort_index()
        calendar = pd.date_range(series.index.min(), series.index.max(), tz='UTC')
        series = series.reindex(calendar)
        y = np.log(series.where(series.gt(0)))
        x = pd.DataFrame({'intercept': 1., 'lag': y.shift(),
                          'weekend': (y.index.dayofweek >= 5).astype(float)}, index=y.index)
        train = (y.index < cutoff) & y.notna() & x.notna().all(axis=1)
        test = y.index >= cutoff
        outputs = {'Persistence': y.shift()}
        try:
            baseline, _, _ = fit_baseline(series, evaluation_start=evaluation_start)
            outputs['EWMA'] = np.log(baseline.baseline)
            parameters.append(dict(component=component, model='EWMA', status='available'))
        except ValueError as exc:
            parameters.append(dict(component=component, model='EWMA', status=str(exc)))
        design = x.loc[train].to_numpy()
        if len(design) >= 20 and np.linalg.matrix_rank(design) == 3:
            coefficients = np.linalg.lstsq(design, y.loc[train].to_numpy(), rcond=None)[0]
            outputs['Lag and weekend'] = x @ coefficients
            parameters.append(dict(component=component, model='Lag and weekend', status='available',
                training_days=int(train.sum()), intercept=coefficients[0],
                lag=coefficients[1], weekend=coefficients[2]))
        else:
            parameters.append(dict(component=component, model='Lag and weekend',
                status='Insufficient independent training variation', training_days=int(train.sum())))
        for name, predicted in outputs.items():
            frame = pd.DataFrame(dict(day=y.index[test], component=component, model=name,
                                      actual_log=y.loc[test].to_numpy(),
                                      forecast_log=predicted.loc[test].to_numpy()))
            # All methods evaluated only where a real previous calendar day exists.
            frame.loc[y.shift().loc[test].isna().to_numpy(), 'forecast_log'] = np.nan
            frame['squared_log_error'] = (frame.actual_log-frame.forecast_log)**2
            predictions.append(frame)
    predictions = pd.concat(predictions, ignore_index=True)
    # Common forecast dates within each component; failed methods remain in parameters.
    keep = predictions.groupby(['day', 'component']).squared_log_error.transform(lambda s: s.notna().all())
    predictions['scored'] = keep
    scored = predictions[keep].copy()
    scored['period'] = scored.day.dt.strftime('%Y-%m')
    aggregate = scored.assign(period='All evaluation dates')
    scores = pd.concat([scored, aggregate]).groupby(['component', 'model', 'period']).agg(
        days=('squared_log_error', 'size'), mse_log=('squared_log_error', 'mean')).reset_index()
    scores['rms_log_pct'] = 100*np.sqrt(scores.mse_log)
    return predictions, scores, pd.DataFrame(parameters)
