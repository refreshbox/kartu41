import sqlite3
import json
from datetime import datetime
from contextlib import contextmanager

DATABASE_FILE = 'kartu41.db'

@contextmanager
def get_db():
    """Context manager untuk database connection"""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def init_db():
    """Inisialisasi database dan buat semua tabel"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Tabel games - Data game
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS games (
                game_id TEXT PRIMARY KEY,
                creator_name TEXT NOT NULL,
                creator_id TEXT NOT NULL,
                game_started INTEGER DEFAULT 0,
                game_ended INTEGER DEFAULT 0,
                current_player_index INTEGER DEFAULT 0,
                round_number INTEGER DEFAULT 0,
                deck_cards TEXT,
                last_discarded_card TEXT,
                last_discarder_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Tabel players - Data pemain per game
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT NOT NULL,
                player_id TEXT NOT NULL,
                name TEXT NOT NULL,
                hand TEXT,
                temp_card TEXT,
                discard_pile TEXT,
                score INTEGER DEFAULT 0,
                cumulative_score INTEGER DEFAULT 0,
                games_won INTEGER DEFAULT 0,
                has_won INTEGER DEFAULT 0,
                surrendered INTEGER DEFAULT 0,
                is_online INTEGER DEFAULT 1,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES games(game_id),
                UNIQUE(game_id, name)
            )
        ''')
        
        # Tabel chat_messages - Chat history
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES games(game_id)
            )
        ''')
        
        # Tabel player_sessions - Session reconnect
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS player_sessions (
                session_key TEXT PRIMARY KEY,
                game_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                socket_id TEXT NOT NULL,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES games(game_id)
            )
        ''')
        
        # Tabel game_rankings - Ranking history per round
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS game_rankings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT NOT NULL,
                round_number INTEGER NOT NULL,
                player_name TEXT NOT NULL,
                rank INTEGER NOT NULL,
                score INTEGER NOT NULL,
                same_suit INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES games(game_id)
            )
        ''')
        
        # Index untuk performa
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_players_game_id ON players(game_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_chat_game_id ON chat_messages(game_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_rankings_game_id ON game_rankings(game_id)')
        
        # Migration: Add creator_id column if it doesn't exist
        cursor.execute("PRAGMA table_info(games)")
        columns = [column[1] for column in cursor.fetchall()]
        if 'creator_id' not in columns:
            cursor.execute('ALTER TABLE games ADD COLUMN creator_id TEXT DEFAULT ""')
        
        print("Database initialized successfully!")

# ============== GAME OPERATIONS ==============

def save_game(game):
    """Simpan atau update game state ke database"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Serialize deck cards
        deck_cards = json.dumps([{'suit': c.suit, 'rank': c.rank} for c in game.deck.cards])
        last_discarded = json.dumps({
            'suit': game.last_discarded_card.suit,
            'rank': game.last_discarded_card.rank
        }) if game.last_discarded_card else None
        
        cursor.execute('''
            INSERT OR REPLACE INTO games (
                game_id, creator_name, creator_id, game_started, game_ended,
                current_player_index, round_number, deck_cards,
                last_discarded_card, last_discarder_name, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ''', (
            game.game_id,
            game.creator_name,
            game.creator_id,
            1 if game.game_started else 0,
            1 if game.game_ended else 0,
            game.current_player_index,
            game.round_number,
            deck_cards,
            last_discarded,
            game.last_discarder_name
        ))

def load_game(game_id):
    """Load game dari database"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM games WHERE game_id = ?', (game_id,))
        row = cursor.fetchone()
        
        if row:
            return dict(row)
        return None

def delete_game(game_id):
    """Hapus game dan semua data terkait"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM chat_messages WHERE game_id = ?', (game_id,))
        cursor.execute('DELETE FROM players WHERE game_id = ?', (game_id,))
        cursor.execute('DELETE FROM game_rankings WHERE game_id = ?', (game_id,))
        cursor.execute('DELETE FROM player_sessions WHERE game_id = ?', (game_id,))
        cursor.execute('DELETE FROM games WHERE game_id = ?', (game_id,))

# ============== PLAYER OPERATIONS ==============

def save_player(game_id, player):
    """Simpan atau update player state ke database"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Serialize cards
        hand = json.dumps([{'suit': c.suit, 'rank': c.rank} for c in player.hand])
        temp_card = json.dumps({
            'suit': player.temp_card.suit,
            'rank': player.temp_card.rank
        }) if player.temp_card else None
        discard_pile = json.dumps([{'suit': c.suit, 'rank': c.rank} for c in player.discard_pile])
        
        cursor.execute('''
            INSERT OR REPLACE INTO players (
                game_id, player_id, name, hand, temp_card, discard_pile,
                score, cumulative_score, games_won, has_won, surrendered,
                is_online, last_seen
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ''', (
            game_id,
            player.player_id,
            player.name,
            hand,
            temp_card,
            discard_pile,
            player.score,
            player.cumulative_score,
            player.games_won,
            1 if player.has_won else 0,
            1 if player.surrendered else 0,
            1 if player.is_online else 0
        ))

def load_players(game_id):
    """Load semua players dari game"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM players WHERE game_id = ? ORDER BY id', (game_id,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def update_player_status(game_id, player_name, is_online):
    """Update status online/offline player"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE players 
            SET is_online = ?, last_seen = CURRENT_TIMESTAMP
            WHERE game_id = ? AND name = ?
        ''', (1 if is_online else 0, game_id, player_name))

# ============== CHAT OPERATIONS ==============

def save_chat_message(game_id, sender_id, sender_name, message):
    """Simpan pesan chat ke database"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO chat_messages (game_id, sender_id, sender_name, message)
            VALUES (?, ?, ?, ?)
        ''', (game_id, sender_id, sender_name, message))

def load_chat_messages(game_id, limit=100):
    """Load chat messages dari game (terbaru dulu)"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT * FROM chat_messages 
            WHERE game_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        ''', (game_id, limit))
        rows = cursor.fetchall()
        # Reverse untuk urutan kronologis
        return [dict(row) for row in reversed(rows)]

# ============== SESSION OPERATIONS ==============

def save_session(session_key, game_id, player_name, socket_id):
    """Simpan session untuk reconnect"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO player_sessions (
                session_key, game_id, player_name, socket_id, last_active
            ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ''', (session_key, game_id, player_name, socket_id))

def load_session(session_key):
    """Load session data"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM player_sessions WHERE session_key = ?', (session_key,))
        row = cursor.fetchone()
        return dict(row) if row else None

def delete_old_sessions(days=7):
    """Hapus session yang sudah lama tidak aktif"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            DELETE FROM player_sessions 
            WHERE last_active < datetime('now', '-' || ? || ' days')
        ''', (days,))

# ============== RANKING OPERATIONS ==============

def save_ranking(game_id, round_number, rankings):
    """Simpan ranking hasil game"""
    with get_db() as conn:
        cursor = conn.cursor()
        for ranking in rankings:
            cursor.execute('''
                INSERT INTO game_rankings (
                    game_id, round_number, player_name, rank, score, same_suit
                ) VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                game_id,
                round_number,
                ranking['player'].name,
                rankings.index(ranking) + 1,
                ranking['score'],
                1 if ranking['same_suit'] else 0
            ))

def get_player_stats(player_name):
    """Dapatkan statistik pemain"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT 
                COUNT(*) as total_games,
                SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END) as wins,
                AVG(score) as avg_score,
                MAX(score) as max_score
            FROM game_rankings
            WHERE player_name = ?
        ''', (player_name,))
        row = cursor.fetchone()
        return dict(row) if row else None

# ============== CLEANUP OPERATIONS ==============

def cleanup_old_games(days=30):
    """Hapus game yang sudah lama selesai"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT game_id FROM games 
            WHERE game_ended = 1 
            AND updated_at < datetime('now', '-' || ? || ' days')
        ''', (days,))
        old_games = cursor.fetchall()
        
        for game in old_games:
            delete_game(game['game_id'])
        
        return len(old_games)

if __name__ == '__main__':
    # Inisialisasi database saat pertama kali
    init_db()
    print("Database setup complete!")
