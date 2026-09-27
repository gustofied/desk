import unittest
import pandas as pd
from history_coverage import coverage_profile, reference_members


class HistoryCoverageTests(unittest.TestCase):
    def test_days_are_not_rows_or_elapsed_span_and_edges_count(self):
        dates = pd.date_range('2026-04-01', periods=10, tz='UTC')
        q = pd.DataFrame(dict(configuration=[1]*5, machine_id=[1]*5, host_id=[2]*5,
                             day=dates[[2, 2, 3, 7, 7]]))
        r = coverage_profile(q, dates).iloc[0]
        self.assertEqual(r.recorded_days, 3)
        self.assertEqual(r.span_days, 6)
        self.assertEqual(r.longest_missing_days, 3)
        self.assertEqual(r.longest_recorded_run, 2)

    def test_gap_count_is_independent_of_datetime_storage_resolution(self):
        dates = pd.date_range('2026-04-01', periods=10, tz='UTC').as_unit('us')
        q = pd.DataFrame(dict(configuration=[1, 1], host_id=[1, 1], day=dates[[0, 9]]))
        self.assertEqual(coverage_profile(q, dates).iloc[0].longest_missing_days, 8)

    def test_distinguishes_machine_history_from_configuration_history(self):
        dates = pd.date_range('2026-04-01', periods=10, tz='UTC')
        q = pd.DataFrame(dict(configuration=[1]*5+[2]*5, machine_id=[7]*10,
                             host_id=[9]*10, day=dates))
        self.assertEqual(coverage_profile(q, dates, 'machine_id').iloc[0].recorded_days, 10)
        self.assertTrue(coverage_profile(q, dates).recorded_days.eq(5).all())

    def test_calendar_must_expose_missing_days(self):
        dates = pd.date_range('2026-04-01', periods=3, tz='UTC')[[0, 2]]
        with self.assertRaises(ValueError):
            coverage_profile(pd.DataFrame(), dates)

    def test_pre_may_membership_cannot_depend_on_future_survival(self):
        records = []
        for machine, start in [(1, '2026-03-01'), (2, '2026-04-20')]:
            for day in pd.date_range(start, '2026-08-14', tz='UTC'):
                records.append(dict(configuration=machine, machine_id=machine, host_id=machine,
                    day=day, price=1., geo_country='US', geo_region='CA',
                    gpu_ram=24576, cpu_cores=8, cpu_ram=64000))
        q = pd.DataFrame(records)
        members = reference_members(q)
        self.assertEqual(members.configuration.tolist(), [1])
        pd.testing.assert_frame_equal(members, reference_members(q[q.day.lt('2026-05-01')]))
        self.assertEqual(members.iloc[0].reference_days, 30)


if __name__ == '__main__':
    unittest.main()
