let leaderboardData = { by_weight: [], by_caught: [], by_biggest: [] };
let socket = null;
let currentMode = 'caught'; // 'caught' by_caught | 'weight' | 'biggest'
let rotationInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchLeaderboard();
    setupWebSocket();
    startRotation();
});

// Fetch leaderboard statistics
async function fetchLeaderboard() {
    try {
        const response = await fetch('/api/leaderboard');
        leaderboardData = await response.json();
        renderLeaderboard();
    } catch (error) {
        console.error('[OBS Leaderboard] Error fetching data:', error);
    }
}

// Render list items in widget
function renderLeaderboard() {
    const container = document.getElementById('leaderboard-rows-container');
    const typeLabel = document.getElementById('leaderboard-type-label');
    const icon = document.getElementById('rotation-icon');
    
    let list = [];
    let title = '';
    let iconStr = '';
    
    if (currentMode === 'caught') {
        list = leaderboardData.by_caught.slice(0, 5);
        title = 'Топ по штукам';
        iconStr = '🎣';
    } else if (currentMode === 'weight') {
        list = leaderboardData.by_weight.slice(0, 5);
        title = 'Топ по весу';
        iconStr = '⚖️';
    } else if (currentMode === 'biggest') {
        list = leaderboardData.by_biggest.slice(0, 5);
        title = 'Самый крупный улов';
        iconStr = '🏆';
    }
    
    typeLabel.innerText = title;
    icon.innerText = iconStr;
    
    if (!list || list.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 1.5rem; font-size: 0.9rem;">
                Здесь пока пусто.
            </div>
        `;
        return;
    }
    
    container.innerHTML = list.map((item, index) => {
        let scoreText = '';
        if (currentMode === 'caught') {
            scoreText = `${item.score} шт`;
        } else if (currentMode === 'weight') {
            scoreText = `${item.score.toFixed(2)} кг`;
        } else if (currentMode === 'biggest') {
            scoreText = `${item.score.toFixed(2)} кг`;
        }
        
        // Show fish name in biggest mode
        const extraDetails = currentMode === 'biggest' 
            ? `<span style="font-size:0.75rem; color:${item.color || 'var(--text-secondary)'}; margin-left: 0.4rem;">(${item.fish_name})</span>`
            : '';
            
        return `
            <div class="leaderboard-row">
                <span class="rank-col">#${index + 1}</span>
                <span class="name-col">
                    ${item.display_name}
                    ${extraDetails}
                </span>
                <span class="score-col">${scoreText}</span>
            </div>
        `;
    }).join('');
}

// Rotate through stats categories
function startRotation() {
    if (rotationInterval) clearInterval(rotationInterval);
    
    rotationInterval = setInterval(() => {
        if (currentMode === 'caught') {
            currentMode = 'weight';
        } else if (currentMode === 'weight') {
            currentMode = 'biggest';
        } else {
            currentMode = 'caught';
        }
        
        // Add fade out animation effect
        const container = document.getElementById('leaderboard-rows-container');
        container.style.opacity = '0';
        container.style.transform = 'translateY(-5px)';
        container.style.transition = 'all 0.25s ease';
        
        setTimeout(() => {
            renderLeaderboard();
            container.style.opacity = '1';
            container.style.transform = 'translateY(0)';
        }, 250);
        
    }, 15000); // rotate every 15 seconds
}

// Websocket setup to keep stats sync in real time
function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`[OBS Leaderboard] Connecting to WS: ${wsUrl}`);
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('[OBS Leaderboard] WebSocket connection established.');
        
        // ping interval
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
                console.log('[OBS Leaderboard] Catch event received, updating scores...');
                // Trigger fetch to refresh database stats
                fetchLeaderboard();
            }
        } catch (err) {
            console.error('[OBS Leaderboard] Error handling socket message:', err);
        }
    };
    
    socket.onclose = () => {
        console.log('[OBS Leaderboard] WebSocket closed. Reconnecting in 5s...');
        setTimeout(setupWebSocket, 5000);
    };
    
    socket.onerror = (err) => {
        console.error('[OBS Leaderboard] WebSocket error:', err);
    };
}
