from flask import Flask, render_template, jsonify, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import secrets
import json
from datetime import datetime
from dotenv import load_dotenv
import os
import database as db

load_dotenv()
app = Flask(__name__)
socket_io_path = os.getenv('SOCKET_IO_PATH', '/socket.io')
base_href = os.getenv('BASE_HREF', '/')
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', secrets.token_hex(16))
socketio = SocketIO(app, cors_allowed_origins="*")

# Initialize database
db.init_db()

# Game state storage (in-memory cache + database)
games = {}
players = {}  # {socket_id: game_id}
player_sessions = {}  # {player_name_game_id: socket_id} untuk reconnect

class Card:
    """Representasi kartu remi"""
    SUITS = ['♠', '♥', '♦', '♣']  # Spade, Heart, Diamond, Club
    SUIT_NAMES = {
        '♠': 'Sekop',
        '♥': 'Hati', 
        '♦': 'Wajik',
        '♣': 'Keriting'
    }
    RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
    
    def __init__(self, suit, rank):
        self.suit = suit
        self.rank = rank
        
    def get_value(self):
        """Menghitung nilai kartu sesuai aturan"""
        if self.rank == 'A':
            return 11
        elif self.rank in ['J', 'Q', 'K']:
            return 10
        else:
            return int(self.rank)
    
    def to_dict(self):
        return {
            'suit': self.suit,
            'rank': self.rank,
            'value': self.get_value(),
            'suit_name': self.SUIT_NAMES[self.suit]
        }
    
    def __repr__(self):
        return f"{self.rank}{self.suit}"


class Deck:
    """Deck kartu remi"""
    def __init__(self):
        self.cards = []
        self.build()
        
    def build(self):
        """Membuat deck lengkap 52 kartu"""
        for suit in Card.SUITS:
            for rank in Card.RANKS:
                self.cards.append(Card(suit, rank))
                
    def shuffle(self):
        """Mengacak kartu"""
        random.shuffle(self.cards)
        
    def deal(self):
        """Mengambil satu kartu dari deck"""
        if len(self.cards) > 0:
            return self.cards.pop()
        return None


class Player:
    """Representasi pemain"""
    def __init__(self, player_id, name):
        self.player_id = player_id
        self.name = name
        self.hand = []
        self.discard_pile = []
        self.score = 0
        self.has_won = False
        self.temp_card = None  # Kartu sementara yang baru diambil
        self.surrendered = False  # Flag untuk menandai pemain menyerah
        self.cumulative_score = 0  # Total score dari semua game
        self.games_won = 0  # Jumlah game yang dimenangkan
        self.is_online = True  # Status online/offline
        
    def add_card(self, card):
        """Menambah kartu ke tangan"""
        self.hand.append(card)
        
    def remove_card(self, card_index):
        """Membuang kartu dari tangan"""
        if 0 <= card_index < len(self.hand):
            card = self.hand.pop(card_index)
            self.discard_pile.append(card)
            return card
        return None
    
    def calculate_best_score(self):
        """Menghitung score terbaik dengan Jenis Kartu yang sama"""
        if len(self.hand) == 0:
            return 0, None, False
            
        # Kelompokkan kartu berdasarkan suit
        suits = {}
        for card in self.hand:
            if card.suit not in suits:
                suits[card.suit] = []
            suits[card.suit].append(card)
        
        best_score = 0
        best_suit = None
        all_same_suit = False
        
        # Cari suit dengan nilai tertinggi
        for suit, cards in suits.items():
            score = sum(card.get_value() for card in cards)
            if score > best_score:
                best_score = score
                best_suit = suit
        
        # Cek apakah semua kartu sama kembang
        if len(suits) == 1:
            all_same_suit = True
            
        # Jika tidak semua sama kembang, ada penalty
        if not all_same_suit:
            # Hitung penalty untuk kartu yang berbeda kembang
            penalty = 0
            for card in self.hand:
                if card.suit != best_suit:
                    penalty += card.get_value()
            best_score -= penalty
            
        self.score = best_score
        return best_score, best_suit, all_same_suit
    
    def to_dict(self, reveal_hand=False, reveal_score=False):
        # Gunakan self.score yang sudah di-update (misalnya jadi 0 jika kalah)
        # Hanya hitung ulang jika score belum pernah di-set
        if self.score == 0 and not self.has_won:
            score, suit, same_suit = self.calculate_best_score()
        else:
            score = self.score
            _, suit, same_suit = self.calculate_best_score()
        
        return {
            'player_id': self.player_id,
            'name': self.name,
            'hand': [card.to_dict() for card in self.hand] if reveal_hand else [],
            'hand_count': len(self.hand),
            'discard_pile': [card.to_dict() for card in self.discard_pile],
            'score': score if reveal_score else None,
            'best_suit': suit if reveal_score else None,
            'all_same_suit': same_suit if reveal_score else None,
            'has_won': self.has_won,
            'temp_card': self.temp_card.to_dict() if self.temp_card and reveal_hand else None,
            'surrendered': self.surrendered,
            'cumulative_score': self.cumulative_score,
            'games_won': self.games_won,
            'is_online': self.is_online
        }


class Game:
    """Logika permainan Kartu 41"""
    def __init__(self, game_id, creator_name, creator_id):
        self.game_id = game_id
        self.creator_name = creator_name  # Nama pemain yang membuat game (persisten)
        self.creator_id = creator_id  # ID pemain yang membuat game (persisten)
        self.deck = Deck()
        self.players = []
        self.current_player_index = 0
        self.game_started = False
        self.game_ended = False
        self.winner = None
        self.rankings = []
        self.created_at = datetime.now()
        self.last_discarded_card = None  # Kartu terakhir yang dibuang
        self.last_discarder_name = None  # Nama pemain yang membuang
        self.round_number = 0  # Nomor game/ronde saat ini
        self.overall_rankings = []  # Ranking kumulatif dari semua game
        self.use_timer = True  # Mode timer default aktif
        
    def add_player(self, player_id, name):
        """Menambah pemain ke game"""
        if len(self.players) >= 6:
            return False, "Game sudah penuh (maksimal 6 pemain)"
        
        if self.game_started:
            return False, "Game sudah dimulai"
            
        player = Player(player_id, name)
        self.players.append(player)
        return True, "Berhasil bergabung"
    
    def get_player_by_id(self, player_id):
        """Mendapatkan player berdasarkan player_id"""
        for player in self.players:
            if player.player_id == player_id:
                return player
        return None
    
    def reconnect_player(self, old_player_id, new_player_id):
        """Reconnect pemain yang terputus"""
        for player in self.players:
            if player.player_id == old_player_id:
                player.player_id = new_player_id
                return True, player.name
        return False, None
    
    def close_hand(self, player_id):
        """Pemain tutup kartu - akhiri game dan tampilkan score semua pemain"""
        # Validasi hanya current player yang bisa tutup kartu
        current_player = self.get_current_player()
        if not current_player or current_player.player_id != player_id:
            return False, None
            
        for i, player in enumerate(self.players):
            if player.player_id == player_id:
                # Tandai bahwa pemain ini menutup kartu
                player.has_won = True
                # Langsung akhiri game
                self.end_game()
                return True, player.name
        return False, None
        
    def remove_player(self, player_id):
        """Menghapus pemain dari game"""
        self.players = [p for p in self.players if p.player_id != player_id]
        
    def start_game(self, starting_player_index=0, shuffle_players=False):
        """Memulai permainan"""
        # Hitung pemain yang online
        online_players = [p for p in self.players if p.is_online]
        
        if len(online_players) < 2:
            return False, "Minimal 2 pemain online untuk memulai"
            
        if self.game_started:
            return False, "Game sudah dimulai"
        
        # Kick offline players sebelum game dimulai
        if len(online_players) < len(self.players):
            offline_players = [p for p in self.players if not p.is_online]
            for offline_player in offline_players:
                self.remove_player(offline_player.player_id)
                # Hapus dari players dict global
                if offline_player.player_id in players:
                    del players[offline_player.player_id]
                print(f"Kicked offline player: {offline_player.name}")
        
        # Increment round number
        self.round_number += 1
        
        # Acak urutan pemain jika diminta (untuk round baru setelah game selesai)
        if shuffle_players and len(self.players) > 2:
            random.shuffle(self.players)
            # Cari index starting player setelah shuffle
            starting_player_index = 0
            if self.winner:
                for i, player in enumerate(self.players):
                    if player.player_id == self.winner.player_id:
                        starting_player_index = i
                        break
            
        # Acak deck dan bagikan 4 kartu ke setiap pemain
        self.deck.shuffle()
        for player in self.players:
            for _ in range(4):
                card = self.deck.deal()
                if card:
                    player.add_card(card)
                    
        self.game_started = True
        self.current_player_index = starting_player_index
        return True, "Game dimulai!"
    
    def restart_game(self):
        """Restart game dengan giliran dari pemenang terakhir"""
        if not self.game_ended:
            return False, "Game belum berakhir"
        
        # Cari index pemenang untuk starting player
        winner_index = 0
        if self.winner:
            for i, player in enumerate(self.players):
                if player.player_id == self.winner.player_id:
                    winner_index = i
                    break
        
        # Reset semua state
        self.deck = Deck()
        self.deck.shuffle()
        self.game_started = False
        self.game_ended = False
        self.winner = None
        self.rankings = []
        self.last_discarded_card = None
        self.last_discarder_name = None
        
        # Reset semua player
        for player in self.players:
            player.hand = []
            player.discard_pile = []
            player.score = 0
            player.has_won = False
            player.temp_card = None
            player.surrendered = False
        
        # Start game dengan giliran dari pemenang
        return self.start_game(winner_index)
        
    def draw_card(self, player_id, from_discard=False):
        """Pemain mengambil kartu dari deck atau discard pile"""
        # Skip pemain yang menyerah
        while self.players[self.current_player_index].surrendered:
            self.current_player_index = (self.current_player_index + 1) % len(self.players)
            # Cek apakah semua pemain menyerah
            if all(p.surrendered for p in self.players):
                self.end_game()
                return False, "Semua pemain menyerah, game berakhir!", None
        
        current_player = self.players[self.current_player_index]
        
        if current_player.player_id != player_id:
            return False, "Bukan giliran Anda", None
        
        # Cek apakah pemain sudah memiliki kartu temporary
        if hasattr(current_player, 'temp_card') and current_player.temp_card:
            return False, "Anda sudah mengambil kartu, sekarang buang salah satu!", None
        
        card = None
        
        if from_discard and self.last_discarded_card:
            # Ambil kartu dari buangan
            card = self.last_discarded_card
            self.last_discarded_card = None
            self.last_discarder_name = None
        else:
            # Ambil kartu dari deck
            if len(self.deck.cards) == 0:
                self.end_game()
                return False, "Deck habis, game berakhir!", None
            card = self.deck.deal()
        
        if card:
            # Simpan kartu sementara, belum masuk ke hand
            current_player.temp_card = card
            source = "buangan" if from_discard else "deck"
            return True, f"Kartu diambil dari {source}", card.to_dict()
        return False, "Tidak ada kartu tersisa", None
        
    def discard_card(self, player_id, card_index):
        """Pemain membuang kartu"""
        # Skip pemain yang menyerah
        while self.players[self.current_player_index].surrendered:
            self.current_player_index = (self.current_player_index + 1) % len(self.players)
        
        current_player = self.players[self.current_player_index]
        
        if current_player.player_id != player_id:
            return False, "Bukan giliran Anda", None
        
        # Pastikan ada kartu temporary yang sudah diambil
        if not hasattr(current_player, 'temp_card') or not current_player.temp_card:
            return False, "Ambil kartu terlebih dahulu!", None
        
        # Jika card_index == -1, berarti buang kartu yang baru diambil
        if card_index == -1:
            # Buang kartu temporary, tidak masukkan ke hand
            card = current_player.temp_card
            current_player.discard_pile.append(card)
            current_player.temp_card = None
            # Simpan kartu buangan untuk pemain berikutnya
            self.last_discarded_card = card
            self.last_discarder_name = current_player.name
        else:
            # Masukkan kartu temporary ke hand
            current_player.add_card(current_player.temp_card)
            current_player.temp_card = None
            
            # Buang kartu dari hand
            card = current_player.remove_card(card_index)
            if not card:
                return False, "Kartu tidak valid", None
            # Simpan kartu buangan untuk pemain berikutnya
            self.last_discarded_card = card
            self.last_discarder_name = current_player.name
            
        # Cek apakah pemain mencapai 41
        score, suit, same_suit = current_player.calculate_best_score()
        
        if score == 41 and same_suit:
            current_player.has_won = True
            self.end_game()
            return True, "Selamat! Anda mencapai 41!", card
            
        # Pindah ke pemain berikutnya (skip yang menyerah)
        self.current_player_index = (self.current_player_index + 1) % len(self.players)
        while self.players[self.current_player_index].surrendered:
            self.current_player_index = (self.current_player_index + 1) % len(self.players)
            # Cek apakah semua pemain menyerah kecuali 1
            active_players = [p for p in self.players if not p.surrendered]
            if len(active_players) <= 1:
                self.end_game()
                break
        
        return True, "Kartu dibuang", card
        
    def end_game(self):
        """Mengakhiri permainan dan menentukan pemenang"""
        self.game_ended = True
        
        # Hitung score semua pemain dari kartu yang dipegang
        player_scores = []
        for player in self.players:
            score, suit, same_suit = player.calculate_best_score()
            player_scores.append({
                'player': player,
                'score': score,
                'same_suit': same_suit,
                'has_won': player.has_won,
                'surrendered': player.surrendered
            })
        
        # Cari pemain yang menutup kartu (has_won=True)
        players_who_closed = [ps for ps in player_scores if ps['has_won']]
        
        if len(players_who_closed) > 0:
            # Cari score tertinggi dari semua pemain (termasuk yang tidak menutup)
            highest_score = max(ps['score'] for ps in player_scores)
            
            # Jika ada pemain yang menutup kartu tapi scorenya lebih rendah dari pemain lain,
            # set scorenya menjadi 0 dan reset has_won (karena dia kalah)
            for ps in players_who_closed:
                if ps['score'] < highest_score:
                    ps['score'] = 0
                    ps['player'].score = 0
                    ps['has_won'] = False  # Reset karena dia kalah
        
        # Sort berdasarkan: NOT surrendered (yang tidak menyerah dulu), same_suit, score
        # Pemain yang menyerah tetap di-rank berdasarkan score mereka, tapi di bawah yang tidak menyerah
        player_scores.sort(key=lambda x: (not x['surrendered'], x['same_suit'], x['score']), reverse=True)
        
        self.rankings = player_scores
        if len(player_scores) > 0:
            # Pemenang adalah pemain dengan score tertinggi (bukan yang tutup kartu)
            self.winner = player_scores[0]['player']
            # Update games won untuk pemenang
            self.winner.games_won += 1
        
        # Update cumulative scores untuk semua pemain
        for ranking in player_scores:
            player = ranking['player']
            player.cumulative_score += ranking['score']
        
        # Hitung overall rankings berdasarkan cumulative score
        self.calculate_overall_rankings()
        
        # Simpan ranking ke database (akan dipanggil dari handler)
            
    def calculate_overall_rankings(self):
        """Menghitung ranking kumulatif dari semua game"""
        overall = []
        for player in self.players:
            overall.append({
                'player': player,
                'cumulative_score': player.cumulative_score,
                'games_won': player.games_won
            })
        
        # Sort berdasarkan: games_won (lebih banyak menang lebih bagus), cumulative_score (lebih tinggi lebih bagus)
        overall.sort(key=lambda x: (x['games_won'], x['cumulative_score']), reverse=True)
        
        self.overall_rankings = overall
    
    def get_current_player(self):
        """Mendapatkan pemain yang sedang giliran"""
        if len(self.players) > 0:
            return self.players[self.current_player_index]
        return None
        
    def to_dict(self, player_id=None):
        """Convert game state ke dictionary"""
        current_player = self.get_current_player()
        
        return {
            'game_id': self.game_id,
            'creator_id': self.creator_id,
            'creator_name': self.creator_name,
            'round_number': self.round_number,
            'use_timer': self.use_timer,
            'players': [p.to_dict(reveal_hand=(p.player_id == player_id), reveal_score=(p.player_id == player_id or self.game_ended)) for p in self.players],
            'current_player_id': current_player.player_id if current_player else None,
            'current_player_name': current_player.name if current_player else None,
            'game_started': self.game_started,
            'game_ended': self.game_ended,
            'deck_remaining': len(self.deck.cards),
            'last_discarded_card': self.last_discarded_card.to_dict() if self.last_discarded_card else None,
            'last_discarder_name': self.last_discarder_name,
            'winner': self.winner.to_dict(reveal_hand=True, reveal_score=True) if self.winner else None,
            'rankings': [
                {
                    'rank': i + 1,
                    'player': r['player'].to_dict(reveal_hand=True, reveal_score=True),
                    'score': r['score'],
                    'same_suit': r['same_suit']
                } 
                for i, r in enumerate(self.rankings)
            ] if self.game_ended else [],
            'overall_rankings': [
                {
                    'rank': i + 1,
                    'player_name': r['player'].name,
                    'cumulative_score': r['cumulative_score'],
                    'games_won': r['games_won']
                }
                for i, r in enumerate(self.overall_rankings)
            ] if len(self.overall_rankings) > 0 else []
        }


@app.route('/')
def index():
    """Halaman utama"""
    return render_template('index.html', base_href=base_href, socket_io_path=socket_io_path)


@socketio.on('connect')
def handle_connect():
    """Handle koneksi socket"""
    print(f"Client connected: {request.sid}")
    emit('connected', {'sid': request.sid})


@socketio.on('disconnect')
def handle_disconnect():
    """Handle disconnect socket"""
    print(f"Client disconnected: {request.sid}")
    
    # Set player status offline
    player_id = request.sid
    if player_id in players:
        game_id = players[player_id]
        if game_id in games:
            game = games[game_id]
            
            # Cari nama player untuk session tracking dan set offline
            for player in game.players:
                if player.player_id == player_id:
                    player.is_online = False  # Set status offline
                    session_key = f"{player.name}_{game_id}"
                    player_sessions[session_key] = player_id
                    print(f"Player {player.name} disconnected, session {session_key} saved for reconnect")
                    
                    # Update database
                    db.update_player_status(game_id, player.name, False)
                    db.save_player(game_id, player)
                    db.save_game(game)
                    
                    # Broadcast disconnect ke player lain dengan game state update
                    socketio.emit('player_disconnected', {
                        'player_name': player.name,
                        'game_state': game.to_dict()
                    }, room=game_id)
                    break
            
            # Jangan hapus dari players dict, biarkan untuk reconnect
            # del players[player_id]  # DISABLED untuk enable reconnect


@socketio.on('create_game')
def handle_create_game(data):
    """Membuat game baru"""
    player_name = data.get('name', 'Player')
    player_id = request.sid
    
    # Generate game ID unik dalam uppercase
    game_id = secrets.token_hex(4).upper()
    
    # Buat game baru dengan creator_name
    game = Game(game_id, player_name, player_id)
    success, message = game.add_player(player_id, player_name)
    
    if success:
        games[game_id] = game
        players[player_id] = game_id
        
        # Simpan session untuk reconnect
        session_key = f"{player_name}_{game_id}"
        player_sessions[session_key] = player_id
        print(f"Session created: {session_key} -> {player_id}")
        
        # Simpan ke database
        db.save_game(game)
        for player in game.players:
            db.save_player(game_id, player)
        db.save_session(session_key, game_id, player_name, player_id)
        
        join_room(game_id)
        
        # Load chat history (biasanya kosong untuk game baru, tapi jika restore dari DB akan ada)
        chat_history = db.load_chat_messages(game_id)
        if chat_history:
            emit('chat_history', {'messages': chat_history})
        
        emit('game_created', {
            'game_id': game_id,
            'message': message,
            'game_state': game.to_dict(player_id)
        })
    else:
        emit('error', {'message': message})


@socketio.on('join_game')
def handle_join_game(data):
    """Bergabung ke game yang ada"""
    game_id = data.get('game_id', '').upper()  # Konversi ke uppercase
    player_name = data.get('name', 'Player')
    player_id = request.sid
    
    print(f"Join game attempt - Game ID: {game_id}, Available games: {list(games.keys())}")
    
    # Cek di memory, jika tidak ada coba restore dari database
    if game_id not in games:
        print(f"Game {game_id} not in memory, trying to restore from database...")
        game = restore_game_from_db(game_id)
        if game:
            games[game_id] = game
            print(f"Game {game_id} restored from database!")
        else:
            emit('error', {'message': 'Game tidak ditemukan'})
            return
    
    game = games[game_id]
    
    # Cek apakah ini reconnect
    session_key = f"{player_name}_{game_id}"
    print(f"Checking reconnect: {session_key}")
    print(f"Available sessions: {list(player_sessions.keys())}")
    
    # Cek apakah player dengan nama ini ada di game
    existing_player = None
    for player in game.players:
        if player.name == player_name:
            existing_player = player
            break
    
    if existing_player and existing_player.player_id != player_id:
        # Ini adalah reconnect attempt
        print(f"Reconnecting player {player_name}: {existing_player.player_id} -> {player_id}")
        old_player_id = existing_player.player_id
        success, name = game.reconnect_player(old_player_id, player_id)
        
        if success:
            # Set player online
            for player in game.players:
                if player.player_id == player_id:
                    player.is_online = True
                    break
            
            # Update mappings
            players[player_id] = game_id
            if old_player_id in players:
                del players[old_player_id]
            player_sessions[session_key] = player_id
            
            join_room(game_id)
            
            # Send reconnect success
            emit('reconnected', {
                'message': 'Berhasil reconnect!',
                'player_id': player_id,
                'game_state': game.to_dict(player_id)
            })
            
            # Broadcast ke player lain dengan game state update
            socketio.emit('player_reconnected', {
                'player_name': name,
                'game_state': game.to_dict()
            }, room=game_id)
            
            # Load chat history dan kirim ke player yang reconnect
            chat_history = db.load_chat_messages(game_id)
            if chat_history:
                emit('chat_history', {'messages': chat_history})
            
            # Send hand to reconnected player, termasuk temp_card jika ada
            hand_data = {
                'hand': [card.to_dict() for card in existing_player.hand]
            }
            
            # Jika ada temp_card (kartu yang baru diambil tapi belum dibuang)
            if existing_player.temp_card:
                hand_data['temp_card'] = existing_player.temp_card.to_dict()
            
            emit('your_hand', hand_data)
            return
    
    # Join biasa
    success, message = game.add_player(player_id, player_name)
    
    if success:
        players[player_id] = game_id
        
        # Simpan session untuk reconnect
        session_key = f"{player_name}_{game_id}"
        player_sessions[session_key] = player_id
        print(f"Session created: {session_key} -> {player_id}")
        
        # Simpan ke database
        for player in game.players:
            if player.player_id == player_id:
                db.save_player(game_id, player)
                break
        db.save_session(session_key, game_id, player_name, player_id)
        
        join_room(game_id)
        
        # Load chat history dan kirim ke player yang baru join
        chat_history = db.load_chat_messages(game_id)
        if chat_history:
            emit('chat_history', {'messages': chat_history})
        
        # Broadcast ke semua player di room
        socketio.emit('player_joined', {
            'player_name': player_name,
            'game_state': game.to_dict()
        }, room=game_id)
    else:
        emit('error', {'message': message})


@socketio.on('close_hand')
def handle_close_hand():
    """Pemain tutup kartu - akhiri game"""
    player_id = request.sid
    
    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return
    
    game_id = players[player_id]
    game = games[game_id]
    
    success, player_name = game.close_hand(player_id)
    
    if success:
        # Simpan game state dan ranking ke database
        db.save_game(game)
        for player in game.players:
            db.save_player(game_id, player)
        db.save_ranking(game_id, game.round_number, game.rankings)
        
        # Broadcast game ended ke semua player dengan score masing-masing
        for player in game.players:
            socketio.emit('game_ended', {
                'message': f'{player_name} menutup kartu! Game berakhir.',
                'game_state': game.to_dict(player.player_id)
            }, room=player.player_id)
    else:
        emit('error', {'message': 'Hanya pemain yang mendapat giliran yang bisa tutup kartu!'})


@socketio.on('discard_and_close')
def handle_discard_and_close(data):
    """Buang kartu dan langsung tutup/akhiri game"""
    player_id = request.sid
    card_index = data.get('card_index')
    
    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return
    
    game_id = players[player_id]
    game = games[game_id]
    
    # Validasi giliran dan jumlah kartu
    current_player = game.get_current_player()
    if not current_player or current_player.player_id != player_id:
        emit('error', {'message': 'Bukan giliran Anda!'})
        return
    
    # Hitung total kartu (hand + temp_card)
    total_cards = len(current_player.hand) + (1 if current_player.temp_card else 0)
    if total_cards != 5:
        emit('error', {'message': 'Harus memiliki 5 kartu untuk tutup!'})
        return
    
    # Buang kartu terlebih dahulu
    success, message, discarded_card = game.discard_card(player_id, card_index)
    
    if not success:
        emit('error', {'message': message})
        return
    
    # Setelah buang kartu, pemain harus punya 4 kartu di hand dan tidak ada temp_card
    # Tandai bahwa pemain ini menutup kartu
    current_player.has_won = True
    # Langsung akhiri game dengan menghitung score dari 4 kartu tersebut
    game.end_game()
    
    # Simpan game state dan ranking ke database
    db.save_game(game)
    for player in game.players:
        db.save_player(game_id, player)
    db.save_ranking(game_id, game.round_number, game.rankings)
    
    # Broadcast game ended ke semua player dengan score masing-masing
    for player in game.players:
        socketio.emit('game_ended', {
            'message': f'{current_player.name} menutup kartu! Game berakhir.',
            'game_state': game.to_dict(player.player_id)
        }, room=player.player_id)


@socketio.on('toggle_timer')
def handle_toggle_timer(data):
    """Toggle mode timer"""
    player_id = request.sid
    
    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return
        
    game_id = players[player_id]
    game = games[game_id]
    
    # Validasi: hanya creator yang bisa ubah setting
    player = game.get_player_by_id(player_id)
    if not player or player.name != game.creator_name:
        emit('error', {'message': 'Hanya pembuat game yang bisa mengubah pengaturan!'})
        return
    
    # Toggle timer
    game.use_timer = data.get('use_timer', True)
    
    # Simpan ke database
    db.save_game(game)
    
    # Broadcast perubahan ke semua player
    socketio.emit('timer_toggled', {
        'use_timer': game.use_timer,
        'game_state': game.to_dict()
    }, room=game_id)


@socketio.on('start_game')
def handle_start_game():
    """Memulai permainan"""
    player_id = request.sid
    
    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return
        
    game_id = players[player_id]
    game = games[game_id]
    
    # Validasi: hanya creator yang bisa start game (berdasarkan nama)
    player = game.get_player_by_id(player_id)
    if not player or player.name != game.creator_name:
        emit('error', {'message': 'Hanya pembuat game yang bisa memulai!'})
        return
    
    success, message = game.start_game()
    
    if success:
        # Simpan game state ke database
        db.save_game(game)
        for player in game.players:
            db.save_player(game_id, player)
        
        # Send game started event to each player with their own data
        for player in game.players:
            socketio.emit('game_started', {
                'message': message,
                'game_state': game.to_dict(player.player_id)
            }, room=player.player_id)
        
        # Send individual hand to each player
        for player in game.players:
            socketio.emit('your_hand', {
                'hand': [card.to_dict() for card in player.hand]
            }, room=player.player_id)
    else:
        emit('error', {'message': message})


@socketio.on('restart_game')
def handle_restart_game():
    """Restart game dengan giliran dari pemenang"""
    player_id = request.sid
    
    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return
        
    game_id = players[player_id]
    game = games[game_id]
    
    success, message = game.restart_game()
    
    if success:
        # Send game started event to each player with their own data
        for player in game.players:
            socketio.emit('game_restarted', {
                'message': message,
                'game_state': game.to_dict(player.player_id)
            }, room=player.player_id)
        
        # Send individual hand to each player
        for player in game.players:
            socketio.emit('your_hand', {
                'hand': [card.to_dict() for card in player.hand]
            }, room=player.player_id)
    else:
        emit('error', {'message': message})


@socketio.on('draw_card')
def handle_draw_card(data=None):
    """Mengambil kartu dari deck atau discard pile"""
    player_id = request.sid
    from_discard = data.get('from_discard', False) if data else False
    
    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return
        
    game_id = players[player_id]
    game = games[game_id]
    
    success, message, card = game.draw_card(player_id, from_discard)
    
    if success:
        # Simpan state ke database
        db.save_game(game)
        for player in game.players:
            db.save_player(game_id, player)
        
        # Update pemain yang ambil kartu
        emit('card_drawn', {
            'message': message,
            'card': card
        })
        
        # Broadcast update game ke semua player
        for player in game.players:
            socketio.emit('game_update', game.to_dict(player.player_id), room=player.player_id)
    else:
        emit('error', {'message': message})
        
        # Jika game berakhir
        if game.game_ended:
            # Simpan ranking ke database
            db.save_game(game)
            for player in game.players:
                db.save_player(game_id, player)
            db.save_ranking(game_id, game.round_number, game.rankings)
            
            socketio.emit('game_ended', {
                'message': message,
                'game_state': game.to_dict()
            }, room=game_id)


@socketio.on('discard_card')
def handle_discard_card(data):
    """Membuang kartu"""
    player_id = request.sid
    card_index = data.get('card_index')
    
    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return
        
    game_id = players[player_id]
    game = games[game_id]
    
    success, message, discarded_card = game.discard_card(player_id, card_index)
    
    if success:
        # Simpan state ke database
        db.save_game(game)
        for player in game.players:
            db.save_player(game_id, player)
        
        # Broadcast update game ke semua player (dengan data yang sesuai untuk masing-masing)
        for player in game.players:
            socketio.emit('game_update', game.to_dict(player.player_id), room=player.player_id)
        
        # Send updated hand to each player
        for player in game.players:
            socketio.emit('your_hand', {
                'hand': [card.to_dict() for card in player.hand]
            }, room=player.player_id)
        
        # Jika game berakhir
        if game.game_ended:
            # Simpan ranking
            db.save_ranking(game_id, game.round_number, game.rankings)
            
            for player in game.players:
                socketio.emit('game_ended', {
                    'message': message,
                    'game_state': game.to_dict(player.player_id)
                }, room=player.player_id)
    else:
        emit('error', {'message': message})


@socketio.on('send_chat')
def handle_send_chat(data):
    """Mengirim pesan chat"""
    player_id = request.sid
    message = data.get('message', '').strip()
    
    if not message:
        return
    
    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return
    
    game_id = players[player_id]
    game = games[game_id]
    
    # Cari nama player
    player_name = 'Unknown'
    for player in game.players:
        if player.player_id == player_id:
            player_name = player.name
            break
    
    # Simpan chat ke database
    db.save_chat_message(game_id, player_id, player_name, message)
    
    # Broadcast chat ke semua player di room
    socketio.emit('chat_message', {
        'sender_id': player_id,
        'sender_name': player_name,
        'message': message,
        'timestamp': datetime.now().isoformat()
    }, room=game_id)

def restore_game_from_db(game_id):
    """Restore game state dari database"""
    game_data = db.load_game(game_id)
    if not game_data:
        return None
    
    # Buat game object
    game = Game(game_id, game_data['creator_name'], game_data.get('creator_id', ''))
    game.game_started = bool(game_data['game_started'])
    game.game_ended = bool(game_data['game_ended'])
    game.current_player_index = game_data['current_player_index']
    game.round_number = game_data['round_number']
    
    # Restore deck
    if game_data['deck_cards']:
        deck_data = json.loads(game_data['deck_cards'])
        game.deck.cards = [Card(c['suit'], c['rank']) for c in deck_data]
    
    # Restore last discarded card
    if game_data['last_discarded_card']:
        card_data = json.loads(game_data['last_discarded_card'])
        game.last_discarded_card = Card(card_data['suit'], card_data['rank'])
        game.last_discarder_name = game_data['last_discarder_name']
    
    # Restore players
    players_data = db.load_players(game_id)
    for p_data in players_data:
        player = Player(p_data['player_id'], p_data['name'])
        player.score = p_data['score']
        player.cumulative_score = p_data['cumulative_score']
        player.games_won = p_data['games_won']
        player.has_won = bool(p_data['has_won'])
        player.surrendered = bool(p_data['surrendered'])
        player.is_online = bool(p_data['is_online'])
        
        # Restore cards
        if p_data['hand']:
            hand_data = json.loads(p_data['hand'])
            player.hand = [Card(c['suit'], c['rank']) for c in hand_data]
        
        if p_data['temp_card']:
            temp_data = json.loads(p_data['temp_card'])
            player.temp_card = Card(temp_data['suit'], temp_data['rank'])
        
        if p_data['discard_pile']:
            discard_data = json.loads(p_data['discard_pile'])
            player.discard_pile = [Card(c['suit'], c['rank']) for c in discard_data]
        
        game.players.append(player)
    
    return game

@socketio.on('finish_game')
def handle_finish_game(data):
    """Mengakhiri game secara permanen dan menghapus dari database"""
    game_id = data.get('game_id')
    player_id = request.sid
    
    if game_id not in games:
        emit('error', {'message': 'Game tidak ditemukan'})
        return
    
    game = games[game_id]
    
    # Cari nama pemain yang mengakhiri game
    player_name = None
    for player in game.players:
        if player.player_id == player_id:
            player_name = player.name
            break
    
    # Hapus dari memori
    del games[game_id]
    
    # Hapus players yang terkait
    if game_id in players:
        del players[game_id]
    
    # Hapus sessions
    sessions_to_delete = [sid for sid, gid in player_sessions.items() if gid == game_id]
    for sid in sessions_to_delete:
        del player_sessions[sid]
    
    # Hapus dari database
    db.delete_game(game_id)
    
    # Broadcast ke semua player di room
    emit('game_finished', {
        'message': f'Game telah diakhiri oleh {player_name or "pemain"}'
    }, room=game_id)
    
    # Redirect yang mengakhiri ke home
    emit('redirect_home')

@app.route('/cleanup')
def cleanup():
    """Endpoint untuk cleanup data lama (bisa dijadwalkan dengan cron)"""
    games_deleted = db.cleanup_old_games(30)
    db.delete_old_sessions(7)
    return jsonify({
        'message': 'Cleanup completed',
        'games_deleted': games_deleted
    })

if __name__ == '__main__':
    socketio.run(app, debug=True, port=3400)
