"""Three report layers built from reviewed evidence; ratings describe this game only."""
import math

SYSTEMS = ('offensive_structure defensive_structure forecheck breakout neutral_zone entries exits '
           'puck_support rush_offense cycle_offense slot_creation shot_selection defensive_zone_coverage '
           'slot_protection rush_defense transition_after_turnovers special_teams repeatable_strengths '
           'repeatable_problems opponent_adjustments next_game_adjustments').split()

def obj(properties):
    return {'type': 'object', 'additionalProperties': False,
            'properties': properties, 'required': list(properties)}

TEXT = {'type': 'string'}
TIMES = {'type': 'array', 'items': {'type': 'number'}}
RATING = obj({'score': {'type': ['number', 'null']}, 'reason': TEXT})
PLAYER = obj({**{k: TEXT for k in ['player', 'position', 'strengths', 'concerns', 'habits', 'coach_note']},
              'rating': RATING, 'evidence_timestamps': TIMES})
UNIT = obj({**{k: TEXT for k in ['label', 'summary', 'strengths', 'concerns', 'adjustments']},
            'type': {'type': 'string', 'enum': ['line', 'defense_pair']},
            'players': {'type': 'array', 'items': TEXT}, 'rating': RATING, 'evidence_timestamps': TIMES})

def extend_schema(schema):
    extra = {'team_systems': obj({k: TEXT for k in SYSTEMS}),
             'result': TEXT, 'process': TEXT, 'game_rating': RATING,
             'unit_reports': {'type': 'array', 'items': UNIT},
             'player_reports': {'type': 'array', 'items': PLAYER}}
    schema['properties'].update(extra)
    schema['required'].extend(extra)
    return schema

REPORT_RUBRIC = '''
Return three layers: team_systems, unit_reports (forward lines and defense pairs),
and player_reports. Fill every team system with cited evidence or "Insufficient evidence".
Keep result separate from process. A win does not establish good decisions or structure.
Evaluate line/pair spacing, complementary support, retrieval/outlet roles, coverage,
turnover recovery, repeatable strengths/problems and next-game adjustments only when visible.
Do not infer who played together from roster membership or a nominal lineup.
Rate reviewed GAME PERFORMANCE from 0 to 100, not permanent skill, IQ, potential or market value.
Rubric: 50 = mixed process; 70 = consistently sound supported decisions; 90 = exceptional
repeatable process across reviewed sequences. Use null when coverage or identity is insufficient.
Every rating needs a reason describing coverage and at least two distinct gameplay sequences.
Player/unit evidence_timestamps must reference supplied gameplay observations in recording seconds.
Never inflate a grade because of the final score, points or an isolated highlight.
Existing closer looks and replayed footage are the same play, not additional evidence.
'''

def verified_report(report, chunks):
    observations = [o for c in chunks for o in (c.get('review') or {}).get('observations', [])
                    if o.get('source') == 'gameplay' and isinstance(o.get('timestamp'), (int, float))
                    and not isinstance(o.get('timestamp'), bool) and math.isfinite(o['timestamp'])
                    and c.get('start', 0) <= o['timestamp'] <= c.get('end', 0)]
    def times_for(name=None):
        return {o['timestamp'] for o in observations
                if name is None or str(o.get('player') or '').strip().casefold() == name}
    def safe_rating(value, times):
        score = value.get('score') if isinstance(value, dict) else None
        # Eight-second closer reviews are not independent sequences.
        enough = len(times) >= 2 and max(times) - min(times) >= 8
        if (not enough or isinstance(score, bool) or not isinstance(score, (int, float))
                or not math.isfinite(score) or not 0 <= score <= 100):
            return {'score': None, 'reason': 'Insufficient independent reviewed gameplay evidence.'}
        return {'score': round(score), 'reason': str(value.get('reason') or 'Reviewed game performance only.')}
    players = []
    seen = set()
    for p in report.get('player_reports') or []:
        if not isinstance(p, dict):
            continue
        key = str(p.get('player') or '').strip().casefold()
        allowed = times_for(key)
        timestamps = sorted({t for t in p.get('evidence_timestamps', []) if isinstance(t, (int, float)) and t in allowed})
        if not key or key in seen or not timestamps:
            continue
        seen.add(key)
        p['evidence_timestamps'] = timestamps
        p['rating'] = safe_rating(p.get('rating'), timestamps)
        players.append(p)
    report['player_reports'] = players
    units = []
    for u in report.get('unit_reports') or []:
        if not isinstance(u, dict):
            continue
        names = {str(p).strip().casefold() for p in u.get('players', [])}
        if len(names) < 2 or any(not times_for(n) for n in names):
            continue
        # Each cited unit sequence must have named evidence for every member nearby.
        timestamps = sorted({t for t in u.get('evidence_timestamps', [])
                             if isinstance(t, (int, float)) and t in times_for()
                             and all(any(abs(t-x) <= 8 for x in times_for(n)) for n in names)})
        if not timestamps:
            continue
        u['evidence_timestamps'] = timestamps
        u['rating'] = safe_rating(u.get('rating'), timestamps)
        units.append(u)
    report['unit_reports'] = units
    report['game_rating'] = safe_rating(report.get('game_rating'), times_for())
    return report
