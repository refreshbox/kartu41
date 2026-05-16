import os
import sys
import tempfile
import time
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


class SocketIORuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = str(Path(cls.temp_dir.name) / 'test_socketio.db')
        os.environ['DATABASE_FILE'] = cls.db_path

        global database, app_module
        import database
        import app as app_module

        cls.database = database
        cls.app_module = app_module
        cls.database.DATABASE_FILE = cls.db_path
        cls.app_module.db.DATABASE_FILE = cls.db_path
        cls.app_module.BOT_TURN_DELAY_SECONDS = 0
        cls.database.init_db()

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def setUp(self):
        self.clients = []
        self.app_module.games.clear()
        self.app_module.players.clear()
        self.app_module.player_sessions.clear()
        with self.database.get_db() as conn:
            cursor = conn.cursor()
            for table in ('chat_messages', 'game_rankings', 'player_sessions', 'players', 'games'):
                cursor.execute(f'DELETE FROM {table}')

    def tearDown(self):
        for client in self.clients:
            if client.is_connected():
                client.disconnect()

    def make_client(self):
        client = self.app_module.socketio.test_client(self.app_module.app)
        self.clients.append(client)
        return client

    @staticmethod
    def get_event(received, event_name):
        for event in received:
            if event['name'] == event_name:
                return event['args'][0] if event['args'] else None
        return None

    def test_async_mode_uses_threading(self):
        self.assertEqual(self.app_module.socketio.async_mode, 'threading')

    def test_create_join_and_start_game_flow(self):
        alice = self.make_client()
        bob = self.make_client()

        alice.emit('create_game', {'name': 'Alice'})
        created = self.get_event(alice.get_received(), 'game_created')
        self.assertIsNotNone(created)
        self.assertEqual(created['game_state']['bot_turn_delay_seconds'], 0)

        game_id = created['game_id']
        bob.emit('join_game', {'game_id': game_id, 'name': 'Bob'})
        bob_events = bob.get_received()
        self.assertIsNotNone(self.get_event(bob_events, 'player_joined'))

        alice.emit('start_game')
        alice_ready_check = self.get_event(alice.get_received(), 'ready_check_started')
        bob_ready_check = self.get_event(bob.get_received(), 'ready_check_started')

        self.assertIsNotNone(alice_ready_check)
        self.assertIsNotNone(bob_ready_check)
        self.assertIn('Alice', alice_ready_check['game_state']['ready_player_names'])

        bob.emit('respond_ready_check', {'accepted': True})
        alice_events = alice.get_received()
        bob_events = bob.get_received()

        alice_started = self.get_event(alice_events, 'game_started')
        bob_started = self.get_event(bob_events, 'game_started')
        self.assertIsNotNone(alice_started)
        self.assertIsNotNone(bob_started)
        self.assertEqual(alice_started['game_state']['round_number'], 1)
        self.assertTrue(alice_started['game_state']['game_started'])

        game = self.app_module.games[game_id]
        self.assertTrue(game.game_started)
        self.assertEqual(len(game.players), 2)
        self.assertTrue(all(len(player.hand) == 4 for player in game.players))

        restored = self.app_module.restore_game_from_db(game_id)
        self.assertIsNotNone(restored)
        self.assertTrue(restored.game_started)
        self.assertEqual(restored.round_number, 1)
        self.assertEqual(len(restored.players), 2)

    def test_non_creator_can_start_ready_check_and_game(self):
        alice = self.make_client()
        bob = self.make_client()

        alice.emit('create_game', {'name': 'Alice'})
        created = self.get_event(alice.get_received(), 'game_created')
        self.assertIsNotNone(created)
        game_id = created['game_id']

        bob.emit('join_game', {'game_id': game_id, 'name': 'Bob'})
        bob.get_received()
        alice.get_received()

        bob.emit('start_game')
        bob_ready_check = self.get_event(bob.get_received(), 'ready_check_started')
        alice_ready_check = self.get_event(alice.get_received(), 'ready_check_started')

        self.assertIsNotNone(bob_ready_check)
        self.assertIsNotNone(alice_ready_check)
        self.assertTrue(bob_ready_check['game_state']['ready_check_active'])
        self.assertIn('Bob', bob_ready_check['game_state']['ready_player_names'])
        self.assertNotIn('Alice', bob_ready_check['game_state']['ready_player_names'])

        alice.emit('respond_ready_check', {'accepted': True})
        alice_started = self.get_event(alice.get_received(), 'game_started')
        bob_started = self.get_event(bob.get_received(), 'game_started')

        self.assertIsNotNone(alice_started)
        self.assertIsNotNone(bob_started)
        self.assertTrue(alice_started['game_state']['game_started'])

    def test_creator_can_update_bot_turn_delay_setting(self):
        alice = self.make_client()

        alice.emit('create_game', {'name': 'Alice'})
        created = self.get_event(alice.get_received(), 'game_created')
        self.assertIsNotNone(created)
        game_id = created['game_id']

        alice.emit('update_bot_turn_delay', {'bot_turn_delay_seconds': 12})
        updated = self.get_event(alice.get_received(), 'bot_turn_delay_updated')

        self.assertIsNotNone(updated)
        self.assertEqual(updated['bot_turn_delay_seconds'], 12)

        game = self.app_module.games[game_id]
        self.assertEqual(game.bot_turn_delay_seconds, 12)

        restored = self.app_module.restore_game_from_db(game_id)
        self.assertIsNotNone(restored)
        self.assertEqual(restored.bot_turn_delay_seconds, 12)

    def test_creator_can_toggle_randomize_player_order_setting(self):
        alice = self.make_client()

        alice.emit('create_game', {'name': 'Alice'})
        created = self.get_event(alice.get_received(), 'game_created')
        self.assertIsNotNone(created)
        game_id = created['game_id']

        alice.emit('toggle_randomize_player_order', {'randomize_player_order': True})
        updated = self.get_event(alice.get_received(), 'player_order_randomization_toggled')

        self.assertIsNotNone(updated)
        self.assertTrue(updated['randomize_player_order'])

        game = self.app_module.games[game_id]
        self.assertTrue(game.randomize_player_order)

        restored = self.app_module.restore_game_from_db(game_id)
        self.assertIsNotNone(restored)
        self.assertTrue(restored.randomize_player_order)

    def test_player_can_reconnect_after_disconnect(self):
        alice = self.make_client()
        bob = self.make_client()

        alice.emit('create_game', {'name': 'Alice'})
        created = self.get_event(alice.get_received(), 'game_created')
        game_id = created['game_id']

        bob.emit('join_game', {'game_id': game_id, 'name': 'Bob'})
        bob.get_received()
        alice.get_received()

        bob.disconnect()

        reconnecting_bob = self.make_client()
        reconnecting_bob.emit('join_game', {'game_id': game_id, 'name': 'Bob'})
        reconnected = self.get_event(reconnecting_bob.get_received(), 'reconnected')

        self.assertIsNotNone(reconnected)
        self.assertEqual(reconnected['message'], 'Berhasil reconnect!')

        game = self.app_module.games[game_id]
        bob_player = next(player for player in game.players if player.name == 'Bob')
        self.assertTrue(bob_player.is_online)
        self.assertEqual(bob_player.player_id, reconnected['player_id'])

    def test_player_can_reconnect_after_server_restore(self):
        alice = self.make_client()
        bob = self.make_client()

        alice.emit('create_game', {'name': 'Alice'})
        created = self.get_event(alice.get_received(), 'game_created')
        game_id = created['game_id']

        bob.emit('join_game', {'game_id': game_id, 'name': 'Bob'})
        bob.get_received()
        alice.get_received()

        self.app_module.games.clear()
        self.app_module.players.clear()
        self.app_module.player_sessions.clear()

        reconnecting_bob = self.make_client()
        reconnecting_bob.emit('join_game', {'game_id': game_id, 'name': 'Bob'})
        received = reconnecting_bob.get_received()
        reconnected = self.get_event(received, 'reconnected')
        error = self.get_event(received, 'error')

        self.assertIsNone(error)
        self.assertIsNotNone(reconnected)
        self.assertEqual(reconnected['message'], 'Berhasil reconnect!')

    def test_disconnected_player_turn_is_continued_by_bot(self):
        alice = self.make_client()
        bob = self.make_client()

        alice.emit('create_game', {'name': 'Alice'})
        created = self.get_event(alice.get_received(), 'game_created')
        game_id = created['game_id']

        bob.emit('join_game', {'game_id': game_id, 'name': 'Bob'})
        bob.get_received()
        alice.get_received()

        alice.emit('start_game')
        alice.get_received()
        bob.get_received()
        bob.emit('respond_ready_check', {'accepted': True})
        alice.get_received()
        bob.get_received()

        game = self.app_module.games[game_id]
        current_player_name = game.get_current_player().name
        current_client = alice if current_player_name == 'Alice' else bob
        observer_client = bob if current_player_name == 'Alice' else alice

        current_client.disconnect()

        observed_events = []
        for _ in range(20):
            observed_events.extend(observer_client.get_received())
            if any(event['name'] == 'bot_played_turn' for event in observed_events):
                break
            time.sleep(0.02)

        bot_played = self.get_event(observed_events, 'bot_played_turn')
        self.assertIsNotNone(bot_played)

        updated_game = self.app_module.games[game_id]
        self.assertIsNotNone(updated_game.last_discarded_card)
        self.assertEqual(updated_game.last_discarder_name, current_player_name)
        self.assertNotEqual(updated_game.get_current_player().name, current_player_name)


if __name__ == '__main__':
    unittest.main()
