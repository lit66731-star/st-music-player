import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const extensionName = 'music-player';

const defaultSettings = {
    volume: 0.8,
    playlist: [],   // { id, name, type: 'local' | 'url', url?, liked }
    currentId: null,
    shuffle: false,
    repeat: 'off',  // 'off' | 'all' | 'one'
};

// ---------------- IndexedDB：音频文件 + 头像 ----------------
const DB_NAME = 'st-music-player';
const DB_STORE = 'tracks';
const AVATAR_STORE = 'avatars';
let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(AVATAR_STORE)) db.createObjectStore(AVATAR_STORE, { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

function idbPut(id, blob) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put({ id, blob });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}
function idbGet(id) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(id);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    }));
}
function idbDelete(id) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}
function avatarPut(key, dataUrl) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(AVATAR_STORE, 'readwrite');
        tx.objectStore(AVATAR_STORE).put({ key, dataUrl });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}
function avatarGet(key) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(AVATAR_STORE, 'readonly');
        const req = tx.objectStore(AVATAR_STORE).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.dataUrl : null);
        req.onerror = () => reject(req.error);
    }));
}

// ---------------- 工具函数 ----------------
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (s[k] === undefined) s[k] = v;
    }
    if (!Array.isArray(s.playlist)) s.playlist = [];
    return s;
}
function saveSettings() { saveSettingsDebounced(); }
function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function compressImage(file, size = 256) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const c = document.createElement('canvas');
            const s = Math.min(img.width, img.height);
            const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
            c.width = c.height = size;
            c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, size, size);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
}

// ---------------- 默认头像（内联 SVG） ----------------
const DEFAULT_AVATAR = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
    `<rect width='100' height='100' fill='#efedee'/>` +
    `<circle cx='50' cy='40' r='17' fill='#bcb5b8'/>` +
    `<path d='M20 82c0-16 13-26 30-26s30 10 30 26' fill='#bcb5b8'/>` +
    `</svg>`
);

// ---------------- SVG 图标（线条风格） ----------------
const ICONS = {
    like: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`,
    prev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14"/><path d="M19 5l-9 7 9 7z"/></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5v14l11-7z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/></svg>`,
    next: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 5v14"/><path d="M5 5l9 7-9 7z"/></svg>`,
    queue: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none"/></svg>`,
    add: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    shuffle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>`,
    repeat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
    music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    volume: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8.5 8.5 0 0 1 0 12"/></svg>`,
    link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>`,
};

// ---------------- 播放器状态 ----------------
const player = {
    audio: null,
    objectUrls: {},   // id -> objectURL
    avatarTarget: 'mine',
};

jQuery(async () => {
    const settings = loadSettings();
    buildTopBarButton();
    buildPlayerPanel();
    player.audio = $('<audio></audio>').css('display', 'none').appendTo('body')[0];
    player.audio.volume = settings.volume;
    bindEvents();
    await hydrate();
    renderAll();
});

// ---------------- 顶部栏按钮 ----------------
function buildTopBarButton() {
    const btn = $(
        `<div id="st-music-player-button" title="音乐播放器（可拖动）">${ICONS.music}</div>`
    );
    btn.appendTo('body');
    btn.on('click', () => togglePanel());
    initButtonDrag(btn);
}

// 顶部按钮可拖动，位置持久化
function initButtonDrag(btn) {
    const settings = extension_settings[extensionName];
    if (settings.btnLeft != null && settings.btnTop != null) {
        btn.css({ left: settings.btnLeft + 'px', top: settings.btnTop + 'px', right: 'auto' });
    }
    let drag = null;
    btn.on('pointerdown', (e) => {
        const r = btn[0].getBoundingClientRect();
        drag = { sx: e.clientX, sy: e.clientY, left: r.left, top: r.top, active: false };
    });
    $(document).on('pointermove.st-mp-btn', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        if (!drag.active && Math.hypot(dx, dy) < 6) return;
        drag.active = true;
        btn.css({ right: 'auto', left: (drag.left + dx) + 'px', top: (drag.top + dy) + 'px' });
    });
    $(document).on('pointerup.st-mp-btn', () => {
        if (!drag) return;
        if (drag.active) {
            suppressClickUntil = Date.now() + 300;
            settings.btnLeft = parseFloat(btn.css('left'));
            settings.btnTop = parseFloat(btn.css('top'));
            saveSettings();
        }
        drag = null;
    });
}

// ---------------- 播放器面板 ----------------
function buildPlayerPanel() {
    if ($('#st-music-player').length) return;
    const html = `
    <div id="st-music-player" class="st-mp">
      <div class="st-mp__close" title="关闭">${ICONS.close}</div>
      <div class="st-mp__body">
        <div class="st-mp__stage">
          <div class="st-mp__avatar st-mp__avatar--mine" data-avatar="mine" title="点击换头像">
            <img alt="">
            <div class="st-mp__dot"></div>
          </div>
          <div class="st-mp__link">
            <svg viewBox="0 0 52 26" preserveAspectRatio="none" aria-hidden="true">
              <path class="st-mp__dash" d="M2 22 Q26 -4 50 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3.5 3"/>
            </svg>
          </div>
          <div class="st-mp__avatar st-mp__avatar--peer" data-avatar="peer" title="点击换头像">
            <img alt="">
            <div class="st-mp__dot"></div>
          </div>
        </div>
        <div class="st-mp__track">未在播放</div>
        <div class="st-mp__status">相距 520km&nbsp;|&nbsp;听了 13140 小时</div>
        <div class="st-mp__progress">
          <div class="st-mp__bar"><div class="st-mp__bar-fill"></div><div class="st-mp__bar-thumb"></div></div>
          <div class="st-mp__times"><span class="st-mp__cur">0:00</span><span class="st-mp__dur">0:00</span></div>
        </div>
        <div class="st-mp__controls">
          <button type="button" class="st-mp__btn st-mp__like" title="喜欢">${ICONS.like}</button>
          <button type="button" class="st-mp__btn st-mp__prev" title="上一首">${ICONS.prev}</button>
          <button type="button" class="st-mp__btn st-mp__play st-mp__btn--primary" title="播放/暂停">${ICONS.play}</button>
          <button type="button" class="st-mp__btn st-mp__next" title="下一首">${ICONS.next}</button>
          <button type="button" class="st-mp__btn st-mp__queue" title="歌曲列表">${ICONS.queue}</button>
        </div>
      </div>

      <div class="st-mp__sheet">
        <div class="st-mp__sheet-head">
          <button type="button" class="st-mp__add" title="添加音乐">${ICONS.add}</button>
          <span class="st-mp__sheet-title">播放列表</span>
          <div class="st-mp__sheet-tools">
            <button type="button" class="st-mp__shuffle" title="随机">${ICONS.shuffle}</button>
            <button type="button" class="st-mp__repeat" title="循环">${ICONS.repeat}</button>
            <button type="button" class="st-mp__sheet-close" title="收起">${ICONS.close}</button>
          </div>
        </div>
        <div class="st-mp__add-panel" style="display:none">
          <button type="button" class="st-mp__add-local">${ICONS.folder} 本地 MP3</button>
          <button type="button" class="st-mp__add-url-btn">${ICONS.link} 音乐链接</button>
          <div class="st-mp__url-row" style="display:none">
            <input type="text" class="st-mp__url-input" placeholder="粘贴 mp3 直链…">
            <button type="button" class="st-mp__url-add">添加</button>
          </div>
        </div>
        <ul class="st-mp__list"></ul>
        <div class="st-mp__volume">
          <i class="st-mp__vol-icon">${ICONS.volume}</i>
          <input type="range" class="st-mp__vol" min="0" max="100" value="80">
        </div>
      </div>

      <input type="file" class="st-mp__file" accept=".mp3,audio/mpeg,audio/*" multiple hidden>
      <input type="file" class="st-mp__avatar-file" accept="image/*" hidden>
    </div>`;
    $('body').append(html);
    placePanelDefault();
    initDrag();
}

function placePanelDefault() {
    const panel = $('#st-music-player');
    const w = panel.outerWidth() || 300;
    const left = Math.max(8, window.innerWidth - w - 20);
    panel.css({ left: left + 'px', top: '64px' });
}

let suppressClickUntil = 0;
function initDrag() {
    const panel = $('#st-music-player');
    let dragging = null;
    // 这些元素内部有自己的点击/拖拽交互，不参与面板拖动（按钮可拖动，见下方阈值判定）
    const INTERACTIVE = 'input, .st-mp__avatar, .st-mp__bar, .st-mp__list, .st-mp__add-panel';

    panel.on('pointerdown', (e) => {
        if ($(e.target).closest(INTERACTIVE).length) return;
        const isButton = $(e.target).closest('button').length;
        dragging = {
            startX: e.clientX, startY: e.clientY,
            left: parseFloat(panel.css('left')) || 0,
            top: parseFloat(panel.css('top')) || 0,
            active: false,
        };
        if (!isButton) e.preventDefault();
    });

    $(document).on('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragging.startX;
        const dy = e.clientY - dragging.startY;
        if (!dragging.active && Math.hypot(dx, dy) < 6) return;
        dragging.active = true;
        const nx = dragging.left + dx;
        const ny = dragging.top + dy;
        panel.css({
            left: Math.max(0, Math.min(window.innerWidth - 60, nx)) + 'px',
            top: Math.max(0, Math.min(window.innerHeight - 60, ny)) + 'px',
        });
    });

    $(document).on('pointerup', () => {
        if (dragging && dragging.active) suppressClickUntil = Date.now() + 300;
        dragging = null;
    });
}

// 拖动按钮后抑制随之而来的 click，避免误触
document.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
    }
}, true);

// ---------------- 事件绑定 ----------------
function bindEvents() {
    const panel = $('#st-music-player');

    panel.find('.st-mp__close').on('click', () => togglePanel(false));
    panel.find('.st-mp__play').on('click', () => togglePlay());
    panel.find('.st-mp__prev').on('click', () => next(-1));
    panel.find('.st-mp__next').on('click', () => next(1));
    panel.find('.st-mp__like').on('click', () => toggleLike());

    // 歌曲列表：上滑面板
    panel.find('.st-mp__queue').on('click', () => toggleSheet(true));
    panel.find('.st-mp__sheet-close').on('click', () => toggleSheet(false));

    panel.find('.st-mp__shuffle').on('click', () => {
        extension_settings[extensionName].shuffle = !extension_settings[extensionName].shuffle;
        saveSettings(); renderAll();
    });
    panel.find('.st-mp__repeat').on('click', () => {
        const s = extension_settings[extensionName];
        s.repeat = s.repeat === 'off' ? 'all' : (s.repeat === 'all' ? 'one' : 'off');
        saveSettings(); renderAll();
    });

    panel.find('.st-mp__vol').on('input', (e) => {
        const v = Number(e.target.value) / 100;
        player.audio.volume = v;
        extension_settings[extensionName].volume = v;
        saveSettings();
    });

    // 进度条拖动
    panel.find('.st-mp__bar').on('pointerdown', (e) => {
        if (!player.audio.duration) return;
        seekTo(e);
        const move = (ev) => seekTo(ev);
        const up = () => { $(document).off('pointermove', move); $(document).off('pointerup', up); };
        $(document).on('pointermove', move);
        $(document).on('pointerup', up);
    });

    // 添加音乐：加号展开面板
    panel.find('.st-mp__add').on('click', () => panel.find('.st-mp__add-panel').slideToggle(160));
    panel.find('.st-mp__add-local').on('click', () => panel.find('.st-mp__file').trigger('click'));
    panel.find('.st-mp__add-url-btn').on('click', () => {
        panel.find('.st-mp__url-row').slideToggle(160);
        panel.find('.st-mp__url-input').trigger('focus');
    });
    panel.find('.st-mp__url-add').on('click', () => {
        const input = panel.find('.st-mp__url-input');
        const url = input.val().trim();
        if (url) addUrlTrack(url);
        input.val('');
        panel.find('.st-mp__url-row').slideUp(160);
        renderAll();
    });
    panel.find('.st-mp__url-input').on('keydown', (e) => {
        if (e.key === 'Enter') panel.find('.st-mp__url-add').trigger('click');
    });

    panel.find('.st-mp__file').on('change', async (e) => {
        const files = Array.from(e.target.files || []);
        for (const f of files) await addLocalFile(f);
        e.target.value = '';
        renderAll();
    });

    // 头像换图
    panel.find('.st-mp__avatar').on('click', (e) => {
        player.avatarTarget = $(e.currentTarget).data('avatar');
        panel.find('.st-mp__avatar-file').trigger('click');
    });
    panel.find('.st-mp__avatar-file').on('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) await setAvatar(player.avatarTarget, file);
        e.target.value = '';
    });

    // 播放列表条目
    panel.find('.st-mp__list').on('click', '.st-mp__item-del', (e) => {
        e.stopPropagation();
        removeTrack($(e.currentTarget).closest('.st-mp__item').data('id'));
    }).on('click', '.st-mp__item', (e) => {
        if ($(e.target).closest('.st-mp__item-del').length) return;
        const t = getTrack($(e.currentTarget).data('id'));
        if (t) playTrack(t);
    });

    // 音频事件
    const a = player.audio;
    a.addEventListener('timeupdate', updateProgress);
    a.addEventListener('loadedmetadata', renderAll);
    a.addEventListener('play', renderAll);
    a.addEventListener('pause', renderAll);
    a.addEventListener('ended', () => {
        if (extension_settings[extensionName].repeat === 'one') { a.currentTime = 0; a.play(); }
        else next(1);
    });
    let errorGuard = 0;
    a.addEventListener('playing', () => { errorGuard = 0; });
    a.addEventListener('error', () => {
        errorGuard++;
        if (errorGuard > 3) { errorGuard = 0; stop(); return; }
        next(1);
    });
}

// ---------------- 头像 ----------------
async function setAvatar(key, file) {
    const dataUrl = await compressImage(file, 256);
    if (!dataUrl) return;
    await avatarPut(key, dataUrl);
    $(`.st-mp__avatar--${key} img`).attr('src', dataUrl);
}

async function loadAvatars() {
    for (const key of ['mine', 'peer']) {
        const dataUrl = await avatarGet(key);
        $(`.st-mp__avatar--${key} img`).attr('src', dataUrl || DEFAULT_AVATAR);
    }
}

// ---------------- 连接动效 ----------------
function updateConnectionState() {
    const panel = $('#st-music-player');
    const track = currentTrack();
    const playing = !!track && !player.audio.paused && !player.audio.ended;
    if (playing && !panel.hasClass('is-connected') && !panel.hasClass('is-connecting')) {
        panel.addClass('is-connecting');
        setTimeout(() => {
            panel.removeClass('is-connecting').addClass('is-connected');
        }, 2400);
    }
    if (!track) {
        panel.removeClass('is-connected is-connecting');
    }
}

// ---------------- 播放列表操作 ----------------
function getTrack(id) {
    return extension_settings[extensionName].playlist.find(t => t.id === id) || null;
}
async function addLocalFile(file) {
    const s = extension_settings[extensionName];
    const id = uid();
    const track = { id, name: file.name.replace(/\.[^.]+$/, ''), type: 'local', liked: false };
    await idbPut(id, file);
    s.playlist.push(track);
    saveSettings();
}
function addUrlTrack(url) {
    const s = extension_settings[extensionName];
    let name = url.split('/').pop().split('?')[0];
    try { name = decodeURIComponent(name); } catch (e) { /* ignore */ }
    if (!name) name = url;
    s.playlist.push({ id: uid(), name, type: 'url', url, liked: false });
    saveSettings();
}
async function removeTrack(id) {
    const s = extension_settings[extensionName];
    const track = getTrack(id);
    if (!track) return;
    await removeTrackData(track);
    s.playlist = s.playlist.filter(t => t.id !== id);
    if (s.currentId === id) { s.currentId = null; stop(); }
    saveSettings();
    renderAll();
}
async function removeTrackData(track) {
    if (track.type === 'local') {
        await idbDelete(track.id);
        if (player.objectUrls[track.id]) { URL.revokeObjectURL(player.objectUrls[track.id]); delete player.objectUrls[track.id]; }
    }
}
async function resolveUrl(track) {
    if (track.type === 'url') return track.url;
    if (player.objectUrls[track.id]) return player.objectUrls[track.id];
    const blob = await idbGet(track.id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    player.objectUrls[track.id] = url;
    return url;
}

// ---------------- 播放控制 ----------------
async function playTrack(track) {
    const url = await resolveUrl(track);
    if (!url) { console.warn('[music-player] 无法加载音频'); return; }
    extension_settings[extensionName].currentId = track.id;
    saveSettings();
    player.audio.src = url;
    try { await player.audio.play(); } catch (e) { /* autoplay 限制 */ }
    renderAll();
}
function togglePlay() {
    const a = player.audio;
    if (!a.src && extension_settings[extensionName].playlist.length) { playTrack(extension_settings[extensionName].playlist[0]); return; }
    if (!a.src) return;
    if (a.paused) a.play(); else a.pause();
}
function stop() {
    player.audio.pause();
    player.audio.currentTime = 0;
    player.audio.removeAttribute('src');
    player.audio.load();
    renderAll();
}
function next(direction = 1) {
    const s = extension_settings[extensionName];
    const list = s.playlist;
    if (!list.length) return;
    const idx = list.findIndex(t => t.id === s.currentId);
    if (idx === -1) { playTrack(list[s.shuffle ? Math.floor(Math.random() * list.length) : 0]); return; }
    let ni;
    if (s.shuffle) {
        if (list.length === 1) ni = 0;
        else { do { ni = Math.floor(Math.random() * list.length); } while (ni === idx); }
    } else {
        ni = idx + direction;
        if (ni < 0) {
            if (s.repeat === 'off') { player.audio.currentTime = 0; renderAll(); return; }
            ni = list.length - 1;
        } else if (ni >= list.length) {
            if (s.repeat === 'off') { stop(); return; }
            ni = 0;
        }
    }
    playTrack(list[ni]);
}
function toggleLike() {
    const track = currentTrack();
    if (!track) return;
    track.liked = !track.liked;
    saveSettings();
    renderAll();
}

// ---------------- 渲染 ----------------
function currentTrack() {
    return getTrack(extension_settings[extensionName].currentId);
}

function renderAll() {
    const s = extension_settings[extensionName];
    const panel = $('#st-music-player');
    if (!panel.length) return;
    const a = player.audio;
    const track = currentTrack();
    const playing = !!track && !a.paused && !a.ended;

    $('#st-music-player-button').toggleClass('is-playing', playing);

    panel.find('.st-mp__track').text(track ? track.name : '未在播放');
    panel.find('.st-mp__play').html(playing ? ICONS.pause : ICONS.play);
    panel.find('.st-mp__like').toggleClass('is-liked', !!(track && track.liked));
    panel.find('.st-mp__shuffle').toggleClass('is-active', s.shuffle);
    panel.find('.st-mp__repeat').toggleClass('is-active', s.repeat !== 'off').toggleClass('is-one', s.repeat === 'one');

    const vol = Math.round(a.volume * 100);
    panel.find('.st-mp__vol').val(vol);

    updateConnectionState();
    renderPlaylist();
    updateProgress();
}

function renderPlaylist() {
    const s = extension_settings[extensionName];
    const list = $('#st-music-player .st-mp__list');
    const items = s.playlist.map(t => {
        const isCur = t.id === s.currentId;
        return `<li class="st-mp__item ${isCur ? 'is-current' : ''}" data-id="${t.id}">
            <span class="st-mp__item-name">${escapeHtml(t.name)}</span>
            <span class="st-mp__item-like ${t.liked ? 'is-liked' : ''}">${ICONS.like}</span>
            <button type="button" class="st-mp__item-del" title="移除">${ICONS.close}</button>
        </li>`;
    }).join('');
    list.html(items || '<li class="st-mp__empty">列表为空，点左上角 + 添加音乐</li>');
}

function updateProgress() {
    const panel = $('#st-music-player');
    if (!panel.length) return;
    const a = player.audio;
    const dur = a.duration || 0;
    const cur = a.currentTime || 0;
    const pct = dur ? (cur / dur) * 100 : 0;
    panel.find('.st-mp__bar-fill').css('width', pct + '%');
    panel.find('.st-mp__bar-thumb').css('left', pct + '%');
    panel.find('.st-mp__cur').text(fmt(cur));
    panel.find('.st-mp__dur').text(dur ? fmt(dur) : '0:00');
}

function seekTo(e) {
    const a = player.audio;
    if (!a.duration) return;
    const bar = $('#st-music-player .st-mp__bar')[0];
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * a.duration;
    updateProgress();
}

// ---------------- 面板 / 列表显隐 ----------------
function togglePanel(force) {
    const panel = $('#st-music-player');
    const show = force === undefined ? panel.is(':hidden') : force;
    if (show) panel.removeClass('open-sheet').show();
    else panel.hide();
}
function toggleSheet(force) {
    const panel = $('#st-music-player');
    const open = force === undefined ? !panel.hasClass('open-sheet') : force;
    panel.toggleClass('open-sheet', open);
}

// ---------------- 启动恢复 ----------------
async function hydrate() {
    const s = extension_settings[extensionName];
    await Promise.all(s.playlist.map(async (t) => { if (t.type === 'local') await resolveUrl(t); }));
    if (s.currentId) {
        const track = getTrack(s.currentId);
        if (track) { const url = await resolveUrl(track); if (url) player.audio.src = url; }
    }
    await loadAvatars();
}
