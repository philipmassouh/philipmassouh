-- Keep guitar only: drop Ukulele, Bass and Drums tabs, then any songs and
-- artists left with nothing. Song ranks are renumbered to stay contiguous;
-- version ranks are per type, so they are unchanged.

DELETE FROM tabs WHERE type NOT IN ('Chords', 'Tab');

DELETE FROM songs WHERE NOT EXISTS (SELECT 1 FROM tabs WHERE tabs.song_id = songs.id);

DELETE FROM songs_fts WHERE rowid NOT IN (SELECT id FROM songs);

DELETE FROM artists WHERE NOT EXISTS (SELECT 1 FROM songs WHERE songs.artist_id = artists.id);

CREATE TEMP TABLE new_rank (id INTEGER PRIMARY KEY, rank INTEGER NOT NULL);
INSERT INTO new_rank SELECT id, row_number() OVER (ORDER BY rank) FROM songs;
UPDATE songs SET rank = (SELECT rank FROM new_rank WHERE new_rank.id = songs.id);
DROP TABLE new_rank;

INSERT INTO songs_fts (songs_fts) VALUES ('optimize');
