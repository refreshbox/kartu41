# Kartu 41 - Database Integration

## Database SQLite telah terintegrasi!

### Fitur yang Disimpan di Database:

1. **Game State** - Status game, deck cards, current player, dll
2. **Players** - Data pemain, kartu, score, status online/offline
3. **Chat Messages** - History chat tetap tersimpan
4. **Player Sessions** - Untuk reconnect setelah disconnect
5. **Game Rankings** - History ranking per round

### Keuntungan:

✅ **Game bisa dilanjutkan** setelah semua pemain disconnect  
✅ **Chat history tetap ada** saat reconnect  
✅ **Player bisa reconnect** dengan data lengkap  
✅ **Statistik pemain** tersimpan  
✅ **Auto-cleanup** data lama

### Setup Database:

Database akan otomatis dibuat saat pertama kali menjalankan aplikasi.

```bash
python app.py
```

File database: `kartu41.db`

### Cara Kerja:

1. **Saat Create/Join Game**: Data disimpan ke database
2. **Saat Disconnect**: Status player di-update ke offline
3. **Saat Reconnect**: 
   - Jika game masih di memory → langsung reconnect
   - Jika game tidak di memory → restore dari database
4. **Saat Chat**: Pesan disimpan ke database
5. **Saat Game End**: Ranking disimpan ke database

### Endpoint Tambahan:

**GET /cleanup** - Cleanup data lama (bisa dijadwalkan dengan cron)
- Hapus game yang sudah >30 hari
- Hapus session yang >7 hari

### Environment Variables:

Copy `.env.example` ke `.env` dan sesuaikan:

```bash
SOCKET_IO_PATH=/kartu41/socket.io
BASE_HREF=/kartu41/
FLASK_SECRET_KEY=your_secret_key_here
FLASK_ENV=development
```

### Struktur Database:

**games** - Data game  
**players** - Data pemain per game  
**chat_messages** - Chat history  
**player_sessions** - Session reconnect  
**game_rankings** - Ranking history

### Fungsi Database (database.py):

- `init_db()` - Inisialisasi database
- `save_game()` - Simpan game state
- `load_game()` - Load game dari DB
- `save_player()` - Simpan player state
- `load_players()` - Load players
- `save_chat_message()` - Simpan chat
- `load_chat_messages()` - Load chat history
- `save_session()` - Simpan session
- `load_session()` - Load session
- `save_ranking()` - Simpan ranking
- `get_player_stats()` - Statistik pemain
- `cleanup_old_games()` - Cleanup otomatis

### Testing:

1. Buat game baru
2. Disconnect semua pemain
3. Join kembali dengan nama yang sama
4. Game dan chat akan ter-restore!
