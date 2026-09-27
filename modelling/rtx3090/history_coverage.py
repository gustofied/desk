"""Count recurring hardware histories and audit price coverage after selection.

Full-history rules are retrospective sensitivity checks. The before-May rule
uses only records available through April 30. Neither rule fills absent quotes.
"""
import numpy as np
import pandas as pd
from price_components import april_cohort, price_components


def coverage_profile(quotes, dates, key='configuration', cutoff='2026-05-01'):
    """One appearance per calendar day; count gaps including both window edges."""
    dates = pd.DatetimeIndex(dates).sort_values()
    if dates.empty or dates.has_duplicates:
        raise ValueError('A nonempty, unique daily calendar is required')
    if not dates.equals(pd.date_range(dates.min(), dates.max(), freq='D')):
        raise ValueError('Include missing calendar days in the audit window')
    cutoff = pd.Timestamp(cutoff, tz='UTC')
    rows = quotes[quotes.day.isin(dates)]
    records = []
    for identity, group in rows.groupby(key):
        seen = pd.DatetimeIndex(group.day.unique()).sort_values()
        present = dates.isin(seen)
        gap_edges = np.flatnonzero(np.diff(np.r_[False, ~present, False].astype(int)))
        run_edges = np.flatnonzero(np.diff(np.r_[False, present, False].astype(int)))
        records.append({key: identity, 'recorded_days': len(seen),
            'calendar_days': len(dates), 'coverage_share': len(seen)/len(dates),
            'first_day': seen.min(), 'last_day': seen.max(),
            'span_days': (seen.max()-seen.min()).days+1,
            'months': len(set(seen.strftime('%Y-%m'))),
            'longest_missing_days': int((gap_edges[1::2]-gap_edges[::2]).max(initial=0)),
            'longest_recorded_run': int((run_edges[1::2]-run_edges[::2]).max(initial=0)),
            'days_before_may': int((seen < cutoff).sum()),
            'hosts': group.host_id.nunique(), 'configurations': group.configuration.nunique()})
    return pd.DataFrame(records).sort_values(['recorded_days', key], ascending=[False, True])


def reference_members(quotes, minimum_history_days=30, cutoff='2026-05-01'):
    """Fix membership without using prices or appearances from May onward."""
    past = quotes[quotes.day.lt(pd.Timestamp(cutoff, tz='UTC'))]
    counts = past.groupby('configuration').day.nunique()
    cohort = april_cohort(past)
    return cohort[cohort.configuration.isin(counts.index[counts.ge(minimum_history_days)])]


def persistence_study(quotes, dates, pairs):
    """Compare predetermined history lengths and expose unsupported dates.

Price results use the existing April reference and 20-machine / 10-host gate.
Daily distribution coverage and adjacent-day matching coverage are different.
"""
    dates = pd.DatetimeIndex(dates).sort_values()
    machines = coverage_profile(quotes, dates, key='machine_id')
    profiles = coverage_profile(quotes, dates)
    config_fields = ['configuration', 'machine_id', 'host_id', 'geo_country',
                     'geo_region', 'gpu_ram', 'cpu_cores', 'cpu_ram']
    profiles = profiles.merge(quotes[config_fields].drop_duplicates(),
                              on='configuration', validate='one_to_one')
    cohort = april_cohort(quotes)
    rules = []
    for n in [30, 60, 90, 120, len(dates)]:
        rules.append((f'At least {n} days in full history', 'Full history',
                      profiles.loc[profiles.recorded_days.ge(n), 'configuration']))
    rules.extend([
        ('Present in every month', 'Full history', profiles.loc[
            profiles.months.eq(len(set(dates.strftime('%Y-%m')))), 'configuration']),
        ('No absence longer than 30 days', 'Full history', profiles.loc[
            profiles.longest_missing_days.le(30), 'configuration']),
        ('At least 30 days before May', 'Through April 30',
            reference_members(quotes).configuration),
    ])
    summaries, paths, memberships, quote_checks = [], [], [], []
    for name, selection_period, ids in rules:
        members = cohort[cohort.configuration.isin(ids)].copy()
        memberships.append(members.assign(rule=name, selection_period=selection_period))
        components, _ = price_components(quotes, members, dates)
        paths.append(components.reset_index().assign(rule=name))
        selected_pairs = pairs[pairs.configuration.isin(members.configuration)]
        matched = selected_pairs.groupby('day').agg(machines=('machine_id','nunique'),
            hosts=('host_id','nunique')).reindex(dates[1:], fill_value=0)
        valid_links = matched.machines.ge(20) & matched.hosts.ge(10)
        peak = components.loc[pd.Timestamp('2026-05-30', tz='UTC')]
        summaries.append(dict(rule=name, selection_period=selection_period,
            configurations=len(members), machines=members.machine_id.nunique(),
            hosts=members.host_id.nunique(), valid_days=int(components.eligible.sum()),
            total_days=len(dates), minimum_daily_machines=int(components.machines.min()),
            minimum_daily_hosts=int(components.hosts.min()),
            valid_daily_links=int(valid_links.sum()), total_daily_links=len(valid_links),
            failed_days=', '.join(components.index[~components.eligible].strftime('%Y-%m-%d')),
            failed_links=', '.join(matched.index[~valid_links].strftime('%Y-%m-%d')),
            may30_machines=int(peak.machines), may30_hosts=int(peak.hosts),
            may30_lower_change_pct=float(peak.lower-100),
            may30_median_change_pct=float(peak['median']-100),
            may30_upper_change_pct=float(peak.upper-100)))
        if selection_period == 'Through April 30':
            for n in [1, 2, 3, 6]:
                check, _ = price_components(quotes[quotes.observations.ge(n)], members, dates)
                quote_checks.append(dict(quotes_per_day=n, valid_days=int(check.eligible.sum()),
                    total_days=len(dates), minimum_machines=int(check.machines.min()),
                    minimum_hosts=int(check.hosts.min()),
                    failed_days=', '.join(check.index[~check.eligible].strftime('%Y-%m-%d'))))
    monthly = (quotes.assign(month=quotes.day.dt.strftime('%Y-%m'))
        .groupby(['configuration', 'month']).day.nunique().unstack(fill_value=0)
        .reindex(columns=sorted(set(dates.strftime('%Y-%m'))), fill_value=0))
    return dict(machines=machines, configurations=profiles, monthly=monthly,
        summary=pd.DataFrame(summaries), daily=pd.concat(paths, ignore_index=True),
        membership=pd.concat(memberships, ignore_index=True),
        quote_sensitivity=pd.DataFrame(quote_checks))
