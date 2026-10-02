import unittest
from unittest.mock import patch
from pathlib import Path
import worker
import replay

class PeriodPartTests(unittest.TestCase):
    def test_cap_and_contiguous_source_offsets(self):
        units=worker.bounded_period_units([{'label':'Period 3','start':800,'end':2100}])
        self.assertEqual([(u['start'],u['end']) for u in units],[(800,1400),(1400,2000),(2000,2100)])
        self.assertTrue(all(u['end']-u['start']<=600 for u in units))
        self.assertTrue(all(u['label']=='Period 3' for u in units))

    def test_byte_limit_split_preserves_completed_units_and_stops_at_floor(self):
        metadata={'period_units':[{'label':'Period 1','start':0,'end':100},
                                  {'label':'Period 2','start':100,'end':700}],
                  'period_unit_index':1,'active_replay_unit':{'kind':'period'}}
        self.assertTrue(replay.split_download_unit(metadata))
        self.assertEqual(metadata['period_unit_index'],1)
        self.assertEqual([(u['start'],u['end']) for u in metadata['period_units']],[(0,100),(100,400),(400,700)])
        self.assertEqual(metadata['period_units'][1]['label'],'Period 2')
        self.assertNotIn('active_replay_unit',metadata)
        metadata['period_units'][1]['end']=130
        metadata['active_replay_unit']={'kind':'period'}
        self.assertFalse(replay.split_download_unit(metadata))

    def test_period_synthesis_waits_for_last_part_and_aggregates_all_parts(self):
        units=worker.bounded_period_units([{'label':'Period 1','start':0,'end':700}])
        existing={'label':'Period 1','start':0,'end':600,'review':{'summary':'first','observations':[]}}
        result={'chunks':[existing],'period_reports':[]}
        metadata={'period_units':units,'period_unit_index':0,'replay_phase':'analyze_periods'}
        job={'metadata':metadata,'result':result}
        with patch.object(worker,'get_job',return_value=job),patch('pathlib.Path.exists',return_value=True),patch('pathlib.Path.unlink'),patch.object(worker,'probe',return_value=600),patch.object(worker,'segments',return_value=[]),patch.object(worker,'update'),patch.object(worker,'update_metadata'),patch.object(worker,'ai_configured',return_value=True),patch.object(worker,'build_rollup',return_value={'summary':'complete'}) as rollup,patch.object(worker,'AUTO_RELEASE_TWITCH_MEDIA',False):
            worker.process_streamed_replay('test')
            rollup.assert_not_called()
            metadata['period_unit_index']=1
            result['chunks'].append({'label':'Period 1','start':600,'end':700,'review':{'summary':'last','observations':[]}})
            worker.process_streamed_replay('test')
            self.assertEqual(len(result['period_reports']),1)
            self.assertEqual(len(rollup.call_args_list[0].args[0]),2)
            self.assertIn('game_rollup',result)

if __name__=='__main__': unittest.main()

