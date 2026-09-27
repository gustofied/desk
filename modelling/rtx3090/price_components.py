"""Price changes within a cohort fixed before May.

Lower and upper percentiles describe the distribution of price changes.
These are not physical baseload/topload, absolute price tiers or prediction limits.
Membership and each configuration's price reference use April only. Missing
listings remain missing: no survivor filter, interpolation or carried prices.
"""
import numpy as np
import pandas as pd
from indices import MATCH_KEYS
from daily_baseline import fit_baseline, episodes


def april_cohort(quotes, minimum_days=5, start='2026-04-01', end='2026-05-01'):
    """Reuse the five-April-day eligibility rule from the host reference model."""
    if minimum_days < 1:
        raise ValueError('At least one reference day required')
    a, b = [pd.Timestamp(t, tz='UTC') for t in [start, end]]
    reference = quotes.loc[quotes.day.ge(a) & quotes.day.lt(b)]
    if reference.duplicated(['configuration', 'day']).any():
        raise ValueError('One daily price per configuration required')
    stats = reference.groupby('configuration').agg(
        reference_price=('price', 'median'), reference_days=('day', 'nunique'),
        reference_first=('day', 'min'), reference_last=('day', 'max'))
    members = reference[['configuration'] + MATCH_KEYS].drop_duplicates()
    return members.merge(stats[stats.reference_days.ge(minimum_days)],
                         on='configuration', validate='one_to_one')


def price_components(quotes, cohort, dates, minimum_machines=20, minimum_hosts=10):
    """Daily 10th/50th/95th percentiles of price / own April median.

    Quantiles have one vote per machine present on that day. Exclude a machine
    represented by multiple configurations on a day, as in the index. Coverage
    gates all price components; missing days are retained in the time axis.
    """
    dates = pd.DatetimeIndex(dates).sort_values()
    rows = quotes[quotes.day.isin(dates)].merge(
        cohort[['configuration', 'reference_price']], on='configuration', validate='many_to_one')
    rows = rows[~rows.duplicated(['day', 'machine_id'], keep=False)].copy()
    rows['relative'] = 100 * rows.price / rows.reference_price
    if not np.isfinite(rows.relative).all() or rows.relative.le(0).any():
        raise ValueError('Price relatives must be positive and finite')
    counts = rows.groupby('day').agg(machines=('machine_id', 'nunique'),
                                   hosts=('host_id', 'nunique'))
    quantiles = rows.groupby('day').relative.quantile([.1, .5, .95]).unstack()
    quantiles = quantiles.reindex(columns=[.1, .5, .95])
    quantiles.columns = ['lower', 'median', 'upper']
    result = counts.join(quantiles).reindex(dates).rename_axis('day')
    result[['machines', 'hosts']] = result[['machines', 'hosts']].fillna(0).astype(int)
    result['eligible'] = result.machines.ge(minimum_machines) & result.hosts.ge(minimum_hosts)
    result.loc[~result.eligible, ['lower', 'median', 'upper']] = np.nan
    result['cohort_share'] = result.machines / cohort.machine_id.nunique()
    return result, rows


def segment_coverage(quotes, pairs, dates, minimum_machines=20, minimum_hosts=10):
    """Audit every April country and preset April cohort thresholds.

    Selection uses April membership and sample size, never the size of May's move.
    Daily pairs retain the existing index's configuration and ambiguity checks.
    """
    dates = pd.DatetimeIndex(dates)
    april = quotes[quotes.day.ge('2026-04-01') & quotes.day.lt('2026-05-01')]
    choices = []
    for country in sorted(april.geo_country.dropna().unique()):
        choices.append((str(country), 'Country', quotes.loc[quotes.geo_country.eq(country), 'configuration'].unique()))
    choices.append(('US and Canada', 'Region', quotes.loc[quotes.geo_country.isin(['US', 'CA']), 'configuration'].unique()))
    for n in [1, 5, 10, 15, 20]:
        choices.append((f'April: at least {n} days', 'Fixed cohort', april_cohort(quotes, n).configuration))
    records = []
    for name, kind, ids in choices:
        prior = april[april.configuration.isin(ids)]
        sample = pairs[pairs.configuration.isin(ids)].groupby('day').agg(
            machines=('machine_id', 'nunique'), hosts=('host_id', 'nunique')).reindex(dates[1:]).fillna(0)
        valid = sample.machines.ge(minimum_machines) & sample.hosts.ge(minimum_hosts)
        after = valid[valid.index >= pd.Timestamp('2026-05-01', tz='UTC')]
        failed = sample.index[~valid]
        records.append(dict(segment=name, kind=kind,
            april_configurations=prior.configuration.nunique(), april_hosts=prior.host_id.nunique(),
            april_machine_days=len(prior), supported_links=int(valid.sum()), total_links=len(valid),
            post_april_links=int(after.sum()), post_april_total=len(after),
            minimum_machines=int(sample.machines.min()), minimum_hosts=int(sample.hosts.min()),
            first_invalid_day=str(failed[0].date()) if len(failed) else None))
    return pd.DataFrame(records)


def percentile_sensitivity(rows, daily, probabilities=(.1, .2, .8, .9, .95), anchor='2026-05-30'):
    """Recalibrate the unchanged baseline separately for each price component."""
    anchor = pd.Timestamp(anchor, tz='UTC')
    records = []
    for probability in probabilities:
        values = rows.groupby('day').relative.quantile(probability).reindex(daily.index).where(daily.eligible)
        record = dict(percentile=probability, anchor_level=float(values.loc[anchor]),
                      start=None, confirmed=None, end=None, status='calibrated')
        try:
            fitted, parameters, _ = fit_baseline(values)
        except ValueError as exc:
            record.update(status=str(exc)); records.append(record); continue
        events = episodes(fitted)
        selected = events[events.direction.eq('Above') & events.start.le(anchor) & events.end.ge(anchor)]
        if not selected.empty:
            event = selected.iloc[0]
            record.update(start=str(event.start.date()), confirmed=str(event.confirmed.date()),
                          end=str(event.end.date()))
        record.update(half_life=parameters['half_life'], width=parameters['width'])
        records.append(record)
    return pd.DataFrame(records)
