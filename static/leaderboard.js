// Leaderboard overlay: rotates between "most catches", "total weight" and
// "biggest catch". Rows are keyed by user so position changes slide instead
// of re-rendering, and new catches are only shown once the alert overlay has
// revealed them (no spoilers).
//
// URL options (all optional):
//   period=session|all_time   which statistics to show (default session)
//   rows=5                    1..10
//   rotate=15                 seconds per category, 0 = stay on the first one
//   modes=caught,weight,biggest   which categories, in order
(function () {
    'use strict';

    const O = window.Overlay;

    const OPTIONS = {
        period: O.param('period', 'session') === 'all_time' ? 'all_time' : 'session',
        rows: Math.round(O.numParam('rows', 5, 1, 10)),
        rotate: O.numParam('rotate', 15, 0, 600),
        modes: O.param('modes', 'caught,weight,biggest').split(',').map(s => s.trim()).filter(Boolean)
    };

    const MODES = {
        caught: {
            title: 'Топ по уловам',
            list: 'by_caught',
            score: (u) => ({ value: String(u.score), unit: pluralize(u.score, 'улов', 'улова', 'уловов', true) }),
            sub: (u) => `${O.formatWeight(u.total_weight)} всего`
        },
        weight: {
            title: 'Топ по весу',
            list: 'by_weight',
            score: (u) => splitWeight(u.score),
            sub: (u) => `${u.total_fish} ${pluralize(u.total_fish, 'улов', 'улова', 'уловов')}`
        },
        biggest: {
            title: 'Рекорды',
            list: 'by_biggest',
            score: (u) => splitWeight(u.score),
            sub: (u) => `<b style="--rarity:${O.rarityColor(u.rarity, u.color)}">${escapeHtml(u.fish_name)}</b>`
        }
    };
    const activeModes = OPTIONS.modes.filter(m => MODES[m]);
    if (!activeModes.length) activeModes.push('caught', 'weight', 'biggest');

    const PERIOD_LABEL = { session: 'за этот стрим', all_time: 'за всё время' };
    const EMPTY_TEXT = {
        session: 'Пока никто не поймал рыбу.<br>Закиньте удочку первым!',
        all_time: 'Статистика пока пуста.'
    };

    const el = {
        board: document.getElementById('board'),
        title: document.getElementById('title'),
        period: document.getElementById('period'),
        dots: document.getElementById('dots'),
        rows: document.getElementById('rows'),
        empty: document.getElementById('empty'),
        emptyText: document.getElementById('empty-text'),
        timerFill: document.getElementById('timer-fill')
    };

    let data = null;
    let modeIndex = 0;
    let rowEls = new Map(); // username -> element for the mode on screen
    let rotateTimer = null;
    let timerAnimation = null;
    const pending = new Map(); // catch id -> fallback timeout waiting for the alert overlay

    // ---------------------------------------------------------------- helpers

    function pluralize(n, one, few, many, short) {
        const mod10 = n % 10;
        const mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) return one;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
        return many;
    }

    function splitWeight(kg) {
        const unit = O.weightUnit(kg);
        return { value: O.formatWeightValue(kg, unit), unit };
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    const rowHeight = () => parseFloat(getComputedStyle(el.board).getPropertyValue('--row-h')) || 58;
    const currentMode = () => MODES[activeModes[modeIndex % activeModes.length]];

    // ---------------------------------------------------------------- data

    async function load() {
        try {
            const response = await fetch(`/api/leaderboard?type=${OPTIONS.period}`);
            if (!response.ok) throw new Error(response.status);
            data = await response.json();
            render({ animateIn: false });
        } catch (err) {
            console.warn('[Fishing leaderboard] failed to load', err);
        }
    }

    // ---------------------------------------------------------------- rendering

    function rankClass(index) {
        return index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
    }

    function fillRow(row, user, index, leader, mode) {
        const score = mode.score(user);
        const share = leader > 0 ? Math.max(0.04, user.score / leader) : 0;

        row.className = `row ${rankClass(index)}${row.classList.contains('enter') ? ' enter' : ''}`;
        row.style.setProperty('--share', share.toFixed(3));
        row.querySelector('.rank').textContent = index + 1;
        row.querySelector('.name').textContent = user.display_name;
        row.querySelector('.sub').innerHTML = mode.sub(user);

        const scoreEl = row.querySelector('.score');
        const text = `${score.value} ${score.unit}`;
        const changed = row.dataset.score && row.dataset.score !== text;
        row.dataset.score = text;
        scoreEl.innerHTML = `${escapeHtml(score.value)}<small>${escapeHtml(score.unit)}</small>`;
        return changed;
    }

    function createRow(user) {
        const row = document.createElement('div');
        row.innerHTML = `
            <span class="rank"></span>
            <span class="ava"></span>
            <div class="who"><div class="name"></div><div class="sub"></div></div>
            <div class="score"></div>
            <span class="bar"></span>`;
        const ava = row.querySelector('.ava');
        ava.textContent = (user.display_name || '?').trim().charAt(0).toUpperCase();
        if (user.avatar) {
            const img = new Image();
            img.alt = '';
            img.onload = () => { ava.textContent = ''; ava.appendChild(img); };
            img.src = user.avatar;
        }
        return row;
    }

    function setY(row, index) {
        row.style.setProperty('--y', `${index * rowHeight()}px`);
        row.style.transform = `translateY(${index * rowHeight()}px)`;
    }

    function renderHeader(animate) {
        const mode = currentMode();
        const apply = () => {
            el.title.textContent = mode.title;
            el.period.textContent = PERIOD_LABEL[OPTIONS.period];
        };
        if (animate) {
            el.title.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }).finished.then(() => {
                apply();
                el.title.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'forwards' });
            });
        } else {
            apply();
        }
        el.dots.innerHTML = activeModes.length > 1
            ? activeModes.map((_, i) => `<i${i === modeIndex % activeModes.length ? ' class="on"' : ''}></i>`).join('')
            : '';
    }

    // animateIn: the category just changed, so the old rows are replaced with a staggered entrance.
    function render({ animateIn }) {
        if (!data) return;
        const mode = currentMode();
        const users = (data[mode.list] || []).slice(0, OPTIONS.rows);
        const leader = users.length ? users[0].score : 0;

        el.rows.style.setProperty('--count', String(Math.max(1, users.length)));
        el.board.style.setProperty('--count', String(Math.max(1, users.length)));
        el.empty.hidden = users.length > 0;
        el.emptyText.innerHTML = EMPTY_TEXT[OPTIONS.period];
        el.rows.hidden = users.length === 0;

        if (animateIn) {
            el.rows.innerHTML = '';
            rowEls = new Map();
        }

        const seen = new Set();
        users.forEach((user, index) => {
            seen.add(user.username);
            let row = rowEls.get(user.username);
            const isNew = !row;
            if (isNew) {
                row = createRow(user);
                row.classList.add('enter');
                row.style.setProperty('--delay', `${animateIn ? index * 0.07 : 0}s`);
                rowEls.set(user.username, row);
                setY(row, index);
                el.rows.appendChild(row);
                row.addEventListener('animationend', (e) => {
                    if (e.animationName === 'row-in') row.classList.remove('enter');
                });
            } else {
                setY(row, index);
            }
            const changed = fillRow(row, user, index, leader, mode);
            if (changed && !isNew && !animateIn) pulse(row);
        });

        for (const [username, row] of rowEls) {
            if (seen.has(username)) continue;
            rowEls.delete(username);
            row.classList.add('leave');
            setTimeout(() => row.remove(), 450);
        }
    }

    function pulse(row) {
        row.classList.remove('pulse');
        void row.offsetWidth;
        row.classList.add('pulse');
        setTimeout(() => row.classList.remove('pulse'), 1500);
    }

    // ---------------------------------------------------------------- rotation

    function startTimer() {
        if (timerAnimation) timerAnimation.cancel();
        if (OPTIONS.rotate <= 0 || activeModes.length < 2) return;
        timerAnimation = el.timerFill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
            duration: OPTIONS.rotate * 1000,
            easing: 'linear',
            fill: 'forwards'
        });
    }

    function rotate() {
        modeIndex = (modeIndex + 1) % activeModes.length;
        renderHeader(true);
        // let the old rows fade before the new category arrives
        const rows = [...rowEls.values()];
        rows.forEach(row => row.classList.add('leave'));
        setTimeout(() => render({ animateIn: true }), 280);
        startTimer();
    }

    function setupRotation() {
        if (OPTIONS.rotate <= 0 || activeModes.length < 2) return;
        clearInterval(rotateTimer);
        rotateTimer = setInterval(rotate, OPTIONS.rotate * 1000);
        startTimer();
    }

    // ---------------------------------------------------------------- live updates

    function refreshFor(id) {
        clearTimeout(pending.get(id));
        pending.delete(id);
        load();
    }

    function onCatch(message) {
        // Stay silent until the alert overlay shows the catch. With no alert overlay
        // connected there is nothing to wait for, so update right away.
        if (!message.id || !message.alerts_online) {
            setTimeout(load, 400);
            return;
        }
        pending.set(message.id, setTimeout(() => refreshFor(message.id), 45000));
    }

    function init() {
        renderHeader(false);
        load();
        setupRotation();
        O.connect({
            role: 'leaderboard',
            onOpen: load,
            onMessage(message) {
                if (message.type === 'catch') onCatch(message);
                else if (message.type === 'revealed' && pending.has(message.id)) setTimeout(() => refreshFor(message.id), 600);
                else if (message.type === 'reset') load();
            }
        });
    }

    O.warmFonts().then(init);
})();
