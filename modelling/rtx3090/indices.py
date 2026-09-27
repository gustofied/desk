"""Observed listing depth and matched asking prices."""
import numpy as np
import pandas as pd


def clean_observations(raw, meta):
    """Keep the source untouched; quarantine ambiguous scans and invalid quote rows.

    Failed/missing metadata are unknown availability, never zero availability.
    Successful empty scans are retained as genuine observed zeros.
    """
    if meta.snapshot_id.duplicated().any():
        raise ValueError('Duplicate scan metadata require source reconciliation')
    rows = raw.drop_duplicates().copy()
    conflicts = rows.duplicated(['snapshot_id', 'machine_id'], keep=False)
    conflict_ids = rows.loc[conflicts, 'snapshot_id'].unique()
    observed = rows.groupby('snapshot_id').agg(
        observed_time=('timestamp', 'first'), timestamps=('timestamp','nunique'),
        n=('machine_id', 'size'))
    scans = meta.merge(observed, on='snapshot_id', how='outer', validate='one_to_one')
    scans['timestamp'] = scans.timestamp.fillna(scans.observed_time)
    scans['n'] = scans.n.fillna(0).astype(int)
    scans['valid'] = (scans.status.eq('ok') & scans.row_count.eq(scans.n)
        & ~scans.snapshot_id.isin(conflict_ids)
        & (scans.n.eq(0) | (scans.timestamps.eq(1) & scans.timestamp.eq(scans.observed_time))))
    scans = scans.sort_values('timestamp').reset_index(drop=True)
    scans['scan'] = np.arange(len(scans))
    scans['day'] = scans.timestamp.dt.floor('D')
    scans['capped'] = scans.n.ge(64) & scans.valid
    scans['clean_in'] = (scans.valid & scans.valid.shift(fill_value=False)
        & scans.logger_version.eq(scans.logger_version.shift())
        & scans.timestamp.diff().dt.total_seconds().between(300, 900))
    scans['clean_next'] = scans.clean_in.shift(-1, fill_value=False)
    scans['block'] = (~scans.clean_in).cumsum()
    rows = rows.merge(scans[['snapshot_id','scan','valid','block','clean_next','capped']],
                      on='snapshot_id',validate='many_to_one')
    quote_ok = (rows.price_usd_hour.gt(0) & np.isfinite(rows.price_usd_hour)
                & rows.machine_id.notna() & rows.host_id.notna())
    keep = rows.valid & quote_ok
    audit = {
        'source_rows':len(raw), 'exact_duplicates_removed':len(raw)-len(rows),
        'conflicting_machine_scan_rows':int(conflicts.sum()),
        'observed_scans_without_metadata':int(scans.status.isna().sum()),
        'failed_scan_attempts':int(scans.status.eq('error').sum()),
        'valid_scans':int(scans.valid.sum()), 'valid_empty_scans':int((scans.valid & scans.n.eq(0)).sum()),
        'rows_quarantined_bad_scan':int((~rows.valid).sum()),
        'rows_quarantined_bad_quote':int((rows.valid & ~quote_ok).sum()),
        'retained_rows':int(keep.sum()),
        'retained_rows_with_nonpositive_cpu_or_ram':int((keep & (rows.cpu_cores.le(0)|rows.cpu_ram.le(0))).sum()),
        'capped_share_of_valid_scans':float(scans.loc[scans.valid,'capped'].mean()),
        'clean_adjacent_pairs':int(scans.clean_next.sum()),
        'machines_with_multiple_country_labels':int(rows.groupby('machine_id').geo_country.nunique().gt(1).sum()),
    }
    clean = rows[keep].sort_values(['machine_id','timestamp']).reset_index(drop=True)
    clean['qualified'] = (clean.verified.eq(True) & clean.reliability.ge(.99)
                          & clean.cpu_cores.gt(0) & clean.cpu_ram.gt(0))
    return clean, scans, audit


def select_segment(rows, verified_only=True, minimum_reliability=.99, country=None):
    use = rows.cpu_cores.gt(0) & rows.cpu_ram.gt(0)
    if verified_only:
        use &= rows.verified.eq(True)
    if minimum_reliability is not None:
        use &= rows.reliability.ge(minimum_reliability)
    if country is not None:
        use &= rows.geo_country.eq(country)
    return rows.loc[use].copy()


def scan_market(segment, scans, budget=.20):
    """A successful empty scan is zero depth and an undefined asking price."""
    stats = segment.groupby('scan').agg(
        available_offers=('machine_id', 'size'),
        available_ask=('price_usd_hour', 'median'),
        ask_q25=('price_usd_hour', lambda x: x.quantile(.25)),
        ask_q75=('price_usd_hour', lambda x: x.quantile(.75)))
    stats['affordable_offers'] = segment[segment.price_usd_hour.le(budget)].groupby('scan').size()
    out = scans.loc[scans.valid, ['scan', 'timestamp', 'day', 'capped']].set_index('scan').join(stats)
    out[['available_offers', 'affordable_offers']] = out[['available_offers', 'affordable_offers']].fillna(0).astype(int)
    return out


def daily_market(market, minimum_scans=120):
    daily = market.groupby('day').agg(
        scans=('available_offers', 'size'),
        availability=('available_offers', 'mean'),
        affordable_availability=('affordable_offers', 'mean'),
        available_ask=('available_ask', 'median'),
        zero_availability_share=('available_offers', lambda x: x.eq(0).mean()),
        zero_affordable_share=('affordable_offers', lambda x: x.eq(0).mean()),
        capped_share=('capped', 'mean'))
    dates = pd.date_range(market.day.min(), market.day.max(), freq='D')
    daily = daily.reindex(dates).rename_axis('day')
    daily['usable'] = daily.scans.ge(minimum_scans)
    daily.loc[~daily.usable, ['availability', 'affordable_availability', 'available_ask',
                            'zero_availability_share', 'zero_affordable_share', 'capped_share']] = np.nan
    return daily


def week_start(days):
    return days - pd.to_timedelta(days.weekday, unit='D')


def weekly_market(daily, base_start='2026-03-01', base_end='2026-04-01', minimum_days=5):
    """Equal-day weekly depth and weekly median of daily scan-median asking prices."""
    d = daily.copy()
    d['week'] = week_start(d.index)
    w = d.groupby('week').agg(
        usable_days=('usable', 'sum'), availability=('availability', 'mean'),
        affordable_availability=('affordable_availability', 'mean'),
        available_ask=('available_ask', 'median'), capped_share=('capped_share', 'mean'))
    levels = ['availability', 'affordable_availability', 'available_ask', 'capped_share']
    w.loc[w.usable_days.lt(minimum_days), levels] = np.nan
    ref = d.loc[(d.index >= pd.Timestamp(base_start, tz='UTC'))
                & (d.index < pd.Timestamp(base_end, tz='UTC')) & d.usable]
    bases = {'availability': float(ref.availability.mean()),
             'affordable_availability': float(ref.affordable_availability.mean())}
    for name, base in bases.items():
        if not np.isfinite(base) or base <= 0:
            raise ValueError(f'No positive reference for {name}')
        w[name + '_index'] = 100 * w[name] / base
    return w, bases


MATCH_KEYS = ['machine_id', 'host_id', 'geo_country', 'geo_region',
              'gpu_ram', 'cpu_cores', 'cpu_ram']


def weekly_machine_quotes(segment, daily, minimum_days=3, minimum_observations=36):
    """Daily then weekly median quotes, with explicit coverage per configuration."""
    s = segment.copy()
    s['day'] = s.timestamp.dt.floor('D')
    s = s[s.day.isin(daily.index[daily.usable])]
    s['configuration'] = s.groupby(MATCH_KEYS, dropna=False, sort=True).ngroup()
    configurations = s[['configuration'] + MATCH_KEYS].drop_duplicates()
    d = s.groupby(['configuration', 'day']).agg(
        price=('price_usd_hour', 'median'), observations=('price_usd_hour', 'size')).reset_index()
    d['week'] = week_start(pd.DatetimeIndex(d.day))
    w = d.groupby(['configuration', 'week']).agg(
        price=('price', 'median'), days=('day', 'size'),
        observations=('observations', 'sum')).reset_index()
    eligible = w[w.days.ge(minimum_days) & w.observations.ge(minimum_observations)]
    return eligible.merge(configurations, on='configuration', validate='many_to_one')


def chained_matched_prices(quotes, weekly, base_week='2026-05-04', minimum_pairs=20,
                           minimum_week_days=5):
    """Chain equal-weight geometric price relatives for adjacent-week matches.

    Do not bridge absent calendar weeks or insufficient overlap. A break ends the
    connected index; do not silently restart/rebase it. Configurations changing
    within a machine are matched exactly; exclude multiple matches for one machine.
    """
    weeks = pd.date_range(weekly.index.min(), weekly.index.max(), freq='7D')
    w = weekly.reindex(weeks)
    prices = quotes.pivot(index='configuration', columns='week', values='price').reindex(columns=weeks)
    members = quotes[['configuration'] + MATCH_KEYS].drop_duplicates().set_index('configuration')
    records, links = [], []
    for previous, current in zip(weeks[:-1], weeks[1:]):
        pair = prices[[previous, current]].dropna().rename(columns={previous:'previous_price',current:'price'})
        pair = pair.join(members)
        pair = pair[~pair.machine_id.duplicated(keep=False)].copy()
        pair['previous_week'], pair['week'] = previous, current
        pair['price_relative'] = pair.price / pair.previous_price
        eligible = (len(pair) >= minimum_pairs and w.loc[[previous,current], 'usable_days'].ge(minimum_week_days).all())
        relative = float(np.exp(np.log(pair.price_relative).mean())) if eligible else np.nan
        links.append(dict(week=current,matched_machines=len(pair),matched_hosts=pair.host_id.nunique(),
                          price_relative=relative,eligible=eligible))
        records.append(pair.reset_index())
    result = pd.DataFrame(links).set_index('week').reindex(weeks).rename_axis('week')
    chain = pd.Series(np.nan,index=weeks,dtype=float)
    if w.iloc[0].usable_days >= minimum_week_days:
        chain.iloc[0] = 100.
    for i in range(1,len(weeks)):
        chain.iloc[i] = chain.iloc[i-1] * result.price_relative.iloc[i]
    base = chain.loc[pd.Timestamp(base_week,tz='UTC')]
    if not np.isfinite(base) or base <= 0:
        raise ValueError('Reference week is not connected by valid price links')
    result['matched_price_index'] = 100 * chain / base
    return result, pd.concat(records,ignore_index=True)
