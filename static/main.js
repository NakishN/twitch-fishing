// State management
let appStatus = {};
let currentLeaderboardTab = 'by-caught';
let leaderboardData = { by_caught: [], by_weight: [], by_biggest: [], history: [] };
let socket = null;

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
    checkUrlParams();
    fetchStatus();
    fetchLeaderboard();
    setupWebSocket();

    // Event Listeners
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    document.getElementById('active-toggle').addEventListener('change', toggleRewardStatus);
    document.getElementById('test-catch-form').addEventListener('submit', triggerTestCatch);
    document.getElementById('reset-db-btn').addEventListener('click', resetDatabase);
});

// Check url query parameters for feedback messages
function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    
    if (success === 'connected') {
        showAlert('Успешно подключено к Twitch! Вы можете активировать награду.', 'success');
    } else if (error) {
        showAlert(`Ошибка подключения к Twitch: ${error}`, 'error');
    }
}

// Show alerts on dashboard
function showAlert(message, type) {
    const alertBox = document.getElementById('alert-box');
    alertBox.innerHTML = `
        <div class="alert alert-${type}">
            ${type === 'success' ? '✅' : '❌'} ${message}
        </div>
    `;
    setTimeout(() => {
        alertBox.innerHTML = '';
    }, 8000);
}

// Fetch general configuration status
async function fetchStatus() {
    try {
        const response = await fetch('/api/status');
        appStatus = await response.json();
        
        updateUIWithStatus();
    } catch (error) {
        console.error('Error fetching status:', error);
        document.getElementById('status-text').innerText = 'Ошибка соединения';
    }
}

// Update UI elements based on current status
function updateUIWithStatus() {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const activeToggle = document.getElementById('active-toggle');
    const twitchAuthBtn = document.getElementById('twitch-auth-btn');
    const twitchConnStatus = document.getElementById('twitch-connection-status');
    
    // Set settings inputs
    if (appStatus.configured) {
        document.getElementById('client-id').value = appStatus.client_id || '';
        document.getElementById('client-secret').placeholder = '••••••••••••••••••••';
    }
    document.getElementById('reward-title').value = appStatus.reward_title;
    document.getElementById('reward-cost').value = appStatus.reward_cost;

    // Set connection status
    if (appStatus.connected) {
        twitchConnStatus.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: 12px; padding: 1rem; margin-top: 1rem; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="font-size: 0.85rem; color: var(--text-secondary); display:block;">Канал:</span>
                    <strong style="font-size: 1.1rem; color: #10b981;">💜 ${appStatus.broadcaster_name}</strong>
                </div>
                <a href="/auth/twitch" class="btn btn-secondary" style="width: auto; padding: 0.5rem 1rem; font-size: 0.85rem;">🔌 Сменить аккаунт</a>
            </div>
        `;
        twitchAuthBtn.style.display = 'none';
        activeToggle.disabled = false;
    } else {
        twitchConnStatus.innerHTML = `
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.15); border-radius: 12px; padding: 1rem; margin-top: 1rem; color: #ef4444; font-size: 0.9rem;">
                ⚠️ <strong>Twitch не авторизован!</strong> Сохраните настройки API и авторизуйтесь ниже.
            </div>
        `;
        twitchAuthBtn.style.display = 'block';
        activeToggle.disabled = true;
    }

    // Toggle active switch
    activeToggle.checked = appStatus.is_active;

    // Update main status pill
    if (appStatus.is_active) {
        statusDot.className = 'status-dot active';
        statusText.innerText = 'Активен (Слушает Twitch)';
        statusText.style.color = '#10b981';
    } else {
        statusDot.className = 'status-dot';
        statusText.innerText = 'Отключен';
        statusText.style.color = 'var(--text-secondary)';
    }
}

// Save Twitch API credentials
async function saveSettings(e) {
    e.preventDefault();
    
    const client_id = document.getElementById('client-id').value.trim();
    const client_secret_input = document.getElementById('client-secret').value.trim();
    const reward_title = document.getElementById('reward-title').value.trim();
    const reward_cost = parseInt(document.getElementById('reward-cost').value);
    
    const payload = {
        client_id,
        client_secret: client_secret_input || appStatus.client_secret || '',
        reward_title,
        reward_cost
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            showAlert('Настройки сохранены! Теперь авторизуйтесь в Twitch.', 'success');
            fetchStatus();
        } else {
            const err = await response.json();
            showAlert(`Не удалось сохранить: ${err.detail || 'Неизвестная ошибка'}`, 'error');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        showAlert('Ошибка при отправке запроса настроек.', 'error');
    }
}

// Toggle game active state (enable/disable Twitch Channel Point reward)
async function toggleRewardStatus(e) {
    const isChecked = e.target.checked;
    e.target.disabled = true; // Temporary disable to prevent double clicking
    
    try {
        const response = await fetch('/api/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: isChecked })
        });
        
        if (response.ok) {
            const data = await response.json();
            showAlert(isChecked ? 'Награда успешно включена!' : 'Награда выключена (поставлена на паузу на Twitch)', 'success');
        } else {
            const err = await response.json();
            showAlert(`Ошибка при переключении: ${err.detail || 'Внутренняя ошибка'}`, 'error');
            e.target.checked = !isChecked; // Revert
        }
    } catch (error) {
        console.error('Error toggling reward status:', error);
        showAlert('Ошибка сети при переключении статуса.', 'error');
        e.target.checked = !isChecked; // Revert
    } finally {
        e.target.disabled = false;
        fetchStatus();
    }
}

// Fetch leaderboard and history statistics
async function fetchLeaderboard() {
    try {
        const response = await fetch('/api/leaderboard');
        leaderboardData = await response.json();
        
        renderLeaderboard();
        renderHistory();
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
    }
}

// Switch Leaderboard Tabs
function switchTab(tabName) {
    currentLeaderboardTab = tabName;
    
    // Manage active state of tabs
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Find matching tab button by onclick parameter content
    const targetTab = Array.from(tabs).find(t => t.getAttribute('onclick').includes(tabName));
    if (targetTab) targetTab.classList.add('active');
    
    renderLeaderboard();
}

// Render selected leaderboard data
function renderLeaderboard() {
    const container = document.getElementById('leaderboard-content');
    let list = [];
    let headers = '';
    
    if (currentLeaderboardTab === 'by-caught') {
        list = leaderboardData.by_caught;
        headers = `
            <tr>
                <th style="width: 70px;">Место</th>
                <th>Никнейм</th>
                <th style="text-align: right;">Поймано рыб</th>
            </tr>
        `;
    } else if (currentLeaderboardTab === 'by-weight') {
        list = leaderboardData.by_weight;
        headers = `
            <tr>
                <th style="width: 70px;">Место</th>
                <th>Никнейм</th>
                <th style="text-align: right;">Общий вес (кг)</th>
            </tr>
        `;
    } else if (currentLeaderboardTab === 'by-biggest') {
        list = leaderboardData.by_biggest;
        headers = `
            <tr>
                <th style="width: 70px;">Место</th>
                <th>Никнейм</th>
                <th>Самый большой улов</th>
                <th style="text-align: right;">Вес (кг)</th>
            </tr>
        `;
    }

    if (!list || list.length === 0) {
        container.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Нет данных для отображения.</p>`;
        return;
    }

    let rowsHtml = list.map((item, index) => {
        let scoreVal = item.score;
        let detailsHtml = '';
        
        if (currentLeaderboardTab === 'by-caught') {
            scoreVal = `${item.score} шт`;
        } else if (currentLeaderboardTab === 'by-weight') {
            scoreVal = `${item.score.toFixed(2)} кг`;
        } else if (currentLeaderboardTab === 'by-biggest') {
            scoreVal = `${item.score.toFixed(2)} кг`;
            detailsHtml = `<td style="color: ${item.color}; font-weight:600;">${item.fish_name} <span style="font-size:0.75rem; background:rgba(255,255,255,0.05); padding:0.1rem 0.4rem; border-radius:4px; margin-left:0.25rem;">${item.rarity.toUpperCase()}</span></td>`;
        }

        return `
            <tr>
                <td><span class="rank-badge">${index + 1}</span></td>
                <td style="font-weight:700;">${item.display_name}</td>
                ${detailsHtml}
                <td class="score-text" style="text-align: right;">${scoreVal}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="leaderboard-table">
            <thead>
                ${headers}
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;
}

// Render recent catches log
function renderHistory() {
    const container = document.getElementById('history-log');
    const history = leaderboardData.history;
    
    if (!history || history.length === 0) {
        container.innerHTML = `<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Лента уловов пуста.</p>`;
        return;
    }

    container.innerHTML = history.map(item => {
        const time = new Date(item.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="history-item">
                <div class="history-info">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <span class="history-user">${item.display_name}</span>
                        <span style="font-size:0.75rem; color:var(--text-secondary);">${time}</span>
                    </div>
                    <div class="history-fish">
                        поймал: <strong style="color: ${item.color};">${item.fish_name}</strong>
                        <span class="rarity-tag" style="background: ${item.color}20; color: ${item.color}; border: 1px solid ${item.color}35;">
                            ${item.rarity_title}
                        </span>
                    </div>
                </div>
                <div class="history-weight" style="color: ${item.color};">${item.weight.toFixed(2)} кг</div>
            </div>
        `;
    }).join('');
}

// Websocket logic to receive live events from the server
function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`Connecting websocket to ${wsUrl}`);
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('WebSocket connection opened.');
        // Ping interval
        setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send('ping');
            }
        }, 30000);
    };
    
    socket.onmessage = (event) => {
        if (event.data === 'pong') return;
        
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'catch') {
                console.log('New catch event received:', data);
                // Refresh data
                fetchLeaderboard();
            }
        } catch (err) {
            console.error('Error handling websocket message:', err);
        }
    };
    
    socket.onclose = () => {
        console.log('WebSocket disconnected. Retrying in 5s...');
        setTimeout(setupWebSocket, 5000);
    };
    
    socket.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

// Trigger simulated/test fishing catch
async function triggerTestCatch(e) {
    e.preventDefault();
    
    const username = document.getElementById('test-username').value.trim();
    const displayname = document.getElementById('test-displayname').value.trim();
    
    try {
        const response = await fetch('/api/test-catch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: username.toLowerCase(),
                display_name: displayname
            })
        });
        
        if (response.ok) {
            showAlert('Тестовый улов успешно симулирован!', 'success');
        } else {
            showAlert('Не удалось запустить тестовый улов.', 'error');
        }
    } catch (error) {
        console.error('Error triggering test catch:', error);
        showAlert('Ошибка сети при отладке улова.', 'error');
    }
}

// Reset stats database
async function resetDatabase() {
    if (!confirm('Вы уверены, что хотите полностью сбросить базу данных? Это удалит всю таблицу лидеров!')) {
        return;
    }
    
    try {
        const response = await fetch('/api/reset-database', { method: 'POST' });
        if (response.ok) {
            showAlert('База данных успешно очищена.', 'success');
            fetchLeaderboard();
        } else {
            showAlert('Не удалось очистить базу данных.', 'error');
        }
    } catch (error) {
        console.error('Error resetting database:', error);
        showAlert('Ошибка сети при сбросе.', 'error');
    }
}

// Utilities: copy text to clipboard
function copyText(elementId) {
    const text = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(text).then(() => {
        alert('Ссылка скопирована в буфер обмена!');
    }).catch(err => {
        console.error('Could not copy:', err);
    });
}
window.copyText = copyText;
window.switchTab = switchTab;
