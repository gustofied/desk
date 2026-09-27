import unittest
import numpy as np
import pandas as pd
from component_diagnostics import common_sample_transitions, selected_date_panel, component_path


def rows():
    data = []
    for date, machines in [('2026-05-06', [(1,100), (2,110)]),
                           ('2026-05-07', [(1,100), (2,110), (3,900)]),
                           ('2026-05-08', [(1,120), (2,130)])]:
        for machine, value in machines:
            data.append(dict(day=pd.Timestamp(date,tz='UTC'), configuration=machine,
                machine_id=machine,host_id=machine,relative=value,observations=2 if machine<3 else 1))
    return pd.DataFrame(data)


class DiagnosticTests(unittest.TestCase):
    def test_entry_can_raise_quantile_without_common_machine_repricing(self):
        table=common_sample_transitions(rows(),[('2026-05-06','2026-05-07')])
        upper=table[table.percentile.eq(.95)].iloc[0]
        self.assertGreater(upper.all_after,upper.all_before)
        self.assertEqual(upper.common_before,upper.common_after)
        self.assertEqual(upper.common_change_pct,0)
        self.assertEqual(upper.common_machines,2)

    def test_common_panel_requires_presence_on_every_selected_date(self):
        summary,panel=selected_date_panel(rows(),['2026-05-06','2026-05-07','2026-05-08'])
        self.assertEqual(set(panel.machine_id),{1,2})
        self.assertTrue(summary.machines.eq(2).all())
        self.assertEqual(summary.loc[0,'upper'],summary.loc[1,'upper'])
        self.assertGreater(summary.loc[2,'lower'],summary.loc[1,'lower'])

    def test_missing_selected_date_produces_empty_panel(self):
        summary,panel=selected_date_panel(rows(),['2026-05-06','2026-05-09'])
        self.assertTrue(panel.empty)
        self.assertTrue(summary['lower'].isna().all())

    def test_quote_threshold_preserves_reference_values_and_missing_days(self):
        dates=pd.date_range('2026-05-06',periods=4,tz='UTC')
        one,_=component_path(rows(),dates,.95,1,2,2)
        two,counts=component_path(rows(),dates,.95,2,2,2)
        self.assertGreater(one.iloc[1],two.iloc[1])
        self.assertEqual(two.iloc[1],109.5)
        self.assertTrue(np.isnan(two.iloc[-1]))
        self.assertEqual(counts.iloc[-1].machines,0)

    def test_host_gate_survives_quote_filter(self):
        data=rows();data['host_id']=1
        series,_=component_path(data,pd.DatetimeIndex(data.day.unique()),.1,1,2,2)
        self.assertTrue(series.isna().all())

    def test_duplicate_machine_is_rejected(self):
        data=pd.concat([rows(),rows().iloc[[0]]])
        with self.assertRaises(ValueError):
            component_path(data,pd.DatetimeIndex(data.day.unique()),.1)


if __name__=='__main__':unittest.main()
