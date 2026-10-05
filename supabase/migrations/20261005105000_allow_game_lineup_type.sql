-- Allow the dedicated Hitmen Game Lineup Room to persist game-specific plans.
-- The frontend already writes lineup_type = 'game'; this keeps the database contract aligned.

alter table public.lineups
  drop constraint if exists lineups_lineup_type_check;

alter table public.lineups
  add constraint lineups_lineup_type_check
  check (
    lineup_type = any (
      array[
        'weekly'::text,
        'bidding'::text,
        'practice'::text,
        'scrim'::text,
        'game'::text
      ]
    )
  );
