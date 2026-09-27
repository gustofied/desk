"""Statistical boundaries: missing scans, price ceilings, selection and basket weights."""
import unittest
import numpy as np
import pandas as pd
from indices import clean_observations, select_segment, scan_market, weekly_market, weekly_machine_quotes, chained_matched_prices


class IndexChecks(unittest.TestCase):
    def test_successful_empty_is_zero_failed_is_unknown_budget_is_inclusive(self):
        dates = pd.date_range('2026-03-02', periods=3, freq='10min', tz='UTC')
        raw = pd.DataFrame([dict(snapshot_id='0', timestamp=dates[0], machine_id=1,
            host_id=10, price_usd_hour=.2, verified=True, reliability=.999,
            cpu_cores=16, cpu_ram=32000, geo_country='US')])
        meta = pd.DataFrame(dict(snapshot_id=['0','1','2'], timestamp=dates,
            status=['ok','ok','error'], row_count=[1,0,0], logger_version='v1'))
        rows, scans, audit = clean_observations(raw, meta)
        market = scan_market(select_segment(rows), scans, budget=.2)
        self.assertEqual(market.loc[0, 'affordable_offers'], 1)
        self.assertEqual(market.loc[1, 'available_offers'], 0)
        self.assertTrue(np.isnan(market.loc[1, 'available_ask']))
        self.assertNotIn(2, market.index)
        self.assertEqual(audit['valid_empty_scans'], 1)

    def test_low_coverage_week_is_missing_not_zero(self):
        dates = pd.date_range('2026-03-02', periods=14, freq='D', tz='UTC')
        daily = pd.DataFrame(dict(usable=True, availability=20., affordable_availability=10.,
                                  available_ask=.2, capped_share=0.), index=dates)
        daily.loc[dates[-3:], 'usable'] = False
        daily.loc[dates[-3:], ['availability','affordable_availability','available_ask','capped_share']] = np.nan
        weekly, _ = weekly_market(daily)
        self.assertEqual(weekly.iloc[0].availability_index, 100)
        self.assertTrue(np.isnan(weekly.iloc[1].availability_index))

    def test_links_exclude_missing_weeks_and_changed_configuration(self):
        dates = pd.date_range('2026-05-04', periods=21, freq='D', tz='UTC')
        daily = pd.DataFrame({'usable': True}, index=dates)
        rows = []
        for week in range(3):
            for machine in range(1,5):
                if machine == 3 and week == 1:
                    continue
                for day in range(3):
                    # Unequal scan frequency must not weight one machine more.
                    for obs in range(12 if machine == 1 else 24):
                        rows.append(dict(timestamp=dates[week*7+day] + pd.Timedelta(minutes=obs),
                            machine_id=machine, host_id=10, geo_country='US', geo_region='CA',
                            gpu_ram=24576, cpu_cores=16 if machine != 4 or week == 0 else 32,
                            cpu_ram=32000, price_usd_hour=(.1 * 2**week if machine == 1 else .4 / 2**week)))
        weekly = pd.DataFrame({'usable_days':7}, index=dates[::7])
        quotes = weekly_machine_quotes(pd.DataFrame(rows), daily)
        links, pairs = chained_matched_prices(quotes, weekly, minimum_pairs=2)
        first = pairs[pairs.week.eq(dates[7])]
        self.assertEqual(set(first.machine_id), {1,2})
        self.assertAlmostEqual(links.loc[dates[7],'matched_price_index'],100.)
        # Unequal observation frequencies do not change equal machine weights.
        daily.loc[dates[8], 'usable'] = False
        sparse = weekly_machine_quotes(pd.DataFrame(rows), daily)
        links, _ = chained_matched_prices(sparse, weekly, minimum_pairs=2)
        self.assertTrue(links.matched_price_index.iloc[1:].isna().all())

    def test_changing_cohort_chains_price_relatives_not_quote_levels(self):
        dates = pd.date_range('2026-05-04',periods=3,freq='7D',tz='UTC')
        rows = []
        for machine, prices in {1:[.1,.2,None],2:[.4,.2,.4],3:[None,1.,2.]}.items():
            for week, price in zip(dates,prices):
                if price is not None:
                    rows.append(dict(configuration=machine,machine_id=machine,week=week,price=price,
                        host_id=10,geo_country='US',geo_region='CA',gpu_ram=24576,cpu_cores=16,cpu_ram=32000))
        weekly = pd.DataFrame({'usable_days':7},index=dates)
        links, pairs = chained_matched_prices(pd.DataFrame(rows),weekly,minimum_pairs=2)
        np.testing.assert_allclose(links.matched_price_index,[100.,100.,200.])
        self.assertEqual(links.loc[dates[2],'matched_machines'],2)
        # A missing calendar week cannot be bridged by a later reappearance.
        links, _ = chained_matched_prices(pd.DataFrame(rows),weekly.drop(dates[1]),minimum_pairs=2)
        self.assertTrue(links.matched_price_index.iloc[1:].isna().all())

    def test_insufficient_overlap_or_coverage_breaks_chain(self):
        dates = pd.date_range('2026-05-04',periods=3,freq='7D',tz='UTC')
        quotes = pd.DataFrame([dict(configuration=1,machine_id=1,week=week,price=.2,
            host_id=10,geo_country='US',geo_region='CA',gpu_ram=24576,cpu_cores=16,cpu_ram=32000)
            for week in dates])
        weekly = pd.DataFrame({'usable_days':7},index=dates)
        links, _ = chained_matched_prices(quotes,weekly,minimum_pairs=2)
        self.assertTrue(links.matched_price_index.iloc[1:].isna().all())
        weekly.loc[dates[1],'usable_days'] = 4
        links, _ = chained_matched_prices(quotes,weekly,minimum_pairs=1)
        self.assertTrue(links.matched_price_index.iloc[1:].isna().all())
        with self.assertRaisesRegex(ValueError,'not connected'):
            chained_matched_prices(quotes,weekly,base_week='2026-05-18',minimum_pairs=1)


if __name__ == '__main__':
    unittest.main()
