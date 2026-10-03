import unittest
from unittest.mock import patch, Mock
import worker
from report_schema import verified_report
import test_worker


class ManagementReviewTests(unittest.TestCase):
    def test_admin_recovery_preserves_evidence_and_hides_metadata(self):
        fixture=test_worker.WorkerTests();fixture.setUp()
        try:
            job_id=fixture.create(status='failed')
            evidence={'chunks':[{'summary':'saved evidence'}]}
            metadata={'source_kind':'twitch_replay','private_value':'secret','periods':[]}
            worker.update_metadata(job_id,metadata,'failed',evidence,'failed')
            handler=object.__new__(worker.Handler)
            handler.connection=Mock();handler.reply=Mock();handler.body=Mock(return_value={})
            handler.path='/internal/replay-jobs/'+job_id
            handler.command='GET';handler.headers={}
            with patch.object(worker,'REPLAY_ADMIN_TOKEN','test-admin'):
                with self.assertRaises(worker.Problem) as denied: handler.dispatch()
                self.assertEqual(denied.exception.status,404)
                handler.headers={'X-Replay-Admin':'test-admin'}
                handler.dispatch()
                response=handler.reply.call_args.args[1]
                self.assertNotIn('metadata',response)
                self.assertEqual(response['result'],evidence)
                handler.path+='/retry';handler.command='POST';handler.dispatch()
                job=worker.get_job(job_id)
                self.assertEqual(job['status'],'queued')
                self.assertEqual(job['result'],evidence)
                self.assertEqual(job['metadata'],metadata)
                self.assertTrue((worker.ROOT/job_id/'source.mp4').exists())
                worker.update(job_id,'ready_for_review',result=evidence)
                with self.assertRaises(worker.Problem) as completed: handler.dispatch()
                self.assertEqual(completed.exception.status,409)
        finally:
            fixture.tearDown()

    def test_overtime_is_not_folded_into_third_period(self):
        spans=[{'label':label,'start':i*100,'end':(i+1)*100}
               for i,label in enumerate(['Period 1','Period 2','Period 3','Overtime','Overtime 2'])]
        periods=worker.normalize_regulation_periods(spans,500)
        self.assertEqual([p['label'] for p in periods],['Period 1','Period 2','Period 3','Overtime 1','Overtime 2'])
        self.assertEqual(periods[2]['end'],300)

    def test_period_regression_requires_manual_restart_mapping(self):
        spans=[{'label':label,'start':i*100,'end':(i+1)*100}
               for i,label in enumerate(['Period 1','Period 2','Period 1','Period 3'])]
        self.assertEqual(worker.normalize_regulation_periods(spans,400),[])

    def test_missing_detection_stops_before_ai_and_keeps_original(self):
        fixture=test_worker.WorkerTests();fixture.setUp()
        try:
            job_id=fixture.create()
            with worker.connect() as db:
                db.execute("UPDATE jobs SET metadata='{}' WHERE id=?",(job_id,))
            with patch.object(worker,'detect_periods',return_value=[]),patch.object(worker,'analyze') as analyze:
                worker.process(job_id)
                analyze.assert_not_called()
            self.assertEqual(worker.get_job(job_id)['status'],'needs_periods')
            self.assertTrue((worker.ROOT/job_id/'source.mp4').exists())
        finally:
            fixture.tearDown()

    def test_ratings_require_named_independent_gameplay_and_unit_support(self):
        chunks=[{'start':0,'end':120,'review':{'observations':[
            {'source':'gameplay','timestamp':10,'player':'A'},
            {'source':'gameplay','timestamp':40,'player':'A'},
            {'source':'lobby','timestamp':50,'player':'B'}]}}]
        report={'game_rating':{'score':70},'player_reports':[
            {'player':'A','rating':{'score':75},'evidence_timestamps':[10,40,99]},
            {'player':'B','rating':{'score':99},'evidence_timestamps':[50]}],
            'unit_reports':[{'players':['A','B'],'evidence_timestamps':[10,40],'rating':{'score':95}}]}
        actual=verified_report(report,chunks)
        self.assertEqual([p['player'] for p in actual['player_reports']],['A'])
        self.assertEqual(actual['player_reports'][0]['evidence_timestamps'],[10,40])
        self.assertEqual(actual['player_reports'][0]['rating']['score'],75)
        self.assertEqual(actual['unit_reports'],[])

    def test_overlapping_closer_looks_do_not_establish_a_rating(self):
        chunks=[{'start':0,'end':120,'review':{'observations':[
            {'source':'gameplay','timestamp':10,'player':'A'},
            {'source':'gameplay','timestamp':12,'player':'A'}]}}]
        report=verified_report({'game_rating':{'score':100},'player_reports':[]},chunks)
        self.assertIsNone(report['game_rating']['score'])


if __name__=='__main__': unittest.main()
