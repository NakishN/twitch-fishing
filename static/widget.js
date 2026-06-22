// Queue to manage incoming catch events sequentially
const catchQueue = [];
let isAnimating = false;
let socket = null;

// Initialize Widget
document.addEventListener('DOMContentLoaded', () => {
    setupWebSocket();
});

// Sound engine utilizing standard Web Audio API (Synthesized chimes)
function playCatchSound(rarity) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        // 1. Water splash sound trigger (white noise burst + low pass drop)
        const bufferSize = ctx.sampleRate * 0.35;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.3);
        
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.5, ctx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        noise.start();
        
        // 2. Chime fanfare based on rarity after splash
        setTimeout(() => {
            if (rarity === 'trash') {
                // Flat sad sound
                playNote(ctx, 165, 'sawtooth', 0.25, 0.4);
            } else if (rarity === 'common') {
                // Short cute bip-bop
                playNote(ctx, 523.25, 'sine', 0.2, 0.1);
                setTimeout(() => playNote(ctx, 659.25, 'sine', 0.2, 0.15), 100);
            } else if (rarity === 'uncommon') {
                // Rising scale
                playNote(ctx, 392, 'sine', 0.2, 0.1);
                setTimeout(() => playNote(ctx, 494, 'sine', 0.2, 0.1), 80);
                setTimeout(() => playNote(ctx, 587, 'sine', 0.2, 0.2), 160);
            } else if (rarity === 'rare') {
                // Mystical bell
                const notes = [440, 554, 659, 880];
                notes.forEach((freq, idx) => {
                    setTimeout(() => playNote(ctx, freq, 'sine', 0.2, 0.3), idx * 100);
                });
            } else if (rarity === 'epic') {
                // Dynamic triangle synth
                const notes = [523.25, 659.25, 783.99, 1046.50];
                notes.forEach((freq, idx) => {
                    setTimeout(() => playNote(ctx, freq, 'triangle', 0.2, 0.3), idx * 80);
                });
            } else if (rarity === 'legendary') {
                // Mega-fanfare major chords + chorus
                const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50, 1318.51];
                notes.forEach((freq, idx) => {
                    setTimeout(() => {
                        playNote(ctx, freq, 'triangle', 0.12, 0.4);
                        playNote(ctx, freq * 1.006, 'sine', 0.08, 0.4); // thick chorus
                    }, idx * 65);
                });
            }
        }, 250);
    } catch (e) {
        console.error('Audio context error:', e);
    }
}

function playNote(ctx, freq, type, volume, duration) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + duration);
}

// Particle splash animation
function createSplashEffect() {
    const container = document.getElementById('effects-container');
    const bobber = document.getElementById('bobber');
    if (!bobber) return;
    
    const rect = bobber.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    for (let i = 0; i < 25; i++) {
        const particle = document.createElement('div');
        particle.className = 'splash-particles';
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        particle.style.width = `${Math.random() * 8 + 4}px`;
        particle.style.height = particle.style.width;
        particle.style.backgroundColor = '#60a5fa';
        particle.style.boxShadow = '0 0 8px #93c5fd';
        particle.style.opacity = '1';
        
        container.appendChild(particle);
        
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 9 + 4;
        let vx = Math.cos(angle) * velocity;
        let vy = Math.sin(angle) * velocity - 4; // pull up
        
        let px = x;
        let py = y;
        let opacity = 1;
        
        const interval = setInterval(() => {
            px += vx;
            py += vy;
            vy += 0.35; // gravity
            opacity -= 0.035;
            
            particle.style.left = `${px}px`;
            particle.style.top = `${py}px`;
            particle.style.opacity = opacity;
            
            if (opacity <= 0) {
                clearInterval(interval);
                particle.remove();
            }
        }, 16);
    }
}

// Confetti effect for EPIC/LEGENDARY rarities
function createConfettiEffect() {
    const container = document.getElementById('effects-container');
    const colors = ['#fbbf24', '#fcd34d', '#f59e0b', '#ec4899', '#a78bfa', '#3b82f6', '#10b981'];
    
    for (let i = 0; i < 80; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = `${Math.random() * window.innerWidth}px`;
        confetti.style.top = `-20px`;
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        
        const size = Math.random() * 10 + 6;
        confetti.style.width = `${size}px`;
        confetti.style.height = `${size}px`;
        confetti.style.opacity = '1';
        confetti.style.boxShadow = '0 0 6px rgba(255,255,255,0.2)';
        
        container.appendChild(confetti);
        
        let px = parseFloat(confetti.style.left);
        let py = -20;
        let vx = Math.random() * 4 - 2;
        let vy = Math.random() * 6 + 3;
        let rotation = Math.random() * 360;
        let rotSpeed = Math.random() * 12 - 6;
        
        const interval = setInterval(() => {
            px += vx;
            py += vy;
            rotation += rotSpeed;
            
            confetti.style.left = `${px}px`;
            confetti.style.top = `${py}px`;
            confetti.style.transform = `rotate(${rotation}deg)`;
            
            if (py > window.innerHeight) {
                clearInterval(interval);
                confetti.remove();
            }
        }, 16);
    }
}

// Run Catch Animation Sequence
function animateCatch(eventData) {
    isAnimating = true;
    
    const card = document.getElementById('catch-card');
    const bobber = document.getElementById('bobber');
    const content = document.getElementById('card-content');
    
    // 1. Set values
    document.getElementById('player-name').innerText = eventData.user.display_name;
    
    const rarityBadge = document.getElementById('rarity-badge');
    rarityBadge.innerText = eventData.fish.rarity_title;
    rarityBadge.style.color = eventData.fish.color;
    rarityBadge.style.borderColor = eventData.fish.color + '40';
    rarityBadge.style.backgroundColor = eventData.fish.color + '15';
    
    const fishTitle = document.getElementById('fish-title');
    fishTitle.innerText = eventData.fish.name;
    fishTitle.style.color = eventData.fish.color;
    
    // Set custom glow styles depending on rarity
    if (eventData.fish.rarity === 'legendary') {
        card.style.boxShadow = `0 0 45px ${eventData.fish.color}60`;
        fishTitle.style.textShadow = `0 0 15px ${eventData.fish.color}`;
    } else if (eventData.fish.rarity === 'epic' || eventData.fish.rarity === 'rare') {
        card.style.boxShadow = `0 0 30px ${eventData.fish.color}40`;
        fishTitle.style.textShadow = 'none';
    } else {
        card.style.boxShadow = '0 15px 50px rgba(0, 0, 0, 0.6)';
        fishTitle.style.textShadow = 'none';
    }
    
    card.style.borderColor = eventData.fish.color;
    document.getElementById('fish-weight').innerText = `${eventData.fish.weight.toFixed(2)} кг`;
    document.getElementById('fish-desc').innerText = eventData.fish.description;
    
    // Reset components to initial states
    bobber.style.display = 'inline-block';
    bobber.style.animation = 'bob 1s ease-in-out infinite alternate';
    content.style.display = 'none';
    
    // Show card wrapper
    card.classList.add('active');
    
    // 2. Bobber Float Phase
    setTimeout(() => {
        // Pull hook down (Bite animation)
        bobber.style.animation = 'none';
        bobber.style.transform = 'translateY(40px) scale(0.9)';
        bobber.style.transition = 'transform 0.15s cubic-bezier(0.6, -0.28, 0.735, 0.045)';
        
        // Splash trigger
        setTimeout(() => {
            createSplashEffect();
            playCatchSound(eventData.fish.rarity);
            bobber.style.display = 'none';
            bobber.style.transform = 'none';
            bobber.style.transition = 'none';
            
            // Switch view to details
            content.style.display = 'block';
            
            // Trigger special particle fanfare
            if (eventData.fish.rarity === 'legendary' || eventData.fish.rarity === 'epic') {
                createConfettiEffect();
            }
            
            // 3. Keep card visible for 7 seconds
            setTimeout(() => {
                // Hide Card
                card.classList.remove('active');
                
                // Wait for hide transitions, then check queue
                setTimeout(() => {
                    isAnimating = false;
                    checkQueue();
                }, 600);
                
            }, 7000);
            
        }, 150);
        
    }, 1500);
}

// Check if there are animations waiting in the queue
function checkQueue() {
    if (isAnimating) return;
    if (catchQueue.length > 0) {
        const nextCatch = catchQueue.shift();
        animateCatch(nextCatch);
    }
}

// Websocket setup
function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`[OBS Widget] Connecting to WS: ${wsUrl}`);
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('[OBS Widget] WebSocket connection established.');
        
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
                console.log('[OBS Widget] Queueing new catch:', data);
                catchQueue.push(data);
                checkQueue();
            }
        } catch (err) {
            console.error('[OBS Widget] Error parsing socket data:', err);
        }
    };
    
    socket.onclose = () => {
        console.log('[OBS Widget] WebSocket closed. Reconnecting in 5s...');
        setTimeout(setupWebSocket, 5000);
    };
    
    socket.onerror = (err) => {
        console.error('[OBS Widget] WebSocket error:', err);
    };
}
