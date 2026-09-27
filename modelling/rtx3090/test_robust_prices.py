import unittest
import numpy as np
import pandas as pd
from robust_prices import fit_week,calibrate_scale,chain


class RobustChecks(unittest.TestCase):
    def test_single_bad_quote_is_bounded_even_when_every_other_quote_is_fixed(self):
        ordinary = np.r_[np.log(10.),np.zeros(99)]
        fit,audit=fit_week(ordinary,.06)
        self.assertAlmostEqual(fit['robust_log_change'],1.345*.06/100)
        self.assertLess(fit['robust_log_change'],ordinary.mean()/20)
        self.assertEqual(fit['flagged'],1)
        self.assertEqual(audit.changed.sum(),1)

    def test_broad_and_partial_common_repricing_are_retained_in_both_directions(self):
        for ratio in [1.2,.8]:
            for n in [40,100]:
                changes=np.r_[np.repeat(np.log(ratio),n),np.zeros(100-n)]
                fit,audit=fit_week(changes,.06)
                self.assertAlmostEqual(fit['robust_log_change'],changes.mean())
                self.assertEqual(fit['flagged'],0)

    def test_no_changes_and_sign_symmetry(self):
        fit,_=fit_week(np.zeros(50),.06)
        self.assertEqual(fit['robust_log_change'],0)
        x=np.r_[np.linspace(-.03,.10,20),2.,np.zeros(30)]
        up,_=fit_week(x,.06);down,_=fit_week(-x,.06)
        self.assertAlmostEqual(up['robust_log_change'],-down['robust_log_change'])
        self.assertEqual(up['flagged'],down['flagged'])

    def test_calibration_does_not_see_future_or_a_week_crossing_cutoff(self):
        p=pd.DataFrame({'week':pd.Timestamp('2026-03-23',tz='UTC'),
                        'price_relative':np.exp(np.linspace(-.1,.1,30))})
        baseline=calibrate_scale(p,'2026-04-01')
        future=pd.DataFrame({'week':[pd.Timestamp('2026-03-30',tz='UTC')]*50,
                             'price_relative':np.repeat(100.,50)})
        self.assertEqual(baseline,calibrate_scale(pd.concat([p,future]),'2026-04-01'))

    def test_missing_links_break_chain_and_invalid_changes_fail(self):
        dates=pd.date_range('2026-02-16',periods=4,freq='7D',tz='UTC')
        result=chain(pd.Series([np.nan,.1,np.nan,.2],index=dates),'2026-02-16')
        self.assertTrue(result.iloc[2:].isna().all())
        with self.assertRaises(ValueError):fit_week([np.nan],.06)
        with self.assertRaises(ValueError):fit_week([0.],0.)


if __name__=='__main__':unittest.main()
