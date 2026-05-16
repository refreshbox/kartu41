# Game Kartu 41

Aplikasi web game Kartu 41 menggunakan Python Flask dan Socket.IO untuk multiplayer real-time.

## Aturan Permainan

**Kartu 41** adalah permainan mengumpulkan kartu yang ditangan bernilai **41** dengan kembang yang sama.

### Nilai Kartu:
- **Kartu angka (2-10)**: Nilainya sesuai dengan angka di kartu
- **J, Q, K**: Nilainya adalah 10
- **A (As)**: Nilainya adalah 11

### Peraturan:
1. Permainan dapat dimainkan oleh **2-6 orang**
2. Setiap pemain mendapat **4 kartu** di awal permainan
3. Setiap giliran: ambil 1 kartu → buang 1 kartu
4. **Timer Mode**: Setiap pemain punya **30 detik** per giliran (default nonaktif)
5. Tujuan: Kumpulkan kartu dengan total nilai **41** dan **kembang yang sama**
6. **Penting**: Jika kartu tidak sama kembang, nilai kartu yang beda kembang akan dikurangi dari total
7. Pemain offline akan otomatis dikeluarkan saat game dimulai jika pemain online ≥ 2

### Akhir Permainan:
- Game berakhir jika ada pemain yang mencapai **41 dengan kembang sama**
- Game juga berakhir jika kartu di deck sudah habis
- Pemenang ditentukan berdasarkan nilai tertinggi yang mendekati 41

## Instalasi

### Menggunakan Docker (Recommended)

```bash
# Build image
docker build -t kartu41 .

# Run container
docker run -d -p 4000:4000 kartu41

# Atau dengan environment variables
docker run -d -p 4000:4000 \
  -e FLASK_SECRET_KEY=your_secret_key \
  -e SOCKET_IO_PATH=/socket.io \
  -e BASE_HREF=/ \
  -e DATABASE_FILE=/app/data/kartu41.db \
  kartu41
```

**Note:** Container menggunakan Gunicorn multi-threaded dengan `simple-websocket` untuk mendukung Socket.IO tanpa `eventlet`:
```bash
gunicorn -w 1 --threads 100 --timeout 120 --bind 0.0.0.0:4000 app:app
```

### Manual Installation

### 1. Clone atau Download Project

### 2. Install Dependencies
```bash
cd kartu41
pip install -r requirements.txt
```

### 3. Setup Environment Variables (optional)
```bash
cp .env.example .env
# Edit .env sesuai kebutuhan
```

Variabel yang didukung:
- `FLASK_SECRET_KEY` - secret key Flask
- `SOCKET_IO_PATH` - path Socket.IO
- `BASE_HREF` - base path aplikasi
- `DATABASE_FILE` - lokasi file SQLite, default `kartu41.db`

### 4. Jalankan Aplikasi

**Development mode:**
```bash
python app.py
```

**Production mode (recommended):**
```bash
gunicorn -w 1 --threads 100 --timeout 120 --bind 0.0.0.0:4000 app:app
```

**Note:** Konfigurasi ini memakai mode `threading` Flask-SocketIO dan paket `simple-websocket`, jadi tidak bergantung pada `eventlet` yang sudah deprecated.

### 5. Buka Browser
Akses aplikasi di: `http://localhost:4000`

### 6. Jalankan Regression Test Backend
```bash
./.venv/bin/python -m unittest tests.test_backend_regressions tests.test_socketio_runtime
```

## Cara Bermain

### Membuat Game Baru:
1. Masukkan nama Anda
2. Klik "Buat Game Baru"
3. Bagikan Game ID kepada teman-teman
4. Tunggu minimal 2 pemain, lalu klik "Mulai Game"

### Bergabung ke Game:
1. Masukkan nama Anda
2. Klik "Gabung Game"
3. Masukkan Game ID yang diterima dari teman
4. Klik "Gabung"

### Saat Bermain:
1. Tunggu giliran Anda (nama akan berubah warna hijau)
2. **Timer countdown** akan muncul di samping nama Anda
3. Klik deck untuk **mengambil kartu** atau ambil dari kartu buangan
4. Pilih kartu yang ingin dibuang
5. Klik tombol **"Buang"** pada kartu tersebut
6. Giliran akan berpindah ke pemain berikutnya
7. ⚠️ Jika waktu habis (30 detik), kartu akan otomatis dimainkan

### Timer Mode:
- Timer bisa diaktifkan/dinonaktifkan oleh pembuat game di lobby
- Saat aktif: setiap pemain punya 30 detik per giliran
- Countdown terlihat oleh semua pemain
- Auto-play jika waktu habis: sistem akan ambil kartu dan buang kartu tertinggi otomatis

## Fitur

✅ Multiplayer real-time menggunakan WebSocket  
✅ **2-6 pemain** per game  
✅ **Timer Mode** - 30 detik per giliran dengan countdown yang terlihat semua pemain  
✅ **Auto-play** - Kartu otomatis dimainkan jika waktu habis  
✅ **Smart paste** - Game ID otomatis terdeteksi dari teks yang di-paste  
✅ **Pemain offline** - Otomatis dikeluarkan saat game dimulai jika pemain online cukup  
✅ UI responsif dan menarik  
✅ Sistem scoring otomatis  
✅ Notifikasi interaktif  
✅ Peringkat akhir game  
✅ Copy Game ID dengan satu klik  
✅ **Reconnect otomatis** - Jika terputus koneksi, bisa kembali ke game  
✅ **Pilih kartu buangan** - Bisa ambil kartu dari deck atau kartu yang dibuang pemain sebelumnya  
✅ **Pertimbangkan kartu** - Lihat kartu yang diambil sebelum memutuskan menyimpan atau membuang  
✅ **Tombol Tutup Kartu** - Tutup kartu untuk mengakhiri game  
✅ **Score tersembunyi** - Score pemain lain tidak terlihat sampai game selesai  
✅ **Docker support** - Siap deploy dengan Docker  
✅ **Database persistence** - Game state tersimpan di SQLite  

## Struktur Project

```
kartu41/
├── app.py                 # Backend Flask + logika game
├── database.py            # Database SQLite handler
├── requirements.txt       # Dependencies Python
├── README.md             # Dokumentasi
├── Dockerfile            # Docker configuration
├── .dockerignore         # Docker ignore file
├── .env                  # Environment variables
├── static/
│   ├── css/
│   │   └── style.css     # Styling aplikasi
│   ├── js/
│   │   └── game.js       # Logic frontend & Socket.IO
│   └── img/
│       └── favicon.ico   # Favicon
├── templates/
│   └── index.html        # HTML template
├── models/               # Chatbot models (jika ada)
└── kartu41.db           # SQLite database (auto-generated)
```

## Teknologi

- **Backend**: Python Flask
- **Real-time**: Flask-SocketIO (WebSocket)
- **WebSocket Runtime**: Python threading + simple-websocket
- **Database**: SQLite
- **Frontend**: HTML5, CSS3, JavaScript
- **Containerization**: Docker
- **Threading**: Python threading untuk timer
- **UI**: Responsive design dengan gradient modern

## Contoh Perhitungan Score

### Contoh 1 (Semua sama kembang):
Kartu: A♦ K♦ Q♦ 10♦  
Score: 11 + 10 + 10 + 10 = **41** ✅

### Contoh 2 (Beda kembang):
Kartu: A♦ K♦ Q♣ 2♦  
Kembang terbanyak: ♦ (Wajik)  
Score: 11 + 10 - 10 + 2 = **13** (Q♣ dikurangi karena beda kembang)

### Contoh 3 (Beda kembang):
Kartu: 10♠ 9♠ 8♠ 5♥  
Kembang terbanyak: ♠ (Sekop)  
Score: 10 + 9 + 8 - 5 = **22** (5♥ dikurangi karena beda kembang)

## Tips Bermain

1. 🎯 Fokus pada satu kembang sejak awal
2. 🃏 Buang kartu dengan kembang berbeda
3. 📊 Perhatikan score Anda di bagian bawah kartu
4. 👀 Pantau jumlah kartu lawan
5. ⚡ Ambil keputusan cepat saat giliran Anda
6. ⏰ Perhatikan timer - jangan sampai kehabisan waktu!
7. 🎲 Manfaatkan kartu buangan dari pemain lain
8. 🚪 Tutup kartu di saat yang tepat untuk mengakhiri game

## Troubleshooting

### Port sudah digunakan:
Ubah port di `app.py`:
```python
socketio.run(app, debug=True, host='0.0.0.0', port=4001)
```

### Module tidak ditemukan:
```bash
pip install -r requirements.txt
```

### Warning eventlet deprecated:
Project ini sudah dikonfigurasi untuk tidak memakai `eventlet`.
Pastikan dependency terpasang ulang:
```bash
pip install -r requirements.txt
```

## Developer

Dibuat dengan ❤️ menggunakan Flask dan Socket.IO

Selamat bermain! 🎴🎉
