"""Audit visible price components without changing the principal estimates.

Same-configuration comparisons distinguish repricing from sample turnover.
All filters preserve April membership and reference prices; missing prices
are never carried forward. Selected-date panels are retrospective diagnostics.
"""
import numpy as np
import pandas as pd
from daily_baseline import fit_baseline, episodes


def common_sample_transitions(rows, transitions):
    records = []
    for before, after in transitions:
        a, b = [pd.Timestamp(t, tz='UTC') for t in [before, after]]
        left = rows[rows.day.eq(a)].set_index('configuration')
        right = rows[rows.day.eq(b)].set_index('configuration')
        if not left.index.is_unique or not right.index.is_unique:
            raise ValueError('One price per configuration and date required')
        common = left.index.intersection(right.index)
        for probability in [.1, .95]:
            records.append(dict(before=a, after=b, percentile=probability,
                listed_before=len(left), listed_after=len(right), common_machines=len(common),
                common_hosts=left.loc[common].host_id.nunique(),
                all_before=left.relative.quantile(probability),
                all_after=right.relative.quantile(probability),
                common_before=left.loc[common].relative.quantile(probability),
                common_after=right.loc[common].relative.quantile(probability),
                common_change_pct=100*np.expm1(np.log(
                    right.loc[common].relative/left.loc[common].relative).mean())))
    return pd.DataFrame(records)


def selected_date_panel(rows, dates):
    dates = pd.DatetimeIndex(pd.to_datetime(dates, utc=True))
    if len(dates) < 2 or dates.has_duplicates:
        raise ValueError('At least two distinct comparison dates required')
    selected = rows[rows.day.isin(dates)]
    counts = selected.groupby('configuration').day.nunique()
    members = counts[counts.eq(len(dates))].index
    panel = selected[selected.configuration.isin(members)].copy()
    summaries = []
    for day in dates:
        data = panel[panel.day.eq(day)]
        summaries.append(dict(day=day, machines=data.machine_id.nunique(),
            hosts=data.host_id.nunique(), lower=data.relative.quantile(.1),
            median=data.relative.median(), upper=data.relative.quantile(.95)))
    return pd.DataFrame(summaries), panel


def component_path(rows, dates, probability, minimum_observations=1,
                   minimum_machines=20, minimum_hosts=10):
    selected = rows[rows.observations.ge(minimum_observations)]
    if selected.duplicated(['day', 'machine_id']).any():
        raise ValueError('Components require one configuration per machine-day')
    groups = selected.groupby('day')
    counts = groups.agg(machines=('machine_id', 'nunique'), hosts=('host_id', 'nunique')).reindex(dates)
    counts = counts.fillna(0).astype(int)
    eligible = counts.machines.ge(minimum_machines) & counts.hosts.ge(minimum_hosts)
    series = groups.relative.quantile(probability).reindex(dates).where(eligible)
    return series, counts


def _fit_record(series, anchor):
    try:
        fitted, parameters, _ = fit_baseline(series)
    except ValueError as exc:
        return dict(status=str(exc), start=pd.NaT, confirmed=pd.NaT, end=pd.NaT)
    events = episodes(fitted)
    event = events[events.direction.eq('Above') & events.start.le(anchor) & events.end.ge(anchor)]
    result = dict(status='No positive episode at anchor', start=pd.NaT, confirmed=pd.NaT,
                  end=pd.NaT, half_life=parameters['half_life'])
    if not event.empty:
        result.update(status='calibrated', **event.iloc[0][['start', 'confirmed', 'end']].to_dict())
    return result


def observation_sensitivity(rows, dates, thresholds=(1, 2, 3, 6), anchor='2026-05-30'):
    anchor = pd.Timestamp(anchor, tz='UTC')
    records = []
    for minimum in thresholds:
        for name, probability in [('lower', .1), ('upper', .95)]:
            series, counts = component_path(rows, dates, probability, minimum)
            records.append(dict(component=name, minimum_observations=minimum,
                valid_days=int(series.notna().sum()), total_days=len(dates),
                peak_machines=int(counts.loc[anchor, 'machines']),
                peak_hosts=int(counts.loc[anchor, 'hosts']),
                peak_increase_pct=float(series.loc[anchor]-100),
                **_fit_record(series, anchor)))
    return pd.DataFrame(records)


def host_path_sensitivity(rows, dates, anchor='2026-05-30'):
    anchor = pd.Timestamp(anchor, tz='UTC')
    records = []
    for host in sorted(rows.host_id.unique()):
        remaining = rows[rows.host_id.ne(host)]
        for name, probability in [('lower', .1), ('upper', .95)]:
            series, counts = component_path(remaining, dates, probability)
            records.append(dict(excluded_host=int(host), component=name,
                valid_days=int(series.notna().sum()),
                minimum_machines=int(counts.machines.min()),minimum_hosts=int(counts.hosts.min()),
                **_fit_record(series, anchor)))
    return pd.DataFrame(records)
