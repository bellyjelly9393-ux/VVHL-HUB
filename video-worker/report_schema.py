"""Three report layers built from reviewed evidence; ratings describe this game only."""
import math
import re

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
Apart from the units of a supplied TEAM LINEUP, do not infer who played together from roster membership.
Rate reviewed GAME PERFORMANCE from 0 to 100, not permanent skill, IQ, potential or market value.
Rubric: 50 = mixed process; 70 = consistently sound supported decisions; 90 = exceptional
repeatable process across reviewed sequences. Use null when coverage or identity is insufficient.
Every rating needs a reason describing coverage and at least two distinct gameplay sequences.
Player/unit evidence_timestamps must reference supplied gameplay observations in recording seconds.
Never inflate a grade because of the final score, points or an isolated highlight.
Existing closer looks and replayed footage are the same play, not additional evidence.
'''

LINEUP_SLOT = re.compile(r'(?:^|[\s,;:(])(LW|RW|LD|RD|C|G)\s*[:=-]?\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)')


def lineup_roster(text):
    """[(position, gamertag)] from lineup text such as 'LW a, C b, RW c, LD d, RD e, G f'."""
    return [(m.group(1), m.group(2).rstrip('.-')) for m in LINEUP_SLOT.finditer(str(text or ''))]


def lineup_units(roster):
    """Forward lines (LW-C-RW) and defense pairs (LD-RD) named in the lineup; the goalie is not a unit."""
    slot = lambda pos: [name for p, name in roster if p == pos]
    lines = [{'type': 'line', 'players': list(names)} for names in zip(slot('LW'), slot('C'), slot('RW'))]
    pairs = [{'type': 'defense_pair', 'players': list(names)} for names in zip(slot('LD'), slot('RD'))]
    for kind, units in (('Line', lines), ('Defense pair', pairs)):
        for i, unit in enumerate(units):
            unit['label'] = f'{kind} {i + 1}: ' + ' - '.join(unit['players'])
    return lines + pairs


def verified_report(report, chunks, lineup=()):
    """Evidence checks. Lineup players and units are always reported, with no rating when evidence is thin."""
    roster = {name.casefold(): (pos, name) for pos, name in lineup}
    thin = 'Insufficient evidence this game'
    observations = []
    closer_windows = []
    def valid_time(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    for c in chunks:
        sources = [(c.get('review') or {}, c.get('start', 0), c.get('end', 0))]
        closer = c.get('sequence_review') or {}
        start, end = closer.get('start'), closer.get('end')
        if (valid_time(start) and valid_time(end)
                and c.get('start', 0) <= start < end <= c.get('end', 0)
                and isinstance(closer.get('review'), dict)):
            closer_windows.append((start, end))
            sources.append((closer['review'], start, end))
        for evidence, lower, upper in sources:
            observations.extend(o for o in evidence.get('observations', [])
                                if o.get('source') == 'gameplay' and valid_time(o.get('timestamp'))
                                and lower <= o['timestamp'] <= upper)
    def times_for(name=None):
        return {o['timestamp'] for o in observations
                if name is None or str(o.get('player') or '').strip().casefold() == name}
    def safe_rating(value, times):
        score = value.get('score') if isinstance(value, dict) else None
        # Eight-second closer reviews are not independent sequences.
        enough = (len(times) >= 2 and max(times) - min(times) >= 8
                  and not any(start <= min(times) <= max(times) <= end for start, end in closer_windows))
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
        if not key or key in seen or not (timestamps or key in roster):
            continue
        seen.add(key)
        if key in roster:
            p['player'] = roster[key][1]  # verbatim gamertag, so it matches the player locker
        p['evidence_timestamps'] = timestamps
        p['rating'] = safe_rating(p.get('rating'), timestamps)
        players.append(p)
    for key, (pos, name) in roster.items():
        if key not in seen:
            players.append({'player': name, 'position': pos, 'strengths': '', 'concerns': '', 'habits': '',
                            'coach_note': thin, 'rating': safe_rating(None, []), 'evidence_timestamps': []})
    report['player_reports'] = players
    units = []
    covered = []
    for u in report.get('unit_reports') or []:
        if not isinstance(u, dict):
            continue
        names = {str(p).strip().casefold() for p in u.get('players', [])}
        named = len(names) >= 2 and all(n in roster for n in names)
        if len(names) < 2 or names in covered or (not named and any(not times_for(n) for n in names)):
            continue
        # Each cited unit sequence must have named evidence for every member nearby.
        timestamps = sorted({t for t in u.get('evidence_timestamps', [])
                             if isinstance(t, (int, float)) and t in times_for()
                             and all(any(abs(t-x) <= 8 for x in times_for(n)) for n in names)})
        if not timestamps and not named:
            continue
        if named:
            u['players'] = [roster[str(p).strip().casefold()][1] for p in u.get('players', [])]
        u['evidence_timestamps'] = timestamps
        u['rating'] = safe_rating(u.get('rating'), timestamps)
        if not timestamps:
            u['summary'] = str(u.get('summary') or '').strip() or thin
        covered.append(names)
        units.append(u)
    for unit in lineup_units(list(roster.values())):
        if {n.casefold() for n in unit['players']} not in covered:
            units.append({**unit, 'summary': thin, 'strengths': '', 'concerns': '', 'adjustments': '',
                          'rating': safe_rating(None, []), 'evidence_timestamps': []})
    report['unit_reports'] = units
    report['game_rating'] = safe_rating(report.get('game_rating'), times_for())
    return report
