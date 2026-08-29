import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const extensionName = 'music-player';

const defaultSettings = {
    volume: 0.8,
    playlist: [],   // { id, name, type: 'local' | 'url', url? }
    currentId: null,
    shuffle: false,
    repeat: 'off',  // 'off' | 'all' | 'one'
};

// ---------------- IndexedDB：存放本地音频文件，跨刷新保留 ----------------
const DB_NAME = 'st-music-player';
const DB_STORE = 'tracks';
let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
                db.createObjectStore(DB_STORE, { keyPath: 'id' });
            }
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

function saveSettings() {
    saveSettingsDebounced();
}

function uid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ---------------- 播放器状态 ----------------
const player = {
    audio: null,
    objectUrls: {},  // id -> objectURL
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
        '<div id="st-music-player-button" title="音乐播放器"><i class="fa-solid fa-music"></i></div>'
    );
    btn.appendTo('body');
    btn.on('click', () => togglePanel());
}

// ---------------- 播放器面板 ----------------
function buildPlayerPanel() {
    if ($('#st-music-player').length) return;
    const html = `
    <div id="st-music-player" class="st-mp">
      <div class="st-mp__header">
        <span class="st-mp__title"><i class="fa-solid fa-music"></i> 音乐播放器</span>
        <div class="st-mp__header-actions">
          <button type="button" class="st-mp__min" title="最小化"><i class="fa-solid fa-minus"></i></button>
          <button type="button" class="st-mp__close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      <div class="st-mp__body">
        <div class="st-mp__now">
          <div class="st-mp__cover"><i class="fa-solid fa-compact-disc"></i></div>
          <div class="st-mp__meta">
            <div class="st-mp__track">未在播放</div>
            <div class="st-mp__artist">添加音乐开始播放</div>
          </div>
        </div>
        <div class="st-mp__progress">
          <div class="st-mp__bar">
            <div class="st-mp__bar-fill"></div>
            <div class="st-mp__bar-thumb"></div>
          </div>
          <div class="st-mp__times">
            <span class="st-mp__cur">0:00</span>
            <span class="st-mp__dur">0:00</span>
          </div>
        </div>
        <div class="st-mp__controls">
          <button type="button" class="st-mp__btn st-mp__shuffle" title="随机播放"><i class="fa-solid fa-shuffle"></i></button>
          <button type="button" class="st-mp__btn st-mp__prev" title="上一首"><i class="fa-solid fa-backward-step"></i></button>
          <button type="button" class="st-mp__btn st-mp__play st-mp__btn--primary" title="播放/暂停"><i class="fa-solid fa-play"></i></button>
          <button type="button" class="st-mp__btn st-mp__next" title="下一首"><i class="fa-solid fa-forward-step"></i></button>
          <button type="button" class="st-mp__btn st-mp__repeat" title="循环模式"><i class="fa-solid fa-repeat"></i><span class="st-mp__repeat-badge">1</span></button>
        </div>
        <div class="st-mp__volume">
          <i class="fa-solid fa-volume-high st-mp__vol-icon"></i>
          <input type="range" class="st-mp__vol" min="0" max="100" value="80">
          <span class="st-mp__vol-val">80%</span>
        </div>
        <div class="st-mp__add-row" style="display:none">
          <input type="text" class="st-mp__url-input" placeholder="粘贴音频直链 (mp3/m4a/ogg…)">
          <button type="button" class="st-mp__url-add">添加</button>
        </div>
        <div class="st-mp__playlist">
          <div class="st-mp__playlist-head">
            <span>播放列表</span>
            <div class="st-mp__playlist-actions">
              <button type="button" class="st-mp__add-local" title="添加本地音乐"><i class="fa-solid fa-folder-open"></i></button>
              <button type="button" class="st-mp__add-url" title="添加音乐链接"><i class="fa-solid fa-link"></i></button>
              <button type="button" class="st-mp__clear" title="清空列表"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
          <ul class="st-mp__list"></ul>
        </div>
      </div>
      <input type="file" class="st-mp__file" accept="audio/*" multiple hidden>
    </div>`;
    $('body').append(html);
    placePanelDefault();
    initDrag();
}

function placePanelDefault() {
    const panel = $('#st-music-player');
    const w = panel.outerWidth() || 320;
    const h = panel.outerHeight() || 420;
    const left = Math.max(8, window.innerWidth - w - 16);
    const top = Math.max(8, Math.min(window.innerHeight - h - 16, 70));
    panel.css({ left: left + 'px', top: top + 'px' });
}

function initDrag() {
    const panel = $('#st-music-player');
    const header = panel.find('.st-mp__header');
    let dragging = null;

    header.on('pointerdown', (e) => {
        if ($(e.target).closest('button').length) return; // 点按钮不拖动
        dragging = {
            startX: e.clientX,
            startY: e.clientY,
            left: parseFloat(panel.css('left')) || 0,
            top: parseFloat(panel.css('top')) || 0,
        };
        header.addClass('is-dragging');
        e.preventDefault();
    });

    $(document).on('pointermove', (e) => {
        if (!dragging) return;
        const nx = dragging.left + (e.clientX - dragging.startX);
        const ny = dragging.top + (e.clientY - dragging.startY);
        const w = panel.outerWidth();
        const h = panel.outerHeight();
        const left = Math.max(0, Math.min(window.innerWidth - 40, nx));
        const top = Math.max(0, Math.min(window.innerHeight - 40, ny));
        panel.css({ left: left + 'px', top: top + 'px' });
    });

    $(document).on('pointerup', () => {
        if (!dragging) return;
        dragging = null;
        header.removeClass('is-dragging');
    });
}

// ---------------- 事件绑定 ----------------
function bindEvents() {
    const panel = $('#st-music-player');

    panel.find('.st-mp__close').on('click', () => togglePanel(false));
    panel.find('.st-mp__min').on('click', () => panel.toggleClass('is-min'));

    panel.find('.st-mp__play').on('click', () => togglePlay());
    panel.find('.st-mp__prev').on('click', () => next(-1));
    panel.find('.st-mp__next').on('click', () => next(1));

    panel.find('.st-mp__shuffle').on('click', () => {
        extension_settings[extensionName].shuffle = !extension_settings[extensionName].shuffle;
        saveSettings();
        renderAll();
    });

    panel.find('.st-mp__repeat').on('click', () => {
        const s = extension_settings[extensionName];
        s.repeat = s.repeat === 'off' ? 'all' : (s.repeat === 'all' ? 'one' : 'off');
        saveSettings();
        renderAll();
    });

    panel.find('.st-mp__vol').on('input', (e) => {
        const v = Number(e.target.value) / 100;
        player.audio.volume = v;
        extension_settings[extensionName].volume = v;
        panel.find('.st-mp__vol-val').text(e.target.value + '%');
        panel.find('.st-mp__vol-icon').attr('class', 'fa-solid ' + volIcon(v) + ' st-mp__vol-icon');
        saveSettings();
    });

    // 进度条拖动
    const bar = panel.find('.st-mp__bar');
    bar.on('pointerdown', (e) => {
        if (!player.audio.duration) return;
        seekTo(e);
        const move = (ev) => seekTo(ev);
        const up = () => {
            $(document).off('pointermove', move);
            $(document).off('pointerup', up);
        };
        $(document).on('pointermove', move);
        $(document).on('pointerup', up);
    });

    // 本地文件
    panel.find('.st-mp__file').on('change', async (e) => {
        const files = Array.from(e.target.files || []);
        for (const f of files) await addLocalFile(f);
        e.target.value = '';
        renderAll();
    });
    panel.find('.st-mp__add-local').on('click', () => panel.find('.st-mp__file').trigger('click'));

    // URL 添加
    panel.find('.st-mp__add-url').on('click', () => {
        panel.find('.st-mp__add-row').slideToggle(150);
        panel.find('.st-mp__url-input').trigger('focus');
    });
    panel.find('.st-mp__url-add').on('click', () => {
        const input = panel.find('.st-mp__url-input');
        const url = input.val().trim();
        if (url) addUrlTrack(url);
        input.val('');
        panel.find('.st-mp__add-row').slideUp(150);
        renderAll();
    });
    panel.find('.st-mp__url-input').on('keydown', (e) => {
        if (e.key === 'Enter') panel.find('.st-mp__url-add').trigger('click');
    });

    panel.find('.st-mp__clear').on('click', async () => {
        const s = extension_settings[extensionName];
        for (const t of s.playlist) await removeTrackData(t);
        s.playlist = [];
        s.currentId = null;
        stop();
        saveSettings();
        renderAll();
    });

    // 播放列表条目点击/删除（事件委托）
    panel.find('.st-mp__list').on('click', '.st-mp__item-del', (e) => {
        e.stopPropagation();
        const id = $(e.currentTarget).closest('.st-mp__item').data('id');
        removeTrack(id);
    }).on('click', '.st-mp__item', (e) => {
        if ($(e.target).closest('.st-mp__item-del').length) return;
        const id = $(e.currentTarget).data('id');
        const t = getTrack(id);
        if (t) playTrack(t);
    });

    // 音频事件
    const a = player.audio;
    a.addEventListener('timeupdate', updateProgress);
    a.addEventListener('loadedmetadata', renderAll);
    a.addEventListener('play', renderAll);
    a.addEventListener('pause', renderAll);
    a.addEventListener('ended', () => {
        const s = extension_settings[extensionName];
        if (s.repeat === 'one') {
            a.currentTime = 0;
            a.play();
        } else {
            next(1);
        }
    });
    let errorGuard = 0;
    a.addEventListener('playing', () => { errorGuard = 0; });
    a.addEventListener('error', () => {
        // 播放失败时跳到下一首；连续失败则停止，避免死循环
        errorGuard++;
        if (errorGuard > 3) { errorGuard = 0; stop(); return; }
        next(1);
    });
}

// ---------------- 播放列表操作 ----------------
function getTrack(id) {
    return extension_settings[extensionName].playlist.find(t => t.id === id) || null;
}

async function addLocalFile(file) {
    const s = extension_settings[extensionName];
    const id = uid();
    const track = { id, name: file.name.replace(/\.[^.]+$/, ''), type: 'local' };
    await idbPut(id, file);
    s.playlist.push(track);
    saveSettings();
}

function addUrlTrack(url) {
    const s = extension_settings[extensionName];
    let name = url.split('/').pop().split('?')[0];
    try { name = decodeURIComponent(name); } catch (e) { /* ignore */ }
    if (!name) name = url;
    s.playlist.push({ id: uid(), name, type: 'url', url });
    saveSettings();
}

async function removeTrack(id) {
    const s = extension_settings[extensionName];
    const track = getTrack(id);
    if (!track) return;
    await removeTrackData(track);
    s.playlist = s.playlist.filter(t => t.id !== id);
    if (s.currentId === id) {
        s.currentId = null;
        stop();
    }
    saveSettings();
    renderAll();
}

async function removeTrackData(track) {
    if (track.type === 'local') {
        await idbDelete(track.id);
        if (player.objectUrls[track.id]) {
            URL.revokeObjectURL(player.objectUrls[track.id]);
            delete player.objectUrls[track.id];
        }
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
    if (!url) {
        toastr && toastr.warning('无法加载音频文件');
        return;
    }
    extension_settings[extensionName].currentId = track.id;
    saveSettings();
    player.audio.src = url;
    try {
        await player.audio.play();
    } catch (e) { /* autoplay 限制，等待用户交互 */ }
    renderAll();
}

function togglePlay() {
    const a = player.audio;
    if (!a.src && extension_settings[extensionName].playlist.length) {
        const first = extension_settings[extensionName].playlist[0];
        playTrack(first);
        return;
    }
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

    if (idx === -1) {
        const ni = s.shuffle ? Math.floor(Math.random() * list.length) : 0;
        playTrack(list[ni]);
        return;
    }

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

// ---------------- 渲染 ----------------
function currentTrack() {
    const s = extension_settings[extensionName];
    return getTrack(s.currentId);
}

function renderAll() {
    const s = extension_settings[extensionName];
    const panel = $('#st-music-player');
    if (!panel.length) return;
    const a = player.audio;
    const track = currentTrack();
    const playing = !!track && !a.paused && !a.ended;

    // 顶部按钮状态
    $('#st-music-player-button').toggleClass('is-playing', playing);

    // 封面与标题
    panel.find('.st-mp__cover').toggleClass('is-spinning', playing);
    panel.find('.st-mp__track').text(track ? track.name : '未在播放');
    panel.find('.st-mp__artist').text(track ? (track.type === 'url' ? '网络音乐' : '本地音乐') : '添加音乐开始播放');

    // 播放按钮图标
    panel.find('.st-mp__play i').attr('class', 'fa-solid ' + (playing ? 'fa-pause' : 'fa-play'));

    // 随机 / 循环状态
    panel.find('.st-mp__shuffle').toggleClass('is-active', s.shuffle);
    const repBtn = panel.find('.st-mp__repeat');
    repBtn.toggleClass('is-active', s.repeat !== 'off');
    repBtn.toggleClass('is-one', s.repeat === 'one');
    repBtn.attr('title', { off: '循环：关', all: '循环：列表', one: '循环：单曲' }[s.repeat]);
    repBtn.find('i').attr('class', 'fa-solid fa-repeat');
    repBtn.find('.st-mp__repeat-badge').toggle(s.repeat === 'one');

    // 音量
    const vol = Math.round(a.volume * 100);
    panel.find('.st-mp__vol').val(vol);
    panel.find('.st-mp__vol-val').text(vol + '%');
    panel.find('.st-mp__vol-icon').attr('class', 'fa-solid ' + volIcon(a.volume) + ' st-mp__vol-icon');

    // 播放列表
    renderPlaylist();
    updateProgress();
}

function renderPlaylist() {
    const s = extension_settings[extensionName];
    const list = $('#st-music-player .st-mp__list');
    const items = s.playlist.map(t => {
        const isCur = t.id === s.currentId;
        const icon = t.type === 'url' ? 'fa-link' : 'fa-file-audio';
        return `<li class="st-mp__item ${isCur ? 'is-current' : ''}" data-id="${t.id}" title="${escapeHtml(t.name)}">
            <i class="fa-solid ${icon} st-mp__item-icon"></i>
            <span class="st-mp__item-name">${escapeHtml(t.name)}</span>
            <button type="button" class="st-mp__item-del" title="移除"><i class="fa-solid fa-xmark"></i></button>
        </li>`;
    }).join('');
    list.html(items || '<li class="st-mp__empty">列表为空，添加音乐吧</li>');
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

function volIcon(v) {
    if (v <= 0) return 'fa-volume-xmark';
    if (v < 0.5) return 'fa-volume-low';
    return 'fa-volume-high';
}

// ---------------- 面板显隐 ----------------
function togglePanel(force) {
    const panel = $('#st-music-player');
    const show = force === undefined ? panel.is(':hidden') : force;
    if (show) {
        panel.removeClass('is-min').show();
    } else {
        panel.hide();
    }
}

// ---------------- 启动时恢复本地音频 URL ----------------
async function hydrate() {
    const s = extension_settings[extensionName];
    await Promise.all(s.playlist.map(async (t) => {
        if (t.type === 'local') await resolveUrl(t);
    }));
    // 恢复当前曲目（不自动播放，等待用户点击）
    if (s.currentId) {
        const track = getTrack(s.currentId);
        if (track) {
            const url = await resolveUrl(track);
            if (url) {
                player.audio.src = url;
            }
        }
    }
}
