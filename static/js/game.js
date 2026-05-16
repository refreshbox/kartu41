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
    latestState: null,
    myHand: [],
    selectedCardIndex: null,
    hasDrawn: false,
    tempCard: null,
    isChatOpen: false,
    unreadChatCount: 0
};

// Reconnect state
let reconnectState = {
    shouldAutoReconnect: false,
    reconnectInProgress: false
};

let connectionState = {
    status: 'connecting',
    title: 'Menyambung ke server',
    message: 'Sedang menyiapkan koneksi permainan.'
};

// Timer state
let turnTimer = {
    interval: null,
    secondsLeft: 30,
    isRunning: false
};

let dragState = {
    pointerId: null,
    kind: null,
    cardIndex: null,
    sourceEl: null,
    previewEl: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    hasDragged: false,
    suppressClick: false
};

function isMyActiveTurn() {
    return gameState.latestState?.current_player_id === gameState.playerId;
}

function canDragHandCards() {
    return Boolean(
        isMyActiveTurn() &&
        gameState.hasDrawn &&
        gameState.tempCard &&
        !isServerInteractionBlocked()
    );
}

function canDragDiscardPileToHand() {
    return Boolean(
        isMyActiveTurn() &&
        !gameState.hasDrawn &&
        gameState.latestState?.last_discarded_card &&
        !isServerInteractionBlocked()
    );
}

function canCloseWithDraggedCard() {
    const totalCards = gameState.myHand.length + (gameState.tempCard ? 1 : 0);
    return canDragHandCards() && totalCards === 5;
}

function getDiscardDropZone() {
    return document.getElementById('discardPileArea');
}

function getDiscardButtonDropZone() {
    return document.getElementById('discardButton');
}

function getCloseDropZone() {
    return document.getElementById('closeHandButton');
}

function getHandDropZone() {
    return document.getElementById('yourHand');
}

function setDragHint(message = '') {
    const dragHint = document.getElementById('dragHint');
    if (!dragHint) {
        return;
    }

    dragHint.textContent = message;
}

function updateDiscardDropZoneState(mode = 'idle') {
    const discardZone = getDiscardDropZone();
    if (!discardZone) {
        return;
    }

    discardZone.classList.remove('drop-ready', 'drop-active');

    if (mode === 'ready') {
        discardZone.classList.add('drop-ready');
    } else if (mode === 'active') {
        discardZone.classList.add('drop-ready', 'drop-active');
    }
}

function updateDiscardButtonDropZoneState(mode = 'idle') {
    const discardButtonZone = getDiscardButtonDropZone();
    if (!discardButtonZone) {
        return;
    }

    discardButtonZone.classList.remove('drop-ready', 'drop-active');

    if (mode === 'ready') {
        discardButtonZone.classList.add('drop-ready');
    } else if (mode === 'active') {
        discardButtonZone.classList.add('drop-ready', 'drop-active');
    }
}

function updateCloseDropZoneState(mode = 'idle') {
    const closeZone = getCloseDropZone();
    if (!closeZone) {
        return;
    }

    closeZone.classList.remove('close-drop-ready', 'close-drop-active');

    if (mode === 'ready') {
        closeZone.classList.add('close-drop-ready');
    } else if (mode === 'active') {
        closeZone.classList.add('close-drop-ready', 'close-drop-active');
    }
}

function updateHandDropZoneState(mode = 'idle') {
    const handZone = getHandDropZone();
    if (!handZone) {
        return;
    }

    handZone.classList.remove('drop-ready', 'drop-active');

    if (mode === 'ready') {
        handZone.classList.add('drop-ready');
    } else if (mode === 'active') {
        handZone.classList.add('drop-ready', 'drop-active');
    }
}

function resetCardDragState() {
    if (dragState.sourceEl) {
        dragState.sourceEl.classList.remove('dragging-source');
    }

    if (dragState.previewEl) {
        dragState.previewEl.remove();
    }

    dragState.pointerId = null;
    dragState.kind = null;
    dragState.cardIndex = null;
    dragState.sourceEl = null;
    dragState.previewEl = null;
    dragState.startX = 0;
    dragState.startY = 0;
    dragState.offsetX = 0;
    dragState.offsetY = 0;
    dragState.hasDragged = false;

    updateDiscardDropZoneState(canDragHandCards() ? 'ready' : 'idle');
    updateDiscardButtonDropZoneState(canDragHandCards() ? 'ready' : 'idle');
    updateCloseDropZoneState(canCloseWithDraggedCard() ? 'ready' : 'idle');
    updateHandDropZoneState(canDragDiscardPileToHand() ? 'ready' : 'idle');
}

function pointInsideElement(element, clientX, clientY) {
    if (!element) {
        return false;
    }

    const rect = element.getBoundingClientRect();
    return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
    );
}

function createDragPreview(sourceEl) {
    const preview = sourceEl.cloneNode(true);
    preview.classList.remove('selected', 'temp-card', 'dragging-source');
    preview.classList.add('drag-card-preview');
    document.body.appendChild(preview);
    return preview;
}

function positionDragPreview(clientX, clientY) {
    if (!dragState.previewEl) {
        return;
    }

    dragState.previewEl.style.left = `${clientX - dragState.offsetX}px`;
    dragState.previewEl.style.top = `${clientY - dragState.offsetY}px`;
}

function beginCardDrag(event) {
    if (!canDragHandCards()) {
        return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
    }

    const cardEl = event.currentTarget;
    const cardIndex = Number(cardEl.dataset.cardIndex);
    const bounds = cardEl.getBoundingClientRect();

    dragState.pointerId = event.pointerId;
    dragState.kind = 'hand-card';
    dragState.cardIndex = cardIndex;
    dragState.sourceEl = cardEl;
    dragState.previewEl = null;
    dragState.startX = event.clientX;
    dragState.startY = event.clientY;
    dragState.offsetX = event.clientX - bounds.left;
    dragState.offsetY = event.clientY - bounds.top;
    dragState.hasDragged = false;

    if (typeof cardEl.setPointerCapture === 'function') {
        cardEl.setPointerCapture(event.pointerId);
    }
}

function beginDiscardPileDrag(event) {
    if (!canDragDiscardPileToHand()) {
        return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
    }

    const cardEl = event.currentTarget;
    const bounds = cardEl.getBoundingClientRect();

    dragState.pointerId = event.pointerId;
    dragState.kind = 'discard-pile';
    dragState.cardIndex = null;
    dragState.sourceEl = cardEl;
    dragState.previewEl = null;
    dragState.startX = event.clientX;
    dragState.startY = event.clientY;
    dragState.offsetX = event.clientX - bounds.left;
    dragState.offsetY = event.clientY - bounds.top;
    dragState.hasDragged = false;

    if (typeof cardEl.setPointerCapture === 'function') {
        cardEl.setPointerCapture(event.pointerId);
    }
}

function getHandCardDropTarget(clientX, clientY) {
    if (canCloseWithDraggedCard() && pointInsideElement(getCloseDropZone(), clientX, clientY)) {
        return 'close';
    }

    if (
        canDragHandCards() && (
            pointInsideElement(getDiscardDropZone(), clientX, clientY) ||
            pointInsideElement(getDiscardButtonDropZone(), clientX, clientY)
        )
    ) {
        return 'discard';
    }

    return null;
}

function getDiscardPileDropTarget(clientX, clientY) {
    if (canDragDiscardPileToHand() && pointInsideElement(getHandDropZone(), clientX, clientY)) {
        return 'hand';
    }

    return null;
}

function moveCardDrag(event) {
    if (dragState.pointerId !== event.pointerId || !dragState.kind) {
        return;
    }

    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (!dragState.hasDragged && distance < 10) {
        return;
    }

    if (!dragState.hasDragged) {
        dragState.hasDragged = true;
        dragState.suppressClick = true;
        dragState.previewEl = createDragPreview(dragState.sourceEl);
        dragState.sourceEl.classList.add('dragging-source');
        if (dragState.kind === 'discard-pile') {
            setDragHint('Lepaskan kartu buangan ke susunan kartu Anda.');
        } else {
            setDragHint('Lepaskan kartu ke area buangan atau tombol tutup kartu.');
        }
    }

    positionDragPreview(event.clientX, event.clientY);
    if (dragState.kind === 'discard-pile') {
        const dropTarget = getDiscardPileDropTarget(event.clientX, event.clientY);
        updateHandDropZoneState(dropTarget === 'hand' ? 'active' : (canDragDiscardPileToHand() ? 'ready' : 'idle'));
    } else {
        const dropTarget = getHandCardDropTarget(event.clientX, event.clientY);
        updateDiscardDropZoneState(dropTarget === 'discard' ? 'active' : (canDragHandCards() ? 'ready' : 'idle'));
        updateDiscardButtonDropZoneState(dropTarget === 'discard' ? 'active' : (canDragHandCards() ? 'ready' : 'idle'));
        updateCloseDropZoneState(dropTarget === 'close' ? 'active' : (canCloseWithDraggedCard() ? 'ready' : 'idle'));
    }
}

function finishCardDrag(event) {
    if (dragState.pointerId !== event.pointerId || !dragState.kind) {
        return;
    }

    const dragKind = dragState.kind;
    const droppedCardIndex = dragState.cardIndex;
    const hadDragged = dragState.hasDragged;
    const dropTarget = dragKind === 'discard-pile'
        ? getDiscardPileDropTarget(event.clientX, event.clientY)
        : getHandCardDropTarget(event.clientX, event.clientY);

    if (dragState.sourceEl && typeof dragState.sourceEl.releasePointerCapture === 'function') {
        try {
            dragState.sourceEl.releasePointerCapture(event.pointerId);
        } catch (error) {
            // Ignore release errors from browsers that already dropped capture.
        }
    }

    resetCardDragState();

    if (dragKind === 'discard-pile' && hadDragged && dropTarget === 'hand') {
        drawCard(true);
    } else if (dragKind === 'hand-card' && hadDragged && dropTarget === 'discard') {
        discardCard(droppedCardIndex);
    } else if (dragKind === 'hand-card' && hadDragged && dropTarget === 'close') {
        closeHandWithCard(droppedCardIndex);
    } else if (canDragDiscardPileToHand()) {
        setDragHint('Tarik kartu buangan ke susunan kartu Anda.');
    } else if (canDragHandCards()) {
        setDragHint('Tarik kartu ke area buangan atau tombol tutup kartu.');
    } else {
        setDragHint('');
    }
}

function cancelCardDrag(event) {
    if (dragState.pointerId !== event.pointerId) {
        return;
    }

    resetCardDragState();
    if (canDragDiscardPileToHand()) {
        setDragHint('Tarik kartu buangan ke susunan kartu Anda.');
    } else if (canDragHandCards()) {
        setDragHint('Tarik kartu ke area buangan atau tombol tutup kartu.');
    } else {
        setDragHint('');
    }
}

function handleCardClick(event, index) {
    if (dragState.suppressClick) {
        dragState.suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    selectCard(index);
}

function handleDiscardPileClick(event) {
    if (dragState.suppressClick) {
        dragState.suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    drawCard(true);
}

window.addEventListener('pointermove', moveCardDrag);
window.addEventListener('pointerup', finishCardDrag);
window.addEventListener('pointercancel', cancelCardDrag);

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
    
    turnTimer.secondsLeft = 30;
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
let modalContext = null;
let readyCheckPromptOpen = false;

function showCustomModal(title, message, icon = '❓', customHTML = null, context = 'default') {
    return new Promise((resolve) => {
        modalResolve = resolve;
        modalContext = context;
        
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
    modalContext = null;
}

function dismissModalSilently(context) {
    const modal = document.getElementById('customModal');
    if (!modal.classList.contains('show') || modalContext !== context) {
        return;
    }

    closeModal(null);
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
    if (reconnectState.shouldAutoReconnect || reconnectState.reconnectInProgress) {
        setConnectionState(
            'reconnecting',
            'Koneksi kembali tersedia',
            'Socket tersambung lagi. Sedang menyelaraskan ulang sesi permainan Anda.'
        );
    } else {
        setConnectionState('online', 'Tersambung', 'Koneksi permainan stabil.');
    }
});

socket.on('connected', (data) => {
    gameState.playerId = data.sid;
    console.log('Player ID:', gameState.playerId);
    attemptAutoReconnect();
});

function getSavedSession() {
    const savedGameId = localStorage.getItem('kartu41_game_id');
    const savedPlayerName = localStorage.getItem('kartu41_player_name');

    if (!savedGameId || !savedPlayerName) {
        return null;
    }

    return {
        gameId: savedGameId,
        playerName: savedPlayerName
    };
}

function updateSavedSessionPanel() {
    const panel = document.getElementById('savedSessionPanel');
    const gameIdEl = document.getElementById('savedSessionGameId');
    const playerNameEl = document.getElementById('savedSessionPlayerName');
    const savedSession = getSavedSession();

    if (!panel || !gameIdEl || !playerNameEl) {
        return;
    }

    if (!savedSession) {
        panel.style.display = 'none';
        return;
    }

    gameIdEl.textContent = savedSession.gameId;
    playerNameEl.textContent = savedSession.playerName;
    panel.style.display = 'block';
}

function reconnectSavedGame() {
    const savedSession = getSavedSession();
    if (!savedSession) {
        showNotification('Tidak ada sesi game aktif yang tersimpan.', 'error');
        updateSavedSessionPanel();
        return;
    }

    gameState.gameId = savedSession.gameId;
    gameState.playerName = savedSession.playerName;

    const welcomeNameInput = document.getElementById('playerName');
    const joinNameInput = document.getElementById('joinPlayerName');
    const joinGameIdInput = document.getElementById('joinGameId');

    if (welcomeNameInput) {
        welcomeNameInput.value = savedSession.playerName;
    }
    if (joinNameInput) {
        joinNameInput.value = savedSession.playerName;
    }
    if (joinGameIdInput) {
        joinGameIdInput.value = savedSession.gameId;
    }

    reconnectState.shouldAutoReconnect = true;

    if (socket.connected) {
        attemptAutoReconnect();
    } else {
        setConnectionState(
            'reconnecting',
            'Menyambung ulang ke game',
            'Koneksi sedang disiapkan. Anda akan otomatis masuk lagi saat server merespons.'
        );
    }
}

function attemptAutoReconnect() {
    if (!reconnectState.shouldAutoReconnect || reconnectState.reconnectInProgress) {
        return;
    }

    const savedSession = getSavedSession();
    if (!savedSession) {
        reconnectState.shouldAutoReconnect = false;
        return;
    }

    reconnectState.reconnectInProgress = true;
    setConnectionState(
        'reconnecting',
        'Menyambung ulang ke game',
        'Koneksi kembali tersedia. Sedang mencoba masuk lagi ke game Anda.'
    );
    gameState.gameId = savedSession.gameId;
    gameState.playerName = savedSession.playerName;

    socket.emit('join_game', {
        game_id: savedSession.gameId,
        name: savedSession.playerName
    });
}

function hasActiveGameSession() {
    return Boolean(gameState.gameId || getSavedSession());
}

function setConnectionState(status, title, message) {
    connectionState.status = status;
    connectionState.title = title;
    connectionState.message = message;
    updateConnectionUI();
}

function isServerInteractionBlocked() {
    return connectionState.status !== 'online';
}

function requireOnlineConnection(actionLabel = 'melakukan aksi ini') {
    if (!isServerInteractionBlocked()) {
        return true;
    }

    if (connectionState.status === 'reconnecting') {
        showNotification(`Koneksi sedang dipulihkan. Tunggu sebentar sebelum ${actionLabel}.`, 'warning');
    } else {
        showNotification(`Koneksi ke server belum siap untuk ${actionLabel}.`, 'error');
    }
    return false;
}

function updateConnectionUI() {
    const badge = document.getElementById('connectionStatusBadge');
    const badgeText = document.getElementById('connectionStatusText');
    const banner = document.getElementById('connectionBanner');
    const bannerTitle = document.getElementById('connectionBannerTitle');
    const bannerMessage = document.getElementById('connectionBannerMessage');
    const isBlocked = isServerInteractionBlocked();

    if (badge && badgeText) {
        badge.className = `connection-status-badge connection-status-${connectionState.status}`;
        badgeText.textContent = connectionState.title;
        badge.title = connectionState.title;
        badge.setAttribute('aria-label', connectionState.title);
    }

    if (banner && bannerTitle && bannerMessage) {
        const shouldShowBanner = connectionState.status === 'reconnecting' || connectionState.status === 'offline';
        banner.className = 'connection-banner';
        if (shouldShowBanner) {
            banner.classList.add('show', connectionState.status);
            bannerTitle.textContent = connectionState.title;
            bannerMessage.textContent = connectionState.message;
        }
    }

    const deckCard = document.querySelector('.deck-card');
    const discardPileCard = document.getElementById('discardPileCard');
    const discardButton = document.getElementById('discardButton');
    const closeHandButton = document.getElementById('closeHandButton');
    const startButton = document.getElementById('startButton');
    const timerToggle = document.getElementById('timerToggle');
    const finishButton = document.getElementById('finishGameBtn');
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.querySelector('.btn-send');

    if (deckCard) {
        deckCard.classList.toggle('interaction-disabled', isBlocked);
    }
    if (discardPileCard) {
        discardPileCard.classList.toggle('interaction-disabled', isBlocked);
    }
    if (discardButton) {
        discardButton.classList.toggle('interaction-disabled', isBlocked);
    }
    if (closeHandButton) {
        closeHandButton.classList.toggle('interaction-disabled', isBlocked);
    }
    if (startButton) {
        startButton.classList.toggle('interaction-disabled', isBlocked);
    }
    if (timerToggle) {
        timerToggle.disabled = isBlocked;
    }
    if (finishButton) {
        finishButton.classList.toggle('interaction-disabled', isBlocked);
    }
    if (chatInput) {
        chatInput.disabled = isBlocked;
        chatInput.placeholder = isBlocked ? 'Menunggu koneksi kembali...' : 'Ketik pesan...';
    }
    if (sendButton) {
        sendButton.classList.toggle('interaction-disabled', isBlocked);
    }
}

// Screen management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    if (screenId === 'gameOverScreen') {
        syncGameOverActions(gameState.latestState);
    }
    updateConnectionUI();
}

function isScreenActive(screenId) {
    return document.getElementById(screenId)?.classList.contains('active') || false;
}

function showWelcome() {
    showScreen('welcomeScreen');
    updateSavedSessionPanel();
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
    if (!requireOnlineConnection('membuat game')) {
        return;
    }

    const playerName = document.getElementById('playerName').value.trim();
    
    if (!playerName) {
        showNotification('Silakan masukkan nama Anda!', 'error');
        return;
    }
    
    gameState.playerName = playerName;
    socket.emit('create_game', {
        name: playerName,
        bot_turn_delay_seconds: 30
    });
}

socket.on('game_created', (data) => {
    gameState.gameId = data.game_id;
    reconnectState.shouldAutoReconnect = false;
    reconnectState.reconnectInProgress = false;
    setConnectionState('online', 'Tersambung', 'Game aktif dan siap dimainkan.');
    // Simpan untuk reconnect
    localStorage.setItem('kartu41_game_id', data.game_id);
    localStorage.setItem('kartu41_player_name', gameState.playerName);
    updateSavedSessionPanel();
    
    document.getElementById('lobbyGameId').textContent = data.game_id;
    updateLobby(data.game_state);
    showScreen('lobbyScreen');
    showNotification('Game berhasil dibuat!', 'success');
});

// Join game
function joinGame() {
    if (!requireOnlineConnection('gabung game')) {
        return;
    }

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
    reconnectState.shouldAutoReconnect = false;
    reconnectState.reconnectInProgress = false;
    setConnectionState('online', 'Tersambung', 'Anda sudah masuk ke sesi permainan.');
    // Simpan untuk reconnect
    localStorage.setItem('kartu41_game_id', gameState.gameId);
    localStorage.setItem('kartu41_player_name', gameState.playerName);
    updateSavedSessionPanel();
    
    updateLobby(data.game_state);
    showScreen('lobbyScreen');
    document.getElementById('lobbyGameId').textContent = gameState.gameId;
    showNotification(`${data.player_name} bergabung ke game!`, 'success');
    
    // Play doorbell sound saat pemain baru bergabung (seperti bell pintu rumah)
    playDoorbellSound();
});

function isCurrentPlayerReady(state) {
    return Boolean(state?.ready_player_names?.includes(gameState.playerName));
}

function updateReadyCheckPanel(state) {
    const panel = document.getElementById('readyCheckPanel');
    const messageEl = document.getElementById('readyCheckMessage');
    const summaryEl = document.getElementById('readyCheckSummary');
    const actionsEl = document.getElementById('readyCheckActions');

    if (!panel || !messageEl || !summaryEl || !actionsEl) {
        return;
    }

    if (!state.ready_check_active) {
        panel.style.display = 'none';
        actionsEl.style.display = 'none';
        summaryEl.innerHTML = '';
        dismissModalSilently('ready-check');
        readyCheckPromptOpen = false;
        return;
    }

    panel.style.display = 'block';
    messageEl.textContent = 'Semua pemain online harus siap sebelum ronde dimulai.';
    summaryEl.innerHTML = '';

    state.players
        .filter((player) => player.is_online)
        .forEach((player) => {
            const row = document.createElement('div');
            row.className = 'ready-check-row';
            const isReady = state.ready_player_names.includes(player.name);
            row.innerHTML = `
                <strong>${player.name}</strong>
                <span class="player-chip ${isReady ? 'ready' : 'waiting'}">
                    ${isReady ? '✅ Siap' : '⏳ Menunggu'}
                </span>
            `;
            summaryEl.appendChild(row);
        });

    const shouldShowActions = !isServerInteractionBlocked() && !isCurrentPlayerReady(state);
    actionsEl.style.display = shouldShowActions ? 'flex' : 'none';
}

function promptReadyCheckIfNeeded(state) {
    if (!state.ready_check_active || isCurrentPlayerReady(state) || readyCheckPromptOpen) {
        return;
    }

    readyCheckPromptOpen = true;
    showCustomModal(
        'Konfirmasi Mulai Game',
        'Ada pemain yang mengajak semua pemain masuk ronde berikutnya. Anda siap bermain sekarang?',
        '🎮',
        null,
        'ready-check'
    ).then((accepted) => {
        readyCheckPromptOpen = false;

        if (accepted === null) {
            return;
        }

        socket.emit('respond_ready_check', {
            accepted: Boolean(accepted)
        });
    });
}

// Update lobby
function updateLobby(state) {
    gameState.latestState = state;
    if (state.game_id) {
        gameState.gameId = state.game_id;
    }

    const playersList = document.getElementById('playersList');
    const playerCount = document.getElementById('playerCount');
    const isBlocked = isServerInteractionBlocked();
    
    playersList.innerHTML = '';
    playerCount.textContent = state.players.length;
    
    state.players.forEach((player) => {
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';

        const statusColor = player.is_online ? '#28a745' : '#dc3545';
        const statusText = player.is_online ? 'Online' : 'Offline';
        const isCreatorPlayer = player.name === state.creator_name;
        const isReady = state.ready_player_names?.includes(player.name);
        const canKick = (
            !state.game_started &&
            gameState.playerName === state.creator_name &&
            player.name !== gameState.playerName
        );

        playerItem.innerHTML = `
            <div class="player-item-main">
                <span class="player-icon">👤</span>
                <span>${player.name}</span>
                <span class="player-status" style="color: ${statusColor}; font-size: 0.85em;">● ${statusText}</span>
            </div>
            <div class="player-item-meta">
                ${isCreatorPlayer ? '<span class="player-chip owner">👑 Pembuat</span>' : ''}
                ${state.ready_check_active ? `<span class="player-chip ${isReady ? 'ready' : 'waiting'}">${isReady ? '✅ Siap' : '⏳ Menunggu'}</span>` : ''}
                ${canKick ? `<button class="btn-kick" data-player-name="${player.name}">Keluarkan</button>` : ''}
            </div>
        `;
        playersList.appendChild(playerItem);

        if (canKick) {
            const kickButton = playerItem.querySelector('.btn-kick');
            kickButton.addEventListener('click', () => kickPlayer(player.name));
        }
    });
    
    const startButton = document.getElementById('startButton');
    const isCreator = state.creator_name === gameState.playerName;
    const hasEnoughPlayers = state.players.filter((player) => player.is_online).length >= 2;
    
    const gameSettings = document.getElementById('gameSettings');
    const gameSettingsAccessNote = document.getElementById('gameSettingsAccessNote');
    if (gameSettings) {
        gameSettings.style.display = 'block';
    }
    if (gameSettingsAccessNote) {
        gameSettingsAccessNote.textContent = isCreator
            ? 'Pengaturan ini bisa Anda ubah sebelum game dimulai.'
            : 'Informasi pengaturan game. Hanya pembuat game yang bisa mengubahnya.';
    }
    
    // Update timer toggle berdasarkan state
    const timerToggle = document.getElementById('timerToggle');
    if (timerToggle && state.use_timer !== undefined) {
        timerToggle.checked = state.use_timer;
    }
    const randomizePlayerOrderToggle = document.getElementById('randomizePlayerOrderToggle');
    if (randomizePlayerOrderToggle && state.randomize_player_order !== undefined) {
        randomizePlayerOrderToggle.checked = state.randomize_player_order;
    }
    const botTurnDelayInput = document.getElementById('botTurnDelayInput');
    if (botTurnDelayInput && state.bot_turn_delay_seconds !== undefined) {
        botTurnDelayInput.value = state.bot_turn_delay_seconds;
    }

    const readyCheckActive = Boolean(state.ready_check_active);
    startButton.disabled = isBlocked || !hasEnoughPlayers;

    if (readyCheckActive) {
        if (isCreator) {
            startButton.disabled = isBlocked;
            startButton.textContent = '🛑 Batalkan Konfirmasi';
        } else {
            startButton.disabled = true;
            startButton.textContent = '⏳ Menunggu Konfirmasi';
        }
    } else {
        startButton.textContent = '🚀 Mulai Game';
    }

    if (isBlocked) {
        startButton.title = 'Menunggu koneksi kembali';
    } else if (readyCheckActive && !isCreator) {
        startButton.title = 'Konfirmasi mulai sedang berlangsung';
    } else if (readyCheckActive) {
        startButton.title = 'Batalkan konfirmasi mulai';
    } else if (!hasEnoughPlayers) {
        startButton.title = 'Minimal 2 pemain untuk memulai';
    } else {
        startButton.title = 'Mulai konfirmasi semua pemain';
    }

    if (timerToggle) {
        timerToggle.disabled = isBlocked || !isCreator || readyCheckActive;
        timerToggle.title = isCreator
            ? 'Aktifkan atau nonaktifkan mode timer'
            : 'Hanya pembuat game yang bisa mengubah mode timer';
    }
    if (randomizePlayerOrderToggle) {
        randomizePlayerOrderToggle.disabled = isBlocked || !isCreator || readyCheckActive;
        randomizePlayerOrderToggle.title = isCreator
            ? 'Aktifkan atau nonaktifkan pengacakan urutan pemain'
            : 'Hanya pembuat game yang bisa mengubah urutan pemain';
    }
    if (botTurnDelayInput) {
        botTurnDelayInput.disabled = isBlocked || !isCreator || readyCheckActive;
        botTurnDelayInput.title = isCreator
            ? 'Atur detik takeover bot saat pemain terputus'
            : 'Hanya pembuat game yang bisa mengubah takeover bot';
    }

    updateReadyCheckPanel(state);
    promptReadyCheckIfNeeded(state);
    updateConnectionUI();
}

// Copy game ID
function copyGameId() {
    const gameId = document.getElementById('lobbyGameId').textContent.trim();
    if (!gameId) {
        showNotification('Game ID belum tersedia.', 'error');
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(gameId)
            .then(() => {
                showNotification('Game ID berhasil disalin!', 'success');
            })
            .catch(() => {
                fallbackCopyGameId(gameId);
            });
        return;
    }

    fallbackCopyGameId(gameId);
}

function fallbackCopyGameId(gameId) {
    const tempInput = document.createElement('input');
    tempInput.value = gameId;
    document.body.appendChild(tempInput);
    tempInput.select();
    tempInput.setSelectionRange(0, tempInput.value.length);

    try {
        document.execCommand('copy');
        showNotification('Game ID berhasil disalin!', 'success');
    } catch (error) {
        showNotification(`Salin manual Game ID: ${gameId}`, 'info');
    } finally {
        document.body.removeChild(tempInput);
    }
}

// Toggle timer mode (hanya creator)
function toggleTimerMode() {
    if (!requireOnlineConnection('mengubah pengaturan timer')) {
        return;
    }

    const timerToggle = document.getElementById('timerToggle');
    const useTimer = timerToggle.checked;
    
    socket.emit('toggle_timer', { use_timer: useTimer });
}

function toggleRandomizePlayerOrder() {
    if (!requireOnlineConnection('mengubah urutan pemain')) {
        return;
    }

    const randomizeToggle = document.getElementById('randomizePlayerOrderToggle');
    const randomizePlayerOrder = Boolean(randomizeToggle?.checked);

    socket.emit('toggle_randomize_player_order', {
        randomize_player_order: randomizePlayerOrder
    });
}

function updateBotTurnDelaySetting() {
    if (!requireOnlineConnection('mengubah delay takeover bot')) {
        return;
    }

    const botTurnDelayInput = document.getElementById('botTurnDelayInput');
    if (!botTurnDelayInput) {
        return;
    }

    const rawValue = botTurnDelayInput.value.trim();
    if (rawValue === '') {
        showNotification('Masukkan jumlah detik takeover bot!', 'error');
        return;
    }

    const delaySeconds = Number(rawValue);
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
        showNotification('Delay takeover bot harus 0 detik atau lebih.', 'error');
        return;
    }

    socket.emit('update_bot_turn_delay', {
        bot_turn_delay_seconds: Math.floor(delaySeconds)
    });
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

socket.on('player_order_randomization_toggled', (data) => {
    const randomizeToggle = document.getElementById('randomizePlayerOrderToggle');
    if (randomizeToggle) {
        randomizeToggle.checked = data.randomize_player_order;
    }

    const message = data.randomize_player_order
        ? 'Urutan pemain akan diacak saat ronde dimulai'
        : 'Urutan pemain akan mengikuti susunan lobby saat ini';
    showNotification(message, 'info');
});

socket.on('bot_turn_delay_updated', (data) => {
    const botTurnDelayInput = document.getElementById('botTurnDelayInput');
    if (botTurnDelayInput) {
        botTurnDelayInput.value = data.bot_turn_delay_seconds;
    }

    if (data.game_state) {
        updateLobby(data.game_state);
    }

    showNotification(`Bot akan mengambil alih setelah ${data.bot_turn_delay_seconds} detik.`, 'info');
});

// Start game
async function startGame() {
    if (!requireOnlineConnection('memulai game')) {
        return;
    }

    if (gameState.latestState?.ready_check_active) {
        const cancelConfirmed = await showCustomModal(
            'Batalkan Konfirmasi Mulai?',
            'Semua pemain sedang diminta konfirmasi. Batalkan proses ini?',
            '🛑'
        );

        if (cancelConfirmed) {
            socket.emit('cancel_ready_check');
        }
        return;
    }

    const confirmed = await showCustomModal(
        'Mulai Konfirmasi Game?',
        'Semua pemain online akan diminta mengonfirmasi kesiapan sebelum ronde dimulai.',
        '🎮'
    );
    
    if (confirmed) {
        socket.emit('start_game');
    }
}

function respondReadyCheck(accepted) {
    if (!requireOnlineConnection('mengirim konfirmasi mulai')) {
        return;
    }

    dismissModalSilently('ready-check');
    readyCheckPromptOpen = false;
    socket.emit('respond_ready_check', { accepted });
}

async function kickPlayer(playerName) {
    if (!requireOnlineConnection('mengeluarkan pemain')) {
        return;
    }

    const confirmed = await showCustomModal(
        'Keluarkan Pemain?',
        `Keluarkan ${playerName} dari lobby game ini?`,
        '🚫'
    );

    if (confirmed) {
        socket.emit('kick_player', { player_name: playerName });
    }
}

socket.on('reconnected', (data) => {
    reconnectState.shouldAutoReconnect = false;
    reconnectState.reconnectInProgress = false;
    setConnectionState('online', 'Tersambung lagi', 'Anda berhasil kembali ke permainan.');
    showNotification('Berhasil reconnect ke game!', 'success');
    
    // Simpan player_id dari reconnect
    gameState.playerId = data.player_id;
    updateSavedSessionPanel();
    
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
    showNotification(data.message || `${data.player_name} kembali ke game!`, 'info');

    if (!data.game_state) {
        return;
    }

    if (data.game_state.game_ended) {
        showScreen('gameOverScreen');
        displayGameOver(data.game_state);
    } else {
        if (isScreenActive('lobbyScreen')) {
            updateLobby(data.game_state);
        }

        if (isScreenActive('gameScreen')) {
            updateOtherPlayers(data.game_state);
        }
    }

    gameState.latestState = data.game_state;
});

socket.on('player_disconnected', (data) => {
    showNotification(data.message || `${data.player_name} terputus koneksi`, 'error');

    if (!data.game_state) {
        return;
    }

    if (data.game_state.game_ended) {
        showScreen('gameOverScreen');
        displayGameOver(data.game_state);
    } else {
        if (isScreenActive('lobbyScreen')) {
            updateLobby(data.game_state);
        }

        if (isScreenActive('gameScreen')) {
            updateOtherPlayers(data.game_state);
        }
    }

    gameState.latestState = data.game_state;
});

socket.on('ready_check_started', (data) => {
    showScreen('lobbyScreen');
    document.getElementById('lobbyGameId').textContent = gameState.gameId;
    updateLobby(data.game_state);
    showNotification(data.message, 'info');
});

socket.on('ready_check_updated', (data) => {
    if (data.game_state) {
        updateLobby(data.game_state);
    }
    showNotification(data.message, 'info');
});

socket.on('ready_check_cancelled', (data) => {
    dismissModalSilently('ready-check');
    readyCheckPromptOpen = false;
    if (data.game_state) {
        updateLobby(data.game_state);
    }
    showNotification(data.message, 'warning');
});

socket.on('returned_to_lobby', (data) => {
    dismissModalSilently('ready-check');
    readyCheckPromptOpen = false;
    showScreen('lobbyScreen');
    document.getElementById('lobbyGameId').textContent = gameState.gameId;
    updateLobby(data.game_state);
    showNotification(data.message, 'success');
});

socket.on('lobby_updated', (data) => {
    if (data.game_state) {
        updateLobby(data.game_state);
    }
    if (data.message) {
        showNotification(data.message, 'info');
    }
});

socket.on('left_lobby', (data) => {
    localStorage.removeItem('kartu41_game_id');
    localStorage.removeItem('kartu41_player_name');
    gameState.gameId = null;
    gameState.playerId = null;
    gameState.latestState = null;
    reconnectState.shouldAutoReconnect = false;
    reconnectState.reconnectInProgress = false;
    updateSavedSessionPanel();
    showNotification(data.message, 'info');
    showScreen('welcomeScreen');
});

socket.on('kicked_from_lobby', (data) => {
    localStorage.removeItem('kartu41_game_id');
    localStorage.removeItem('kartu41_player_name');
    gameState.gameId = null;
    gameState.playerId = null;
    gameState.latestState = null;
    reconnectState.shouldAutoReconnect = false;
    reconnectState.reconnectInProgress = false;
    dismissModalSilently('ready-check');
    readyCheckPromptOpen = false;
    updateSavedSessionPanel();
    showNotification(data.message, 'warning');
    showScreen('welcomeScreen');
});

socket.on('bot_playing', (data) => {
    showNotification(data.message, 'info');
});

socket.on('bot_played_turn', (data) => {
    showNotification(data.message, 'info');
});

socket.on('game_started', (data) => {
    dismissModalSilently('ready-check');
    readyCheckPromptOpen = false;
    showScreen('gameScreen');
    document.getElementById('gameIdDisplay').textContent = gameState.gameId;
    showNotification(data.message, 'success');
    updateGameState(data.game_state);
});

// Update game state
function updateGameState(state) {
    gameState.latestState = state;

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

    if (!discardPileArea || !discardPileCard) {
        return;
    }

    const discardCount = (state.players || []).reduce((total, player) => {
        return total + (player.discard_pile?.length || 0);
    }, 0);
    
    if (state.last_discarded_card) {
        const card = state.last_discarded_card;
        const isRed = card.suit === '♥' || card.suit === '♦';
        const isMyTurn = state.current_player_id === gameState.playerId && !gameState.hasDrawn;
        
        // Jika giliran pemain dan belum ambil kartu, bisa diklik
        const clickable = isMyTurn ? 'cursor: pointer;' : 'cursor: default;';
        const showDiscardStack = discardCount > 1;

        discardPileArea.classList.toggle('has-card', showDiscardStack);
        discardPileCard.innerHTML = `
            ${showDiscardStack ? '<div class="discard-stack-layer discard-stack-layer-back"></div>' : ''}
            ${showDiscardStack ? '<div class="discard-stack-layer discard-stack-layer-mid"></div>' : ''}
            ${showDiscardStack ? '<div class="discard-stack-shadow"></div>' : ''}
            <div class="discard-stack-top">
                <div class="card ${isRed ? 'red' : 'black'} discard-draw-card" style="${clickable} margin: 0;">
                    <div class="card-rank">${card.rank}</div>
                    <div class="card-suit">${card.suit}</div>
                </div>
            </div>
            <div class="discard-origin">
                dari ${state.last_discarder_name}
            </div>
        `;

        const discardDrawCard = discardPileCard.querySelector('.discard-draw-card');
        if (discardDrawCard && isMyTurn) {
            discardDrawCard.addEventListener('click', handleDiscardPileClick);
            discardDrawCard.addEventListener('pointerdown', beginDiscardPileDrag);
        }
    } else {
        discardPileArea.classList.remove('has-card');
        discardPileCard.innerHTML = `
            <div class="discard-placeholder">
                <div class="discard-placeholder-icon">🗑️</div>
                <div class="discard-placeholder-text">Drop kartu di sini</div>
            </div>
        `;
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
        
        // Status online/offline/bot dengan warna
        const statusColor = player.is_bot_controlled ? '#f39c12' : (player.is_online ? '#28a745' : '#dc3545');
        const statusText = player.is_bot_controlled ? 'Bot' : (player.is_online ? 'Online' : 'Offline');
        
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
    resetCardDragState();
    
    // Hitung total kartu (hand + temp card)
    const totalCards = gameState.myHand.length + (tempCard ? 1 : 0);
    const canCloseHand = totalCards === 5;
    const canDrag = canDragHandCards();
    
    // Jika ada kartu temporary (baru diambil), tampilkan dengan highlight
    if (tempCard) {
        const cardDiv = document.createElement('div');
        const isRed = tempCard.suit === '♥' || tempCard.suit === '♦';
        cardDiv.className = `card ${isRed ? 'red' : 'black'} temp-card`;
        cardDiv.style.border = '4px solid #ffd700';
        cardDiv.style.animation = 'bounce 0.5s';
        cardDiv.dataset.cardIndex = '-1';
        if (canDrag) {
            cardDiv.classList.add('card-draggable');
        }
        cardDiv.addEventListener('click', (event) => handleCardClick(event, -1));
        cardDiv.addEventListener('pointerdown', beginCardDrag);
        
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
        cardDiv.dataset.cardIndex = String(index);
        if (canDrag) {
            cardDiv.classList.add('card-draggable');
        }
        cardDiv.addEventListener('click', (event) => handleCardClick(event, index));
        cardDiv.addEventListener('pointerdown', beginCardDrag);
        
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
    const blocked = isServerInteractionBlocked();
    const canDragHand = canDragHandCards();
    const canDragDiscard = canDragDiscardPileToHand();
    
    // Tombol buang: aktif jika ada kartu dipilih DAN ada tempCard
    if (discardBtn) {
        discardBtn.disabled = blocked || !hasSelection || !hasTempCard;
        if (!blocked && hasSelection && hasTempCard) {
            discardBtn.style.opacity = '1';
            discardBtn.style.cursor = 'pointer';
        } else {
            discardBtn.style.opacity = '0.5';
            discardBtn.style.cursor = 'not-allowed';
        }
    }

    updateDiscardDropZoneState(canDragHand ? 'ready' : 'idle');
    updateCloseDropZoneState(canCloseWithDraggedCard() ? 'ready' : 'idle');
    updateHandDropZoneState(canDragDiscard ? 'ready' : 'idle');

    if (canDragDiscard) {
        setDragHint('Tarik kartu buangan ke susunan kartu Anda.');
    } else if (canDragHand) {
        setDragHint('Tarik kartu ke area buangan atau tombol tutup kartu.');
    } else if (blocked) {
        setDragHint('Menunggu koneksi kembali sebelum melanjutkan aksi kartu.');
    } else {
        setDragHint('');
    }
    
    // Tombol tutup: aktif jika 5 kartu DAN ada kartu dipilih
    if (closeBtn) {
        closeBtn.disabled = blocked || !canClose || !hasSelection;
        if (!blocked && canClose && hasSelection) {
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
    if (!requireOnlineConnection('memilih kartu')) {
        return;
    }

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
    if (!requireOnlineConnection('mengambil kartu')) {
        return;
    }

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
    if (!requireOnlineConnection('membuang kartu')) {
        return;
    }

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
    gameState.latestState = data.game_state;
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
    gameState.latestState = null;
    reconnectState.shouldAutoReconnect = false;
    reconnectState.reconnectInProgress = false;
    dismissModalSilently('ready-check');
    readyCheckPromptOpen = false;
    updateSavedSessionPanel();
    
    showNotification(data.message, 'warning');
    
    // Redirect to home after 2 seconds
    setTimeout(() => {
        showScreen('welcomeScreen');
        updateSavedSessionPanel();
    }, 2000);
});

// Redirect home for creator
socket.on('redirect_home', () => {
    localStorage.removeItem('kartu41_game_id');
    localStorage.removeItem('kartu41_player_name');
    gameState.gameId = null;
    gameState.playerId = null;
    gameState.playerName = null;
    gameState.latestState = null;
    reconnectState.shouldAutoReconnect = false;
    reconnectState.reconnectInProgress = false;
    dismissModalSilently('ready-check');
    readyCheckPromptOpen = false;
    updateSavedSessionPanel();
    
    setTimeout(() => {
        showScreen('welcomeScreen');
        updateSavedSessionPanel();
    }, 2000);
});

function displayGameOver(state) {
    gameState.latestState = state;
    const winnerEl = document.getElementById('winnerAnnouncement');
    const rankingsEl = document.getElementById('rankingsList');
    syncGameOverActions(state);
    
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
    
    syncGameOverActions(state);
}

function syncGameOverActions(state = gameState.latestState) {
    const returnToLobbyBtn = document.getElementById('returnToLobbyBtn');
    const finishBtn = document.getElementById('finishGameBtn');
    const isCreator = Boolean(state?.creator_name && state.creator_name === gameState.playerName);

    if (returnToLobbyBtn) {
        returnToLobbyBtn.innerHTML = '🏠 Ke Lobby';
        returnToLobbyBtn.onclick = returnToLobby;
        returnToLobbyBtn.style.display = 'block';
    }

    if (finishBtn) {
        finishBtn.style.display = isCreator ? 'block' : 'none';
    }
}

// Leave game
async function leaveGame() {
    const confirmed = await showCustomModal(
        'Keluar dari Lobby?',
        'Anda akan keluar dari lobby game ini. Skor ronde yang sudah selesai tetap tersimpan untuk game ini, tetapi Anda tidak ikut ronde berikutnya.',
        '🚪'
    );
    
    if (confirmed) {
        socket.emit('leave_lobby');
    }
}

function backToHome() {
    localStorage.removeItem('kartu41_game_id');
    localStorage.removeItem('kartu41_player_name');
    location.reload();
}

async function returnToLobby() {
    if (!requireOnlineConnection('kembali ke lobby')) {
        return;
    }

    const confirmed = await showCustomModal(
        'Kembali ke Lobby?',
        'Semua pemain akan kembali ke lobby. Game ID tetap sama dan skor kumulatif ronde sebelumnya tetap disimpan.',
        '🏠'
    );
    
    if (confirmed) {
        socket.emit('return_to_lobby');
    }
}

async function finishGame() {
    if (!requireOnlineConnection('mengakhiri game')) {
        return;
    }

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
    if (!requireOnlineConnection('menutup kartu')) {
        return;
    }

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
    if (!requireOnlineConnection('mengirim chat')) {
        return;
    }

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
    const savedSession = getSavedSession();
    updateSavedSessionPanel();
    
    if (savedSession) {
        const shouldReconnect = await showCustomModal(
            'Game Ditemukan!',
            `Anda memiliki game yang sedang berlangsung:\n\nGame ID: ${savedSession.gameId}\nNama: ${savedSession.playerName}\n\nReconnect ke game?`,
            '🔌'
        );
        
        if (shouldReconnect) {
            gameState.gameId = savedSession.gameId;
            gameState.playerName = savedSession.playerName;
            
            // Fill in the fields
            document.getElementById('playerName').value = savedSession.playerName;
            document.getElementById('joinGameId').value = savedSession.gameId;
            
            if (socket.connected) {
                reconnectState.shouldAutoReconnect = true;
                attemptAutoReconnect();
            } else {
                reconnectState.shouldAutoReconnect = true;
            }
        } else {
            showWelcome();
            updateSavedSessionPanel();
            showNotification(`Game ${savedSession.gameId} tetap aktif. Anda bisa kembali dari menu utama.`, 'info');
        }
    }
});

// Error handling
socket.on('error', (data) => {
    if (reconnectState.reconnectInProgress) {
        reconnectState.reconnectInProgress = false;
    }
    showNotification(data.message, 'error');
});

socket.io.on('reconnect_attempt', () => {
    if (hasActiveGameSession()) {
        setConnectionState(
            'reconnecting',
            'Mencoba reconnect',
            'Koneksi masih putus. Sistem sedang mencoba menyambung ulang ke server.'
        );
    }
});

socket.io.on('reconnect_failed', () => {
    setConnectionState(
        'offline',
        'Reconnect gagal',
        'Belum bisa tersambung kembali. Periksa jaringan Anda lalu coba refresh halaman.'
    );
});

socket.on('connect_error', () => {
    setConnectionState(
        hasActiveGameSession() ? 'reconnecting' : 'offline',
        hasActiveGameSession() ? 'Server belum merespons' : 'Belum tersambung',
        hasActiveGameSession()
            ? 'Kami masih mencoba menghubungkan Anda kembali ke game.'
            : 'Koneksi ke server belum berhasil. Coba lagi sebentar lagi.'
    );
});

socket.on('disconnect', () => {
    const savedSession = getSavedSession();
    reconnectState.shouldAutoReconnect = Boolean(savedSession);
    reconnectState.reconnectInProgress = false;
    if (savedSession) {
        setConnectionState(
            'reconnecting',
            'Koneksi terputus',
            'Game sedang mencoba menyambungkan Anda kembali. Jika gagal terlalu lama, refresh halaman.'
        );
    } else {
        setConnectionState(
            'offline',
            'Koneksi terputus',
            'Server sedang tidak dapat dijangkau. Beberapa aksi dikunci sampai koneksi kembali.'
        );
    }
    showNotification('Koneksi terputus!', 'error');
});
