// Socket.IO connection
const socketPath = window.SOCKET_IO_PATH || '/socket.io';
const socket = io({ path: socketPath });

// Sound notification
const notificationSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBi6Czfbigy8GHm7A7+OZSA4PVqvn8K1aGAg+leHyxnMpBSd8zPLaizsIGGS57OihUBELTKXh8Ldj'); // Soft notification beep

// Doorbell sound untuk player joined - menggunakan notifikasi yang lebih jelas
const doorbellSound = new Audio('data:audio/wav;base64,UklGRpQHAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YXAHAAAAAAAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA/v4AAP39AAD9/QAA/f0AAP39AAD9/QAA/f0AAP39AAD9/QAA/f0AAP39AAD9/QAA/f0AAP7+AAD+/gAA/v4AAP//AACAA4AFgAmADYARgBWAGYAdgCGAJYApgC2AMYAzgDWAN4A5gDuAPYA+gD+AQIBAgEGAQYBBgEGAQYBBgECAP4A+gD2APYBCgEuAVYBfgGmAcoBvgF2ATIBDgEiAVIBjgHSAhYCVgKSAs4C9gL2AtoCpgJmAiYB6gGuAYIBcgGSAcYCCgJWApoC2gMOAy4CwgJGAbYBNgCuAF4AIgACAAYAMgByALoA/gE+AW4BhgGGAWoBI');

// Chat notification sound - suara khusus untuk pesan chat
const chatNotificationSound = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');

// Game state
let gameState = {
    gameId: null,
    playerId: null,
    playerName: null,
    myHand: [],
    selectedCardIndex: null,
    hasDrawn: false,
    tempCard: null,
    isChatOpen: false,
    unreadChatCount: 0
};

// Timer state
let turnTimer = {
    interval: null,
    secondsLeft: 20,
    isRunning: false
};

// Play notification sound
function playNotificationSound() {
    notificationSound.volume = 0.6; // Volume 30% agar tidak terlalu kencang
    notificationSound.play().catch(e => console.log('Sound play failed:', e));
}

// Play doorbell sound untuk player joined
function playDoorbellSound() {
    doorbellSound.volume = 0.7;
    doorbellSound.play().catch(e => console.log('Doorbell sound play failed:', e));
}

// Play chat notification sound
function playChatNotificationSound() {
    // Menggunakan notifikasi dengan pitch lebih tinggi untuk chat
    const chatSound = new Audio('data:audio/wav;base64,UklGRiYCAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQICAACgoKCgoKCgoJ+fn5+fn5+enp6enp6enZ2dnZ2dnJycnJycm5ubm5ubmpqampqZmZmZmZiYmJiYl5eXl5eWlpaWlpWVlZWVlJSUlJSTk5OTk5KSkpKSkZGRkZGQkJCQkI+Pj4+Pjo6Ojo6NjY2NjYyMjIyMi4uLi4uKioqKioqJiYmJiYiIiIiIh4eHh4eGhoaGhoWFhYWFhISEhISEg4ODg4OCgoKCgoGBgYGBgYCAgIB/f39/f35+fn5+fX19fX18fHx8fHt7e3t7enp6enp5eXl5eXh4eHh4d3d3d3d2dnZ2dnV1dXV1dHR0dHRzc3Nzc3JycnJycXFxcXFwcHBwcG9vb29vbm5ubm5tbW1tbWxsbGxsa2trawA=');
    chatSound.volume = 0.5;
    chatSound.play().catch(e => console.log('Chat sound play failed:', e));
}

// Play card draw sound
function playCardDrawSound() {
    const drawSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACAg4aJjI+Sk5OUlJSUk5KRkI6LiIWCf3x5dXJvbGljX1xZVlNQTUpIRkRDQT9AQEBBQkNDQ0NDQ0JBQEBAPz49PTo4NzY0MjEvLSspKCYkIyEgHx4dHRwcHBweHyAhIyUmKCssLzEzNTg7PUJGS01QU1ZaXmFlaWxwdHh8gISIi5CUl5qcnp+goKCgnpybmZeVk4+Mh4OAfnx6d3VycG5samnp6Ojm5ePi4N/d29nX1dPS0M7LycfFw8C+vLm3tbKwr66sq6inp6WkoqGfnZybmpmYl5aVlJOSkZCPjo6NjIyLi4qKiYmJiImIiIeHh4eGhoaGhoWFhYWFhYSEhISEhISEhISEhISEhISEhIWFhYWGhoaHh4eIiImJiouMjI6Pj5GSlJWXmZqcnqChoqSmp6mqq62vsbO1t7m7vcDBxMbJy87Q09XX2tvd4OLk5ujq7O7w8vT2+Pr8/v8A');
    drawSound.volume = 0.4;
    drawSound.play().catch(e => console.log('Draw sound play failed:', e));
}

// Play card discard sound
function playCardDiscardSound() {
    const discardSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAAB/fHl2c3BtamdiX1xZVlNQTkxKSEZFRENCQkFBQUFBQkJDREVGR0lKTE5QUlRXWVxfYmVoa2+Sk5SVlZWVlZSUk5KRkI6Ni4iGhIKAfnt5d3VzcXBua2lnZmRjYmFgX19fX19fYGBhYmNkZWdpamxtb3FzdXd5e32AgIOFh4mLjY+RkpOUlJSUk5KRj46Mi4mHhYOBf314dnRycG5sampmZGNiYWBgX19fYGBhYmNkZmdpamxtb3FzdXd5fH6BhIaJi46Qk5WYmpyfpKiqrK+xs7W3ubq8vb6/wMHBwsLCwsLCwsHBwMC/vr28u7q5t7a1s7Gvraupqaan5eXj4+Lh4N/e3dzb2tnY19bV1NPR0M/OzczLycjGxcO+vbq4trOxr62rqaelp6inp6eopqinqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nnb3N3e3+Dh4uPk5ebn6Onq6+zt7u/w8fLz9PX29/j5+vv8/f7/AA==');
    discardSound.volume = 0.4;
    discardSound.play().catch(e => console.log('Discard sound play failed:', e));
}

// Timer functions
function startTurnTimer() {
    stopTurnTimer(); // Stop any existing timer
    
    turnTimer.secondsLeft = 20;
    turnTimer.isRunning = true;
    
    const timerContainer = document.getElementById('timerContainer');
    const timerEl = document.getElementById('turnTimer');
    
    if (timerContainer) {
        timerContainer.style.display = 'flex';
    }
    
    updateTimerDisplay();
    
    turnTimer.interval = setInterval(() => {
        turnTimer.secondsLeft--;
        updateTimerDisplay();
        
        // Peringatan saat 5 detik terakhir
        if (turnTimer.secondsLeft <= 5 && turnTimer.secondsLeft > 0) {
            playNotificationSound();
        }
        
        // Waktu habis - auto discard kartu tertinggi
        if (turnTimer.secondsLeft <= 0) {
            stopTurnTimer();
            autoDiscardHighestCard();
        }
    }, 1000);
}

function stopTurnTimer() {
    if (turnTimer.interval) {
        clearInterval(turnTimer.interval);
        turnTimer.interval = null;
    }
    turnTimer.isRunning = false;
    
    const timerContainer = document.getElementById('timerContainer');
    if (timerContainer) {
        timerContainer.style.display = 'none';
    }
}

function updateTimerDisplay() {
    const timerEl = document.getElementById('turnTimer');
    if (!timerEl) return;
    
    timerEl.textContent = turnTimer.secondsLeft;
    
    // Ubah warna berdasarkan waktu tersisa
    if (turnTimer.secondsLeft > 10) {
        timerEl.style.color = '#28a745'; // Hijau
    } else if (turnTimer.secondsLeft > 5) {
        timerEl.style.color = '#ffc107'; // Kuning
    } else {
        timerEl.style.color = '#dc3545'; // Merah
        timerEl.style.animation = 'pulse 0.5s infinite';
    }
}

function autoDiscardHighestCard() {
    // Jika belum ambil kartu (4 kartu di tangan), auto ambil dari deck
    if (!gameState.hasDrawn && gameState.myHand.length === 4) {
        showNotification('⏰ Waktu habis! Otomatis mengambil kartu dari deck', 'warning');
        playCardDrawSound();
        socket.emit('draw_card', { from_discard: false });
        
        // Set timeout untuk auto discard setelah ambil kartu
        setTimeout(() => {
            if (gameState.hasDrawn && gameState.tempCard) {
                autoDiscardAfterDraw();
            }
        }, 1000);
        return;
    }
    
    // Jika sudah ambil kartu (5 kartu), auto buang kartu tertinggi
    if (gameState.hasDrawn && gameState.tempCard) {
        autoDiscardAfterDraw();
    }
}

function autoDiscardAfterDraw() {
    // Cari kartu dengan nilai tertinggi (termasuk temp card)
    let highestIndex = -1; // -1 = temp card
    let highestValue = gameState.tempCard.value;
    
    gameState.myHand.forEach((card, index) => {
        if (card.value > highestValue) {
            highestValue = card.value;
            highestIndex = index;
        }
    });
    
    // Auto discard kartu tertinggi
    showNotification('⏰ Kartu tertinggi otomatis dibuang', 'warning');
    playCardDiscardSound();
    
    socket.emit('discard_card', { card_index: highestIndex });
    gameState.hasDrawn = false;
    gameState.selectedCardIndex = null;
    gameState.tempCard = null;
}

// Custom Modal Dialog
let modalResolve = null;

function showCustomModal(title, message, icon = '❓', customHTML = null) {
    return new Promise((resolve) => {
        modalResolve = resolve;
        
        const modal = document.getElementById('customModal');
        const modalTitle = modal.querySelector('.modal-title');
        const modalMessage = modal.querySelector('.modal-message');
        const modalIcon = modal.querySelector('.modal-icon');
        
        modalTitle.textContent = title;
        
        // Jika ada custom HTML, gunakan innerHTML, jika tidak gunakan textContent
        if (customHTML) {
            modalMessage.innerHTML = customHTML;
        } else {
            modalMessage.textContent = message;
        }
        
        modalIcon.textContent = icon;
        
        modal.classList.add('show');
    });
}

function closeModal(result) {
    const modal = document.getElementById('customModal');
    modal.classList.remove('show');
    
    if (modalResolve) {
        modalResolve(result);
        modalResolve = null;
    }
}

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('customModal');
        if (modal.classList.contains('show')) {
            closeModal(false);
        }
    }
});

// Initialize socket connection
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('connected', (data) => {
    gameState.playerId = data.sid;
    console.log('Player ID:', gameState.playerId);
});

// Screen management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function showWelcome() {
    showScreen('welcomeScreen');
}

function showJoinGame() {
    // Copy nama dari welcome screen jika sudah diisi
    const playerName = document.getElementById('playerName').value.trim();
    if (playerName) {
        document.getElementById('joinPlayerName').value = playerName;
    }
    showScreen('joinScreen');
    
    // Setup paste event listener untuk joinGameId jika belum ada
    const joinGameIdInput = document.getElementById('joinGameId');
    if (joinGameIdInput && !joinGameIdInput.dataset.pasteListenerAdded) {
        joinGameIdInput.addEventListener('paste', function(e) {
            e.preventDefault();
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            // Ambil kata terakhir dari teks yang di-paste
            const words = pastedText.trim().split(/\s+/);
            const lastWord = words[words.length - 1];
            // Set value dengan kata terakhir
            this.value = lastWord;
        });
        joinGameIdInput.dataset.pasteListenerAdded = 'true';
    }
}

// Notifications
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Create game
function createGame() {
    const playerName = document.getElementById('playerName').value.trim();
    
    if (!playerName) {
        showNotification('Silakan masukkan nama Anda!', 'error');
        return;
    }
    
    gameState.playerName = playerName;
    socket.emit('create_game', { name: playerName });
}

socket.on('game_created', (data) => {
    gameState.gameId = data.game_id;
    // Simpan untuk reconnect
    localStorage.setItem('kartu41_game_id', data.game_id);
    localStorage.setItem('kartu41_player_name', gameState.playerName);
    
    document.getElementById('lobbyGameId').textContent = data.game_id;
    updateLobby(data.game_state);
    showScreen('lobbyScreen');
    showNotification('Game berhasil dibuat!', 'success');
});

// Join game
function joinGame() {
    const playerName = document.getElementById('joinPlayerName').value.trim();
    const gameId = document.getElementById('joinGameId').value.trim().toUpperCase();
    
    if (!playerName) {
        showNotification('Silakan masukkan nama Anda!', 'error');
        return;
    }
    
    if (!gameId) {
        showNotification('Silakan masukkan Game ID!', 'error');
        return;
    }
    
    gameState.playerName = playerName;
    gameState.gameId = gameId;
    socket.emit('join_game', { game_id: gameId, name: playerName });
}

socket.on('player_joined', (data) => {
    // Simpan untuk reconnect
    localStorage.setItem('kartu41_game_id', gameState.gameId);
    localStorage.setItem('kartu41_player_name', gameState.playerName);
    
    updateLobby(data.game_state);
    showScreen('lobbyScreen');
    document.getElementById('lobbyGameId').textContent = gameState.gameId;
    showNotification(`${data.player_name} bergabung ke game!`, 'success');
    
    // Play doorbell sound saat pemain baru bergabung (seperti bell pintu rumah)
    playDoorbellSound();
});

// Update lobby
function updateLobby(state) {
    const playersList = document.getElementById('playersList');
    const playerCount = document.getElementById('playerCount');
    
    playersList.innerHTML = '';
    playerCount.textContent = state.players.length;
    
    state.players.forEach((player, index) => {
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';
        
        // Tentukan status online/offline dengan warna
        const statusColor = player.is_online ? '#28a745' : '#dc3545';
        const statusText = player.is_online ? 'Online' : 'Offline';
        
        playerItem.innerHTML = `
            <span class="player-icon">👤</span>
            <span>${player.name}</span>
            <span class="player-status" style="color: ${statusColor}; font-size: 0.85em; margin-left: 10px;">● ${statusText}</span>
        `;
        playersList.appendChild(playerItem);
    });
    
    // Enable start button hanya jika: minimal 2 players dan user adalah creator
    const startButton = document.getElementById('startButton');
    const isCreator = state.creator_name === gameState.playerName;
    const hasEnoughPlayers = state.players.length >= 2;
    
    // Tampilkan game settings hanya untuk creator
    const gameSettings = document.getElementById('gameSettings');
    if (gameSettings) {
        gameSettings.style.display = isCreator ? 'block' : 'none';
    }
    
    // Update timer toggle berdasarkan state
    const timerToggle = document.getElementById('timerToggle');
    if (timerToggle && state.use_timer !== undefined) {
        timerToggle.checked = state.use_timer;
    }
    
    // Debug logging
    console.log('UpdateLobby Debug:', {
        creator_name: state.creator_name,
        playerName: gameState.playerName,
        isCreator: isCreator,
        hasEnoughPlayers: hasEnoughPlayers,
        use_timer: state.use_timer
    });
    
    startButton.disabled = !isCreator || !hasEnoughPlayers;
    
    // Update button text untuk feedback
    if (!isCreator) {
        startButton.title = 'Hanya pembuat game yang bisa memulai';
    } else if (!hasEnoughPlayers) {
        startButton.title = 'Minimal 2 pemain untuk memulai';
    } else {
        startButton.title = 'Mulai game sekarang';
    }
}

// Copy game ID
function copyGameId() {
    const gameId = document.getElementById('lobbyGameId').textContent;
    navigator.clipboard.writeText("Gas kuyyy 👉 kartu41.bepe.web.id " + gameId).then(() => {
        showNotification('Game ID berhasil disalin!', 'success');
    });
}

// Toggle timer mode (hanya creator)
function toggleTimerMode() {
    const timerToggle = document.getElementById('timerToggle');
    const useTimer = timerToggle.checked;
    
    socket.emit('toggle_timer', { use_timer: useTimer });
}

// Handle timer toggled response
socket.on('timer_toggled', (data) => {
    const timerToggle = document.getElementById('timerToggle');
    if (timerToggle) {
        timerToggle.checked = data.use_timer;
    }
    
    const message = data.use_timer ? 'Mode timer diaktifkan' : 'Mode timer dinonaktifkan';
    showNotification(message, 'info');
});

// Start game
async function startGame() {
    const confirmed = await showCustomModal(
        'Mulai Game Sekarang?',
        'Apakah akan memulai sekarang atau menunggu pemain lain gabung?\n\nKlik OK untuk mulai sekarang',
        '🎮'
    );
    
    if (confirmed) {
        socket.emit('start_game');
    }
}

socket.on('reconnected', (data) => {
    showNotification('Berhasil reconnect ke game!', 'success');
    
    // Simpan player_id dari reconnect
    gameState.playerId = data.player_id;
    
    console.log('Reconnected Event:', {
        player_id: data.player_id,
        creator_name: data.game_state.creator_name,
        playerName: gameState.playerName,
        isCreator: data.game_state.creator_name === gameState.playerName
    });
    
    if (data.game_state.game_started && !data.game_state.game_ended) {
        showScreen('gameScreen');
        document.getElementById('gameIdDisplay').textContent = gameState.gameId;
        updateGameState(data.game_state);
    } else if (data.game_state.game_ended) {
        showScreen('gameOverScreen');
        displayGameOver(data.game_state);
    } else {
        showScreen('lobbyScreen');
        document.getElementById('lobbyGameId').textContent = gameState.gameId;
        updateLobby(data.game_state);
    }
});

socket.on('player_reconnected', (data) => {
    showNotification(`${data.player_name} kembali ke game!`, 'info');
    
    // Update lobby jika di lobby screen
    if (document.getElementById('lobbyScreen').style.display !== 'none') {
        updateLobby(data.game_state);
    }
    
    // Update daftar pemain jika sedang bermain
    if (document.getElementById('gameScreen').style.display !== 'none' && data.game_state) {
        updateOtherPlayers(data.game_state);
    }
    
    if (data.game_state) {
        Object.assign(gameState, data.game_state);
    }
});

socket.on('player_disconnected', (data) => {
    showNotification(`${data.player_name} terputus koneksi`, 'error');
    
    // Update lobby jika di lobby screen
    if (document.getElementById('lobbyScreen').style.display !== 'none') {
        updateLobby(data.game_state);
    }
    
    // Update daftar pemain jika sedang bermain
    if (document.getElementById('gameScreen').style.display !== 'none' && data.game_state) {
        updateOtherPlayers(data.game_state);
    }
    
    if (data.game_state) {
        Object.assign(gameState, data.game_state);
    }
});

socket.on('game_started', (data) => {
    showScreen('gameScreen');
    document.getElementById('gameIdDisplay').textContent = gameState.gameId;
    showNotification(data.message, 'success');
    updateGameState(data.game_state);
});

// Update game state
function updateGameState(state) {
    // Update round number
    if (state.round_number) {
        document.getElementById('roundNumber').textContent = state.round_number;
    }
    
    // Update deck count
    document.getElementById('deckCount').textContent = state.deck_remaining;
    
    // Update current turn
    const currentTurnEl = document.getElementById('currentTurn');
    currentTurnEl.textContent = state.current_player_name || '-';
    currentTurnEl.dataset.playerId = state.current_player_id; // Simpan ID untuk validasi
    
    // Highlight if it's your turn
    const isMyTurn = state.current_player_id === gameState.playerId;
    if (isMyTurn) {
        currentTurnEl.style.color = '#28a745';
        currentTurnEl.style.fontWeight = 'bold';
        // Mulai timer saat giliran pemain (hanya jika use_timer aktif)
        if (state.use_timer) {
            startTurnTimer();
        }
    } else {
        currentTurnEl.style.color = '#667eea';
        currentTurnEl.style.fontWeight = 'normal';
        // Stop timer jika bukan giliran kita
        stopTurnTimer();
    }
    
    // Update button Tutup Kartu - hanya enable jika giliran pemain ini
    const closeHandBtn = document.querySelector('.btn-surrender');
    if (closeHandBtn) {
        closeHandBtn.disabled = !isMyTurn;
        closeHandBtn.style.opacity = isMyTurn ? '1' : '0.5';
        closeHandBtn.style.cursor = isMyTurn ? 'pointer' : 'not-allowed';
    }
    
    // Update discard pile
    updateDiscardPile(state);
    
    // Update other players
    updateOtherPlayers(state);
    
    // Update your info
    const myPlayer = state.players.find(p => p.player_id === gameState.playerId);
    if (myPlayer) {
        const yourNameEl = document.getElementById('yourName');
        const yourScoreEl = document.getElementById('yourScore');
        const yourSuitEl = document.getElementById('yourSuit');
        
        if (yourNameEl) yourNameEl.textContent = myPlayer.name;
        if (yourScoreEl) yourScoreEl.textContent = myPlayer.score !== null ? myPlayer.score : '???';
        if (yourSuitEl) yourSuitEl.textContent = myPlayer.best_suit || '';
    }
}

// Update discard pile display
function updateDiscardPile(state) {
    const discardPileArea = document.getElementById('discardPileArea');
    const discardPileCard = document.getElementById('discardPileCard');
    
    if (state.last_discarded_card) {
        // Tampilkan kartu buangan jika ada (semua pemain bisa lihat)
        discardPileArea.style.display = 'block';
        
        const card = state.last_discarded_card;
        const isRed = card.suit === '♥' || card.suit === '♦';
        const isMyTurn = state.current_player_id === gameState.playerId && !gameState.hasDrawn;
        
        // Jika giliran pemain dan belum ambil kartu, bisa diklik
        const clickable = isMyTurn ? 'cursor: pointer;' : 'cursor: default; opacity: 0.7;';
        const clickHandler = isMyTurn ? 'onclick="drawCard(true)"' : '';
        
        discardPileCard.innerHTML = `
            <div class="card ${isRed ? 'red' : 'black'}" style="${clickable} margin: 0;" ${clickHandler}>
                <div class="card-rank">${card.rank}</div>
                <div class="card-suit">${card.suit}</div>
            </div>
            <div style="text-align: center; margin-top: 5px; font-size: 0.8em; color: #ffffffff;">
                dari ${state.last_discarder_name}
            </div>
        `;
        
        // Update label berdasarkan giliran
        const label = document.querySelector('.discard-pile-label');
        if (label) {
            if (isMyTurn) {
                label.textContent = 'Ambil dari Buangan';
                label.style.background = '#28a745';
            } else {
                label.textContent = 'Kartu Buangan';
                label.style.background = '#6c757d';
            }
        }
    } else {
        discardPileArea.style.display = 'none';
    }
}

// Update other players display
function updateOtherPlayers(state) {
    const otherPlayersEl = document.getElementById('otherPlayers');
    otherPlayersEl.innerHTML = '<h3 style="margin-bottom: 10px; color: white;">Daftar Pemain</h3>';
    
    state.players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-list-item';
        
        // Highlight current player dengan border
        if (player.player_id === state.current_player_id) {
            playerDiv.style.borderLeft = '4px solid #28a745';
            playerDiv.style.paddingLeft = '8px';
        }
        
        // Status online/offline dengan warna
        const statusColor = player.is_online ? '#28a745' : '#dc3545';
        const statusText = player.is_online ? 'Online' : 'Offline';
        
        // Jangan tampilkan score selama pertandingan untuk lebih challenging
        // Score hanya muncul di layar game over
        
        // Tandai pemain sendiri
        const isMe = player.player_id === gameState.playerId ? ' (Anda)' : '';
        
        playerDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="font-weight: ${player.player_id === state.current_player_id ? 'bold' : 'normal'};">
                        ${player.name}${isMe}
                    </span>
                </div>
                <span style="color: ${statusColor}; font-size: 0.85em;">● ${statusText}</span>
            </div>
        `;
        
        otherPlayersEl.appendChild(playerDiv);
    });
    
    // Update ranking kumulatif di sidebar kanan
    updateCumulativeRanking(state);
}

function updateCumulativeRanking(state) {
    const rankingEl = document.getElementById('cumulativeRanking');
    
    if (!rankingEl) return;
    
    // Cek apakah ada overall rankings
    if (state.overall_rankings && state.overall_rankings.length > 0) {
        rankingEl.innerHTML = '<h3 style="margin-bottom: 15px; color: #333; font-size: 1.3em;">🏆 Ranking Kumulatif</h3>';
        
        state.overall_rankings.forEach((ranking, index) => {
            const rankDiv = document.createElement('div');
            rankDiv.className = 'ranking-item-sidebar';
            
            // Warna berdasarkan peringkat
            let bgColor = '#ffffff';
            let borderColor = '#ddd';
            if (index === 0) {
                bgColor = '#fff9e6';
                borderColor = '#ffd700';
            } else if (index === 1) {
                bgColor = '#f5f5f5';
                borderColor = '#c0c0c0';
            } else if (index === 2) {
                bgColor = '#fff5e6';
                borderColor = '#cd7f32';
            }
            
            const trophy = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${ranking.rank}.`;
            
            rankDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: ${bgColor}; border-left: 4px solid ${borderColor}; border-radius: 8px; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.5em;">${trophy}</span>
                        <div>
                            <div style="font-weight: bold; color: #333; font-size: 1em;">${ranking.player_name}</div>
                            <div style="font-size: 0.85em; color: #666;">Menang: ${ranking.games_won}x</div>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 1.3em; font-weight: bold; color: #667eea;">${ranking.cumulative_score}</div>
                        <div style="font-size: 0.75em; color: #999;">poin</div>
                    </div>
                </div>
            `;
            
            rankingEl.appendChild(rankDiv);
        });
    } else {
        // Jika belum ada ranking, tampilkan pesan
        rankingEl.innerHTML = `
            <div style="background: rgba(255, 255, 255, 0.95); border-radius: 12px; padding: 20px; text-align: center;">
                <div style="font-size: 3em; margin-bottom: 10px;">🏆</div>
                <h3 style="color: #333; margin-bottom: 10px;">Ranking Kumulatif</h3>
                <p style="color: #666; font-size: 0.9em;">Belum ada data ranking.<br>Selesaikan game pertama untuk melihat ranking!</p>
            </div>
        `;
    }
}

// Your hand update
socket.on('your_hand', (data) => {
    gameState.myHand = data.hand;
    
    // Restore temp_card jika ada (untuk kasus reconnect)
    if (data.temp_card) {
        gameState.tempCard = data.temp_card;
        gameState.hasDrawn = true; // Set hasDrawn karena sudah ambil kartu
    }
    
    renderHand(gameState.tempCard);
});

function renderHand(tempCard = null) {
    const handEl = document.getElementById('yourHand');
    handEl.innerHTML = '';
    
    // Hitung total kartu (hand + temp card)
    const totalCards = gameState.myHand.length + (tempCard ? 1 : 0);
    const canCloseHand = totalCards === 5;
    
    // Jika ada kartu temporary (baru diambil), tampilkan dengan highlight
    if (tempCard) {
        const cardDiv = document.createElement('div');
        const isRed = tempCard.suit === '♥' || tempCard.suit === '♦';
        cardDiv.className = `card ${isRed ? 'red' : 'black'} temp-card`;
        cardDiv.style.border = '4px solid #ffd700';
        cardDiv.style.animation = 'bounce 0.5s';
        cardDiv.onclick = () => selectCard(-1);
        
        // Kartu temp dianggap selected jika selectedCardIndex === -1 atau null
        const isTempSelected = gameState.selectedCardIndex === -1 || gameState.selectedCardIndex === null;
        if (isTempSelected) {
            cardDiv.classList.add('selected');
        }
        
        cardDiv.innerHTML = `
            <div class="card-rank">${tempCard.rank}</div>
            <div class="card-suit">${tempCard.suit}</div>
        `;
        
        handEl.appendChild(cardDiv);
    }
    
    gameState.myHand.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        const isRed = card.suit === '♥' || card.suit === '♦';
        cardDiv.className = `card ${isRed ? 'red' : 'black'}`;
        cardDiv.onclick = () => selectCard(index);
        
        const isSelected = gameState.selectedCardIndex === index;
        if (isSelected) {
            cardDiv.classList.add('selected');
        }
        
        cardDiv.innerHTML = `
            <div class="card-rank">${card.rank}</div>
            <div class="card-suit">${card.suit}</div>
        `;
        
        handEl.appendChild(cardDiv);
    });
    
    // Update tombol global
    updateActionButtons(canCloseHand, gameState.selectedCardIndex !== null || tempCard !== null, tempCard !== null);
}

function updateActionButtons(canClose, hasSelection, hasTempCard) {
    const discardBtn = document.getElementById('discardButton');
    const closeBtn = document.getElementById('closeHandButton');
    
    // Tombol buang: aktif jika ada kartu dipilih DAN ada tempCard
    if (discardBtn) {
        discardBtn.disabled = !hasSelection || !hasTempCard;
        if (hasSelection && hasTempCard) {
            discardBtn.style.opacity = '1';
            discardBtn.style.cursor = 'pointer';
        } else {
            discardBtn.style.opacity = '0.5';
            discardBtn.style.cursor = 'not-allowed';
        }
    }
    
    // Tombol tutup: aktif jika 5 kartu DAN ada kartu dipilih
    if (closeBtn) {
        closeBtn.disabled = !canClose || !hasSelection;
        if (canClose && hasSelection) {
            closeBtn.style.opacity = '1';
            closeBtn.style.cursor = 'pointer';
        } else {
            closeBtn.style.opacity = '0.5';
            closeBtn.style.cursor = 'not-allowed';
        }
    }
}

function discardSelectedCard() {
    const selectedIndex = gameState.selectedCardIndex;
    // -1 adalah valid (kartu temp), null/undefined tidak valid
    if (selectedIndex !== null && selectedIndex !== undefined && selectedIndex !== false) {
        discardCard(selectedIndex);
    }
}

function closeSelectedHand() {
    const selectedIndex = gameState.selectedCardIndex;
    // -1 adalah valid (kartu temp), null/undefined tidak valid
    if (selectedIndex !== null && selectedIndex !== undefined && selectedIndex !== false) {
        closeHandWithCard(selectedIndex);
    }
}

function selectCard(index) {
    if (!gameState.hasDrawn && index !== -1) {
        showNotification('Ambil kartu dulu!', 'error');
        return;
    }
    
    if (gameState.selectedCardIndex === index) {
        // Deselect - kembali ke state awal (kartu temp auto selected)
        gameState.selectedCardIndex = gameState.tempCard ? -1 : null;
    } else {
        gameState.selectedCardIndex = index;
    }
    renderHand(gameState.tempCard);
}

// Draw card
function drawCard(fromDiscard = false) {
    if (gameState.hasDrawn) {
        showNotification('Anda sudah mengambil kartu!', 'error');
        return;
    }
    
    socket.emit('draw_card', { from_discard: fromDiscard });
}

socket.on('card_drawn', (data) => {
    gameState.hasDrawn = true;
    gameState.tempCard = data.card;
    gameState.selectedCardIndex = -1; // Kartu baru otomatis terpilih
    renderHand(data.card);
    playCardDrawSound(); // Play sound saat ambil kartu
    showNotification(`Anda mendapat ${data.card.rank}${data.card.suit}! Pilih kartu mana yang akan dibuang`, 'info');
});

// Discard card
async function discardCard(index) {
    if (!gameState.hasDrawn) {
        showNotification('Ambil kartu dulu!', 'error');
        return;
    }
    
    const isDiscardingNewCard = index === -1;
    let cardToDiscard;
    
    if (isDiscardingNewCard) {
        cardToDiscard = gameState.tempCard;
    } else {
        cardToDiscard = gameState.myHand[index];
    }
    
    const isRed = cardToDiscard.suit === '♥' || cardToDiscard.suit === '♦';
    const cardColor = isRed ? '#e74c3c' : '#2c3e50';
    
    const title = isDiscardingNewCard ? 'Buang Kartu Baru?' : 'Buang Kartu Ini?';
    
    // Buat HTML untuk menampilkan kartu
    const cardHTML = `
        <p style="margin-bottom: 10px;">Anda akan membuang kartu:</p>
        <div style="display: inline-block; background: white; border: 2px solid ${cardColor}; border-radius: 8px; padding: 12px 20px; box-shadow: 0 3px 10px rgba(0,0,0,0.15); margin: 10px 0;">
            <div style="font-size: 1.8em; color: ${cardColor}; font-weight: bold; text-align: center; line-height: 1;">
                ${cardToDiscard.rank}${cardToDiscard.suit}
            </div>
            <div style="font-size: 0.85em; color: #666; margin-top: 5px; text-align: center;">
                ${cardToDiscard.suit_name} • Nilai ${cardToDiscard.value}
            </div>
        </div>
        <p style="margin-top: 10px; color: #666;">Yakin ingin membuang kartu ini?</p>
    `;
    
    const confirmed = await showCustomModal(title, '', '🗑️', cardHTML);
    
    if (confirmed) {
        stopTurnTimer(); // Stop timer saat buang kartu
        playCardDiscardSound(); // Play sound saat buang kartu
        socket.emit('discard_card', { card_index: index });
        gameState.hasDrawn = false;
        gameState.selectedCardIndex = null;
        gameState.tempCard = null;
    }
}

// Game update
socket.on('game_update', (data) => {
    updateGameState(data);
    
    // Play sound jika ada kartu dibuang (discard pile berubah)
    if (data.last_discarded_card) {
        playNotificationSound();
    }
    
    // Update your hand if needed
    const myPlayer = data.players.find(p => p.player_id === gameState.playerId);
    if (myPlayer && myPlayer.hand.length > 0) {
        gameState.myHand = myPlayer.hand;
        // Cek apakah masih ada temp card
        if (myPlayer.temp_card && gameState.hasDrawn) {
            gameState.tempCard = myPlayer.temp_card;
            renderHand(myPlayer.temp_card);
        } else {
            gameState.tempCard = null;
            renderHand();
        }
    }
});

// Chat history loaded (when joining game)
socket.on('chat_history', (data) => {
    const messages = data.messages || [];
    messages.forEach(msg => {
        displayChatMessage({
            sender_id: msg.sender_id,
            sender_name: msg.sender_name,
            message: msg.message,
            timestamp: msg.timestamp
        }, false); // false = no sound for history
    });
});

// Chat message received
socket.on('chat_message', (data) => {
    displayChatMessage(data);
    playChatNotificationSound(); // Play sound khusus untuk chat baru
});

// Game ended
socket.on('game_ended', (data) => {
    showScreen('gameOverScreen');
    displayGameOver(data.game_state);
    showNotification(data.message, 'info');
});

socket.on('game_restarted', (data) => {
    showScreen('gameScreen');
    document.getElementById('gameIdDisplay').textContent = gameState.gameId;
    showNotification('Game dimulai lagi! Giliran: ' + data.game_state.current_player_name, 'success');
    updateGameState(data.game_state);
    
    // Reset hasDrawn untuk turn baru
    gameState.hasDrawn = false;
});

// Game finished permanently
socket.on('game_finished', (data) => {
    // Clear game state
    localStorage.removeItem('kartu41_game_id');
    localStorage.removeItem('kartu41_player_name');
    gameState.gameId = null;
    gameState.playerId = null;
    gameState.playerName = null;
    
    showNotification(data.message, 'warning');
    
    // Redirect to home after 2 seconds
    setTimeout(() => {
        showScreen('welcomeScreen');
    }, 2000);
});

// Redirect home for creator
socket.on('redirect_home', () => {
    localStorage.removeItem('kartu41_game_id');
    localStorage.removeItem('kartu41_player_name');
    gameState.gameId = null;
    gameState.playerId = null;
    gameState.playerName = null;
    
    setTimeout(() => {
        showScreen('welcomeScreen');
    }, 2000);
});

function displayGameOver(state) {
    const winnerEl = document.getElementById('winnerAnnouncement');
    const rankingsEl = document.getElementById('rankingsList');
    
    if (state.winner) {
        winnerEl.innerHTML = `
            <h2>🎉 Pemenang Game ke-${state.round_number} 🎉</h2>
            <div class="winner-name">${state.winner.name}</div>
            <p>Score: ${state.winner.score} ${state.winner.best_suit}</p>
        `;
    }
    
    // Display current game rankings
    rankingsEl.innerHTML = '';
    state.rankings.forEach((ranking, index) => {
        const rankDiv = document.createElement('div');
        let className = 'ranking-item';
        if (index === 0) className += ' first';
        else if (index === 1) className += ' second';
        else if (index === 2) className += ' third';
        
        rankDiv.className = className;
        
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
        const isSurrendered = ranking.player.surrendered;
        const sameSuitText = isSurrendered ? '🏳️ Menyerah' : 
            (ranking.same_suit ? '✅ Sama Jenis Kartu' : '❌ Beda Jenis Kartu');
        
        // Show cards
        const cardsHtml = ranking.player.hand.map(card => 
            `<span style="color: ${card.suit === '♥' || card.suit === '♦' ? '#e74c3c' : '#2c3e50'}">${card.rank}${card.suit}</span>`
        ).join(' ');
        
        rankDiv.innerHTML = `
            <div class="rank-number">${medal} ${ranking.rank}</div>
            <div class="rank-info">
                <div class="rank-name">${ranking.player.name}${isSurrendered ? ' 🏳️' : ''}</div>
                <div class="rank-details">
                    ${sameSuitText}<br>
                    Kartu: ${cardsHtml}
                </div>
            </div>
            <div class="rank-score">${ranking.score}</div>
        `;
        
        rankingsEl.appendChild(rankDiv);
    });
    
    // Display overall cumulative rankings
    const overallRankingsEl = document.getElementById('overallRankingsList');
    const overallSection = document.getElementById('overallRankingsSection');
    
    if (state.overall_rankings && state.overall_rankings.length > 0) {
        overallSection.style.display = 'block';
        overallRankingsEl.innerHTML = '';
        
        state.overall_rankings.forEach((ranking, index) => {
            const rankDiv = document.createElement('div');
            let className = 'ranking-item overall-ranking';
            if (index === 0) className += ' first';
            else if (index === 1) className += ' second';
            else if (index === 2) className += ' third';
            
            rankDiv.className = className;
            
            const trophy = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📊';
            
            rankDiv.innerHTML = `
                <div class="rank-number">${trophy} ${ranking.rank}</div>
                <div class="rank-info">
                    <div class="rank-name">${ranking.player_name}</div>
                    <div class="rank-details">
                        Total Score: ${ranking.cumulative_score}<br>
                        Menang: ${ranking.games_won}x
                    </div>
                </div>
                <div class="rank-score">${ranking.cumulative_score}</div>
            `;
            
            overallRankingsEl.appendChild(rankDiv);
        });
    } else {
        overallSection.style.display = 'none';
    }
    
    // Show finish button for all players
    const finishBtn = document.getElementById('finishGameBtn');
    if (finishBtn) {
        finishBtn.style.display = 'block';
    }
}

// Leave game
async function leaveGame() {
    const confirmed = await showCustomModal(
        'Keluar dari Game?',
        'Yakin ingin keluar dari game?\nProgress game tidak akan tersimpan.',
        '🚪'
    );
    
    if (confirmed) {
        localStorage.removeItem('kartu41_game_id');
        localStorage.removeItem('kartu41_player_name');
        location.reload();
    }
}

function backToHome() {
    localStorage.removeItem('kartu41_game_id');
    localStorage.removeItem('kartu41_player_name');
    location.reload();
}

async function restartGame() {
    const confirmed = await showCustomModal(
        'Main Lagi?',
        'Giliran akan dimulai dari pemenang.\nSiap untuk ronde berikutnya?',
        '🔄'
    );
    
    if (confirmed) {
        socket.emit('restart_game');
    }
}

async function finishGame() {
    const confirmed = await showCustomModal(
        'Akhiri Game?',
        'Game akan dihapus secara permanen dan ID game tidak bisa digunakan lagi.\nYakin ingin mengakhiri?',
        '🏁'
    );
    
    if (confirmed) {
        socket.emit('finish_game', {
            game_id: gameState.gameId
        });
    }
}

async function closeHandWithCard(cardIndex) {
    // Validasi apakah giliran pemain ini
    const currentTurnEl = document.getElementById('currentTurn');
    const currentPlayerId = currentTurnEl?.dataset?.playerId;
    
    if (!currentPlayerId || currentPlayerId !== gameState.playerId) {
        showNotification('Hanya pemain yang mendapat giliran yang bisa tutup kartu!', 'error');
        return;
    }
    
    // Tentukan kartu yang akan dibuang
    let cardToDiscard;
    if (cardIndex === -1) {
        cardToDiscard = gameState.tempCard;
    } else {
        cardToDiscard = gameState.myHand[cardIndex];
    }
    
    const isRed = cardToDiscard.suit === '♥' || cardToDiscard.suit === '♦';
    const cardColor = isRed ? '#e74c3c' : '#2c3e50';
    
    // Buat HTML untuk menampilkan kartu
    const cardHTML = `
        <p style="margin-bottom: 10px;">Anda akan tutup kartu dan membuang:</p>
        <div style="display: inline-block; background: white; border: 2px solid ${cardColor}; border-radius: 8px; padding: 12px 20px; box-shadow: 0 3px 10px rgba(0,0,0,0.15); margin: 10px 0;">
            <div style="font-size: 1.8em; color: ${cardColor}; font-weight: bold; text-align: center; line-height: 1;">
                ${cardToDiscard.rank}${cardToDiscard.suit}
            </div>
            <div style="font-size: 0.85em; color: #666; margin-top: 5px; text-align: center;">
                ${cardToDiscard.suit_name} • Nilai ${cardToDiscard.value}
            </div>
        </div>
        <p style="margin-top: 10px; color: #666;">Game akan berakhir dan score semua pemain akan ditampilkan.</p>
    `;
    
    const confirmed = await showCustomModal(
        'Tutup Kartu?',
        '',
        '🎯',
        cardHTML
    );
    
    if (confirmed) {
        // Buang kartu terlebih dahulu, lalu tutup
        socket.emit('discard_and_close', { card_index: cardIndex });
        
        // Reset state setelah emit
        gameState.hasDrawn = false;
        gameState.selectedCardIndex = null;
        gameState.tempCard = null;
    }
}

// Chat functions
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message) {
        socket.emit('send_chat', { message: message });
        input.value = '';
    }
}

// Handle Enter key in chat input
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
});

function displayChatMessage(data, playSound = true) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    
    // Format timestamp
    let timeString = '';
    if (data.timestamp) {
        const date = new Date(data.timestamp);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        timeString = `${day}/${month}/${year} ${hours}:${minutes}`;
    }
    
    // Tentukan jenis pesan
    if (data.sender_id === gameState.playerId) {
        messageDiv.className = 'chat-message user';
        messageDiv.innerHTML = `
            <div class="chat-text">${escapeHtml(data.message)}</div>
            ${timeString ? `<div class="chat-time">${timeString}</div>` : ''}
        `;
    } else {
        messageDiv.className = 'chat-message other';
        messageDiv.innerHTML = `
            <div class="chat-sender">${escapeHtml(data.sender_name)}</div>
            <div class="chat-text">${escapeHtml(data.message)}</div>
            ${timeString ? `<div class="chat-time">${timeString}</div>` : ''}
        `;
        
        // Jika chat ditutup (mobile mode), tampilkan toast dan update badge
        const chatBox = document.getElementById('chatBox');
        const isMobile = window.innerWidth <= 768;
        
        if (isMobile && !gameState.isChatOpen) {
            showChatToast(data.sender_name, data.message);
            gameState.unreadChatCount++;
            updateChatBadge();
        }
    }
    
    chatMessages.appendChild(messageDiv);
    
    // Auto scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Toggle chat visibility (untuk mobile)
function toggleChat() {
    const chatBox = document.getElementById('chatBox');
    const chatBadge = document.getElementById('chatBadge');
    
    gameState.isChatOpen = !gameState.isChatOpen;
    
    if (gameState.isChatOpen) {
        chatBox.classList.add('show');
        // Reset unread count
        gameState.unreadChatCount = 0;
        chatBadge.style.display = 'none';
    } else {
        chatBox.classList.remove('show');
    }
}

// Show toast notification untuk chat baru (saat chat ditutup di mobile)
function showChatToast(senderName, message) {
    const toast = document.getElementById('chatToast');
    const toastSender = toast.querySelector('.toast-sender');
    const toastMessage = toast.querySelector('.toast-message');
    
    toastSender.textContent = senderName;
    toastMessage.textContent = message.length > 50 ? message.substring(0, 50) + '...' : message;
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Update chat badge count
function updateChatBadge() {
    const chatBadge = document.getElementById('chatBadge');
    if (gameState.unreadChatCount > 0) {
        chatBadge.textContent = gameState.unreadChatCount > 9 ? '9+' : gameState.unreadChatCount;
        chatBadge.style.display = 'flex';
    } else {
        chatBadge.style.display = 'none';
    }
}

// Check for reconnect on page load
window.addEventListener('load', async () => {
    const savedGameId = localStorage.getItem('kartu41_game_id');
    const savedPlayerName = localStorage.getItem('kartu41_player_name');
    
    if (savedGameId && savedPlayerName) {
        const shouldReconnect = await showCustomModal(
            'Game Ditemukan!',
            `Anda memiliki game yang sedang berlangsung:\n\nGame ID: ${savedGameId}\nNama: ${savedPlayerName}\n\nReconnect ke game?`,
            '🔌'
        );
        
        if (shouldReconnect) {
            gameState.gameId = savedGameId;
            gameState.playerName = savedPlayerName;
            
            // Fill in the fields
            document.getElementById('playerName').value = savedPlayerName;
            document.getElementById('joinGameId').value = savedGameId;
            
            // Auto join
            socket.emit('join_game', { 
                game_id: savedGameId, 
                name: savedPlayerName 
            });
        } else {
            // Clear saved data
            localStorage.removeItem('kartu41_game_id');
            localStorage.removeItem('kartu41_player_name');
        }
    }
});

// Error handling
socket.on('error', (data) => {
    showNotification(data.message, 'error');
});

socket.on('disconnect', () => {
    showNotification('Koneksi terputus!', 'error');
});
