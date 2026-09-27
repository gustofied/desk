import unittest
import numpy as np
import pandas as pd
from daily_baseline import chain_daily,fit_baseline
from market_checks import (direct_reference,omit_hosts_from_chain,coverage_sensitivity,
                           baseline_sensitivity,depth_baseline,recovery_thresholds,pre_event_holdout)


def row(machine,day,price,observations=3):
    return dict(configuration=machine,machine_id=machine,host_id=machine,
        geo_country='X',geo_region='Y',gpu_ram=24,cpu_cores=8,cpu_ram=32,
        day=day,price=price,observations=observations)


class MeasurementChecks(unittest.TestCase):
    def test_chain_and_direct_diverge_under_changing_survivors(self):
        days=pd.date_range('2026-04-30',periods=3,tz='UTC')
        q=pd.DataFrame([row(1,days[0],1),row(2,days[0],1),
                        row(1,days[1],2),row(3,days[1],1000),
                        row(2,days[2],1),row(3,days[2],2000)])
        daily=pd.DataFrame({'usable':True},index=days)
        chain,_=chain_daily(q,daily,minimum_pairs=1,minimum_hosts=1)
        direct,audit=direct_reference(q,days,minimum_pairs=1,minimum_hosts=1)
        self.assertAlmostEqual(chain.matched_index.iloc[-1],400.)
        self.assertAlmostEqual(direct.direct_index.iloc[-1],100.)
        self.assertNotIn(3,audit.machine_id.to_list())
        unsupported,_=direct_reference(q,days,minimum_pairs=2,minimum_hosts=2)
        self.assertTrue(np.isnan(unsupported.direct_index.iloc[-1]))

    def test_whole_host_omission_matches_a_full_recalculation(self):
        days=pd.date_range('2026-04-30',periods=5,tz='UTC')
        q=pd.DataFrame([row(h,d,1.+.2*h*i) for i,d in enumerate(days) for h in [1,2,3]])
        daily=pd.DataFrame({'usable':True},index=days)
        index,pairs=chain_daily(q,daily,minimum_pairs=2,minimum_hosts=2)
        paths,audit=omit_hosts_from_chain(pairs,index,minimum_pairs=2,minimum_hosts=2)
        self.assertTrue(audit.complete.all())
        for h in [1,2,3]:
            direct,_=chain_daily(q[q.host_id.ne(h)],daily,minimum_pairs=2,minimum_hosts=2)
            np.testing.assert_allclose(paths[h],direct.matched_index)

    def test_strict_quote_coverage_does_not_bridge_unsupported_days(self):
        days=pd.date_range('2026-04-30',periods=5,tz='UTC')
        q=pd.DataFrame([row(h,d,1.+.1*i,1 if i==2 and h>1 else 3)
                        for i,d in enumerate(days) for h in [1,2,3]])
        daily=pd.DataFrame({'usable':True},index=days)
        summary,links=coverage_sensitivity(q,daily,minimum_counts=(1,2),minimum_pairs=2,minimum_hosts=2)
        self.assertEqual(summary.iloc[1].first_break,'2026-05-02')
        strict=links[links.minimum_observations.eq(2)].set_index('day')
        self.assertTrue(strict.loc['2026-05-02':,'matched_index'].isna().all())

    def history(self):
        days=pd.date_range('2026-02-17','2026-08-14',tz='UTC')
        rng=np.random.default_rng(7)
        return pd.Series(100*np.exp(np.cumsum(rng.normal(0,.003,len(days)))),index=days)

    def test_grid_widths_and_holdout_do_not_use_future_values(self):
        x=self.history();_,p,c=fit_baseline(x)
        opts=dict(half_lives=(7,),cap_multipliers=(.5,2.,np.inf),quantiles=(.90,.99),persistence_days=(1,3))
        grid,_=baseline_sensitivity(x,p,c,**opts)
        changed=x.copy();changed.loc['2026-06-01':]*=5
        other,_=baseline_sensitivity(changed,p,c,**opts)
        np.testing.assert_allclose(grid.width,other.width)
        self.assertEqual(pre_event_holdout(x),pre_event_holdout(changed))
        self.assertEqual(len(grid),12)

    def test_depth_model_preserves_zeros_and_original_units(self):
        x=(self.history()/10-1).clip(lower=0);x.loc['2026-05-10':'2026-05-20']=0
        m,p,c,e=depth_baseline(x)
        np.testing.assert_allclose(m.observed,x)
        self.assertTrue(m.lower.ge(0).all())
        self.assertNotIn('deviation_pct',m.columns)
        np.testing.assert_allclose(m.deviation_listings,x-m.baseline)

    def test_recovery_requires_consecutive_days_and_respects_missing(self):
        days=pd.date_range('2026-04-01','2026-05-10',tz='UTC')
        d=pd.DataFrame({'availability':10.,'affordable_availability':10.,'usable':True},index=days)
        d.loc['2026-05-01':,['availability','affordable_availability']]=8.
        d.loc['2026-05-03','usable']=False
        result=recovery_thresholds(d,after='2026-05-01',thresholds=(.8,),persistence=3)
        self.assertTrue(result.confirmed.eq(pd.Timestamp('2026-05-06',tz='UTC')).all())
        self.assertTrue(result.recovery_start.eq(pd.Timestamp('2026-05-04',tz='UTC')).all())


if __name__=='__main__':unittest.main()
