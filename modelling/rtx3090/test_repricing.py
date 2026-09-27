import unittest
import numpy as np
import pandas as pd
from repricing import daily_transitions, forecast_comparison, transition_host_sensitivity


def sample():
    records = []
    for day, prices in [('2026-05-01', {1: 100, 2: 120}),
                        ('2026-05-02', {1: 100, 2: 120, 3: 800}),
                        ('2026-05-03', {1: 150, 2: 180})]:
        for machine, price in prices.items():
            records.append(dict(day=pd.Timestamp(day, tz='UTC'), configuration=machine,
                machine_id=machine, host_id=machine, relative=price, observations=2))
    return pd.DataFrame(records)


class RepricingTests(unittest.TestCase):
    def test_all_transitions_separate_entry_from_price_change(self):
        data = sample()
        result = daily_transitions(data, data.day.unique(), minimum_machines=2, minimum_hosts=2)
        p95 = result[result.percentile.eq(.95)].reset_index(drop=True)
        self.assertEqual(len(result), 8)
        self.assertGreater(p95.iloc[0].visible_change_pp, 0)
        self.assertEqual(p95.iloc[0].matched_change_pp, 0)
        self.assertEqual(p95.iloc[0].entered, 1)
        self.assertAlmostEqual(p95.iloc[1].matched_after / p95.iloc[1].matched_before, 1.5)
        self.assertEqual(p95.iloc[1].exited, 1)

    def test_coverage_failure_stays_missing_with_counts(self):
        data = sample()
        result = daily_transitions(data, data.day.unique(), minimum_machines=3, minimum_hosts=2)
        self.assertTrue(result.matched_change_pp.isna().all())
        self.assertTrue(result.matched_machines.eq(2).all())
        self.assertFalse(result.eligible.any())

    def test_no_matching_across_missing_calendar_day(self):
        data = sample().loc[lambda x: x.day.ne(pd.Timestamp('2026-05-02', tz='UTC'))]
        result = daily_transitions(data, data.day.unique(), minimum_machines=1, minimum_hosts=1)
        self.assertTrue(result.matched_machines.eq(0).all())
        self.assertTrue(result.matched_change_pp.isna().all())

    def test_quote_count_gate_applies_to_both_dates(self):
        data = sample()
        data.loc[(data.machine_id == 1) & (data.day == data.day.min()), 'observations'] = 1
        result = daily_transitions(data, data.day.unique(), minimum_observations=2,
                                  minimum_machines=1, minimum_hosts=1)
        self.assertEqual(result.iloc[0].matched_machines, 1)

    def test_host_change_cannot_be_a_match(self):
        data = sample()
        data.loc[data.day.eq(pd.Timestamp('2026-05-02', tz='UTC')), 'host_id'] += 10
        result = daily_transitions(data, data.day.unique(), minimum_machines=1, minimum_hosts=1)
        self.assertTrue(result.matched_machines.eq(0).all())

    def test_omission_does_not_invent_values_when_gate_fails(self):
        data = sample()
        summary, paths = transition_host_sensitivity(data, data.day.unique())
        self.assertTrue(summary.valid_omissions.eq(0).all())
        self.assertTrue(summary.omission_min.isna().all())
        self.assertTrue(paths.matched_change_pp.isna().all())

    def test_duplicate_machine_rejected(self):
        data = sample()
        with self.assertRaises(ValueError):
            daily_transitions(pd.concat([data, data.iloc[[0]]]), data.day.unique())

    def test_forecast_cannot_use_future_prices(self):
        dates = pd.date_range('2026-02-17', '2026-06-01', tz='UTC')
        rng = np.random.default_rng(4)
        x = 100*np.exp(np.cumsum(rng.normal(0, .005, len(dates))))
        components = pd.DataFrame({'lower': x, 'median': x*1.1, 'upper': x*1.4}, index=dates)
        before, _, params = forecast_comparison(components)
        changed = components.copy()
        changed.loc['2026-05-15':] *= 3
        after, _, later_params = forecast_comparison(changed)
        pd.testing.assert_frame_equal(params, later_params)
        pd.testing.assert_frame_equal(before[before.day.le('2026-05-15')][['day','model','forecast_log']],
                                      after[after.day.le('2026-05-15')][['day','model','forecast_log']])
        changed.loc['2026-05-03'] = np.nan
        missing, _, _ = forecast_comparison(changed)
        self.assertTrue(missing.loc[missing.day.eq('2026-05-04'), 'forecast_log'].isna().all())

    def test_flat_reference_is_reported_not_forced_to_fit(self):
        dates = pd.date_range('2026-02-17', '2026-06-01', tz='UTC')
        components = pd.DataFrame(100., index=dates, columns=['lower','median','upper'])
        _, scores, params = forecast_comparison(components)
        self.assertEqual(set(scores.model), {'Persistence'})
        self.assertTrue(params[params.model.eq('Lag and weekend')].status.eq(
            'Insufficient independent training variation').all())


if __name__ == '__main__':
    unittest.main()
