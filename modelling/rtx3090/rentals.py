"""Infer rental starts from validated listing histories.

Identification assumption: a stable machine listing absent for at least six
hours is rented at its last posted rate. These are event classifications, not
transaction records. Never invent activity outside observed collection blocks.
"""
import numpy as np
import pandas as pd
from indices import MATCH_KEYS


def infer_rentals(raw, segment, scans, hours=6, stable_sightings=3):
    """One event per stable listing exit, confirmed with continuous follow-up.

    All valid-scan rows establish machine presence, regardless of segment or
    price validity. A changed offer ID alone is not a rental. The cap flag is
    an audit of the entire qualification/confirmation window.
    """
    if hours<=0 or stable_sightings<1:raise ValueError('Positive duration and sightings required')
    timeline=scans.set_index('scan')
    presence=raw.drop_duplicates().merge(
        scans.loc[scans.valid,['snapshot_id','scan','block','clean_next']],
        on='snapshot_id',how='inner',validate='many_to_one')
    presence=presence[presence.machine_id.notna()].sort_values(['machine_id','scan']).reset_index(drop=True)
    group=presence.groupby('machine_id',sort=False)
    presence['next_scan']=group.scan.shift(-1)
    presence['next_time']=group.timestamp.shift(-1)
    breaks=(presence.machine_id.ne(presence.machine_id.shift())|
        presence.scan.diff().ne(1)|presence.block.ne(presence.block.shift()))
    for col in MATCH_KEYS[1:]:
        same=presence[col].eq(presence[col].shift())|(presence[col].isna()&presence[col].shift().isna())
        breaks|=~same
    presence['streak']=presence.groupby(breaks.cumsum()).cumcount()+1
    exits=presence[presence.clean_next&presence.next_scan.ne(presence.scan+1)&
        presence.streak.ge(stable_sightings)].copy()
    exits=exits.merge(segment[['snapshot_id','machine_id']].drop_duplicates(),
        on=['snapshot_id','machine_id'],how='inner',validate='one_to_one')
    exits['first_absent']=(exits.scan+1).map(timeline.timestamp)
    scan_times=scans.timestamp.to_numpy(dtype='datetime64[ns]').astype(np.int64)
    targets=(exits.first_absent+pd.Timedelta(hours=hours)).to_numpy(dtype='datetime64[ns]').astype(np.int64)
    confirmation=np.searchsorted(scan_times,targets,side='left')
    within=confirmation<len(scans)
    exits['confirmation_scan']=np.minimum(confirmation,len(scans)-1)
    exits['confirmed_at']=exits.confirmation_scan.map(timeline.timestamp)
    uninterrupted=exits.confirmation_scan.map(timeline.block).eq(exits.block)
    absent=exits.next_scan.isna()|exits.next_scan.gt(exits.confirmation_scan)
    exits=exits[within&uninterrupted&absent].copy()
    cap_sum=np.r_[0,scans.capped.to_numpy(dtype=int).cumsum()]
    start=exits.scan.to_numpy()-stable_sightings+1
    end=exits.confirmation_scan.to_numpy()+1
    exits['uncapped_window']=(cap_sum[end]-cap_sum[start])==0
    exits['day']=exits.first_absent.dt.floor('D')
    exits['inference_hours']=hours
    exits=exits.rename(columns={'timestamp':'last_seen','price_usd_hour':'inferred_rental_rate'})
    return exits[['machine_id','host_id','ask_id','geo_country','last_seen','first_absent',
        'confirmed_at','next_time','inferred_rental_rate','day','scan','confirmation_scan',
        'uncapped_window','inference_hours']].reset_index(drop=True)


def daily_rentals(events,scans,daily,hours=6,minimum_followup_share=.9,minimum_rates=10):
    """Daily starts with collection follow-up coverage, not an occupancy measure.

    Require >=90% of valid scan times to permit uninterrupted six-hour follow-up
    for cross-day chart comparisons. Raw detected counts are retained separately.
    Rate medians require ten classified starts; each event receives one vote.
    """
    times=scans.timestamp.to_numpy(dtype='datetime64[ns]').astype(np.int64)
    targets=(scans.timestamp+pd.Timedelta(hours=hours)).to_numpy(dtype='datetime64[ns]').astype(np.int64)
    end=np.searchsorted(times,targets,side='left')
    within=end<len(scans)
    end=np.minimum(end,len(scans)-1)
    followup=(within&scans.clean_in.to_numpy(dtype=bool)&
        (scans.block.to_numpy()==scans.block.to_numpy()[end]))
    coverage=pd.DataFrame({'day':scans.day,'valid':scans.valid,'followup':followup})
    coverage=coverage[coverage.valid].groupby('day').followup.mean()
    stats=events.groupby('day').agg(detected_starts=('machine_id','size'),
        rental_hosts=('host_id','nunique'),median_inferred_rate=('inferred_rental_rate','median'),
        uncapped_starts=('uncapped_window','sum'))
    result=daily[['usable']].join(coverage.rename('followup_share')).join(stats)
    for c in ['detected_starts','rental_hosts','uncapped_starts']:result[c]=result[c].fillna(0).astype(int)
    result['publish']=result.usable&result.followup_share.ge(minimum_followup_share)
    result['rental_starts']=result.detected_starts.where(result.publish)
    result['median_inferred_rate']=result.median_inferred_rate.where(
        result.publish&result.detected_starts.ge(minimum_rates))
    return result
