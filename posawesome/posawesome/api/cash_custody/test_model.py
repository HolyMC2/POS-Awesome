import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('cash_model',pathlib.Path(__file__).with_name('model.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class TestCashCount(unittest.TestCase):
    def test_exact_minor_units(self):
        self.assertEqual(m.count({'denominations':[{'value':0.1,'quantity':3},{'value':0.2,'quantity':1}]})['total_minor'],50)

    def test_duplicate_negative_fractional_nonfinite(self):
        for rows in [[{'value':20,'quantity':-1}],[{'value':20,'quantity':0.5}],[{'value':20,'quantity':True}],
                     [{'value':20,'quantity':1},{'value':20,'quantity':1}],[{'value':'NaN','quantity':1}]]:
            with self.subTest(rows=rows),self.assertRaises(ValueError):m.count({'denominations':rows})

    def test_manual_evidence(self):
        c=m.count({'denominations':[{'value':100,'quantity':9}],'source':'manual','amount':'980','reason':'Counted additional coins separately'})
        self.assertEqual(c['derived_minor'],90000);self.assertEqual(c['total_minor'],98000)
        self.assertEqual(m.count(c),c)
        with self.assertRaises(ValueError):m.count({'source':'manual','amount':980})

    def test_minor_rejects_invalid_precision(self):
        for v in ['Infinity',-1,'1.001',None]:
            with self.subTest(v=v),self.assertRaises(ValueError):m.minor(v)

    def test_fingerprint_order_invariant(self):
        self.assertEqual(m.fingerprint({'a':1,'b':2}),m.fingerprint({'b':2,'a':1}))
        self.assertNotEqual(m.fingerprint({'a':1}),m.fingerprint({'a':2}))


if __name__=='__main__':unittest.main()
