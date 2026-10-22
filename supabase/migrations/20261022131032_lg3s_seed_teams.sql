-- 12 LG3S nations (LG teamid -> nation, group) from lg3s-season1-data.json; cross-checked vs LG standings page.
insert into public.lg3s_teams (lg_team_id, nation, group_code, crest_path, source_url) values
  (341, 'Canada', 'A', 'assets/lg3s/team341.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=341&leagueid=154&seasonid=1'),
  (1446, 'Great Britain', 'A', 'assets/lg3s/team1446.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=1446&leagueid=154&seasonid=1'),
  (591, 'Japan', 'A', 'assets/lg3s/team591.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=591&leagueid=154&seasonid=1'),
  (1439, 'Latvia', 'A', 'assets/lg3s/team1439.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=1439&leagueid=154&seasonid=1'),
  (1079, 'Slovakia', 'A', 'assets/lg3s/team1079.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=1079&leagueid=154&seasonid=1'),
  (404, 'Switzerland', 'A', 'assets/lg3s/team404.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=404&leagueid=154&seasonid=1'),
  (532, 'Germany', 'B', 'assets/lg3s/team532.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=532&leagueid=154&seasonid=1'),
  (822, 'Italy', 'B', 'assets/lg3s/team822.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=822&leagueid=154&seasonid=1'),
  (531, 'Kazakhstan', 'B', 'assets/lg3s/team531.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=531&leagueid=154&seasonid=1'),
  (1444, 'Poland', 'B', 'assets/lg3s/team1444.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=1444&leagueid=154&seasonid=1'),
  (343, 'Sweden', 'B', 'assets/lg3s/team343.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=343&leagueid=154&seasonid=1'),
  (342, 'USA', 'B', 'assets/lg3s/team342.svg', 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=342&leagueid=154&seasonid=1')
on conflict (lg_team_id) do update set nation = excluded.nation, group_code = excluded.group_code, crest_path = excluded.crest_path, updated_at = now();
