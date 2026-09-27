import unittest
import numpy as np
import pandas as pd
from price_components import april_cohort, price_components, segment_coverage


def fixture():
    rows = []
    for day in pd.date_range('2026-04-01', '2026-05-04', tz='UTC'):
        for machine, price in [(1, 1.), (2, 10.)]:
            rows.append(dict(day=day, configuration=machine, machine_id=machine,
                host_id=machine, geo_country='US', geo_region='CA', gpu_ram=24576,
                cpu_cores=16, cpu_ram=64, price=price, observations=10))
    return pd.DataFrame(rows)


class CohortTests(unittest.TestCase):
    def test_future_prices_and_new_machines_do_not_change_membership_or_reference(self):
        q = fixture()
        expected = april_cohort(q)
        changed = q.copy()
        changed.loc[changed.day.ge('2026-05-01'), 'price'] *= 500
        newcomer = changed[changed.day.ge('2026-05-01')].copy()
        newcomer['configuration'] += 100; newcomer['machine_id'] += 100
        pd.testing.assert_frame_equal(expected, april_cohort(pd.concat([changed, newcomer])))

    def test_same_proportional_change_is_independent_of_machine_price_level(self):
        q = fixture(); cohort = april_cohort(q)
        q.loc[q.day.eq('2026-05-01'), 'price'] *= 2
        dates = pd.date_range('2026-05-01', periods=4, tz='UTC')
        daily, _ = price_components(q, cohort, dates, 2, 2)
        np.testing.assert_allclose(daily.loc[dates[0], ['lower', 'median', 'upper']].astype(float), 200.)
        np.testing.assert_allclose(daily.loc[dates[1], ['lower', 'median', 'upper']].astype(float), 100.)

    def test_absent_machines_are_not_carried_forward_and_coverage_is_enforced(self):
        q = fixture(); cohort = april_cohort(q)
        q = q[~(q.day.eq('2026-05-02') & q.machine_id.eq(1))]
        dates = pd.date_range('2026-05-01', periods=4, tz='UTC')
        daily, rows = price_components(q, cohort, dates, 2, 2)
        self.assertEqual(daily.loc[dates[1], 'machines'], 1)
        self.assertFalse(daily.loc[dates[1], 'eligible'])
        self.assertTrue(pd.isna(daily.loc[dates[1], 'lower']))
        self.assertTrue(daily.loc[dates[2], 'eligible'])

    def test_multiple_configurations_do_not_double_count_one_machine(self):
        q = fixture(); alternate = q[q.machine_id.eq(1)].copy()
        alternate['configuration'] = 3; alternate['cpu_cores'] = 32
        q = pd.concat([q, alternate]); cohort = april_cohort(q)
        day = pd.DatetimeIndex([pd.Timestamp('2026-05-01', tz='UTC')])
        daily, rows = price_components(q, cohort, day, 1, 1)
        self.assertEqual(daily.iloc[0].machines, 1)
        self.assertEqual(rows.machine_id.tolist(), [2])

    def test_machine_counts_cannot_substitute_for_host_coverage(self):
        q = fixture(); q['host_id'] = 1
        cohort = april_cohort(q)
        daily, _ = price_components(q, cohort, pd.DatetimeIndex(q.day.unique()), 2, 2)
        self.assertFalse(daily.eligible.any())
        self.assertTrue(daily['upper'].isna().all())

    def test_invalid_gap_is_retained_by_segment_audit(self):
        q = fixture(); dates = pd.date_range('2026-04-29', periods=4, tz='UTC')
        pairs = q[q.day.isin([dates[1], dates[3]])]
        result = segment_coverage(q, pairs, dates, 2, 2).set_index('segment').loc['US']
        self.assertEqual(result.supported_links, 2)
        self.assertEqual(result.total_links, 3)
        self.assertEqual(result.first_invalid_day, '2026-05-01')


if __name__ == '__main__':
    unittest.main()
