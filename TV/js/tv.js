/**
 * Solara TV — 电视遥控器优化版音乐播放器
 *
 * 控制区两排五等分：
 *   Row0: [📥列表] [📡网易云] [🔁循环] [📋视图] [🔎搜索]
 *   Row1: [⏪]  [⏮]  [▶️]   [⏭]   [⏩]
 */
document.addEventListener('DOMContentLoaded', () => {

    // ===================== 常量 =====================
    const API_BASE = 'https://music-api.gdstudio.xyz/api.php';
    const PAGE_SIZE = 30;

    const SOURCES = [
        { id: 'netease',  name: '网易云' },
        { id: 'joox',     name: 'JOOX' },
        { id: 'bilibili', name: 'B站' }
    ];

    const PLAY_MODES = [
        { id: 'loop',     icon: '🔁', desc: '列表循环', short: '循环' },
        { id: 'single',   icon: '🔂', desc: '单曲循环', short: '单曲' },
        { id: 'random',   icon: '🔀', desc: '随机播放', short: '随机' },
        { id: 'sequence', icon: '⏬', desc: '顺序播放', short: '顺序' }
    ];

    // ===================== 状态 =====================
    let currentSourceIdx = 0;
    let currentModeIdx   = 0;
    let currentView      = 'playlist';
    let searchResults     = [];
    let playlist          = [];
    try { playlist = JSON.parse(localStorage.getItem('tv_playlist') || '[]'); } catch (e) { playlist = []; }
    let currentPlayIdx    = -1;
    let parsedLyrics      = [];
    let isSearching       = false;

    let searchKeyword     = '';
    let searchPage        = 1;
    let hasMorePages      = false;

    let modalOpen         = false;
    let pendingSong       = null;

    let kbOpen            = false;
    let kbRow             = 1;
    let kbCol             = 0;
    let kbReturnEl        = null;

    let currentZone       = 'ctrl';
    let lastIndex         = { ctrl: 0, list: 0 };
    let prevZone          = 'ctrl';

    // ===================== DOM =====================
    const searchInput     = document.getElementById('search-input');
    const btnSearch       = document.getElementById('btn-search');
    const btnSource       = document.getElementById('btn-source');
    const btnMode         = document.getElementById('btn-mode');
    const btnPlay         = document.getElementById('btn-play');
    const btnPrev         = document.getElementById('btn-prev');
    const btnNext         = document.getElementById('btn-next');
    const btnRewind       = document.getElementById('btn-rewind');
    const btnForward      = document.getElementById('btn-forward');
    const btnGoList       = document.getElementById('btn-go-list');
    const btnView         = document.getElementById('btn-view');
    const btnPrevPage     = document.getElementById('btn-prev-page');
    const btnNextPage     = document.getElementById('btn-next-page');
    const pageInfo        = document.getElementById('page-info');
    const pagination      = document.getElementById('pagination');
    const progressFill    = document.getElementById('progress-fill');
    const timeCurrent     = document.getElementById('progress-time-current');
    const timeTotal       = document.getElementById('progress-time-total');
    const lyricsContent   = document.getElementById('lyrics-content');
    const lyricsScroll    = document.getElementById('lyrics-scroll');
    const lyricsTitle     = document.getElementById('lyrics-title');
    const albumCover      = document.getElementById('album-cover');
    const bgBlur          = document.getElementById('bg-blur');
    const toastEl         = document.getElementById('toast');
    const songListEl      = document.getElementById('song-list');
    const listScroll      = document.getElementById('list-scroll');
    const loadingEl       = document.getElementById('loading');
    const audio           = document.getElementById('audio-player');

    const actionModal     = document.getElementById('action-modal');
    const modalSongName   = document.getElementById('modal-song-name');
    const modalPlay       = document.getElementById('modal-play');
    const modalAdd        = document.getElementById('modal-add');
    const modalCancel     = document.getElementById('modal-cancel');

    const btnKb           = document.getElementById('btn-kb');
    const kbOverlay       = document.getElementById('kb-overlay');
    const kbQuery         = document.getElementById('kb-query');
    const kbGrid          = document.getElementById('kb-grid');

    // ===================== Toast =====================
    let toastTimer;
    function showToast(msg, ok) {
        toastEl.innerText = msg;
        toastEl.className = 'toast show' + (ok ? ' success' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
    }

    // ===================== 工具 =====================
    function fmt(s) {
        if (!s || isNaN(s)) return '00:00';
        return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(Math.floor(s%60)).padStart(2,'0');
    }
    function savePlaylist() {
        try { localStorage.setItem('tv_playlist', JSON.stringify(playlist)); } catch(e) {}
    }
    function esc(str) {
        const d = document.createElement('div');
        d.appendChild(document.createTextNode(str));
        return d.innerHTML;
    }
    function artistStr(song) {
        return Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '未知歌手');
    }

    // ===================== 导航系统 =====================

    const ctrlGrid = [
        ['btn-go-list', 'btn-source', 'btn-mode',   'btn-view',   'btn-search'],
        ['btn-rewind',  'btn-prev',   'btn-play',   'btn-next',   'btn-forward']
    ];
    const ROWS = ctrlGrid.length;
    const COLS = ctrlGrid[0].length;

    let ctrlRow = 1, ctrlCol = 2;

    function getCtrlEl(r, c) {
        return (ctrlGrid[r] && ctrlGrid[r][c]) ? document.getElementById(ctrlGrid[r][c]) : null;
    }

    function focusCtrl() {
        const el = getCtrlEl(ctrlRow, ctrlCol);
        if (el) el.focus();
    }

    function ctrlNav(dir) {
        if (dir === 'left') {
            if (ctrlCol > 0) { ctrlCol--; focusCtrl(); }
        }
        else if (dir === 'right') {
            if (ctrlCol < COLS - 1) { ctrlCol++; focusCtrl(); }
        }
        else if (dir === 'up') {
            if (ctrlRow > 0) { ctrlRow--; focusCtrl(); }
        }
        else if (dir === 'down') {
            if (ctrlRow < ROWS - 1) { ctrlRow++; focusCtrl(); }
        }
    }

    function getListItems() {
        return Array.from(document.querySelectorAll('.tv-focusable[data-zone="list"]'));
    }

    function focusListItem(idx) {
        const items = getListItems();
        if (items.length === 0) return;
        const i = Math.max(0, Math.min(idx, items.length - 1));
        items[i].focus({ preventScroll: false });
        lastIndex.list = i;
        if (items[i] !== searchInput) {
            items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function focusFirstSong() {
        const songs = songListEl.querySelectorAll('.song-item.tv-focusable');
        if (songs.length > 0) {
            songs[0].focus();
            songs[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            currentZone = 'list';
            const all = getListItems();
            const idx = all.indexOf(songs[0]);
            lastIndex.list = idx >= 0 ? idx : 0;
        } else {
            searchInput.focus();
            currentZone = 'list';
            lastIndex.list = 0;
        }
    }

    function getModalItems() {
        return Array.from(document.querySelectorAll('.tv-focusable[data-zone="modal"]'));
    }

    // 焦点即状态：焦点实际落到哪个元素，导航状态就同步到哪里，
    // 避免遥控、鼠标、系统输入法各自移动焦点后 currentZone 与真实焦点错位
    document.addEventListener('focusin', (e) => {
        const el = e.target;
        if (!el || !el.dataset) return;
        const z = el.dataset.zone;
        if (!z) return;
        currentZone = z;
        if (z === 'list') {
            const items = getListItems();
            const i = items.indexOf(el);
            if (i >= 0) lastIndex.list = i;
        } else if (z === 'ctrl') {
            for (let r = 0; r < ROWS; r++)
                for (let c = 0; c < COLS; c++)
                    if (ctrlGrid[r][c] === el.id) { ctrlRow = r; ctrlCol = c; }
        } else if (z === 'kb' && el.dataset.kb) {
            const p = el.dataset.kb.split(',');
            kbRow = +p[0]; kbCol = +p[1];
        }
    });

    // ===================== 弹窗 =====================
    function openModal(song) {
        pendingSong = song;
        modalSongName.innerText = song.name || '未知歌曲';
        actionModal.style.display = 'flex';
        modalOpen = true;
        prevZone = currentZone;
        currentZone = 'modal';
        setTimeout(() => modalPlay.focus(), 50);
    }

    function closeModal() {
        actionModal.style.display = 'none';
        modalOpen = false;
        pendingSong = null;
        currentZone = prevZone;
        if (currentZone === 'list') focusListItem(lastIndex.list);
        else focusCtrl();
    }

    modalPlay.addEventListener('click', () => {
        if (!pendingSong) return;
        const song = pendingSong;
        const exists = playlist.findIndex(s => s.id === song.id && s.source === song.source);
        if (exists >= 0) {
            currentPlayIdx = exists;
        } else {
            playlist.push(song);
            savePlaylist();
            currentPlayIdx = playlist.length - 1;
        }
        playSong(currentPlayIdx);
        showToast('正在播放: ' + (song.name || ''), true);
        closeModal();
    });

    modalAdd.addEventListener('click', () => {
        if (!pendingSong) return;
        const song = pendingSong;
        const exists = playlist.some(s => s.id === song.id && s.source === song.source);
        if (exists) {
            showToast('该歌曲已在列表中');
        } else {
            playlist.push(song);
            savePlaylist();
            showToast('已添加: ' + (song.name || ''), true);
        }
        closeModal();
    });

    modalCancel.addEventListener('click', closeModal);

    // ===================== 内置遥控键盘 =====================
    // 电视系统不弹输入法时的兜底：方向键选字，OK 输入
    const KB_ROWS = [
        ['1','2','3','4','5','6','7','8','9','0'],
        ['q','w','e','r','t','y','u','i','o','p'],
        ['a','s','d','f','g','h','j','k','l'],
        ['z','x','c','v','b','n','m']
    ];
    const KB_ACTIONS = [
        { label: '空格', act: 'space' },
        { label: '⌫ 删除', act: 'del' },
        { label: '清空', act: 'clear' },
        { label: '🔍 搜索', act: 'search' },
        { label: '✕ 关闭', act: 'close' }
    ];
    let kbKeys = [];

    function buildKeyboard() {
        kbGrid.innerHTML = '';
        kbKeys = [];
        KB_ROWS.forEach((row, r) => {
            const div = document.createElement('div');
            div.className = 'kb-row';
            const els = [];
            row.forEach((ch, c) => {
                const k = document.createElement('div');
                k.className = 'kb-key tv-focusable';
                k.tabIndex = 0;
                k.dataset.zone = 'kb';
                k.dataset.kb = r + ',' + c;
                k.innerText = ch;
                k.addEventListener('click', () => { kbRow = r; kbCol = c; kbTypeChar(ch); });
                div.appendChild(k);
                els.push(k);
            });
            kbGrid.appendChild(div);
            kbKeys.push(els);
        });
        const div = document.createElement('div');
        div.className = 'kb-row';
        const els = [];
        const r = KB_ROWS.length;
        KB_ACTIONS.forEach((a, c) => {
            const k = document.createElement('div');
            k.className = 'kb-key act tv-focusable';
            k.tabIndex = 0;
            k.dataset.zone = 'kb';
            k.dataset.kb = r + ',' + c;
            k.innerText = a.label;
            k.addEventListener('click', () => { kbRow = r; kbCol = c; kbDoAction(a.act); });
            div.appendChild(k);
            els.push(k);
        });
        kbGrid.appendChild(div);
        kbKeys.push(els);
    }

    function syncKbQuery() {
        const v = searchInput.value;
        kbQuery.innerText = v || '输入歌名 / 歌手…';
        kbQuery.classList.toggle('placeholder', !v);
    }
    function kbTypeChar(ch) {
        searchInput.value += ch;
        syncKbQuery();
    }
    function kbDoAction(act) {
        if (act === 'space') kbTypeChar(' ');
        else if (act === 'del') { searchInput.value = searchInput.value.slice(0, -1); syncKbQuery(); }
        else if (act === 'clear') { searchInput.value = ''; syncKbQuery(); }
        else if (act === 'close') closeKeyboard();
        else if (act === 'search') {
            const v = searchInput.value.trim();
            closeKeyboard(true);
            if (v) doSearch(v, 1, false);
            else showToast('请先输入关键词');
        }
    }
    function kbFocus() {
        const row = kbKeys[kbRow];
        if (row && row[kbCol]) row[kbCol].focus();
    }
    function kbNav(dir) {
        if (dir === 'left')  kbCol = Math.max(0, kbCol - 1);
        if (dir === 'right') kbCol = Math.min(kbKeys[kbRow].length - 1, kbCol + 1);
        if (dir === 'up')    kbRow = Math.max(0, kbRow - 1);
        if (dir === 'down')  kbRow = Math.min(kbKeys.length - 1, kbRow + 1);
        kbCol = Math.min(kbCol, kbKeys[kbRow].length - 1);
        kbFocus();
    }
    function openKeyboard() {
        kbReturnEl = document.activeElement;
        kbOpen = true;
        kbOverlay.style.display = 'flex';
        currentZone = 'kb';
        syncKbQuery();
        kbRow = 1; kbCol = 0;
        setTimeout(kbFocus, 50);
    }
    function closeKeyboard(skipRestore) {
        kbOpen = false;
        kbOverlay.style.display = 'none';
        currentZone = 'list';
        if (!skipRestore) {
            const back = (kbReturnEl && document.contains(kbReturnEl)) ? kbReturnEl : btnKb;
            if (back) back.focus();
        }
    }
    btnKb.addEventListener('click', openKeyboard);

    // ===================== 键盘事件（遥控器） =====================
    // 兼容三类信号：标准 e.key、传统 keyCode、厂商私有返回码（LG 461 / 三星 10009）
    const BACK_KEYCODES = new Set([27, 461, 10009]);
    function isBackEvent(e) {
        return e.key === 'Escape' || e.key === 'BrowserBack' || e.key === 'GoBack' ||
               BACK_KEYCODES.has(e.keyCode);
    }

    document.addEventListener('keydown', (e) => {
        const key = e.keyCode;
        const kname = e.key || '';
        const ae  = document.activeElement;
        const isInput = (ae === searchInput);

        // 媒体键：任何区域都直接控制播放
        if (kname === 'MediaPlayPause' || key === 179) { e.preventDefault(); togglePlay(); return; }
        if (kname === 'MediaTrackNext' || key === 176) { e.preventDefault(); playNext(); return; }
        if (kname === 'MediaTrackPrevious' || key === 177) { e.preventDefault(); playPrev(); return; }
        if (kname === 'MediaFastForward' || key === 228) {
            e.preventDefault();
            if (audio.src && !isNaN(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
            return;
        }
        if (kname === 'MediaRewind' || key === 227) {
            e.preventDefault();
            if (audio.src) audio.currentTime = Math.max(0, audio.currentTime - 10);
            return;
        }

        // 遥控键盘层
        if (kbOpen) {
            if ([37, 38, 39, 40, 13].includes(key)) e.preventDefault();
            if (isBackEvent(e)) { e.preventDefault(); closeKeyboard(); return; }
            if (key === 8) { e.preventDefault(); kbDoAction('del'); return; }
            switch (key) {
                case 37: kbNav('left'); return;
                case 39: kbNav('right'); return;
                case 38: kbNav('up'); return;
                case 40: kbNav('down'); return;
                case 13: { const row = kbKeys[kbRow]; if (row && row[kbCol]) row[kbCol].click(); return; }
            }
            if (kname.length === 1 && !e.ctrlKey && !e.metaKey) kbTypeChar(kname);
            return;
        }

        // 弹窗模式
        if (modalOpen) {
            if ([37, 38, 39, 40, 13].includes(key)) e.preventDefault();
            if (isBackEvent(e) || (key === 8 && !isInput)) { e.preventDefault(); closeModal(); return; }
            const mItems = getModalItems();
            let mi = mItems.indexOf(ae);
            if (mi === -1) mi = 0;
            if (key === 38 && mi > 0) mItems[mi - 1].focus();
            else if (key === 40 && mi < mItems.length - 1) mItems[mi + 1].focus();
            else if (key === 13 && ae) ae.click();
            return;
        }

        // 空格 = 播放/暂停
        if (key === 32 && !isInput) { e.preventDefault(); togglePlay(); return; }

        // 返回键：输入框 → 回控制区；列表区 → 回控制区；控制区 → 不动作（防误退）
        if (isBackEvent(e)) {
            e.preventDefault();
            if (isInput) {
                searchInput.blur();
                currentZone = 'ctrl'; ctrlRow = 0; ctrlCol = 4;
                focusCtrl();
            } else if (currentZone === 'list') {
                currentZone = 'ctrl'; ctrlRow = 1; ctrlCol = 2;
                focusCtrl();
            }
            return;
        }
        if (key === 8 && !isInput) {
            // Backspace 在非输入场景充当返回
            e.preventDefault();
            if (currentZone === 'list') {
                currentZone = 'ctrl'; ctrlRow = 1; ctrlCol = 2;
                focusCtrl();
            }
            return;
        }

        // 输入框
        if (isInput) {
            if (key === 13) {
                e.preventDefault();
                const kw = searchInput.value.trim();
                if (kw) { searchInput.blur(); doSearch(kw, 1, false); }
                return;
            }
            if (key === 40) {
                e.preventDefault();
                currentZone = 'list';
                const songs = songListEl.querySelectorAll('.song-item.tv-focusable');
                if (songs.length > 0) {
                    songs[0].focus();
                    const all = getListItems();
                    lastIndex.list = all.indexOf(songs[0]);
                }
                return;
            }
            if (key === 37 && searchInput.selectionStart === 0) {
                e.preventDefault();
                lastIndex.list = 0;
                currentZone = 'ctrl';
                ctrlRow = 0; ctrlCol = 4;
                focusCtrl();
                return;
            }
            return;
        }

        if ([37, 38, 39, 40, 13].includes(key)) e.preventDefault();

        // Ctrl 区域
        if (currentZone === 'ctrl') {
            switch (key) {
                case 37: ctrlNav('left'); break;
                case 39:
                    if (ctrlCol === COLS - 1) {
                        currentZone = 'list';
                        searchInput.focus();
                        lastIndex.list = 0;
                    } else {
                        ctrlNav('right');
                    }
                    break;
                case 38: ctrlNav('up'); break;
                case 40: ctrlNav('down'); break;
                case 13: if (ae) ae.click(); break;
            }
            return;
        }

        // List 区域
        if (currentZone === 'list') {
            const items = getListItems();
            let ci = items.indexOf(ae);
            if (ci === -1) ci = 0;

            // 翻页键 / 频道键：一次跳 10 项
            if (key === 34 || kname === 'PageDown' || kname === 'ChannelDown') {
                e.preventDefault();
                focusListItem(ci + 10);
                return;
            }
            if (key === 33 || kname === 'PageUp' || kname === 'ChannelUp') {
                e.preventDefault();
                focusListItem(ci - 10);
                return;
            }

            switch (key) {
                case 38:
                    if (ci > 0) {
                        let t = ci - 1;
                        if (items[t] && items[t].classList.contains('del-btn')) t--;
                        if (t >= 0) {
                            items[t].focus();
                            lastIndex.list = t;
                            if (items[t] !== searchInput) {
                                items[t].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                            }
                        }
                    }
                    break;
                case 40:
                    if (ci < items.length - 1) {
                        let t = ci + 1;
                        if (items[t] && items[t].classList.contains('del-btn')) t++;
                        if (t < items.length) {
                            items[t].focus();
                            lastIndex.list = t;
                            items[t].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                    }
                    break;
                case 37:
                    if (ae && ae.classList.contains('page-btn')) {
                        if (ci > 0 && items[ci - 1].classList.contains('page-btn')) {
                            items[ci - 1].focus();
                            lastIndex.list = ci - 1;
                        }
                    } else if (ae && ae.classList.contains('del-btn')) {
                        if (ci > 0) { items[ci - 1].focus(); lastIndex.list = ci - 1; }
                    } else {
                        lastIndex.list = ci;
                        currentZone = 'ctrl';
                        if (ae === searchInput) { ctrlRow = 0; ctrlCol = 4; }
                        else { ctrlRow = 1; ctrlCol = 2; }
                        focusCtrl();
                    }
                    break;
                case 39:
                    if (ae && ae.classList.contains('page-btn')) {
                        if (items[ci + 1] && items[ci + 1].classList.contains('page-btn')) {
                            items[ci + 1].focus();
                            lastIndex.list = ci + 1;
                        }
                    } else if (ae && ae.classList.contains('song-item') &&
                        items[ci + 1] && items[ci + 1].classList.contains('del-btn')) {
                        items[ci + 1].focus();
                        lastIndex.list = ci + 1;
                    }
                    break;
                case 13:
                    if (ae) ae.click();
                    break;
            }
            return;
        }
    });

    // ===================== 按钮事件 =====================

    // 搜索
    btnSearch.addEventListener('click', () => {
        const kw = searchInput.value.trim();
        if (kw) {
            doSearch(kw, 1, false);
        } else {
            // 没输入时直接打开内置遥控键盘，不依赖电视系统输入法
            openKeyboard();
        }
    });

    // 音源（显示当前源名称）
    btnSource.addEventListener('click', () => {
        currentSourceIdx = (currentSourceIdx + 1) % SOURCES.length;
        const s = SOURCES[currentSourceIdx];
        btnSource.querySelector('.c-text').innerText = s.name;
        showToast('音源: ' + s.name, true);
    });

    // 模式
    btnMode.addEventListener('click', () => {
        currentModeIdx = (currentModeIdx + 1) % PLAY_MODES.length;
        const m = PLAY_MODES[currentModeIdx];
        btnMode.querySelector('.c-icon').innerText = m.icon;
        showToast('模式: ' + m.desc, true);
    });

    // 播放/暂停
    btnPlay.addEventListener('click', togglePlay);
    function togglePlay() {
        if (audio.src) {
            if (audio.paused) { audio.play(); btnPlay.querySelector('.c-icon').innerText = '⏸'; }
            else              { audio.pause(); btnPlay.querySelector('.c-icon').innerText = '▶️'; }
        } else if (playlist.length > 0) {
            playSong(0);
        } else {
            showToast('没有可播放的歌曲');
        }
    }

    btnPrev.addEventListener('click', playPrev);
    btnNext.addEventListener('click', playNext);

    btnRewind.addEventListener('click', () => {
        if (audio.src && !isNaN(audio.duration)) {
            audio.currentTime = Math.max(0, audio.currentTime - 10);
            showToast('快退 10s', true);
        }
    });
    btnForward.addEventListener('click', () => {
        if (audio.src && !isNaN(audio.duration)) {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
            showToast('快进 10s', true);
        }
    });

    btnGoList.addEventListener('click', () => {
        focusFirstSong();
    });

    // 视图切换（📋 播放列表 / 📂 搜索结果）
    btnView.addEventListener('click', () => {
        currentView = currentView === 'search' ? 'playlist' : 'search';
        updateViewIcon();
        renderCurrentView();
        showToast(currentView === 'search' ? '搜索结果' : '播放列表 (' + playlist.length + ')', true);
    });

    function updateViewIcon() {
        btnView.querySelector('.c-icon').innerText = currentView === 'playlist' ? '📋' : '📂';
    }

    btnPrevPage.addEventListener('click', () => {
        if (searchPage > 1 && searchKeyword) doSearch(searchKeyword, searchPage - 1, false);
    });
    btnNextPage.addEventListener('click', () => {
        if (hasMorePages && searchKeyword) doSearch(searchKeyword, searchPage + 1, false);
    });

    // ===================== 音频事件 =====================
    audio.addEventListener('timeupdate', () => {
        if (isNaN(audio.duration)) return;
        progressFill.style.width = (audio.currentTime / audio.duration * 100) + '%';
        timeCurrent.innerText = fmt(audio.currentTime);
        timeTotal.innerText   = fmt(audio.duration);
        updateLyricsHighlight(audio.currentTime);
    });
    audio.addEventListener('ended', playNext);
    audio.addEventListener('error', () => {
        showToast('播放出错，跳下一首');
        setTimeout(playNext, 1000);
    });

    // ===================== 搜索 =====================
    async function doSearch(keyword, page, append) {
        if (isSearching) return;
        isSearching = true;
        searchKeyword = keyword;
        searchPage = page;

        loadingEl.style.display = 'block';
        if (!append) songListEl.innerHTML = '';

        currentView = 'search';
        updateViewIcon();

        const source = SOURCES[currentSourceIdx].id;

        try {
            const url = `${API_BASE}?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=${PAGE_SIZE}&pages=${page}`;
            const res = await fetch(url);
            const data = await res.json();
            const songs = Array.isArray(data) ? data : (data.data || data.result || []);

            if (songs && songs.length > 0) {
                searchResults = songs.map(s => ({ ...s, target_source: source }));
                hasMorePages = songs.length >= PAGE_SIZE;
                renderCurrentView();
                showToast(`第 ${page} 页 · ${songs.length} 首`, true);
                setTimeout(() => focusFirstSong(), 100);
            } else {
                searchResults = [];
                hasMorePages = false;
                renderCurrentView();
                showToast('未找到歌曲，试试切换音源');
            }
        } catch (err) {
            console.error(err);
            showToast('搜索失败：网络错误');
        } finally {
            loadingEl.style.display = 'none';
            isSearching = false;
        }
    }

    // ===================== 渲染列表 =====================
    function renderCurrentView() {
        // 列表重建会销毁当前焦点元素：先记下焦点在列表中的位置，重建后恢复，
        // 否则点播/删歌后遥控焦点会直接丢失
        const ae = document.activeElement;
        const fi = getListItems().indexOf(ae);
        if (currentView === 'search') renderSearchResults();
        else renderPlaylist();
        if (fi >= 0 && currentZone === 'list' && !modalOpen && !kbOpen) {
            const after = getListItems();
            if (after.length) focusListItem(Math.min(fi, after.length - 1));
        }
    }

    function renderSearchResults() {
        songListEl.innerHTML = '';
        if (searchResults.length === 0) {
            songListEl.innerHTML = '<div class="empty-tip"><span class="e-icon">🔍</span>暂无搜索结果<br>输入关键词开始搜索</div>';
            pagination.style.display = 'none';
            return;
        }

        searchResults.forEach((song, i) => {
            const row = document.createElement('div');
            row.className = 'list-row';

            const item = document.createElement('div');
            item.className = 'song-item tv-focusable';
            item.tabIndex = 0;
            item.dataset.zone = 'list';

            const artist = artistStr(song);
            const album = song.album || '';
            const globalIdx = (searchPage - 1) * PAGE_SIZE + i + 1;

            item.innerHTML =
                '<span class="s-idx">' + globalIdx + '</span>' +
                '<div class="s-info">' +
                    '<div class="s-name">' + esc(song.name || '未知歌曲') + '</div>' +
                    '<div class="s-detail">' + esc(artist) + (album ? ' · ' + esc(album) : '') + '</div>' +
                '</div>';

            item.addEventListener('click', () => openModal(song));
            row.appendChild(item);
            songListEl.appendChild(row);
        });

        pagination.style.display = 'flex';
        pageInfo.innerText = '第 ' + searchPage + ' 页';
        btnPrevPage.classList.toggle('disabled', searchPage <= 1);
        btnNextPage.classList.toggle('disabled', !hasMorePages);
    }

    function renderPlaylist() {
        songListEl.innerHTML = '';
        pagination.style.display = 'none';

        if (playlist.length === 0) {
            songListEl.innerHTML = '<div class="empty-tip"><span class="e-icon">📋</span>播放列表为空<br>搜索歌曲添加</div>';
            return;
        }

        playlist.forEach((song, i) => {
            const row = document.createElement('div');
            row.className = 'list-row';

            const item = document.createElement('div');
            item.className = 'song-item tv-focusable';
            item.tabIndex = 0;
            item.dataset.zone = 'list';
            if (i === currentPlayIdx) item.classList.add('playing');

            const artist = artistStr(song);
            const album = song.album || '';

            item.innerHTML =
                '<span class="s-idx">' + (i + 1) + '</span>' +
                '<div class="s-info">' +
                    '<div class="s-name">' + esc(song.name || '未知歌曲') + '</div>' +
                    '<div class="s-detail">' + esc(artist) + (album ? ' · ' + esc(album) : '') + '</div>' +
                '</div>';

            item.addEventListener('click', () => playSong(i));
            row.appendChild(item);

            const del = document.createElement('div');
            del.className = 'del-btn tv-focusable';
            del.tabIndex = 0;
            del.dataset.zone = 'list';
            del.innerHTML = '✕';
            del.title = '移除';
            del.addEventListener('click', (ev) => {
                ev.stopPropagation();
                playlist.splice(i, 1);
                savePlaylist();
                showToast('已移除', true);
                if (currentPlayIdx === i) {
                    audio.pause(); audio.src = '';
                    btnPlay.querySelector('.c-icon').innerText = '▶️';
                    if (playlist.length > 0) {
                        currentPlayIdx = Math.min(i, playlist.length - 1);
                        playSong(currentPlayIdx);
                    } else {
                        currentPlayIdx = -1;
                        resetUI();
                    }
                } else if (currentPlayIdx > i) {
                    currentPlayIdx--;
                }
                renderCurrentView();
            });
            row.appendChild(del);

            songListEl.appendChild(row);
        });
    }

    function resetUI() {
        document.getElementById('song-title').innerText = 'Solara TV';
        document.getElementById('song-artist').innerText = '准备播放';
        lyricsContent.innerHTML = '<div class="lyrics-placeholder">等待播放...</div>';
        lyricsTitle.innerText = '歌词';
        progressFill.style.width = '0%';
        timeCurrent.innerText = '00:00';
        timeTotal.innerText = '00:00';
        albumCover.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect fill='%231a1a2e' width='400' height='400'/%3E%3Ctext x='200' y='200' text-anchor='middle' dominant-baseline='central' font-size='80' fill='%23444'%3E🎵%3C/text%3E%3C/svg%3E";
        bgBlur.style.backgroundImage = '';
    }

    // ===================== 播放引擎 =====================
    async function playSong(index) {
        if (index < 0 || index >= playlist.length) return;
        currentPlayIdx = index;
        const song = playlist[index];
        const artist = artistStr(song);

        document.getElementById('song-title').innerText = song.name || '未知歌曲';
        document.getElementById('song-artist').innerText = artist;
        lyricsContent.innerHTML = '<div class="lyrics-placeholder">加载中...</div>';
        lyricsTitle.innerText = song.name || '歌词';
        parsedLyrics = [];

        if (currentView === 'playlist') renderCurrentView();

        const source = song.target_source || song.source || 'netease';

        try {
            const urlRes = await fetch(`${API_BASE}?types=url&source=${source}&id=${song.id}&br=320`);
            const urlData = await urlRes.json();

            if (urlData && urlData.url) {
                audio.src = urlData.url.replace(/^http:\/\//i, 'https://');
                audio.play();
                btnPlay.querySelector('.c-icon').innerText = '⏸';
            } else {
                showToast((song.name || '') + ' 无法播放，跳过');
                setTimeout(playNext, 500);
                return;
            }

            if (song.pic_id) {
                fetch(`${API_BASE}?types=pic&source=${source}&id=${song.pic_id}&size=500`)
                    .then(r => r.json())
                    .then(d => {
                        if (d && d.url) {
                            const u = d.url.replace(/^http:\/\//i, 'https://');
                            albumCover.src = u;
                            bgBlur.style.backgroundImage = 'url(' + u + ')';
                        }
                    }).catch(() => {});
            }

            if (song.lyric_id) {
                fetch(`${API_BASE}?types=lyric&source=${source}&id=${song.lyric_id}`)
                    .then(r => r.json())
                    .then(d => {
                        if (d && d.lyric) {
                            parsedLyrics = parseLRC(d.lyric);
                            if (parsedLyrics.length > 0) {
                                renderLyrics(parsedLyrics);
                            } else {
                                const clean = d.lyric.replace(/\[[^\]]*\]/g, '').trim();
                                lyricsContent.innerHTML = '<div class="lyrics-placeholder">' + (clean || '纯音乐，请欣赏') + '</div>';
                            }
                        } else {
                            lyricsContent.innerHTML = '<div class="lyrics-placeholder">暂无歌词</div>';
                        }
                    }).catch(() => {
                        lyricsContent.innerHTML = '<div class="lyrics-placeholder">歌词加载失败</div>';
                    });
            } else {
                lyricsContent.innerHTML = '<div class="lyrics-placeholder">暂无歌词</div>';
            }

            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: song.name || '', artist: artist, album: song.album || ''
                });
                navigator.mediaSession.setActionHandler('play', () => { audio.play(); btnPlay.querySelector('.c-icon').innerText = '⏸'; });
                navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); btnPlay.querySelector('.c-icon').innerText = '▶️'; });
                navigator.mediaSession.setActionHandler('previoustrack', playPrev);
                navigator.mediaSession.setActionHandler('nexttrack', playNext);
            }

        } catch (err) {
            console.error(err);
            showToast('网络错误');
        }
    }

    // ===================== 上/下一首 =====================
    function playNext() {
        if (playlist.length === 0) return;
        const mode = PLAY_MODES[currentModeIdx].id;
        if (mode === 'single') { audio.currentTime = 0; audio.play(); return; }
        let n = currentPlayIdx;
        if (mode === 'random') {
            if (playlist.length > 1) {
                do { n = Math.floor(Math.random() * playlist.length); } while (n === currentPlayIdx);
            }
        } else {
            n = currentPlayIdx + 1;
            if (n >= playlist.length) {
                if (mode === 'loop') n = 0;
                else { audio.pause(); btnPlay.querySelector('.c-icon').innerText = '▶️'; showToast('列表结束'); return; }
            }
        }
        playSong(n);
    }

    function playPrev() {
        if (playlist.length === 0) return;
        const mode = PLAY_MODES[currentModeIdx].id;
        let p = mode === 'random' ? Math.floor(Math.random() * playlist.length) : currentPlayIdx - 1;
        if (p < 0) p = (mode === 'loop') ? playlist.length - 1 : 0;
        playSong(p);
    }

    // ===================== 歌词 =====================
    function parseLRC(lrc) {
        const result = [];
        const tagRe = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
        for (const line of String(lrc).split('\n')) {
            const tags = [...line.matchAll(tagRe)];
            if (!tags.length) continue;
            const txt = line.replace(/\[[^\]]*\]/g, '').trim();
            if (!txt) continue;
            for (const m of tags) {
                const t = parseInt(m[1]) * 60 + parseInt(m[2]) +
                    (m[3] ? parseInt(m[3].padEnd(3, '0')) / 1000 : 0);
                result.push({ time: t, text: txt });
            }
        }
        return result.sort((a, b) => a.time - b.time);
    }

    function renderLyrics(lyrics) {
        lyricsContent.innerHTML = '';
        lyrics.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'lyric-line';
            div.dataset.index = i;
            div.innerText = item.text;
            lyricsContent.appendChild(div);
        });
    }

    let lastHL = -1;
    function updateLyricsHighlight(ct) {
        if (parsedLyrics.length === 0) return;
        let ai = -1;
        for (let i = parsedLyrics.length - 1; i >= 0; i--) {
            if (ct >= parsedLyrics[i].time) { ai = i; break; }
        }
        if (ai === lastHL) return;
        lastHL = ai;
        const lines = lyricsContent.querySelectorAll('.lyric-line');
        lines.forEach((el, i) => el.classList.toggle('active', i === ai));
        if (ai >= 0 && lines[ai]) {
            lines[ai].scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }

    // ===================== 初始化 =====================
    buildKeyboard();
    renderCurrentView();

    // 初始化音源文字显示
    btnSource.querySelector('.c-text').innerText = SOURCES[currentSourceIdx].name;

    setTimeout(() => {
        currentZone = 'ctrl';
        ctrlRow = 1; ctrlCol = 2;
        focusCtrl();
    }, 300);

    if (playlist.length > 0) {
        showToast('已恢复 ' + playlist.length + ' 首歌曲', true);
    }

});