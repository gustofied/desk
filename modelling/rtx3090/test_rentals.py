"""Checks on rental identification and missing collection coverage."""
import unittest
import numpy as np
import pandas as pd
from indices import clean_observations,select_segment
from rentals import infer_rentals,daily_rentals


def fixture(return_scan=45,periods=70):
    times=pd.date_range('2026-03-02',periods=periods,freq='10min',tz='UTC')
    records=[]
    for i,t in enumerate(times):
        for machine in ([1,2] if i<3 or i>=return_scan else [2]):
            records.append(dict(snapshot_id=str(i),timestamp=t,machine_id=machine,
                host_id=10,ask_id=100*machine+i,price_usd_hour=.12 if machine==1 else .24,
                verified=True,reliability=.999,cpu_cores=16,cpu_ram=32000,
                gpu_ram=24576,geo_country='US',geo_region='CA'))
    raw=pd.DataFrame(records)
    meta=pd.DataFrame(dict(snapshot_id=list(map(str,range(periods))),timestamp=times,
        status='ok',logger_version='3.2'))
    meta['row_count']=meta.snapshot_id.map(raw.groupby('snapshot_id').size())
    return raw,meta


def prepare(raw,meta):
    clean,scans,_=clean_observations(raw,meta)
    return select_segment(clean),scans


class RentalChecks(unittest.TestCase):
    def test_one_start_last_rate_and_full_six_hour_absence(self):
        raw,meta=fixture();q,s=prepare(raw,meta)
        e=infer_rentals(raw,q,s)
        self.assertEqual(e.machine_id.tolist(),[1])
        self.assertEqual(e.iloc[0].inferred_rental_rate,.12)
        self.assertEqual(e.iloc[0].first_absent,pd.Timestamp('2026-03-02 00:30',tz='UTC'))
        self.assertEqual(e.iloc[0].confirmed_at,pd.Timestamp('2026-03-02 06:30',tz='UTC'))
        self.assertTrue(e.iloc[0].uncapped_window)

    def test_presence_at_confirmation_prevents_identification(self):
        raw,meta=fixture(return_scan=39);q,s=prepare(raw,meta)
        self.assertTrue(infer_rentals(raw,q,s).empty)

    def test_collection_break_and_dataset_end_cannot_confirm(self):
        for failure in [True,False]:
            raw,meta=fixture(periods=70 if failure else 30)
            if failure:meta.loc[meta.snapshot_id.eq('20'),'status']='error'
            q,s=prepare(raw,meta)
            self.assertTrue(infer_rentals(raw,q,s).empty)

    def test_presence_outside_segment_still_ends_absence(self):
        raw,meta=fixture()
        row=raw[raw.machine_id.eq(1)].iloc[[0]].copy()
        row['snapshot_id']='25';row['timestamp']=meta.loc[25,'timestamp']
        row['verified']=False;row['price_usd_hour']=-1
        raw=pd.concat([raw,row],ignore_index=True);meta.loc[25,'row_count']+=1
        q,s=prepare(raw,meta)
        self.assertTrue(infer_rentals(raw,q,s).empty)

    def test_configuration_change_resets_stability(self):
        raw,meta=fixture();raw.loc[raw.machine_id.eq(1)&raw.snapshot_id.eq('2'),'geo_region']='NY'
        q,s=prepare(raw,meta)
        self.assertTrue(infer_rentals(raw,q,s).empty)

    def test_cap_anywhere_in_confirmation_window_is_recorded(self):
        raw,meta=fixture();q,s=prepare(raw,meta);s.loc[s.scan.eq(20),'capped']=True
        e=infer_rentals(raw,q,s)
        self.assertEqual(len(e),1);self.assertFalse(e.iloc[0].uncapped_window)

    def test_missing_followup_is_not_reported_as_zero_activity(self):
        raw,meta=fixture(periods=3*144);q,s=prepare(raw,meta)
        events=infer_rentals(raw,q,s)
        days=pd.date_range('2026-03-02',periods=3,tz='UTC')
        daily=pd.DataFrame({'usable':True},index=days)
        d=daily_rentals(events,s,daily)
        self.assertEqual(d.iloc[0].rental_starts,1)
        self.assertEqual(d.iloc[1].rental_starts,0)
        self.assertTrue(np.isnan(d.iloc[2].rental_starts))
        self.assertTrue(np.isnan(d.iloc[0].median_inferred_rate))


if __name__=='__main__':unittest.main()
