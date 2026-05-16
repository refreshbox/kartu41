from flask import Flask, render_template, jsonify, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import secrets
import json
from datetime import datetime
from threading import Lock
from dotenv import load_dotenv
import os
import database as db

load_dotenv()
app = Flask(__name__)
socket_io_path = os.getenv('SOCKET_IO_PATH', '/socket.io')
base_href = os.getenv('BASE_HREF', '/')
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', secrets.token_hex(16))
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Initialize database
db.init_db()

# Game state storage (in-memory cache + database)
games = {}
players = {}  # {socket_id: game_id}
player_sessions = {}  # {player_name_game_id: socket_id} untuk reconnect
bot_turn_tokens = {}
bot_turn_lock = Lock()
BOT_TURN_DELAY_SECONDS = max(0, int(float(os.getenv('BOT_TURN_DELAY_SECONDS', '30'))))


def normalize_bot_turn_delay_seconds(value, fallback=None):
    """Normalisasi input delay takeover bot ke integer detik."""
    if fallback is None:
        fallback = BOT_TURN_DELAY_SECONDS

    try:
        normalized = int(float(value))
    except (TypeError, ValueError):
        return fallback

    return max(0, normalized)

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
        self.use_timer = False  # Mode timer default nonaktif
        self.randomize_player_order = False  # Default urutan pemain tetap
        self.bot_turn_delay_seconds = BOT_TURN_DELAY_SECONDS
        self.ready_check_active = False
        self.ready_player_names = []
        self.next_starting_player_name = None
        
    def add_player(self, player_id, name):
        """Menambah pemain ke game"""
        if len(self.players) >= 6:
            return False, "Game sudah penuh (maksimal 6 pemain)"
        
        if self.game_started:
            return False, "Game sudah dimulai"

        if self.game_ended:
            return False, "Tunggu ronde selesai dikembalikan ke lobby"

        if self.ready_check_active:
            return False, "Konfirmasi mulai sedang berlangsung"

        if any(player.name == name for player in self.players):
            return False, "Nama pemain sudah digunakan"
            
        player = Player(player_id, name)
        self.players.append(player)
        return True, "Berhasil bergabung"
    
    def get_player_by_id(self, player_id):
        """Mendapatkan player berdasarkan player_id"""
        for player in self.players:
            if player.player_id == player_id:
                return player
        return None

    def get_player_by_name(self, player_name):
        """Mendapatkan player berdasarkan nama."""
        for player in self.players:
            if player.name == player_name:
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
        removed_player = None
        remaining_players = []

        for player in self.players:
            if player.player_id == player_id:
                removed_player = player
                continue
            remaining_players.append(player)

        self.players = remaining_players

        if removed_player and removed_player.name in self.ready_player_names:
            self.ready_player_names = [
                player_name for player_name in self.ready_player_names
                if player_name != removed_player.name
            ]

        if removed_player and removed_player.name == self.next_starting_player_name:
            self.next_starting_player_name = None

        if self.players:
            self.current_player_index %= len(self.players)
        else:
            self.current_player_index = 0

        return removed_player

    def set_creator(self, player):
        """Tetapkan creator/pembuat game baru."""
        self.creator_name = player.name
        self.creator_id = player.player_id

    def assign_random_creator(self):
        """Pilih creator baru secara acak dari pemain tersisa."""
        if not self.players:
            self.creator_name = ''
            self.creator_id = ''
            return None

        new_creator = random.choice(self.players)
        self.set_creator(new_creator)
        return new_creator

    def cancel_ready_check(self):
        """Reset status konfirmasi mulai."""
        self.ready_check_active = False
        self.ready_player_names = []

    def begin_ready_check(self, initiator_name=None):
        """Mulai konfirmasi dari semua pemain online di lobby."""
        online_players = [player for player in self.players if player.is_online]

        if self.game_started:
            return False, "Game sudah dimulai"

        if self.game_ended:
            return False, "Tunggu kembali ke lobby terlebih dahulu"

        if len(online_players) < 2:
            return False, "Minimal 2 pemain online untuk memulai"

        self.ready_check_active = True
        self.ready_player_names = []
        ready_initiator_name = initiator_name or self.creator_name
        initiator = self.get_player_by_name(ready_initiator_name)
        if initiator and initiator.is_online:
            self.ready_player_names.append(initiator.name)

        return True, "Konfirmasi mulai dikirim ke semua pemain."

    def _get_starting_player_index(self):
        if not self.players:
            return 0

        if self.next_starting_player_name:
            for index, player in enumerate(self.players):
                if player.name == self.next_starting_player_name:
                    return index

        return 0

    def mark_player_ready(self, player_id):
        """Tandai pemain siap. Jika semua siap, game langsung dimulai."""
        if not self.ready_check_active:
            return False, "Belum ada konfirmasi mulai yang aktif", False

        player = self.get_player_by_id(player_id)
        if not player:
            return False, "Pemain tidak ditemukan", False

        if not player.is_online:
            return False, "Pemain sedang offline", False

        if player.name not in self.ready_player_names:
            self.ready_player_names.append(player.name)

        online_player_names = [online_player.name for online_player in self.players if online_player.is_online]
        all_ready = all(player_name in self.ready_player_names for player_name in online_player_names)
        if all_ready:
            self.cancel_ready_check()
            success, message = self.start_game()
            return success, message, success

        return (True, f'{player.name} sudah siap. Menunggu pemain lain.', False)

    def reset_round_state(self):
        """Reset state ronde tanpa menghapus skor kumulatif."""
        self.deck = Deck()
        self.game_started = False
        self.game_ended = False
        self.winner = None
        self.rankings = []
        self.last_discarded_card = None
        self.last_discarder_name = None
        self.cancel_ready_check()

        for player in self.players:
            player.hand = []
            player.discard_pile = []
            player.score = 0
            player.has_won = False
            player.temp_card = None
            player.surrendered = False

    def return_to_lobby(self):
        """Kembali ke lobby setelah ronde selesai."""
        if not self.game_ended:
            return False, "Ronde ini belum selesai"

        self.next_starting_player_name = self.winner.name if self.winner else self.next_starting_player_name
        self.reset_round_state()
        return True, "Kembali ke lobby. Pemain baru bisa bergabung."
        
    def start_game(self, starting_player_index=None, shuffle_players=False):
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
                player_sessions.pop(f"{offline_player.name}_{self.game_id}", None)
                db.delete_session(f"{offline_player.name}_{self.game_id}")
                print(f"Kicked offline player: {offline_player.name}")

        if len(self.players) < 2:
            return False, "Minimal 2 pemain online untuk memulai"

        if starting_player_index is None:
            starting_player_index = self._get_starting_player_index()
        starting_player_name = None
        if 0 <= starting_player_index < len(self.players):
            starting_player_name = self.players[starting_player_index].name

        self.deck = Deck()
        self.deck.shuffle()
        self.game_ended = False
        self.winner = None
        self.rankings = []
        self.last_discarded_card = None
        self.last_discarder_name = None
        self.cancel_ready_check()

        for player in self.players:
            player.hand = []
            player.discard_pile = []
            player.score = 0
            player.has_won = False
            player.temp_card = None
            player.surrendered = False
        
        previous_round_number = self.round_number

        # Increment round number
        self.round_number += 1
        
        # Acak urutan pemain hanya untuk ronde berikutnya setelah ronde pertama selesai.
        should_shuffle_players = shuffle_players or (
            self.randomize_player_order and previous_round_number > 0
        )
        if should_shuffle_players and len(self.players) > 1:
            random.shuffle(self.players)
        if starting_player_name:
            for i, player in enumerate(self.players):
                if player.name == starting_player_name:
                    starting_player_index = i
                    break
        else:
            starting_player_index = 0
            
        # Acak deck dan bagikan 4 kartu ke setiap pemain
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
        
        self.next_starting_player_name = self.winner.name if self.winner else self.next_starting_player_name
        self.reset_round_state()
        return self.start_game()
        
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
        players_data = []
        for player in self.players:
            player_data = player.to_dict(
                reveal_hand=(player.player_id == player_id),
                reveal_score=(player.player_id == player_id or self.game_ended)
            )
            player_data['is_bot_controlled'] = (not player.is_online and self.game_started and not self.game_ended)
            players_data.append(player_data)
        
        return {
            'game_id': self.game_id,
            'creator_id': self.creator_id,
            'creator_name': self.creator_name,
            'round_number': self.round_number,
            'use_timer': self.use_timer,
            'randomize_player_order': self.randomize_player_order,
            'bot_turn_delay_seconds': self.bot_turn_delay_seconds,
            'ready_check_active': self.ready_check_active,
            'ready_player_names': list(self.ready_player_names),
            'online_player_count': len([player for player in self.players if player.is_online]),
            'players': players_data,
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


def persist_game_state(game, include_rankings=False):
    """Simpan seluruh state game dalam satu transaksi."""
    db.save_game_state(game, include_rankings=include_rankings)


def emit_lobby_state(game, message=None, event_name='lobby_updated'):
    """Broadcast state lobby yang tidak mengandung informasi privat."""
    payload = {'game_state': game.to_dict()}
    if message is not None:
        payload['message'] = message
    socketio.emit(event_name, payload, room=game.game_id)


def remove_player_session(game_id, player_name):
    """Bersihkan session reconnect milik pemain."""
    session_key = f"{player_name}_{game_id}"
    player_sessions.pop(session_key, None)
    db.delete_session(session_key)


def delete_game_everywhere(game_id):
    """Hapus game sepenuhnya dari memory dan database."""
    games.pop(game_id, None)

    players_to_delete = [sid for sid, joined_game_id in players.items() if joined_game_id == game_id]
    for sid in players_to_delete:
        del players[sid]

    sessions_to_delete = [session_key for session_key, socket_id in player_sessions.items() if session_key.endswith(f"_{game_id}")]
    for session_key in sessions_to_delete:
        del player_sessions[session_key]

    db.delete_game(game_id)


def remove_player_from_lobby(game, player, *, kicked_by=None):
    """Keluarkan pemain dari lobby, tangani pindah creator dan cleanup game kosong."""
    if not player:
        return False, "Pemain tidak ditemukan", None

    was_creator = player.name == game.creator_name
    removed_player = game.remove_player(player.player_id)
    if not removed_player:
        return False, "Pemain tidak ditemukan", None

    players.pop(removed_player.player_id, None)
    remove_player_session(game.game_id, removed_player.name)
    leave_room(game.game_id, sid=removed_player.player_id)

    if game.ready_check_active:
        game.cancel_ready_check()

    new_creator = None
    if was_creator and game.players:
        new_creator = game.assign_random_creator()

    if not game.players:
        delete_game_everywhere(game.game_id)
        return True, f'{removed_player.name} keluar. Game dibubarkan karena tidak ada pemain tersisa.', None

    persist_game_state(game)

    if kicked_by:
        if new_creator:
            message = f'{removed_player.name} dikeluarkan oleh {kicked_by}. Pembuat game sekarang {new_creator.name}.'
        else:
            message = f'{removed_player.name} dikeluarkan oleh {kicked_by}.'
    elif new_creator:
        message = f'{removed_player.name} keluar. Pembuat game sekarang {new_creator.name}.'
    else:
        message = f'{removed_player.name} keluar dari lobby.'

    return True, message, new_creator


def invalidate_bot_turn(game_id):
    """Batalkan task bot lama untuk game ini."""
    with bot_turn_lock:
        bot_turn_tokens[game_id] = bot_turn_tokens.get(game_id, 0) + 1
        return bot_turn_tokens[game_id]


def get_bot_turn_token(game_id):
    with bot_turn_lock:
        return bot_turn_tokens.get(game_id, 0)


def emit_game_state_to_players(event_name, game, message=None, wrap_state=True):
    """Kirim state game privat ke tiap pemain aktif di room pribadinya."""
    for player in game.players:
        state = game.to_dict(player.player_id)
        if wrap_state:
            payload = {'game_state': state}
            if message is not None:
                payload['message'] = message
        else:
            payload = state
        socketio.emit(event_name, payload, room=player.player_id)


def emit_hands_to_players(game):
    """Kirim hand terbaru ke tiap pemain."""
    for player in game.players:
        payload = {
            'hand': [card.to_dict() for card in player.hand]
        }
        if player.temp_card:
            payload['temp_card'] = player.temp_card.to_dict()
        socketio.emit('your_hand', payload, room=player.player_id)


def emit_bot_takeover(game, player_name):
    delay = game.bot_turn_delay_seconds
    if delay == 0:
        message = f'{player_name} terputus. Bot langsung melanjutkan giliran secara acak.'
    else:
        message = f'{player_name} terputus. Bot akan mengambil alih dalam {delay} detik.'

    socketio.emit('bot_playing', {
        'player_name': player_name,
        'message': message
    }, room=game.game_id)


def perform_bot_turn(game_id, token):
    if game_id not in games:
        return

    game = games[game_id]
    socketio.sleep(game.bot_turn_delay_seconds)

    if get_bot_turn_token(game_id) != token:
        return

    if game_id not in games:
        return

    game = games[game_id]
    if game.game_ended or not game.game_started or not game.players:
        return

    current_player = game.get_current_player()
    if not current_player or current_player.is_online or current_player.surrendered:
        return

    from_discard = bool(game.last_discarded_card) and random.choice([True, False])
    success, message, _ = game.draw_card(current_player.player_id, from_discard=from_discard)

    if not success:
        if game.game_ended:
            persist_game_state(game, include_rankings=True)
            socketio.emit('game_ended', {
                'message': message,
                'game_state': game.to_dict()
            }, room=game_id)
        return

    discard_candidates = [-1] + list(range(len(current_player.hand)))
    card_index = random.choice(discard_candidates)
    success, message, _ = game.discard_card(current_player.player_id, card_index)

    if not success:
        return

    persist_game_state(game, include_rankings=game.game_ended)
    socketio.emit('bot_played_turn', {
        'player_name': current_player.name,
        'message': f'Bot memainkan giliran {current_player.name} secara acak.'
    }, room=game_id)
    emit_game_state_to_players('game_update', game, wrap_state=False)
    emit_hands_to_players(game)

    if game.game_ended:
        emit_game_state_to_players('game_ended', game, message)
        return

    schedule_bot_turn_if_needed(game)


def schedule_bot_turn_if_needed(game):
    """Jalankan bot bila giliran jatuh ke pemain offline."""
    token = invalidate_bot_turn(game.game_id)

    if game.game_ended or not game.game_started or not game.players:
        return

    current_player = game.get_current_player()
    if not current_player or current_player.is_online or current_player.surrendered:
        return

    emit_bot_takeover(game, current_player.name)
    socketio.start_background_task(perform_bot_turn, game.game_id, token)


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

                    ready_check_was_active = game.ready_check_active
                    if not game.game_started and game.ready_check_active:
                        game.cancel_ready_check()
                    
                    # Update database
                    persist_game_state(game)
                    db.save_session(session_key, game_id, player.name, player_id)
                    
                    # Broadcast disconnect ke player lain dengan game state update
                    if not game.game_started:
                        lobby_message = (
                            f'{player.name} terputus. Konfirmasi mulai dibatalkan.'
                            if ready_check_was_active
                            else f'{player.name} terputus dari lobby.'
                        )
                        socketio.emit('player_disconnected', {
                            'player_name': player.name,
                            'message': lobby_message,
                            'game_state': game.to_dict()
                        }, room=game_id)
                    else:
                        socketio.emit('player_disconnected', {
                            'player_name': player.name,
                            'game_state': game.to_dict()
                        }, room=game_id)
                    schedule_bot_turn_if_needed(game)
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
    game.bot_turn_delay_seconds = normalize_bot_turn_delay_seconds(
        data.get('bot_turn_delay_seconds'),
        BOT_TURN_DELAY_SECONDS
    )
    success, message = game.add_player(player_id, player_name)
    
    if success:
        games[game_id] = game
        players[player_id] = game_id
        
        # Simpan session untuk reconnect
        session_key = f"{player_name}_{game_id}"
        player_sessions[session_key] = player_id
        print(f"Session created: {session_key} -> {player_id}")
        
        # Simpan ke database
        persist_game_state(game)
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
        if existing_player.is_online:
            emit('error', {'message': 'Nama pemain sudah digunakan'})
            return

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
            persist_game_state(game)
            db.save_session(session_key, game_id, player_name, player_id)
            schedule_bot_turn_if_needed(game)
            
            join_room(game_id)
            
            # Send reconnect success
            emit('reconnected', {
                'message': 'Berhasil reconnect!',
                'player_id': player_id,
                'game_state': game.to_dict(player_id)
            })
            
            # Broadcast ke player lain dengan game state update
            if not game.game_started:
                socketio.emit('player_reconnected', {
                    'player_name': name,
                    'message': f'{name} kembali ke lobby.',
                    'game_state': game.to_dict()
                }, room=game_id)
            else:
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
        persist_game_state(game)
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
        schedule_bot_turn_if_needed(game)
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
        persist_game_state(game, include_rankings=True)
        
        # Broadcast game ended ke semua player dengan score masing-masing
        emit_game_state_to_players('game_ended', game, f'{player_name} menutup kartu! Game berakhir.')
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
    persist_game_state(game, include_rankings=True)
    
    # Broadcast game ended ke semua player dengan score masing-masing
    emit_game_state_to_players('game_ended', game, f'{current_player.name} menutup kartu! Game berakhir.')


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
    persist_game_state(game)
    
    # Broadcast perubahan ke semua player
    socketio.emit('timer_toggled', {
        'use_timer': game.use_timer,
        'game_state': game.to_dict()
    }, room=game_id)


@socketio.on('toggle_randomize_player_order')
def handle_toggle_randomize_player_order(data):
    """Toggle pengacakan urutan pemain per ronde."""
    player_id = request.sid

    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return

    game_id = players[player_id]
    game = games[game_id]

    player = game.get_player_by_id(player_id)
    if not player or player.name != game.creator_name:
        emit('error', {'message': 'Hanya pembuat game yang bisa mengubah pengaturan!'})
        return

    game.randomize_player_order = bool(data.get('randomize_player_order', False))
    persist_game_state(game)

    socketio.emit('player_order_randomization_toggled', {
        'randomize_player_order': game.randomize_player_order,
        'game_state': game.to_dict()
    }, room=game_id)


@socketio.on('update_bot_turn_delay')
def handle_update_bot_turn_delay(data):
    """Update delay takeover bot untuk game ini."""
    player_id = request.sid

    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return

    game_id = players[player_id]
    game = games[game_id]

    player = game.get_player_by_id(player_id)
    if not player or player.name != game.creator_name:
        emit('error', {'message': 'Hanya pembuat game yang bisa mengubah pengaturan!'})
        return

    raw_delay = data.get('bot_turn_delay_seconds')
    if raw_delay in (None, ''):
        emit('error', {'message': 'Masukkan jumlah detik takeover bot!'})
        return

    normalized_delay = normalize_bot_turn_delay_seconds(raw_delay, fallback=-1)
    if normalized_delay < 0:
        emit('error', {'message': 'Delay takeover bot harus berupa angka!'})
        return

    game.bot_turn_delay_seconds = normalized_delay
    persist_game_state(game)

    socketio.emit('bot_turn_delay_updated', {
        'bot_turn_delay_seconds': game.bot_turn_delay_seconds,
        'game_state': game.to_dict()
    }, room=game_id)


@socketio.on('start_game')
def handle_start_game():
    """Mulai ready-check sebelum game dimulai."""
    player_id = request.sid
    
    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return
        
    game_id = players[player_id]
    game = games[game_id]
    
    player = game.get_player_by_id(player_id)
    if not player:
        emit('error', {'message': 'Pemain tidak ditemukan'})
        return

    if not player.is_online:
        emit('error', {'message': 'Pemain sedang offline'})
        return
    
    success, message = game.begin_ready_check(player.name)
    
    if success:
        persist_game_state(game)
        socketio.emit('ready_check_started', {
            'message': message,
            'game_state': game.to_dict()
        }, room=game_id)
    else:
        emit('error', {'message': message})


@socketio.on('respond_ready_check')
def handle_respond_ready_check(data):
    """Respons pemain terhadap ready-check lobby."""
    player_id = request.sid

    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return

    game_id = players[player_id]
    game = games[game_id]
    accepted = bool(data.get('accepted'))
    player = game.get_player_by_id(player_id)

    if not game.ready_check_active:
        emit('error', {'message': 'Konfirmasi mulai sudah tidak aktif'})
        return

    if not player:
        emit('error', {'message': 'Pemain tidak ditemukan'})
        return

    if not accepted:
        game.cancel_ready_check()
        persist_game_state(game)
        socketio.emit('ready_check_cancelled', {
            'message': f'{player.name} belum siap. Konfirmasi mulai dibatalkan.',
            'game_state': game.to_dict()
        }, room=game_id)
        return

    success, message, all_ready = game.mark_player_ready(player_id)

    if not success:
        emit('error', {'message': message})
        return

    persist_game_state(game)

    if all_ready:
        emit_game_state_to_players('game_started', game, message)
        emit_hands_to_players(game)
        schedule_bot_turn_if_needed(game)
        return

    socketio.emit('ready_check_updated', {
        'message': message,
        'game_state': game.to_dict()
    }, room=game_id)


@socketio.on('cancel_ready_check')
def handle_cancel_ready_check():
    """Creator dapat membatalkan ready-check lobby."""
    player_id = request.sid

    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return

    game_id = players[player_id]
    game = games[game_id]
    player = game.get_player_by_id(player_id)

    if not player or player.name != game.creator_name:
        emit('error', {'message': 'Hanya pembuat game yang bisa membatalkan konfirmasi!'})
        return

    if not game.ready_check_active:
        emit('error', {'message': 'Belum ada konfirmasi mulai yang aktif'})
        return

    game.cancel_ready_check()
    persist_game_state(game)
    socketio.emit('ready_check_cancelled', {
        'message': 'Konfirmasi mulai dibatalkan oleh pembuat game.',
        'game_state': game.to_dict()
    }, room=game_id)


@socketio.on('return_to_lobby')
def handle_return_to_lobby():
    """Kembali ke lobby setelah ronde selesai."""
    player_id = request.sid

    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return

    game_id = players[player_id]
    game = games[game_id]

    success, message = game.return_to_lobby()
    if not success:
        emit('error', {'message': message})
        return

    persist_game_state(game)
    emit_lobby_state(game, message, event_name='returned_to_lobby')


@socketio.on('leave_lobby')
def handle_leave_lobby():
    """Keluar dari lobby tanpa menghapus game sepenuhnya."""
    player_id = request.sid

    if player_id not in players:
        emit('left_lobby', {'message': 'Anda sudah tidak berada di game manapun.'})
        return

    game_id = players[player_id]
    game = games.get(game_id)
    if not game:
        players.pop(player_id, None)
        emit('left_lobby', {'message': 'Anda sudah keluar dari game.'})
        return

    if game.game_started and not game.game_ended:
        emit('error', {'message': 'Keluar hanya bisa dilakukan saat masih di lobby'})
        return

    player = game.get_player_by_id(player_id)
    success, message, _ = remove_player_from_lobby(game, player)
    if not success:
        emit('error', {'message': message})
        return

    emit('left_lobby', {'message': message})
    if game_id in games:
        emit_lobby_state(games[game_id], message)


@socketio.on('kick_player')
def handle_kick_player(data):
    """Creator dapat mengeluarkan pemain lain dari lobby."""
    player_id = request.sid
    target_player_name = (data.get('player_name') or '').strip()

    if player_id not in players:
        emit('error', {'message': 'Anda tidak ada di game manapun'})
        return

    game_id = players[player_id]
    game = games.get(game_id)
    if not game:
        emit('error', {'message': 'Game tidak ditemukan'})
        return

    actor = game.get_player_by_id(player_id)
    if not actor or actor.name != game.creator_name:
        emit('error', {'message': 'Hanya pembuat game yang bisa mengeluarkan pemain!'})
        return

    if game.game_started and not game.game_ended:
        emit('error', {'message': 'Pemain hanya bisa dikeluarkan saat masih di lobby'})
        return

    target_player = game.get_player_by_name(target_player_name)
    if not target_player:
        emit('error', {'message': 'Pemain tidak ditemukan'})
        return

    if target_player.name == actor.name:
        emit('error', {'message': 'Gunakan tombol keluar jika ingin meninggalkan lobby'})
        return

    target_player_id = target_player.player_id
    success, message, _ = remove_player_from_lobby(game, target_player, kicked_by=actor.name)
    if not success:
        emit('error', {'message': message})
        return

    socketio.emit('kicked_from_lobby', {
        'message': f'Anda dikeluarkan dari game {game_id} oleh {actor.name}.'
    }, room=target_player_id)

    if game_id in games:
        emit_lobby_state(games[game_id], message)


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
        # Simpan game state baru agar restart tetap konsisten setelah reconnect/server restart
        persist_game_state(game)

        # Send game started event to each player with their own data
        emit_game_state_to_players('game_restarted', game, message)
        
        # Send individual hand to each player
        emit_hands_to_players(game)
        schedule_bot_turn_if_needed(game)
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
        persist_game_state(game)
        
        # Update pemain yang ambil kartu
        emit('card_drawn', {
            'message': message,
            'card': card
        })
        
        # Broadcast update game ke semua player
        emit_game_state_to_players('game_update', game, wrap_state=False)
        schedule_bot_turn_if_needed(game)
    else:
        emit('error', {'message': message})
        
        # Jika game berakhir
        if game.game_ended:
            # Simpan ranking ke database
            persist_game_state(game, include_rankings=True)
            
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
        persist_game_state(game, include_rankings=game.game_ended)
        
        # Broadcast update game ke semua player (dengan data yang sesuai untuk masing-masing)
        emit_game_state_to_players('game_update', game, wrap_state=False)
        
        # Send updated hand to each player
        emit_hands_to_players(game)
        
        # Jika game berakhir
        if game.game_ended:
            emit_game_state_to_players('game_ended', game, message)
        else:
            schedule_bot_turn_if_needed(game)
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
    game.ready_check_active = bool(game_data.get('ready_check_active', 0))
    ready_player_names = game_data.get('ready_player_names')
    if ready_player_names:
        game.ready_player_names = json.loads(ready_player_names)
    game.next_starting_player_name = game_data.get('next_starting_player_name')
    game.current_player_index = game_data['current_player_index']
    game.round_number = game_data['round_number']
    game.use_timer = bool(game_data.get('use_timer', 0))
    game.randomize_player_order = bool(game_data.get('randomize_player_order', 0))
    game.bot_turn_delay_seconds = normalize_bot_turn_delay_seconds(
        game_data.get('bot_turn_delay_seconds'),
        BOT_TURN_DELAY_SECONDS
    )
    
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
    had_stale_online_players = False
    winner_player = None
    for p_data in players_data:
        player = Player(p_data['player_id'], p_data['name'])
        player.score = p_data['score']
        player.cumulative_score = p_data['cumulative_score']
        player.games_won = p_data['games_won']
        player.has_won = bool(p_data['has_won'])
        player.surrendered = bool(p_data['surrendered'])
        if player.has_won:
            winner_player = player
        # Setelah restore dari database, socket lama tidak lagi valid.
        # Semua pemain dianggap offline sampai mereka reconnect dengan sid baru.
        player.is_online = False
        had_stale_online_players = had_stale_online_players or bool(p_data['is_online'])
        
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

    if game.players:
        game.calculate_overall_rankings()

    if game.game_ended and game.round_number:
        rankings_data = db.load_rankings(game_id, game.round_number)
        restored_rankings = []
        for ranking_data in rankings_data:
            ranked_player = game.get_player_by_name(ranking_data['player_name'])
            if not ranked_player:
                continue
            restored_rankings.append({
                'player': ranked_player,
                'score': ranking_data['score'],
                'same_suit': bool(ranking_data['same_suit'])
            })

        if restored_rankings:
            game.rankings = restored_rankings
            game.winner = restored_rankings[0]['player']
        elif winner_player:
            game.winner = winner_player
    elif winner_player:
        game.winner = winner_player

    if game.players and game.current_player_index >= len(game.players):
        game.current_player_index %= len(game.players)

    if had_stale_online_players:
        persist_game_state(game)
    
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

    delete_game_everywhere(game_id)
    
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
    socketio.run(app, debug=True, port=4000)
