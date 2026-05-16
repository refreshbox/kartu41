import os
import sys
import tempfile
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


class BackendRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = str(Path(cls.temp_dir.name) / 'test_kartu41.db')
        os.environ['DATABASE_FILE'] = cls.db_path

        global database, app_module
        import database
        import app as app_module

        cls.database = database
        cls.app_module = app_module
        cls.database.DATABASE_FILE = cls.db_path
        cls.app_module.db.DATABASE_FILE = cls.db_path
        cls.database.init_db()

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def setUp(self):
        self.app_module.games.clear()
        self.app_module.players.clear()
        self.app_module.player_sessions.clear()
        with self.database.get_db() as conn:
            cursor = conn.cursor()
            for table in ('chat_messages', 'game_rankings', 'player_sessions', 'players', 'games'):
                cursor.execute(f'DELETE FROM {table}')

    def test_duplicate_player_name_is_rejected(self):
        game = self.app_module.Game('GAME1', 'Alice', 'sid-1')

        self.assertEqual(game.add_player('sid-1', 'Alice'), (True, 'Berhasil bergabung'))
        self.assertEqual(game.add_player('sid-2', 'Alice'), (False, 'Nama pemain sudah digunakan'))

    def test_save_player_preserves_join_order(self):
        class DummyPlayer:
            def __init__(self, player_id, name):
                self.player_id = player_id
                self.name = name
                self.hand = []
                self.temp_card = None
                self.discard_pile = []
                self.score = 0
                self.cumulative_score = 0
                self.games_won = 0
                self.has_won = False
                self.surrendered = False
                self.is_online = True

        game_id = 'ORDER1'
        game = self.app_module.Game(game_id, 'Owner', 'owner-sid')
        self.database.save_game(game)

        for player_id, name in [('p1', 'A'), ('p2', 'B'), ('p3', 'C')]:
            self.database.save_player(game_id, DummyPlayer(player_id, name))

        initial_order = [row['name'] for row in self.database.load_players(game_id)]
        self.database.save_player(game_id, DummyPlayer('p2-new', 'B'))
        updated_order = [row['name'] for row in self.database.load_players(game_id)]

        self.assertEqual(initial_order, ['A', 'B', 'C'])
        self.assertEqual(updated_order, ['A', 'B', 'C'])

    def test_timer_mode_is_restored_from_database(self):
        game = self.app_module.Game('TIMER1', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')
        game.use_timer = False

        self.database.save_game_state(game)
        restored = self.app_module.restore_game_from_db('TIMER1')

        self.assertIsNotNone(restored)
        self.assertFalse(restored.use_timer)

    def test_bot_turn_delay_uses_default_and_is_restored_from_database(self):
        game = self.app_module.Game('BOTD1', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')

        self.assertEqual(game.bot_turn_delay_seconds, 30)

        game.bot_turn_delay_seconds = 45
        self.database.save_game_state(game)
        restored = self.app_module.restore_game_from_db('BOTD1')

        self.assertIsNotNone(restored)
        self.assertEqual(restored.bot_turn_delay_seconds, 45)

    def test_randomize_player_order_is_restored_from_database(self):
        game = self.app_module.Game('SHUFFLE1', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')
        game.randomize_player_order = True

        self.database.save_game_state(game)
        restored = self.app_module.restore_game_from_db('SHUFFLE1')

        self.assertIsNotNone(restored)
        self.assertTrue(restored.randomize_player_order)

    def test_first_round_keeps_lobby_order_when_randomize_enabled(self):
        game = self.app_module.Game('SHUFFLE2', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')
        game.add_player('sid-2', 'Bob')
        game.add_player('sid-3', 'Cara')
        for player in game.players:
            player.is_online = True
        game.randomize_player_order = True

        original_shuffle = self.app_module.random.shuffle
        try:
            self.app_module.random.shuffle = lambda seq: seq.reverse()
            success, _ = game.start_game()
        finally:
            self.app_module.random.shuffle = original_shuffle

        self.assertTrue(success)
        self.assertEqual([player.name for player in game.players], ['Alice', 'Bob', 'Cara'])

    def test_next_round_randomizes_player_order_when_enabled(self):
        game = self.app_module.Game('SHUFFLE3', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')
        game.add_player('sid-2', 'Bob')
        game.add_player('sid-3', 'Cara')
        for player in game.players:
            player.is_online = True
        game.randomize_player_order = True

        game.round_number = 1
        original_shuffle = self.app_module.random.shuffle
        try:
            self.app_module.random.shuffle = lambda seq: seq.reverse()
            success, _ = game.start_game()
        finally:
            self.app_module.random.shuffle = original_shuffle

        self.assertTrue(success)
        self.assertEqual([player.name for player in game.players], ['Cara', 'Bob', 'Alice'])

    def test_restart_state_is_persisted(self):
        game = self.app_module.Game('RESTART1', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')
        game.add_player('sid-2', 'Bob')
        game.start_game()
        game.game_ended = True
        game.winner = game.players[0]

        self.database.save_game_state(game)
        success, _ = game.restart_game()
        self.assertTrue(success)

        self.database.save_game_state(game)
        restored = self.app_module.restore_game_from_db('RESTART1')

        self.assertIsNotNone(restored)
        self.assertEqual(restored.round_number, 2)
        self.assertFalse(restored.game_ended)

    def test_restore_marks_players_offline_after_server_restart(self):
        game = self.app_module.Game('RESTORE1', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')
        game.add_player('sid-2', 'Bob')
        game.players[0].is_online = True
        game.players[1].is_online = True

        self.database.save_game_state(game)
        restored = self.app_module.restore_game_from_db('RESTORE1')

        self.assertIsNotNone(restored)
        self.assertTrue(all(player.is_online is False for player in restored.players))

        persisted_rows = self.database.load_players('RESTORE1')
        self.assertTrue(all(bool(row['is_online']) is False for row in persisted_rows))

    def test_ready_check_state_is_restored_from_database(self):
        game = self.app_module.Game('READY1', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')
        game.add_player('sid-2', 'Bob')

        success, _ = game.begin_ready_check()
        self.assertTrue(success)

        self.database.save_game_state(game)
        restored = self.app_module.restore_game_from_db('READY1')

        self.assertIsNotNone(restored)
        self.assertTrue(restored.ready_check_active)
        self.assertEqual(restored.ready_player_names, ['Alice'])

    def test_return_to_lobby_resets_round_and_keeps_cumulative_scores(self):
        game = self.app_module.Game('LOBBY1', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')
        game.add_player('sid-2', 'Bob')
        game.start_game()

        game.players[0].cumulative_score = 40
        game.players[0].games_won = 1
        game.winner = game.players[0]
        game.game_ended = True
        game.rankings = [{'player': game.players[0], 'score': 40, 'same_suit': True}]

        success, _ = game.return_to_lobby()

        self.assertTrue(success)
        self.assertEqual(game.game_id, 'LOBBY1')
        self.assertFalse(game.game_started)
        self.assertFalse(game.game_ended)
        self.assertEqual(game.players[0].cumulative_score, 40)
        self.assertEqual(game.players[0].games_won, 1)
        self.assertEqual(game.players[0].hand, [])

    def test_restore_keeps_rankings_and_cumulative_history_after_restart(self):
        game = self.app_module.Game('RANK1', 'Alice', 'sid-1')
        game.add_player('sid-1', 'Alice')
        game.add_player('sid-2', 'Bob')
        game.start_game()

        alice = game.players[0]
        bob = game.players[1]
        alice.cumulative_score = 41
        alice.games_won = 1
        bob.cumulative_score = 13
        game.game_ended = True
        game.winner = alice
        alice.has_won = True
        game.rankings = [
            {'player': alice, 'score': 41, 'same_suit': True},
            {'player': bob, 'score': 13, 'same_suit': False},
        ]
        game.calculate_overall_rankings()

        self.database.save_game_state(game, include_rankings=True)
        restored = self.app_module.restore_game_from_db('RANK1')

        self.assertIsNotNone(restored)
        self.assertTrue(restored.game_ended)
        self.assertEqual(restored.winner.name, 'Alice')
        self.assertEqual(len(restored.rankings), 2)
        self.assertEqual(restored.rankings[0]['player'].name, 'Alice')
        self.assertEqual(restored.rankings[0]['score'], 41)
        self.assertEqual(len(restored.overall_rankings), 2)
        self.assertEqual(restored.overall_rankings[0]['player'].name, 'Alice')
        self.assertEqual(restored.overall_rankings[0]['cumulative_score'], 41)


if __name__ == '__main__':
    unittest.main()
