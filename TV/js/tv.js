/**
 * Solara TV — 电视遥控器优化版音乐播放器
 *
 * 控制区两排五等分：
 *   Row0: [📥列表] [📡网易云] [🔁循环] [📋视图] [🔎搜索]
 *   Row1: [⏪]  [⏮]  [▶️]   [⏭]   [⏩]
 *
 * 搜索结果：行内 [▶️] [➕] 按钮替代弹窗
 * 播放列表：点击播放，右滑 [✕] 删除
 * 歌曲名称：截断省略不滚动
 * 歌手/专辑：超长时 marquee 滚动
 */
document.addEventListener('DOMContentLoaded', () => {

    // ===================== 常量 =====================
    const API_BASE = 'https://music-api.gdstudio.xyz/api.php';
    const PAGE_SIZE = 30;

    const SOURCES = [
        { id: 'netease', name: '网易云' },
        { id: 'kuwo',    name: '酷我' },
        { id: 'joox',    name: 'JOOX' }
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
    let currentView      = 'search';
    let searchResults    = [];
    let playlist         = JSON.parse(localStorage.getItem('tv_playlist') || '[]');
    let currentPlayIdx   = -1;
    let parsedLyrics     = [];
    let isSearching      = false;

    let searchKeyword    = '';
    let searchPage       = 1;
    let hasMorePages     = false;

    let currentZone      = 'ctrl';
    let lastIndex        = { ctrl: 0, list: 0 };
    let prevZone         = 'ctrl';

    // 【新增】确认键防重复标志：keydown 处理过则 keyup 不再触发
    let _enterHandled    = false;

    // ===================== DOM =====================
    const searchInput   = document.getElementById('search-input');
    const btnSearch     = document.getElementById('btn-search');
    const btnSource     = document.getElementById('btn-source');
    const btnMode       = document.getElementById('btn-mode');
    const btnPlay       = document.getElementById('btn-play');
    const btnPrev       = document.getElementById('btn-prev');
    const btnNext       = document.getElementById('btn-next');
    const btnRewind     = document.getElementById('btn-rewind');
    const btnForward    = document.getElementById('btn-forward');
    const btnGoList     = document.getElementById('btn-go-list');
    const btnView       = document.getElementById('btn-view');
    const btnPrevPage   = document.getElementById('btn-prev-page');
    const btnNextPage   = document.getElementById('btn-next-page');
    const pageInfo      = document.getElementById('page-info');
    const pagination    = document.getElementById('pagination');
    const progressFill  = document.getElementById('progress-fill');
    const timeCurrent   = document.getElementById('progress-time-current');
    const timeTotal     = document.getElementById('progress-time-total');
    const lyricsContent = document.getElementById('lyrics-content');
    const lyricsScroll  = document.getElementById('lyrics-scroll');
    const lyricsTitle   = document.getElementById('lyrics-title');
    const albumCover    = document.getElementById('album-cover');
    const bgBlur        = document.getElementById('bg-blur');
    const toastEl       = document.getElementById('toast');
    const songListEl    = document.getElementById('song-list');
    const loadingEl     = document.getElementById('loading');
    const audio         = document.getElementById('audio-player');

    // ===================== Toast =====================
    let toastTimer;
    function showToast(msg, ok) {
        toastEl.innerText = msg;
        toastEl.className = 'toast show' + (ok ? ' success' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
    }

    // ===================== 工具函数 =====================
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

    // ===================== 长文本滚动检测 =====================
    function initMarquee(el) {
        if (!el) return;
        const textEl = el.querySelector('.scroll-text');
        if (!textEl) return;

        // 重置状态
        textEl.classList.remove('marquee');
        textEl.style.removeProperty('--marquee-d');
        textEl.style.animationDuration = '';

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const containerW = el.clientWidth;
                const textW = textEl.scrollWidth;
                if (textW <= containerW) return;

                // 复制文本实现无缝循环
                const original = textEl.textContent;
                textEl.textContent = original + '   ' + original;

                const totalW = textEl.scrollWidth;
                const halfW = totalW / 2;
                const distance = halfW + 40;
                const speed = 60;
                const duration = distance / speed;

                textEl.style.setProperty('--marquee-d', '-' + distance + 'px');
                textEl.style.animationDuration = duration + 's';
                textEl.classList.add('marquee');
            });
        });
    }

    function initAllMarquees() {
        // 改动：只对歌手/专辑信息初始化滚动，歌曲名称不滚动
        document.querySelectorAll('.s-detail.scroll-wrap').forEach(initMarquee);
        const artistEl = document.getElementById('song-artist');
        if (artistEl) initMarquee(artistEl);
    }

    // ===================== 焦点导航系统 =====================
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
        if (dir === 'left')  { if (ctrlCol > 0)         { ctrlCol--; focusCtrl(); } }
        if (dir === 'right') { if (ctrlCol < COLS - 1)  { ctrlCol++; focusCtrl(); } }
        if (dir === 'up')    { if (ctrlRow > 0)         { ctrlRow--; focusCtrl(); } }
        if (dir === 'down')  { if (ctrlRow < ROWS - 1)  { ctrlRow++; focusCtrl(); } }
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

    // ===================== 键盘事件 =====================
    document.addEventListener('keydown', (e) => {
        // 【修复①】const → let，兼容电视遥控器 DPAD_CENTER(keyCode=23)
        let key = e.keyCode;
        if (key === 23) key = 13;
        // 标记 keydown 已处理确认键，防止 keyup 重复触发
        if (key === 13) _enterHandled = true;

        const ae  = document.activeElement;
        const isInput = (ae === searchInput);

        // 空格（非输入框时切换播放）
        if (key === 32 && !isInput) { e.preventDefault(); togglePlay(); return; }

        // 输入框特殊处理
        if (isInput) {
            if (key === 13) {
                e.preventDefault();
                const kw = searchInput.value.trim();
                if (kw) { searchInput.blur(); doSearch(kw, 1, false); }
                return;
            }
            if (key === 40) {
                e.preventDefault();
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

        if ([37,38,39,40,13,27].includes(key)) e.preventDefault();

        // ---- Ctrl Zone ----
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

        // ---- List Zone ----
        if (currentZone === 'list') {
            const items = getListItems();
            let ci = items.indexOf(ae);
            if (ci === -1) ci = 0;

            switch (key) {
                case 38: // ↑ 跳过操作按钮和删除按钮
                    if (ci > 0) {
                        let t = ci - 1;
                        while (t >= 0 && (
                            items[t].classList.contains('act-btn') ||
                            items[t].classList.contains('del-btn')
                        )) { t--; }
                        if (t >= 0) {
                            items[t].focus();
                            lastIndex.list = t;
                            if (items[t] !== searchInput) {
                                items[t].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                            }
                        }
                    }
                    break;
                case 40: // ↓ 跳过操作按钮和删除按钮
                    if (ci < items.length - 1) {
                        let t = ci + 1;
                        while (t < items.length && (
                            items[t].classList.contains('act-btn') ||
                            items[t].classList.contains('del-btn')
                        )) { t++; }
                        if (t < items.length) {
                            items[t].focus();
                            lastIndex.list = t;
                            items[t].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                    }
                    break;
                case 37: // ←
                    if (ae.classList.contains('act-btn') || ae.classList.contains('del-btn')) {
                        const songItem = ae.closest('.list-row')?.querySelector('.song-item');
                        if (songItem) {
                            songItem.focus();
                            const idx = items.indexOf(songItem);
                            if (idx >= 0) lastIndex.list = idx;
                        }
                    } else {
                        lastIndex.list = ci;
                        currentZone = 'ctrl';
                        if (ae === searchInput) { ctrlRow = 0; ctrlCol = 4; }
                        else { ctrlRow = 1; ctrlCol = 2; }
                        focusCtrl();
                    }
                    break;
                case 39: // →
                    if (ae.classList.contains('song-item')) {
                        const row = ae.closest('.list-row');
                        const firstAct = row?.querySelector('.act-btn, .del-btn');
                        if (firstAct) {
                            firstAct.focus();
                            const idx = items.indexOf(firstAct);
                            if (idx >= 0) lastIndex.list = idx;
                        }
                    } else if (ae.classList.contains('act-btn')) {
                        const row = ae.closest('.list-row');
                        const btns = row ? Array.from(row.querySelectorAll('.act-btn')) : [];
                        const bi = btns.indexOf(ae);
                        if (bi >= 0 && bi < btns.length - 1) {
                            btns[bi + 1].focus();
                        }
                    }
                    break;
                case 13: // Enter
                    if (ae) ae.click();
                    break;
            }
            return;
        }
    });

    // 【修复②】兼容部分电视遥控器仅在 keyup 时触发确认键的情况
    document.addEventListener('keyup', (e) => {
        if (e.keyCode === 13 || e.keyCode === 23 || e.key === 'Enter') {
            if (!_enterHandled) {
                const ae = document.activeElement;
                if (ae && ae !== document.body) {
                    e.preventDefault();
                    ae.click();
                }
            }
            _enterHandled = false;
        }
    });

    // ===================== 按钮事件 =====================

    btnSearch.addEventListener('click', () => {
        const kw = searchInput.value.trim();
        if (kw) {
            doSearch(kw, 1, false);
        } else {
            showToast('请先输入关键词');
            currentZone = 'list';
            searchInput.focus();
            lastIndex.list = 0;
        }
    });

    btnSource.addEventListener('click', () => {
        currentSourceIdx = (currentSourceIdx + 1) % SOURCES.length;
        const s = SOURCES[currentSourceIdx];
        btnSource.querySelector('.c-text').innerText = s.name;
        showToast('音源: ' + s.name, true);
    });

    btnMode.addEventListener('click', () => {
        currentModeIdx = (currentModeIdx + 1) % PLAY_MODES.length;
        const m = PLAY_MODES[currentModeIdx];
        btnMode.querySelector('.c-icon').innerText = m.icon;
        showToast('模式: ' + m.desc, true);
    });

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

    btnGoList.addEventListener('click', () => { focusFirstSong(); });

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
        if (currentView === 'search') renderSearchResults();
        else renderPlaylist();
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

            const isPlaying = currentPlayIdx >= 0 && playlist[currentPlayIdx] &&
                playlist[currentPlayIdx].id === song.id &&
                playlist[currentPlayIdx].source === song.source;
            if (isPlaying) item.classList.add('playing');

            item.innerHTML =
                '<span class="s-idx">' + globalIdx + '</span>' +
                '<div class="s-info">' +
                    '<div class="s-name">' + esc(song.name || '未知歌曲') + '</div>' +
                    '<div class="s-detail scroll-wrap"><span class="scroll-text">' + esc(artist) + (album ? ' · ' + esc(album) : '') + '</span></div>' +
                '</div>';

            const actions = document.createElement('div');
            actions.className = 'song-actions';

            const playBtn = document.createElement('div');
            playBtn.className = 'act-btn tv-focusable';
            playBtn.tabIndex = 0;
            playBtn.dataset.zone = 'list';
            playBtn.innerHTML = '▶️';
            playBtn.title = '直接播放';
            playBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
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
            });

            const addBtn = document.createElement('div');
            addBtn.className = 'act-btn act-add tv-focusable';
            addBtn.tabIndex = 0;
            addBtn.dataset.zone = 'list';
            addBtn.innerHTML = '➕';
            addBtn.title = '添加到列表';
            addBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const exists = playlist.some(s => s.id === song.id && s.source === song.source);
                if (exists) {
                    showToast('该歌曲已在列表中');
                } else {
                    playlist.push(song);
                    savePlaylist();
                    showToast('已添加: ' + (song.name || ''), true);
                }
            });

            actions.appendChild(playBtn);
            actions.appendChild(addBtn);

            row.appendChild(item);
            row.appendChild(actions);
            songListEl.appendChild(row);
        });

        pagination.style.display = 'flex';
        pageInfo.innerText = '第 ' + searchPage + ' 页';
        btnPrevPage.classList.toggle('disabled', searchPage <= 1);
        btnNextPage.classList.toggle('disabled', !hasMorePages);

        requestAnimationFrame(initAllMarquees);
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
                    '<div class="s-detail scroll-wrap"><span class="scroll-text">' + esc(artist) + (album ? ' · ' + esc(album) : '') + '</span></div>' +
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
                const wasPlaying = (currentPlayIdx === i);
                playlist.splice(i, 1);
                savePlaylist();
                showToast('已移除', true);

                if (wasPlaying) {
                    audio.pause();
                    audio.src = '';
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

        requestAnimationFrame(initAllMarquees);
    }

    function resetUI() {
        document.getElementById('song-title').textContent = 'Solara TV';
        document.getElementById('song-artist').innerHTML = '<span class="scroll-text">准备播放</span>';
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

        document.getElementById('song-title').textContent = song.name || '未知歌曲';
        document.getElementById('song-artist').innerHTML = '<span class="scroll-text">' + esc(artist) + '</span>';
        initMarquee(document.getElementById('song-artist'));

        lyricsContent.innerHTML = '<div class="lyrics-placeholder">加载中...</div>';
        lyricsTitle.innerText = song.name || '歌词';
        parsedLyrics = [];

        if (currentView === 'playlist') renderCurrentView();
        else {
            songListEl.querySelectorAll('.song-item').forEach((el, i) => {
                const s = searchResults[i];
                if (s && s.id === song.id && s.source === song.source) {
                    el.classList.add('playing');
                } else {
                    el.classList.remove('playing');
                }
            });
        }

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
                                const clean = d.lyric.replace(/$$.*?$$/g, '').trim();
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

    // ===================== 上 / 下一首 =====================
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
        const regex = /$$(\d{2}):(\d{2})(?:\.(\d{1,3}))?$$/;
        for (const line of lrc.split('\n')) {
            const m = line.match(regex);
            if (m) {
                const t = parseInt(m[1])*60 + parseInt(m[2]) + (m[3] ? parseInt(m[3].padEnd(3,'0'))/1000 : 0);
                const txt = line.replace(/$$.*?$$/g, '').trim();
                if (txt) result.push({ time: t, text: txt });
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
    renderCurrentView();
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
