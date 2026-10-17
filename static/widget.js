// Catch alert overlay.
//
// Story of one alert: a fishing line drops from the top edge of the screen,
// the bobber lands on a strip of water and nibbles a few times, then the
// strike pulls it under and the catch comes out of the water as a tag
// hanging on the line. The tag swings, shows the weight on a scale and is
// reeled back up. Everything is drawn locally: no images, no sound files.
//
// URL options (all optional):
//   x=50        horizontal position of the line, % of the source width
//   y=9         top edge of the tag, % of the source height
//   scale=1     size of the whole alert
//   hold=1      multiplier for how long the tag stays on screen
//   volume=0.7  0..1, or sound=0 to mute
//   demo=1      loop fake catches for positioning (demo=legendary for one rarity)
(function () {
    'use strict';

    const O = window.Overlay;

    const OPTIONS = {
        x: O.numParam('x', 50, 0, 100),
        y: O.numParam('y', 9, 0, 90),
        scale: O.numParam('scale', 1, 0.4, 2.5),
        hold: O.numParam('hold', 1, 0.3, 4),
        volume: O.numParam('volume', 0.7, 0, 1),
        sound: O.flagParam('sound', true),
        demo: O.flagParam('demo', false) ? O.param('demo', '1') : null
    };
    const S = OPTIONS.scale;

    const CARD_WIDTH = 460;
    const GROMMET_Y = 24; // grommet centre from the tag's top edge, unscaled px

    // How each rarity is staged. Rarer catches get more suspense and more light.
    const STAGING = {
        trash:     { hold: 5000,  nibbles: [1, 1], glow: 0,    sparkles: 0,  sheen: null,   tilt: 0.09 },
        common:    { hold: 5500,  nibbles: [1, 2], glow: 0.1,  sparkles: 0,  sheen: null,   tilt: 0 },
        uncommon:  { hold: 6000,  nibbles: [1, 2], glow: 0.15, sparkles: 0,  sheen: null,   tilt: 0 },
        rare:      { hold: 7000,  nibbles: [2, 3], glow: 0.24, sparkles: 0,  sheen: 'once', tilt: 0, shiny: true },
        epic:      { hold: 8500,  nibbles: [2, 3], glow: 0.32, sparkles: 7,  sheen: 'loop', tilt: 0, shiny: true },
        legendary: { hold: 11000, nibbles: [3, 4], glow: 0.4,  sparkles: 16, sheen: 'loop', tilt: 0, shiny: true, rays: true, flash: true, tremble: true }
    };

    const SIZE_CLASSES = [[0.2, 'мелочь'], [0.5, 'средний'], [0.8, 'крупный'], [Infinity, 'трофей']];

    const ICONS = {
        trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 6h3v1.5A3.5 3.5 0 0 1 16.6 11M7 6H4v1.5A3.5 3.5 0 0 0 7.4 11"/></svg>',
        crown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/></svg>',
        mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
    };

    // ---------------------------------------------------------------- utils

    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const rand = (min, max) => min + Math.random() * (max - min);
    const randInt = ([min, max]) => Math.floor(rand(min, max + 1));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const ease = {
        linear: t => t,
        inQuad: t => t * t,
        inCubic: t => t * t * t,
        outCubic: t => 1 - Math.pow(1 - t, 3),
        outExpo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
        inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
        outBack: t => 1 + 2.15 * Math.pow(t - 1, 3) + 1.15 * Math.pow(t - 1, 2)
    };

    function formatDuration(seconds) {
        if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} ч`;
        if (seconds >= 60) return `${Math.round(seconds / 60)} мин`;
        return `${seconds} с`;
    }

    // ---------------------------------------------------------------- sound

    // Synthesised with Web Audio: one shared context, a compressor so stacked
    // sounds never clip, and a short generated reverb for the chimes.
    const Sound = (() => {
        let ctx = null;
        let master = null;
        let wet = null;
        let noiseBuffer = null;

        const midi = n => 440 * Math.pow(2, (n - 69) / 12);

        function init() {
            if (!OPTIONS.sound || OPTIONS.volume <= 0) return false;
            if (ctx) {
                if (ctx.state === 'suspended') ctx.resume();
                return true;
            }
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return false;

            ctx = new AudioContextClass();
            master = ctx.createGain();
            master.gain.value = OPTIONS.volume;
            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = -12;
            compressor.ratio.value = 4;
            master.connect(compressor).connect(ctx.destination);

            const reverb = ctx.createConvolver();
            reverb.buffer = impulse(1.8, 3.2);
            wet = ctx.createGain();
            wet.gain.value = 0.3;
            wet.connect(reverb).connect(master);

            noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            return true;
        }

        function impulse(seconds, decay) {
            const length = Math.floor(ctx.sampleRate * seconds);
            const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
            for (let ch = 0; ch < 2; ch++) {
                const data = buffer.getChannelData(ch);
                for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
            return buffer;
        }

        function out(node, reverb) {
            node.connect(master);
            if (reverb) {
                const send = ctx.createGain();
                send.gain.value = reverb;
                node.connect(send).connect(wet);
            }
        }

        function tone(freq, { at = 0, dur = 0.4, type = 'sine', gain = 0.2, attack = 0.006, glide = null, filter = null, reverb = 0.25 } = {}) {
            const t0 = ctx.currentTime + at;
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t0);
            if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + dur);

            const amp = ctx.createGain();
            amp.gain.setValueAtTime(0.0001, t0);
            amp.gain.exponentialRampToValueAtTime(gain, t0 + attack);
            amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

            let source = osc;
            if (filter) {
                const lowpass = ctx.createBiquadFilter();
                lowpass.type = 'lowpass';
                lowpass.Q.value = 2;
                lowpass.frequency.setValueAtTime(filter[0], t0);
                lowpass.frequency.exponentialRampToValueAtTime(filter[1], t0 + dur);
                osc.connect(lowpass);
                source = lowpass;
            }
            source.connect(amp);
            out(amp, reverb);
            osc.start(t0);
            osc.stop(t0 + dur + 0.05);
        }

        function noise({ at = 0, dur = 0.3, gain = 0.2, type = 'bandpass', from = 1200, to = 400, q = 0.8, reverb = 0.1 } = {}) {
            const t0 = ctx.currentTime + at;
            const src = ctx.createBufferSource();
            src.buffer = noiseBuffer;
            const filter = ctx.createBiquadFilter();
            filter.type = type;
            filter.Q.value = q;
            filter.frequency.setValueAtTime(from, t0);
            filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
            const amp = ctx.createGain();
            amp.gain.setValueAtTime(0.0001, t0);
            amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
            amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            src.connect(filter).connect(amp);
            out(amp, reverb);
            src.start(t0, Math.random() * 0.5);
            src.stop(t0 + dur + 0.05);
        }

        function bell(note, at, gain, dur) {
            const f = midi(note);
            tone(f, { at, dur, gain, reverb: 0.5 });
            tone(f * 2.76, { at, dur: dur * 0.45, gain: gain * 0.22, reverb: 0.5 });
            tone(f * 5.4, { at, dur: dur * 0.18, gain: gain * 0.07, reverb: 0.5 });
        }

        function pluck(note, at, gain) {
            tone(midi(note), { at, dur: 0.42, type: 'triangle', gain, reverb: 0.3 });
            tone(midi(note + 12), { at, dur: 0.2, gain: gain * 0.3, reverb: 0.3 });
        }

        const jingles = {
            trash() {
                // Deflated "wah-wah"
                tone(midi(57), { type: 'sawtooth', dur: 0.34, gain: 0.08, glide: midi(56), filter: [1500, 500], reverb: 0.15 });
                tone(midi(53), { at: 0.32, type: 'sawtooth', dur: 0.8, gain: 0.08, glide: midi(49), filter: [1300, 260], reverb: 0.2 });
            },
            common() {
                [76, 83].forEach((n, i) => pluck(n, i * 0.09, 0.13));
            },
            uncommon() {
                [74, 78, 81, 86].forEach((n, i) => pluck(n, i * 0.075, 0.12));
            },
            rare() {
                [69, 73, 76, 81, 85].forEach((n, i) => bell(n, i * 0.085, 0.11, 1.3));
            },
            epic() {
                [62, 66, 69, 74].forEach(n => tone(midi(n), { dur: 1.8, type: 'triangle', gain: 0.045, attack: 0.25, reverb: 0.5 }));
                [74, 78, 81, 86, 90].forEach((n, i) => bell(n, 0.05 + i * 0.07, 0.1, 1.4));
            },
            legendary() {
                tone(70, { dur: 1.4, gain: 0.32, glide: 30, reverb: 0.2 });
                [67, 72, 76, 79].forEach((n, i) => tone(midi(n), { at: i * 0.11, dur: 0.32, type: 'sawtooth', gain: 0.055, filter: [700, 2600], reverb: 0.35 }));
                [60, 64, 67, 72, 76].forEach(n => tone(midi(n), { at: 0.48, dur: 2.2, type: 'sawtooth', gain: 0.035, attack: 0.05, filter: [900, 3200], reverb: 0.5 }));
                [96, 100, 103, 107, 108, 103].forEach((n, i) => bell(n, 0.6 + i * 0.13, 0.05, 0.9));
            }
        };

        function play(fn) {
            if (!init()) return;
            try {
                fn();
            } catch (err) {
                console.warn('[Fishing alert] sound error', err);
            }
        }

        return {
            init,
            cast: () => play(() => noise({ dur: 0.38, gain: 0.05, from: 500, to: 2400, q: 1.2 })),
            plop: () => play(() => {
                tone(560, { dur: 0.11, gain: 0.22, glide: 170, reverb: 0.1 });
                noise({ dur: 0.14, gain: 0.05, type: 'lowpass', from: 2400, to: 300 });
            }),
            nibble: () => play(() => tone(rand(900, 1050), { dur: 0.07, gain: 0.08, glide: 600, reverb: 0.1 })),
            tremble: (dur) => play(() => {
                noise({ dur, gain: 0.14, type: 'lowpass', from: 220, to: 120, q: 3 });
                tone(55, { dur, type: 'sawtooth', gain: 0.035, attack: 0.2, filter: [240, 120] });
            }),
            strike: () => play(() => {
                noise({ dur: 0.5, gain: 0.32, from: 1800, to: 320, q: 0.7 });
                noise({ dur: 0.32, gain: 0.06, type: 'highpass', from: 5000, to: 2200 });
                tone(150, { dur: 0.2, gain: 0.24, glide: 55, reverb: 0.05 });
            }),
            jingle: (rarity) => play(jingles[rarity] || jingles.common),
            badge: () => play(() => bell(91, 0, 0.045, 0.6)),
            reel: () => play(() => {
                for (let i = 0; i < 12; i++) noise({ at: i * 0.045, dur: 0.03, gain: 0.05, type: 'highpass', from: 3200, to: 2600, q: 2, reverb: 0 });
            })
        };
    })();

    // ---------------------------------------------------------------- DOM

    const $ = (id) => document.getElementById(id);
    const el = {
        back: $('scene-back'),
        front: $('scene-front'),
        flash: $('flash'),
        label: $('cast-label'),
        labelName: $('cast-name'),
        labelText: $('cast-text'),
        labelQueue: $('cast-queue'),
        rig: $('rig'),
        card: $('card'),
        pips: $('rarity-pips'),
        rarityName: $('rarity-name'),
        catchNo: $('catch-no'),
        avatar: $('avatar'),
        anglerName: $('angler-name'),
        fishName: $('fish-name'),
        weigh: $('weigh'),
        weightValue: $('weight-value'),
        weightUnit: $('weight-unit'),
        sizeClass: $('size-class'),
        ruler: $('ruler'),
        rulerFill: $('ruler-fill'),
        rulerNeedle: $('ruler-needle'),
        rulerMin: $('ruler-min'),
        rulerMax: $('ruler-max'),
        desc: $('fish-desc'),
        badges: $('badges')
    };
    const back = el.back.getContext('2d');
    const front = el.front.getContext('2d');
    const waterCanvas = document.createElement('canvas');
    const waterCtx = waterCanvas.getContext('2d');

    let dpr = 1;
    let viewW = 0;
    let viewH = 0;

    function resize() {
        dpr = window.devicePixelRatio || 1;
        viewW = window.innerWidth;
        viewH = window.innerHeight;
        for (const canvas of [el.back, el.front]) {
            canvas.width = Math.round(viewW * dpr);
            canvas.height = Math.round(viewH * dpr);
        }
        back.setTransform(dpr, 0, 0, dpr, 0, 0);
        front.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ---------------------------------------------------------------- scene state

    const scene = {
        active: false,
        cx: 0,
        anchorY: -40,
        cardTop: 0,
        cardH: 0,
        waterY: 0,
        rgb: '167, 180, 186',
        water: { alpha: 0, spread: 0, width: 0 },
        line: { visible: false, to: 'bobber', slack: 1, tremble: 0 },
        bobber: { visible: false, drop: 1, dip: 0, vel: 0, sink: 0, alpha: 1 },
        card: { visible: false, L: 0, theta: 0, omega: 0, tilt: 0, swinging: false, clip: false },
        glow: { alpha: 0, strength: 0 },
        rays: { alpha: 0, angle: 0 },
        sparkleRate: 0,
        dripUntil: 0,
        ripples: [],
        particles: []
    };

    // ---------------------------------------------------------------- animation engine

    const tweens = new Set();
    let running = false;
    let lastFrame = 0;
    let time = 0;

    function tween(duration, easing, update) {
        return new Promise(resolve => {
            tweens.add({ start: null, duration, easing, update, resolve });
            wake();
        });
    }

    function wake() {
        if (running) return;
        running = true;
        lastFrame = performance.now();
        requestAnimationFrame(frame);
    }

    function frame(now) {
        const dt = Math.min(0.05, (now - lastFrame) / 1000);
        lastFrame = now;
        time += dt;

        for (const tw of tweens) {
            if (tw.start === null) tw.start = now;
            const t = Math.min(1, (now - tw.start) / tw.duration);
            tw.update(tw.easing(t));
            if (t >= 1) {
                tweens.delete(tw);
                tw.resolve();
            }
        }

        step(dt);
        render();

        // Idle overlays shouldn't burn CPU in OBS: stop the loop when nothing moves.
        if (scene.active || tweens.size || scene.particles.length || scene.ripples.length) {
            requestAnimationFrame(frame);
        } else {
            running = false;
            back.clearRect(0, 0, viewW, viewH);
            front.clearRect(0, 0, viewW, viewH);
        }
    }

    // ---------------------------------------------------------------- physics

    function waveAt(x) {
        let y = Math.sin(x * 0.045 / S + time * 1.7) * 1.7 * S + Math.sin(x * 0.021 / S - time * 1.1) * 2.3 * S;
        // The bobber pulls a small dimple into the surface when it dips
        const d = x - scene.cx;
        const pull = Math.max(0, scene.bobber.dip) * 0.35 + Math.min(scene.bobber.sink, 20) * 0.3;
        y += pull * S * Math.exp(-(d * d) / (2 * Math.pow(24 * S, 2)));
        return y;
    }

    function bobberPose() {
        const b = scene.bobber;
        const k = 1.3 * S;
        const surface = scene.waterY + waveAt(scene.cx);
        const restY = surface + (b.dip + b.sink) * S;
        const y = lerp(restY, -90 * S, b.drop);
        const slope = (waveAt(scene.cx + 6) - waveAt(scene.cx - 6)) / 12;
        return { x: scene.cx, y, k, tilt: Math.atan(slope) * 0.9 + clamp(b.vel * 0.0015, -0.25, 0.25) };
    }

    function grommet() {
        const c = scene.card;
        return {
            x: scene.cx + c.L * Math.sin(c.theta),
            y: scene.anchorY + c.L * Math.cos(c.theta)
        };
    }

    // Maps a point on the tag (unscaled, tag-local) to screen coordinates.
    function cardPoint(lx, ly) {
        const g = grommet();
        const angle = scene.card.theta + scene.card.tilt;
        const dx = (lx - CARD_WIDTH / 2) * S;
        const dy = (ly - GROMMET_Y) * S;
        return {
            x: g.x + dx * Math.cos(angle) - dy * Math.sin(angle),
            y: g.y + dx * Math.sin(angle) + dy * Math.cos(angle)
        };
    }

    function step(dt) {
        const b = scene.bobber;
        b.vel += (-160 * b.dip - 10 * b.vel) * dt;
        if (scene.line.tremble) b.vel += (Math.random() - 0.5) * 3200 * dt * scene.line.tremble;
        b.dip += b.vel * dt;

        const c = scene.card;
        if (c.swinging) {
            const rest = 0.006 * Math.sin(time * 1.3); // the tag never hangs perfectly still
            const w = 3.6;
            const zeta = 0.085;
            c.omega += (-(w * w) * (c.theta - rest) - 2 * zeta * w * c.omega) * dt;
            c.theta += c.omega * dt;
        }

        scene.rays.angle += dt * 0.12;

        for (let i = scene.ripples.length - 1; i >= 0; i--) {
            const r = scene.ripples[i];
            r.r += r.speed * dt;
            r.alpha = r.a0 * Math.pow(1 - Math.min(1, r.r / r.max), 2);
            if (r.r >= r.max) scene.ripples.splice(i, 1);
        }

        const gravity = 1500 * S;
        for (let i = scene.particles.length - 1; i >= 0; i--) {
            const p = scene.particles[i];
            p.life -= dt;
            if (p.kind === 'drop') p.vy += gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            const hitWater = p.kind === 'drop' && scene.water.alpha > 0.3 && p.vy > 0 && p.y > scene.waterY + waveAt(p.x);
            if (hitWater) addRipple(p.x, 22, 40, 0.35);
            if (p.life <= 0 || hitWater || p.y > viewH + 30) scene.particles.splice(i, 1);
        }

        if (c.visible && time < scene.dripUntil && Math.random() < dt * 7) {
            const p = cardPoint(rand(24, CARD_WIDTH - 24), scene.cardH - 2);
            scene.particles.push({ kind: 'drop', x: p.x, y: p.y, vx: 0, vy: rand(0, 40), size: rand(1.5, 2.6) * S, life: 2.5, max: 2.5 });
        }

        if (c.visible && scene.sparkleRate && Math.random() < dt * scene.sparkleRate) spawnSparkle();
    }

    function addRipple(x, max = 90, speed = 70, alpha = 0.7) {
        scene.ripples.push({ x, r: 4 * S, max: max * S, speed: speed * S, alpha, a0: alpha });
    }

    function splash(x, y, count, power, spread, width = 12) {
        for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
            const speed = power * rand(0.45, 1.2) * S;
            scene.particles.push({
                kind: 'drop',
                x: x + (Math.random() - 0.5) * width * S,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: rand(1.4, 3.2) * S,
                life: 1.4,
                max: 1.4
            });
        }
    }

    function spawnSparkle() {
        // Anywhere along the tag's outline, drifting upwards
        const edge = Math.random();
        const lx = edge < 0.5 ? rand(-14, CARD_WIDTH + 14) : (Math.random() < 0.5 ? rand(-18, 4) : rand(CARD_WIDTH - 4, CARD_WIDTH + 18));
        const ly = edge < 0.5 ? (Math.random() < 0.6 ? rand(-14, 20) : rand(scene.cardH - 20, scene.cardH + 14)) : rand(0, scene.cardH);
        const p = cardPoint(lx, ly);
        const life = rand(1, 1.9);
        scene.particles.push({
            kind: 'spark',
            x: p.x,
            y: p.y,
            vx: rand(-12, 12) * S,
            vy: rand(-55, -18) * S,
            size: rand(3, 7.5) * S,
            white: Math.random() < 0.35,
            life,
            max: life
        });
    }

    // ---------------------------------------------------------------- rendering

    function render() {
        back.clearRect(0, 0, viewW, viewH);
        front.clearRect(0, 0, viewW, viewH);

        if (scene.card.visible) {
            drawGlow(back);
            drawRays(back);
        }
        drawLine(back);
        if (scene.bobber.visible) drawBobber(back);
        drawWater(back);
        drawParticles(front);
        positionCard();
    }

    function attachPoint() {
        if (scene.line.to === 'card') return grommet();
        const pose = bobberPose();
        return { x: pose.x + Math.sin(pose.tilt) * 36 * pose.k, y: pose.y - Math.cos(pose.tilt) * 36 * pose.k };
    }

    function drawLine(ctx) {
        if (!scene.line.visible) return;
        const a = { x: scene.cx, y: scene.anchorY };
        const b = attachPoint();
        const sway = scene.line.slack * (7 + 4 * Math.sin(time * 0.9)) * S;
        const shake = scene.line.tremble * (Math.random() - 0.5) * 4 * S;
        const mx = (a.x + b.x) / 2 + sway + shake;
        const my = (a.y + b.y) / 2;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.lineCap = 'round';
        ctx.lineWidth = 3.4 * S;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.stroke();
        ctx.lineWidth = 1.6 * S;
        ctx.strokeStyle = 'rgba(236, 243, 246, 0.88)';
        ctx.stroke();
    }

    const BOBBER_BODY = (() => {
        const p = new Path2D();
        p.moveTo(0, -21);
        p.bezierCurveTo(7, -21, 10, -10, 10, -3);
        p.bezierCurveTo(10, 7, 5, 15, 0, 18);
        p.bezierCurveTo(-5, 15, -10, 7, -10, -3);
        p.bezierCurveTo(-10, -10, -7, -21, 0, -21);
        return p;
    })();

    function drawBobber(ctx) {
        const pose = bobberPose();
        ctx.save();
        ctx.globalAlpha = scene.bobber.alpha;
        ctx.translate(pose.x, pose.y);
        ctx.rotate(pose.tilt);
        ctx.scale(pose.k, pose.k);
        ctx.lineCap = 'round';

        // antenna with a bright tip, keel below
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#1f2529';
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(0, -36);
        ctx.moveTo(0, 17);
        ctx.lineTo(0, 26);
        ctx.stroke();
        ctx.strokeStyle = '#ff5a47';
        ctx.beginPath();
        ctx.moveTo(0, -36);
        ctx.lineTo(0, -30);
        ctx.stroke();

        const white = ctx.createLinearGradient(-10, 0, 10, 0);
        white.addColorStop(0, '#d6d0c5');
        white.addColorStop(0.45, '#fbf8f2');
        white.addColorStop(1, '#bdb6aa');
        ctx.fillStyle = white;
        ctx.fill(BOBBER_BODY);

        ctx.save();
        ctx.clip(BOBBER_BODY);
        const red = ctx.createLinearGradient(-10, 0, 10, 0);
        red.addColorStop(0, '#c3281c');
        red.addColorStop(0.45, '#ff5a47');
        red.addColorStop(1, '#a8231a');
        ctx.fillStyle = red;
        ctx.fillRect(-12, -24, 24, 20.5);
        ctx.fillStyle = '#1b2125';
        ctx.fillRect(-12, -4.4, 24, 2.6);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.ellipse(-4.2, -12, 1.8, 5, -0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.stroke(BOBBER_BODY);
        ctx.restore();
    }

    function drawWater(ctx) {
        const water = scene.water;
        if (water.alpha <= 0.002) return;

        const width = water.width * water.spread;
        const depth = 64 * S;
        const pad = 34 * S;
        const w = Math.ceil(width) + 2;
        const h = Math.ceil(depth + pad * 2);
        if (waterCanvas.width !== Math.round(w * dpr) || waterCanvas.height !== Math.round(h * dpr)) {
            waterCanvas.width = Math.round(w * dpr);
            waterCanvas.height = Math.round(h * dpr);
        }
        const wc = waterCtx;
        wc.setTransform(dpr, 0, 0, dpr, 0, 0);
        wc.globalCompositeOperation = 'source-over';
        wc.clearRect(0, 0, w, h);

        const x0 = scene.cx - width / 2;
        const surface = (lx) => pad + waveAt(x0 + lx);

        // Water body: tints whatever is under the surface (the bobber's keel, the rising tag)
        wc.beginPath();
        wc.moveTo(0, pad + depth);
        for (let lx = 0; lx <= w; lx += 6) wc.lineTo(lx, surface(lx));
        wc.lineTo(w, pad + depth);
        wc.closePath();
        const body = wc.createLinearGradient(0, pad - 4, 0, pad + depth);
        body.addColorStop(0, 'rgba(120, 196, 226, 0.46)');
        body.addColorStop(1, 'rgba(40, 110, 140, 0)');
        wc.fillStyle = body;
        wc.fill();

        wc.beginPath();
        for (let lx = 0; lx <= w; lx += 4) {
            if (lx === 0) wc.moveTo(lx, surface(lx));
            else wc.lineTo(lx, surface(lx));
        }
        wc.lineWidth = 4.5 * S;
        wc.strokeStyle = 'rgba(0, 24, 34, 0.28)';
        wc.stroke();
        wc.lineWidth = 2.2 * S;
        wc.strokeStyle = 'rgba(230, 245, 251, 0.95)';
        wc.stroke();

        wc.lineWidth = 1.6 * S;
        for (const r of scene.ripples) {
            wc.beginPath();
            wc.ellipse(r.x - x0, pad + waveAt(r.x), r.r, r.r * 0.24, 0, 0, Math.PI * 2);
            wc.strokeStyle = `rgba(230, 245, 251, ${r.alpha})`;
            wc.stroke();
        }

        // Fade both ends so the water strip has no hard edges
        wc.globalCompositeOperation = 'destination-in';
        const fade = wc.createLinearGradient(0, 0, w, 0);
        fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
        fade.addColorStop(0.2, 'rgba(0, 0, 0, 1)');
        fade.addColorStop(0.8, 'rgba(0, 0, 0, 1)');
        fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
        wc.fillStyle = fade;
        wc.fillRect(0, 0, w, h);

        ctx.globalAlpha = water.alpha;
        ctx.drawImage(waterCanvas, x0, scene.waterY - pad, w, h);
        ctx.globalAlpha = 1;
    }

    function cardCenter() {
        return cardPoint(CARD_WIDTH / 2, scene.cardH / 2);
    }

    function drawGlow(ctx) {
        const alpha = scene.glow.alpha * scene.glow.strength * (0.85 + 0.15 * Math.sin(time * 2.2));
        if (alpha <= 0.002) return;
        const c = cardCenter();
        const r = CARD_WIDTH * S * 0.95;
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
        g.addColorStop(0, `rgba(${scene.rgb}, ${alpha})`);
        g.addColorStop(0.55, `rgba(${scene.rgb}, ${alpha * 0.45})`);
        g.addColorStop(1, `rgba(${scene.rgb}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
    }

    function drawRays(ctx) {
        if (scene.rays.alpha <= 0.002) return;
        const c = cardCenter();
        const radius = 640 * S;
        const count = 14;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(scene.rays.angle);
        const g = ctx.createRadialGradient(0, 0, 80 * S, 0, 0, radius);
        g.addColorStop(0, `rgba(${scene.rgb}, ${0.26 * scene.rays.alpha})`);
        g.addColorStop(1, `rgba(${scene.rgb}, 0)`);
        ctx.fillStyle = g;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const half = 0.045 + 0.03 * (i % 3) / 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius, a - half, a + half);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    function drawParticles(ctx) {
        for (const p of scene.particles) {
            const t = p.life / p.max;
            if (p.kind === 'drop') {
                const speed = Math.hypot(p.vx, p.vy);
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(Math.atan2(p.vy, p.vx));
                ctx.fillStyle = `rgba(230, 245, 251, ${Math.min(1, t * 2) * 0.9})`;
                ctx.beginPath();
                ctx.ellipse(0, 0, p.size * (1 + Math.min(speed / 500, 1.6)), p.size, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            } else {
                const r = p.size * Math.sin(Math.PI * t);
                ctx.fillStyle = p.white ? `rgba(255, 255, 255, ${0.95 * t + 0.05})` : `rgba(${scene.rgb}, ${0.95 * t + 0.05})`;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y - r);
                ctx.quadraticCurveTo(p.x, p.y, p.x + r, p.y);
                ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + r);
                ctx.quadraticCurveTo(p.x, p.y, p.x - r, p.y);
                ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - r);
                ctx.fill();
            }
        }
    }

    function positionCard() {
        if (!scene.card.visible) return;
        const g = grommet();
        const angle = scene.card.theta + scene.card.tilt;
        el.rig.style.transform =
            `translate(${g.x}px, ${g.y}px) rotate(${angle}rad) scale(${S}) translate(${-CARD_WIDTH / 2}px, ${-GROMMET_Y}px)`;

        // While the tag is coming out of the water, hide the part still below the surface
        if (scene.card.clip) {
            const visible = GROMMET_Y + (scene.waterY - g.y) / S;
            const hidden = clamp(scene.cardH - visible, 0, scene.cardH);
            el.card.style.clipPath = hidden > 0 ? `inset(0 0 ${hidden}px 0)` : 'none';
        }
    }

    // ---------------------------------------------------------------- the tag

    let digitWidth = 0;
    let avatarToken = 0;

    function measureDigits() {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
        el.weightValue.appendChild(probe);
        for (const d of '0123456789') {
            probe.textContent = d;
            digitWidth = Math.max(digitWidth, probe.getBoundingClientRect().width);
        }
        probe.remove();
        if (digitWidth) el.card.style.setProperty('--digit-w', `${digitWidth.toFixed(2)}px`);
    }

    // Each digit gets a fixed-width box so the number doesn't jitter while counting.
    function renderWeight(text) {
        el.weightValue.innerHTML = text.replace(/\d/g, '<span class="d">$&</span>');
    }

    function setRuler(p) {
        el.rulerFill.style.transform = `scaleX(${p})`;
        el.rulerNeedle.style.left = `${p * 100}%`;
    }

    function rangePosition(fish) {
        if (fish.rarity === 'trash' || !(fish.max_weight > fish.min_weight) || !(fish.weight > 0)) return null;
        return clamp((fish.weight - fish.min_weight) / (fish.max_weight - fish.min_weight), 0, 1);
    }

    function fitFishName() {
        let size = 44;
        el.fishName.style.fontSize = `${size}px`;
        while (size > 24 && (el.fishName.scrollWidth > el.fishName.clientWidth + 1 || el.fishName.offsetHeight > size * 1.04 * 2 + 4)) {
            size -= 2;
            el.fishName.style.fontSize = `${size}px`;
        }
    }

    function badge(icon, title, note, variant) {
        const li = document.createElement('li');
        li.className = `badge${variant ? ` ${variant}` : ''}`;
        li.innerHTML = ICONS[icon];
        const text = document.createElement('span');
        text.textContent = title;
        if (note) {
            const small = document.createElement('small');
            small.textContent = ` · ${note}`;
            text.appendChild(small);
        }
        li.appendChild(text);
        return li;
    }

    function fillCard(ev, color, staging) {
        const fish = ev.fish;
        const records = ev.records || {};
        const tier = O.RARITIES[fish.rarity] ? O.RARITIES[fish.rarity].tier : 0;

        el.card.className = 'card';
        if (staging.shiny) el.card.classList.add('is-shiny');
        if (fish.rarity === 'legendary') el.card.classList.add('is-legendary');
        el.card.style.setProperty('--accent', color);
        el.card.style.setProperty('--accent-rgb', O.rgb(color));
        el.card.style.clipPath = 'none';

        el.pips.innerHTML = tier ? Array.from({ length: 6 }, (_, i) => `<i${i < tier ? ' class="on"' : ''}></i>`).join('') : '';
        el.rarityName.textContent = fish.rarity_title || '';

        el.catchNo.classList.toggle('is-preview', Boolean(ev.preview));
        el.catchNo.textContent = ev.preview ? 'предпросмотр' : (ev.stats && ev.stats.total_fish ? `улов № ${ev.stats.total_fish}` : '');

        const name = ev.user.display_name || ev.user.username || 'Рыбак';
        el.anglerName.textContent = name;
        el.avatar.textContent = name.trim().charAt(0).toUpperCase();
        const token = ++avatarToken;
        if (ev.user.avatar) {
            const img = new Image();
            img.alt = '';
            img.onload = () => {
                if (token !== avatarToken) return;
                el.avatar.textContent = '';
                el.avatar.appendChild(img);
            };
            img.src = ev.user.avatar;
        }

        el.fishName.textContent = fish.name;

        const hasWeight = fish.weight > 0;
        el.weigh.hidden = !hasWeight;
        if (hasWeight) {
            const unit = O.weightUnit(fish.weight);
            renderWeight(O.formatWeightValue(0, unit));
            el.weightUnit.textContent = unit;
        }

        const position = rangePosition(fish);
        el.ruler.hidden = position === null;
        el.sizeClass.hidden = position === null;
        el.sizeClass.getAnimations().forEach(a => a.cancel());
        if (position !== null) {
            setRuler(0);
            el.rulerMin.textContent = O.formatWeight(fish.min_weight);
            el.rulerMax.textContent = O.formatWeight(fish.max_weight);
            el.sizeClass.textContent = SIZE_CLASSES.find(([limit]) => position < limit)[1];
        }

        el.desc.textContent = fish.description || '';
        el.desc.hidden = !fish.description;

        el.badges.innerHTML = '';
        if (records.stream_record) {
            el.badges.appendChild(badge('trophy', 'Рекорд стрима',
                records.previous_stream_record ? `было ${O.formatWeight(records.previous_stream_record)}` : null, 'is-gold'));
        } else if (records.personal_best) {
            el.badges.appendChild(badge('crown', 'Личный рекорд',
                records.previous_personal_best ? `было ${O.formatWeight(records.previous_personal_best)}` : null, null));
        }
        if (fish.mute_duration) {
            el.badges.appendChild(badge('mute', `Мут на ${formatDuration(fish.mute_duration)}`, null, 'is-danger'));
        }

        // Measure with the real content before the tag is shown
        el.rig.style.transform = `scale(${S})`;
        fitFishName();
        scene.cardH = el.card.offsetHeight;
    }

    async function playReadout(fish) {
        const position = rangePosition(fish);
        if (fish.weight > 0) {
            const unit = O.weightUnit(fish.weight);
            await sleep(240);
            await tween(1150, ease.outExpo, e => {
                renderWeight(O.formatWeightValue(fish.weight * e, unit));
                if (position !== null) setRuler(position * e);
            });
            renderWeight(O.formatWeightValue(fish.weight, unit));
            if (position !== null) {
                el.sizeClass.animate(
                    [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
                    { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
                );
            }
        } else {
            await sleep(400);
        }

        for (const li of el.badges.children) {
            await sleep(170);
            li.animate(
                [{ opacity: 0, transform: 'translateY(8px) scale(0.94)' }, { opacity: 1, transform: 'none' }],
                { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.25)', fill: 'forwards' }
            );
            Sound.badge();
        }
    }

    // ---------------------------------------------------------------- cast label

    function placeLabel() {
        const top = Math.min(scene.waterY + 40 * S, viewH - 56 * S);
        el.label.style.left = `${scene.cx}px`;
        el.label.style.top = `${top}px`;
    }

    function labelFrames(visible) {
        const hidden = `translate(-50%, ${10 * S}px) scale(${S})`;
        const shown = `translate(-50%, 0) scale(${S})`;
        return visible
            ? [{ opacity: 0, transform: hidden }, { opacity: 1, transform: shown }]
            : [{ opacity: 1, transform: shown }, { opacity: 0, transform: hidden }];
    }

    function showLabel(name, text) {
        el.label.style.transformOrigin = '50% 0';
        el.labelName.textContent = name;
        el.labelText.textContent = text;
        updateQueueBadge();
        placeLabel();
        el.label.animate(labelFrames(true), { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    }

    function setLabelText(text) {
        el.labelText.textContent = text;
        el.labelText.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220 });
    }

    function hideLabel() {
        el.label.animate(labelFrames(false), { duration: 260, easing: 'ease-in', fill: 'forwards' });
    }

    function updateQueueBadge() {
        el.labelQueue.hidden = queue.length === 0;
        el.labelQueue.textContent = `+${queue.length} в очереди`;
    }

    // ---------------------------------------------------------------- the sequence

    function layout() {
        const half = (CARD_WIDTH * S) / 2 + 16;
        scene.cx = clamp((viewW * OPTIONS.x) / 100, half, Math.max(half, viewW - half));
        scene.cardTop = (viewH * OPTIONS.y) / 100;
        scene.waterY = Math.min(scene.cardTop + scene.cardH * S + 84 * S, viewH - 96 * S);
        scene.water.width = (CARD_WIDTH + 180) * S;
        scene.anchorY = -40;
    }

    async function play(ev) {
        const fish = ev.fish;
        const staging = STAGING[fish.rarity] || STAGING.common;
        const color = O.rarityColor(fish.rarity, fish.color);
        const backlog = queue.length;
        // A burst of redemptions shouldn't take forever to work through
        const pace = backlog >= 3 ? 0.55 : backlog >= 1 ? 0.8 : 1;

        fillCard(ev, color, staging);
        layout();
        scene.rgb = O.rgb(color);
        scene.active = true;
        wake();

        // 1. Cast: the line drops in with the bobber, water fades in under it
        Object.assign(scene.line, { visible: true, to: 'bobber', slack: 1, tremble: 0 });
        Object.assign(scene.bobber, { visible: true, drop: 1, dip: 0, vel: 0, sink: 0, alpha: 1 });
        showLabel(ev.user.display_name || ev.user.username, 'закидывает удочку');
        Sound.cast();
        tween(480, ease.outCubic, e => {
            scene.water.alpha = e;
            scene.water.spread = 0.55 + 0.45 * e;
        });
        await tween(560, ease.inQuad, e => { scene.bobber.drop = 1 - e; });
        Sound.plop();
        scene.bobber.vel += 170;
        addRipple(scene.cx, 70);
        addRipple(scene.cx, 120, 55, 0.4);
        splash(scene.cx, scene.waterY, 7, 260, 1.5);

        // 2. Nibbles: rarer fish make you wait a little longer
        const nibbles = backlog >= 2 ? 0 : randInt(staging.nibbles);
        await sleep(rand(650, 1100) * pace);
        for (let i = 0; i < nibbles; i++) {
            if (i === 0) setLabelText('клюёт…');
            scene.bobber.vel += rand(85, 130);
            addRipple(scene.cx, 60, 60, 0.55);
            Sound.nibble();
            await sleep(rand(520, 1000) * pace);
        }
        if (staging.tremble && backlog < 2) {
            setLabelText('что-то тяжёлое…');
            Sound.tremble(1.1);
            await tween(1000, ease.linear, e => {
                scene.line.tremble = Math.sin(Math.PI * e) * 1.4;
                scene.line.slack = 1 - e;
            });
            scene.line.tremble = 0;
        }

        // 3. Strike: the bobber goes under with a splash and the line snaps taut
        setLabelText('подсекает!');
        Sound.strike();
        splash(scene.cx, scene.waterY, 24, 430, 1.2);
        addRipple(scene.cx, 130, 120, 0.9);
        addRipple(scene.cx, 190, 90, 0.5);
        tween(160, ease.outCubic, e => { scene.line.slack = Math.min(scene.line.slack, 1 - e); });
        await tween(240, ease.inQuad, e => {
            scene.bobber.sink = 64 * e;
            scene.bobber.alpha = 1 - e * e;
        });
        scene.bobber.visible = false;
        hideLabel();

        // 4. Reveal: the tag is pulled out of the water and swings on the line
        await reveal(ev, staging);

        // 5. Hold
        await sleep(staging.hold * pace * OPTIONS.hold);

        // 6. Reel the tag back up
        await reelOut();
    }

    async function reveal(ev, staging) {
        const fish = ev.fish;
        const card = scene.card;
        const startL = scene.waterY + 34 * S - scene.anchorY;
        const endL = scene.cardTop + GROMMET_Y * S - scene.anchorY;

        Object.assign(card, { visible: true, L: startL, theta: 0, omega: 0, tilt: 0, swinging: false, clip: true });
        scene.line.to = 'card';
        positionCard();
        el.rig.style.visibility = 'visible';

        if (!ev.preview && ev.id) link.send({ type: 'revealed', id: ev.id });
        setTimeout(() => Sound.jingle(fish.rarity), 80);

        let splashed = false;
        await tween(700, ease.outBack, e => {
            card.L = lerp(startL, endL, e);
            if (!splashed && e > 0.12) {
                splashed = true;
                for (let i = 0; i < 6; i++) {
                    const x = scene.cx + (i / 5 - 0.5) * CARD_WIDTH * S * 0.9;
                    splash(x, scene.waterY, 5, 360, 0.9, 30);
                }
                addRipple(scene.cx, 260, 160, 0.7);
            }
        });
        card.clip = false;
        el.card.style.clipPath = 'none';
        card.swinging = true;
        card.omega = (Math.random() < 0.5 ? -1 : 1) * rand(0.26, 0.38);
        scene.dripUntil = time + 2.4;

        tween(700, ease.inOutSine, e => { scene.water.alpha = 1 - e; });

        if (staging.tilt) {
            // Junk hangs crooked
            tween(1400, ease.outBack, e => { card.tilt = staging.tilt * e; });
        }
        if (staging.sheen) el.card.classList.add(staging.sheen === 'loop' ? 'sheen-loop' : 'sheen-once');
        scene.glow.strength = staging.glow;
        tween(600, ease.outCubic, e => { scene.glow.alpha = e; });
        scene.sparkleRate = staging.sparkles;
        if (staging.rays) tween(900, ease.outCubic, e => { scene.rays.alpha = e; });
        if (staging.flash) {
            el.flash.style.setProperty('--flash-rgb', scene.rgb);
            el.flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: 1900, easing: 'ease-out' });
        }

        playReadout(fish);
    }

    async function reelOut() {
        Sound.reel();
        scene.sparkleRate = 0;
        const glow0 = scene.glow.alpha;
        const rays0 = scene.rays.alpha;
        tween(450, ease.linear, e => {
            scene.glow.alpha = glow0 * (1 - e);
            scene.rays.alpha = rays0 * (1 - e);
        });

        const card = scene.card;
        const startL = card.L;
        const endL = -(scene.cardH * S) - 140 - scene.anchorY;
        const theta0 = card.theta;
        card.swinging = false;
        await tween(760, ease.inCubic, e => {
            card.L = lerp(startL, endL, e);
            card.theta = theta0 * (1 - e);
        });

        el.rig.style.visibility = 'hidden';
        el.card.classList.remove('sheen-once', 'sheen-loop');
        Object.assign(card, { visible: false, swinging: false, theta: 0, omega: 0, tilt: 0 });
        Object.assign(scene.line, { visible: false, tremble: 0 });
        scene.water.alpha = 0;
        scene.glow.alpha = 0;
        scene.rays.alpha = 0;
        scene.active = false;
    }

    function hardReset() {
        el.rig.style.visibility = 'hidden';
        el.label.getAnimations().forEach(a => a.cancel());
        el.card.classList.remove('sheen-once', 'sheen-loop');
        scene.card.visible = false;
        scene.bobber.visible = false;
        scene.line.visible = false;
        scene.water.alpha = 0;
        scene.glow.alpha = 0;
        scene.rays.alpha = 0;
        scene.sparkleRate = 0;
        scene.active = false;
    }

    // ---------------------------------------------------------------- queue

    const queue = [];
    let playing = false;

    function enqueue(ev) {
        if (!ev || !ev.fish || !ev.user) return;
        queue.push(ev);
        updateQueueBadge();
        if (!playing) runQueue();
    }

    async function runQueue() {
        playing = true;
        while (queue.length) {
            const ev = queue.shift();
            updateQueueBadge();
            try {
                await play(ev);
            } catch (err) {
                console.error('[Fishing alert] failed to play catch', err);
                hardReset();
            }
            await sleep(450);
        }
        playing = false;
        if (OPTIONS.demo) scheduleDemo();
    }

    // ---------------------------------------------------------------- demo mode

    const DEMO_CATCHES = [
        { rarity: 'trash', rarity_title: 'Хлам', name: 'Старый башмак', weight: 0.64, min_weight: 0.2, max_weight: 1.0, description: 'Кто-то выбросил его давным-давно. Отлично пахнет водорослями!' },
        { rarity: 'common', rarity_title: 'Обычная рыба', name: 'Окунь', weight: 0.86, min_weight: 0.1, max_weight: 1.2, description: 'Полосатый хищник. Берегитесь острых плавников!' },
        { rarity: 'uncommon', rarity_title: 'Необычная рыба', name: 'Судак', weight: 4.37, min_weight: 0.8, max_weight: 6.0, description: 'Клыкастый охотник глубин. Светится в темноте (почти).' },
        { rarity: 'rare', rarity_title: 'Редкая рыба', name: 'Плеко', weight: 0.92, min_weight: 0.1, max_weight: 1.5, description: 'Прилипала! Присосался к вашему рту. Замучен на 10 минут!', mute_duration: 600 },
        { rarity: 'epic', rarity_title: 'Эпическая рыба', name: 'Сом', weight: 48.6, min_weight: 5, max_weight: 70, description: 'Гигант омутов! С длинными усами. Может утащить на дно.', personal_best: 12.4 },
        { rarity: 'legendary', rarity_title: 'ЛЕГЕНДАРНАЯ РЫБА', name: 'Кракен', weight: 843.2, min_weight: 100, max_weight: 1000, description: 'Легендарное чудовище бездны! Как ты вообще его вытащил?!', stream_record: 48.6 }
    ];
    let demoIndex = 0;
    let demoTimer = null;

    function scheduleDemo() {
        clearTimeout(demoTimer);
        demoTimer = setTimeout(() => {
            const only = DEMO_CATCHES.find(c => c.rarity === OPTIONS.demo);
            const sample = only || DEMO_CATCHES[demoIndex++ % DEMO_CATCHES.length];
            enqueue({
                id: null,
                preview: true,
                user: { display_name: 'demo_rybak', username: 'demo_rybak', avatar: null },
                fish: sample,
                stats: { total_fish: 3 },
                records: {
                    personal_best: Boolean(sample.personal_best),
                    previous_personal_best: sample.personal_best || null,
                    stream_record: Boolean(sample.stream_record),
                    previous_stream_record: sample.stream_record || null
                }
            });
        }, 1200);
    }

    // ---------------------------------------------------------------- boot

    let link = { send() {} };

    async function init() {
        resize();
        window.addEventListener('resize', resize);
        // Browsers (not OBS) only allow audio after a click
        document.addEventListener('pointerdown', () => Sound.init());

        await O.warmFonts();
        measureDigits();

        link = O.connect({
            role: OPTIONS.demo ? 'alert-demo' : 'alert',
            onMessage(message) {
                if (message.type === 'catch') enqueue(message);
            }
        });

        if (OPTIONS.demo) scheduleDemo();
    }

    init();
})();
