import unittest
import numpy as np
import pandas as pd
from daily_baseline import level_path,fit_baseline,apply_baseline,episodes,chain_daily


class DailyModelChecks(unittest.TestCase):
    def history(self):
        dates=pd.date_range('2026-02-17','2026-08-14',tz='UTC')
        rng=np.random.default_rng(7)
        return pd.Series(100*np.exp(np.cumsum(rng.normal(0,.003,len(dates)))),index=dates)

    def test_baseline_does_not_use_todays_or_future_value(self):
        x=self.history();day=pd.Timestamp('2026-05-20',tz='UTC')
        base,params,grid=fit_baseline(x)
        shock=x.copy();shock.loc[day:]*=10
        revised,revised_params,revised_grid=fit_baseline(shock)
        self.assertEqual(params,revised_params)
        pd.testing.assert_frame_equal(grid,revised_grid)
        pd.testing.assert_series_equal(base.baseline.loc[:day],revised.baseline.loc[:day])
        self.assertNotEqual(base.residual.loc[day],revised.residual.loc[day])

    def test_market_index_preserved_and_update_bounded(self):
        x=self.history();x.iloc[100]*=10
        result,params,_=fit_baseline(x)
        pd.testing.assert_series_equal(result.observed,x,check_names=False,check_freq=False)
        updates=np.log(result.baseline).diff().abs().dropna()
        self.assertTrue((updates<=params['alpha']*params['update_cap']+1e-12).all())

    def test_sustained_level_eventually_adapts(self):
        days=pd.date_range('2026-01-01',periods=300,tz='UTC')
        x=pd.Series(np.r_[np.repeat(100.,10),np.repeat(120.,290)],index=days)
        path=level_path(x,7,.03)
        self.assertAlmostEqual(path.baseline.iloc[10],100.)
        self.assertAlmostEqual(path.baseline.iloc[-1],120.,places=5)

    def test_episode_confirmation_and_missing_days(self):
        days=pd.date_range('2026-05-01',periods=10,tz='UTC')
        r=pd.DataFrame({'status':pd.array([1,1,1,pd.NA,1,1,0,-1,-1,-1],dtype='Int64'),
                        'residual':[.1]*10,'deviation_pct':[10.]*10},index=days)
        e=episodes(r)
        self.assertEqual(e.days.to_list(),[3,3])
        self.assertEqual(e.confirmed.iloc[0],days[2])
        self.assertEqual(e.start.iloc[1],days[7])
        self.assertTrue(e.ongoing.iloc[-1])

    def test_missing_observations_are_not_filled(self):
        x=self.history();x.iloc[90]=np.nan
        r,_,_=fit_baseline(x)
        self.assertTrue(r.loc[x.index[90],['baseline','observed','residual']].isna().all())
        self.assertTrue(pd.isna(r.status.iloc[90]))

    def test_daily_matching_excludes_entries_and_breaks_on_missing_link(self):
        dates=pd.date_range('2026-04-28',periods=5,tz='UTC')
        daily=pd.DataFrame({'usable':True},index=dates)
        records=[]
        for i,day in enumerate(dates):
            for machine in range(3):
                if i==3:continue
                records.append(dict(configuration=machine,machine_id=machine,host_id=machine,
                    geo_country='X',geo_region='Y',gpu_ram=24,cpu_cores=8,cpu_ram=32,
                    day=day,price=1.1**i,observations=2))
        records.append(dict(configuration=9,machine_id=9,host_id=9,geo_country='X',geo_region='Y',
                            gpu_ram=24,cpu_cores=8,cpu_ram=32,day=dates[2],price=1000.,observations=2))
        w,p=chain_daily(pd.DataFrame(records),daily,str(dates[0].date()),minimum_pairs=2,minimum_hosts=2)
        self.assertAlmostEqual(w.matched_index.iloc[2],121.)
        self.assertTrue(w.matched_index.iloc[3:].isna().all())
        self.assertNotIn(9,p.machine_id.to_list())


if __name__=='__main__':unittest.main()
