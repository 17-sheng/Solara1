/**
 * Solara TV — 电视遥控器优化版音乐播放器
 * 
 * 三列布局：左列表(33%) | 中间控制按钮竖排(72px) | 右播放区(~61%)
 * 三个 zone: left(歌曲列表), ctrl(中间按钮), player(进度条)
 * ← → 在 zone 间切换，↑ ↓ 在 zone 内导航
 */
document.addEventListener('DOMContentLoaded', () => {

    // ===================== 常量 =====================
    const API_BASE = 'https://music-api.gdstudio.xyz/api.php';

    const SOURCES = [
        { id: 'netease', name: '网易云' },
        { id: 'tencent', name: 'QQ音乐' },
        { id: 'kuwo',    name: '酷我' },
        { id: 'joox',    name: 'JOOX' },
        { id: 'apple',   name: 'Apple' }
    ];

    const PLAY_MODES = [
        { id: 'loop',     icon: '🔁', desc: '列表循环', short: '循环' },
        { id: 'single',   icon: '🔂', desc: '单曲循环', short: '单曲' },
        { id: 'random',   icon: '🔀', desc: '随机播放', short: '随机' },
        { id: 'sequence', icon: '⏬', desc: '顺序播放', short: '顺序' }
    ];

    // ===================== 状态 =====================
    let currentSourceIndex = 0;
    let currentModeIndex   = 0;
    let currentView        = 'search';   // 'search' | 'playlist'
    let searchResults      = [];
    let playlist           = JSON.parse(localStorage.getItem('tv_playlist') || '[]');
    let currentPlayIndex   = -1;
    let currentZone        = 'left';     // 'left' | 'ctrl' | 'player'
    let parsedLyrics       = [];
    let isSearching        = false;

    // 记住每个 zone 最后的焦点索引
    let lastIndex = { left: 0, ctrl: 2, player: 0 };

    // ===================== DOM =====================
    const searchInput      = document.getElementById('search-input');
    const btnSearch        = document.getElementById('btn-search');
    const btnSource        = document.getElementById('btn-source');
    const btnView          = document.getElementById('btn-view');
    const btnPlay          = document.getElementById('btn-play');
    const btnPrev          = document.getElementById('btn-prev');
    const btnNext          = document.getElementById('btn-next');
    const btnMode          = document.getElementById('btn-mode');
    const progressTrack    = document.getElementById('progress-track');
    const progressFill     = document.getElementById('progress-fill');
    const timeCurrent      = document.getElementById('progress-time-current');
    const timeTotal        = document.getElementById('progress-time-total');
    const lyricsTextEl     = document.getElementById('lyrics-text');
    const lyricsContainer  = document.getElementById('lyrics-container');
    const albumCover       = document.getElementById('album-cover');
    const bgBlur           = document.getElementById('bg-blur');
    const toastEl          = document.getElementById('toast');
    const songListEl       = document.getElementById('song-list');
    const songListWrapper  = document.getElementById('song-list-wrapper');
    const loadingEl        = document.getElementById('loading');
    const audio            = document.getElementById('audio-player');

    // ===================== Toast =====================
    let toastTimer;
    function showToast(msg, isSuccess = false) {
        toastEl.innerText = msg;
        toastEl.className = 'toast show' + (isSuccess ? ' success' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.classList.remove('show'); }, 2500);
    }

    // ===================== 工具函数 =====================
    function formatTime(s) {
        if (!s || isNaN(s)) return '00:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }

    function savePlaylist() {
        try { localStorage.setItem('tv_playlist', JSON.stringify(playlist)); } catch(e) {}
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ===================== 导航系统 =====================
    function getZoneItems(zone) {
        return Array.from(document.querySelectorAll(`.tv-focusable[data-zone="${zone}"]`));
    }

    function focusZoneItem(zone, index) {
        const items = getZoneItems(zone);
        if (items.length === 0) return;
        const idx = Math.max(0, Math.min(index, items.length - 1));
        items[idx].focus({ preventScroll: false });
        if (zone === 'left' && items[idx].classList.contains('song-item')) {
            items[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    // ===================== 核心键盘事件 =====================
    document.addEventListener('keydown', (e) => {
        const key = e.keyCode;
        const ae  = document.activeElement;
        const isInput = (ae === searchInput);

        // 空格：播放/暂停（非输入框）
        if (key === 32 && !isInput) {
            e.preventDefault();
            togglePlay();
            return;
        }

        // 输入框特殊处理
        if (isInput) {
            if (key === 13) { // Enter
                e.preventDefault();
                const kw = searchInput.value.trim();
                if (kw) { searchInput.blur(); doSearch(kw); }
                return;
            }
            if (key === 40) { // ↓ 离开输入框到列表
                e.preventDefault();
                const items = getZoneItems('left');
                if (items.length > 0) { items[0].focus(); currentZone = 'left'; lastIndex.left = 0; }
                return;
            }
            if (key === 39) { // → 到中间控制栏
                e.preventDefault();
                currentZone = 'ctrl';
                focusZoneItem('ctrl', lastIndex.ctrl);
                return;
            }
            return;
        }

        // 非输入框屏蔽默认行为
        if ([37, 38, 39, 40, 13].includes(key)) {
            e.preventDefault();
        }

        const zoneItems = getZoneItems(currentZone);
        let ci = zoneItems.indexOf(ae);
        if (ci === -1) ci = 0;

        switch (key) {
            case 38: // ↑
                if (ci > 0) {
                    let target = ci - 1;
                    // 跳过 delete-btn
                    if (currentZone === 'left' && zoneItems[target] && zoneItems[target].classList.contains('delete-btn')) {
                        target--;
                    }
                    if (target >= 0) {
                        zoneItems[target].focus();
                        lastIndex[currentZone] = target;
                        if (currentZone === 'left') {
                            zoneItems[target].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                    }
                } else if (currentZone === 'left') {
                    // 到顶 → 聚焦搜索框
                    searchInput.focus();
                }
                break;

            case 40: // ↓
                if (ci < zoneItems.length - 1) {
                    let target = ci + 1;
                    if (currentZone === 'left' && zoneItems[target] && zoneItems[target].classList.contains('delete-btn')) {
                        target++;
                    }
                    if (target < zoneItems.length) {
                        zoneItems[target].focus();
                        lastIndex[currentZone] = target;
                        if (currentZone === 'left') {
                            zoneItems[target].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                    }
                }
                break;

            case 37: // ← 左
                if (currentZone === 'ctrl') {
                    // ctrl → left
                    lastIndex.ctrl = ci;
                    currentZone = 'left';
                    focusZoneItem('left', lastIndex.left);
                } else if (currentZone === 'player') {
                    // player → ctrl
                    lastIndex.player = ci;
                    currentZone = 'ctrl';
                    focusZoneItem('ctrl', lastIndex.ctrl);
                } else if (currentZone === 'left') {
                    // 如果在 delete-btn，跳回 song-item
                    if (ae && ae.classList.contains('delete-btn')) {
                        const prev = ci - 1;
                        if (prev >= 0) {
                            zoneItems[prev].focus();
                            lastIndex.left = prev;
                        }
                    }
                }
                break;

            case 39: // → 右
                if (currentZone === 'left') {
                    // 如果在 song-item 且旁边有 delete-btn
                    if (ae && ae.classList.contains('song-item') &&
                        zoneItems[ci + 1] && zoneItems[ci + 1].classList.contains('delete-btn')) {
                        zoneItems[ci + 1].focus();
                        lastIndex.left = ci + 1;
                    } else {
                        // left → ctrl
                        lastIndex.left = ci;
                        currentZone = 'ctrl';
                        focusZoneItem('ctrl', lastIndex.ctrl);
                    }
                } else if (currentZone === 'ctrl') {
                    // ctrl → player
                    lastIndex.ctrl = ci;
                    currentZone = 'player';
                    focusZoneItem('player', lastIndex.player);
                } else if (currentZone === 'player') {
                    // 在进度条快进5秒
                    if (ae && ae.id === 'progress-track' && audio.src && !isNaN(audio.duration)) {
                        audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
                    }
                }
                break;

            case 13: // Enter/OK
                if (ae) ae.click();
                break;
        }
    });

    // 进度条特殊快进/快退（聚焦时）
    progressTrack.addEventListener('keydown', (e) => {
        if (!audio.src || isNaN(audio.duration)) return;
        if (e.keyCode === 37) {
            e.stopPropagation();
            e.preventDefault();
            audio.currentTime = Math.max(0, audio.currentTime - 5);
        } else if (e.keyCode === 39) {
            e.stopPropagation();
            e.preventDefault();
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
        }
    });

    // ===================== 按钮事件 =====================

    // 搜索
    btnSearch.addEventListener('click', () => {
        const kw = searchInput.value.trim();
        if (kw) {
            doSearch(kw);
        } else {
            showToast('请先输入搜索关键词');
            searchInput.focus();
            currentZone = 'left';
        }
    });

    // 切换音源
    btnSource.addEventListener('click', () => {
        currentSourceIndex = (currentSourceIndex + 1) % SOURCES.length;
        const s = SOURCES[currentSourceIndex];
        btnSource.querySelector('.ctrl-label').innerText = s.name;
        showToast('已切换: ' + s.name, true);
    });

    // 切换视图
    btnView.addEventListener('click', () => {
        currentView = currentView === 'search' ? 'playlist' : 'search';
        updateView();
        if (currentView === 'search') {
            btnView.querySelector('.ctrl-icon').innerText = '📋';
            btnView.querySelector('.ctrl-label').innerText = '列表';
        } else {
            btnView.querySelector('.ctrl-icon').innerText = '🔍';
            btnView.querySelector('.ctrl-label').innerText = '搜索';
        }
        showToast(currentView === 'search' ? '搜索结果' : '播放列表 (' + playlist.length + ')', true);
    });

    // 播放/暂停
    btnPlay.addEventListener('click', togglePlay);
    function togglePlay() {
        if (audio.src) {
            if (audio.paused) { audio.play(); btnPlay.querySelector('.ctrl-icon').innerText = '⏸'; }
            else              { audio.pause(); btnPlay.querySelector('.ctrl-icon').innerText = '▶️'; }
        } else if (playlist.length > 0) {
            playSong(0);
        } else {
            showToast('当前没有可播放的歌曲');
        }
    }

    // 上一首/下一首
    btnPrev.addEventListener('click', playPrev);
    btnNext.addEventListener('click', playNext);

    // 循环模式
    btnMode.addEventListener('click', () => {
        currentModeIndex = (currentModeIndex + 1) % PLAY_MODES.length;
        const mode = PLAY_MODES[currentModeIndex];
        btnMode.querySelector('.ctrl-icon').innerText = mode.icon;
        btnMode.querySelector('.ctrl-label').innerText = mode.short;
        btnMode.title = mode.desc;
        showToast('模式: ' + mode.desc, true);
    });

    // 进度条点击
    progressTrack.addEventListener('click', (e) => {
        if (!audio.src || isNaN(audio.duration)) return;
        const rect = progressTrack.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        audio.currentTime = ratio * audio.duration;
    });

    // ===================== 音频事件 =====================
    audio.addEventListener('timeupdate', () => {
        if (isNaN(audio.duration)) return;
        const pct = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = pct + '%';
        timeCurrent.innerText = formatTime(audio.currentTime);
        timeTotal.innerText   = formatTime(audio.duration);
        updateLyricsHighlight(audio.currentTime);
    });

    audio.addEventListener('ended', playNext);

    audio.addEventListener('error', () => {
        showToast('播放出错，跳下一首');
        setTimeout(playNext, 1000);
    });

    // ===================== 搜索逻辑 =====================
    async function doSearch(keyword) {
        if (isSearching) return;
        isSearching = true;
        loadingEl.style.display = 'block';
        songListEl.innerHTML = '';
        currentView = 'search';
        // 同步视图按钮
        btnView.querySelector('.ctrl-icon').innerText = '📋';
        btnView.querySelector('.ctrl-label').innerText = '列表';
        const source = SOURCES[currentSourceIndex].id;

        try {
            const url = `${API_BASE}?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=30`;
            const res = await fetch(url);
            const data = await res.json();
            const songs = Array.isArray(data) ? data : (data.data || data.result || []);

            if (songs && songs.length > 0) {
                searchResults = songs.map(s => ({ ...s, target_source: source }));
                updateView();
                showToast('找到 ' + searchResults.length + ' 首歌曲', true);
                // 聚焦第一首歌
                setTimeout(() => {
                    const firstSong = songListEl.querySelector('.song-item');
                    if (firstSong) {
                        firstSong.focus();
                        currentZone = 'left';
                        lastIndex.left = 0;
                    }
                }, 100);
            } else {
                searchResults = [];
                updateView();
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
    function updateView() {
        renderList(currentView === 'search' ? searchResults : playlist);
    }

    function renderList(list) {
        songListEl.innerHTML = '';

        if (list.length === 0) {
            const tip = currentView === 'search'
                ? '<span class="icon">🔍</span>暂无搜索结果<br>输入关键词开始搜索'
                : '<span class="icon">📋</span>播放列表为空<br>搜索歌曲后按 OK 添加';
            songListEl.innerHTML = '<div class="empty-tip">' + tip + '</div>';
            return;
        }

        list.forEach((song, index) => {
            const row = document.createElement('div');
            row.className = 'list-row';

            const item = document.createElement('div');
            item.className = 'song-item tv-focusable';
            item.tabIndex = 0;
            item.dataset.zone = 'left';

            if (currentView === 'playlist' && index === currentPlayIndex) {
                item.classList.add('playing');
            }

            const artist = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '未知歌手');
            const album = song.album || '';

            item.innerHTML =
                '<span class="song-index">' + (index + 1) + '</span>' +
                '<div class="song-info">' +
                    '<div class="song-name">' + escapeHtml(song.name || '未知歌曲') + '</div>' +
                    '<div class="song-detail">' + escapeHtml(artist) + (album ? ' · ' + escapeHtml(album) : '') + '</div>' +
                '</div>';

            item.addEventListener('click', () => {
                if (currentView === 'search') {
                    playlist.push(song);
                    savePlaylist();
                    currentPlayIndex = playlist.length - 1;
                    playSong(currentPlayIndex);
                    showToast('已添加并播放', true);
                } else {
                    playSong(index);
                }
            });

            row.appendChild(item);

            // 播放列表视图才显示删除按钮
            if (currentView === 'playlist') {
                const del = document.createElement('div');
                del.className = 'delete-btn tv-focusable';
                del.tabIndex = 0;
                del.dataset.zone = 'left';
                del.innerHTML = '✕';
                del.title = '从列表移除';
                del.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    playlist.splice(index, 1);
                    savePlaylist();
                    showToast('已移除', true);
                    if (currentPlayIndex === index) {
                        audio.pause();
                        audio.src = '';
                        btnPlay.querySelector('.ctrl-icon').innerText = '▶️';
                        if (playlist.length > 0) {
                            currentPlayIndex = Math.min(index, playlist.length - 1);
                            playSong(currentPlayIndex);
                        } else {
                            currentPlayIndex = -1;
                            resetPlayerUI();
                        }
                    } else if (currentPlayIndex > index) {
                        currentPlayIndex--;
                    }
                    updateView();
                });
                row.appendChild(del);
            }

            songListEl.appendChild(row);
        });
    }

    function resetPlayerUI() {
        document.getElementById('song-title').innerText = 'Solara TV';
        document.getElementById('song-artist').innerText = '准备播放';
        lyricsTextEl.innerText = '暂无歌词';
        progressFill.style.width = '0%';
        timeCurrent.innerText = '00:00';
        timeTotal.innerText = '00:00';
        albumCover.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect fill='%231a1a2e' width='400' height='400'/%3E%3Ctext x='200' y='200' text-anchor='middle' dominant-baseline='central' font-size='80' fill='%23333'%3E🎵%3C/text%3E%3C/svg%3E";
        bgBlur.style.backgroundImage = '';
    }

    // ===================== 播放引擎 =====================
    async function playSong(index) {
        if (index < 0 || index >= playlist.length) return;
        currentPlayIndex = index;
        const song = playlist[index];

        const artist = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '未知歌手');
        document.getElementById('song-title').innerText = song.name || '未知歌曲';
        document.getElementById('song-artist').innerText = artist;
        lyricsTextEl.innerText = '正在加载...';
        parsedLyrics = [];

        if (currentView === 'playlist') updateView();

        const source = song.target_source || song.source || 'netease';

        try {
            const urlRes = await fetch(`${API_BASE}?types=url&source=${source}&id=${song.id}`);
            const urlData = await urlRes.json();

            if (urlData && urlData.url) {
                audio.src = urlData.url.replace(/^http:\/\//i, 'https://');
                audio.play();
                btnPlay.querySelector('.ctrl-icon').innerText = '⏸';
            } else {
                showToast(song.name + ' 无法播放，跳过');
                setTimeout(playNext, 500);
                return;
            }

            // 封面（异步）
            if (song.pic_id) {
                fetch(`${API_BASE}?types=pic&source=${source}&id=${song.pic_id}&size=500`)
                    .then(r => r.json())
                    .then(data => {
                        if (data && data.url) {
                            const picUrl = data.url.replace(/^http:\/\//i, 'https://');
                            albumCover.src = picUrl;
                            bgBlur.style.backgroundImage = 'url(' + picUrl + ')';
                        }
                    }).catch(() => {});
            }

            // 歌词（异步）
            if (song.lyric_id) {
                fetch(`${API_BASE}?types=lyric&source=${source}&id=${song.lyric_id}`)
                    .then(r => r.json())
                    .then(data => {
                        if (data && data.lyric) {
                            parsedLyrics = parseLRC(data.lyric);
                            if (parsedLyrics.length > 0) {
                                renderLyrics(parsedLyrics);
                            } else {
                                lyricsTextEl.innerText = data.lyric.replace(/\[.*?\]/g, '').trim() || '纯音乐，请欣赏';
                            }
                        } else {
                            lyricsTextEl.innerText = '暂无歌词';
                        }
                    }).catch(() => {
                        lyricsTextEl.innerText = '歌词加载失败';
                    });
            } else {
                lyricsTextEl.innerText = '暂无歌词';
            }

            // MediaSession
            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: song.name || '未知歌曲',
                    artist: artist,
                    album: song.album || ''
                });
                navigator.mediaSession.setActionHandler('play', () => { audio.play(); btnPlay.querySelector('.ctrl-icon').innerText = '⏸'; });
                navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); btnPlay.querySelector('.ctrl-icon').innerText = '▶️'; });
                navigator.mediaSession.setActionHandler('previoustrack', playPrev);
                navigator.mediaSession.setActionHandler('nexttrack', playNext);
            }

        } catch (err) {
            console.error(err);
            showToast('网络错误，无法播放');
            lyricsTextEl.innerText = '';
        }
    }

    // ===================== 上/下一首 =====================
    function playNext() {
        if (playlist.length === 0) return;
        const mode = PLAY_MODES[currentModeIndex].id;

        if (mode === 'single') {
            audio.currentTime = 0;
            audio.play();
            return;
        }

        let next = currentPlayIndex;
        if (mode === 'random') {
            if (playlist.length > 1) {
                do { next = Math.floor(Math.random() * playlist.length); } while (next === currentPlayIndex);
            }
        } else {
            next = currentPlayIndex + 1;
            if (next >= playlist.length) {
                if (mode === 'loop') next = 0;
                else {
                    audio.pause();
                    btnPlay.querySelector('.ctrl-icon').innerText = '▶️';
                    showToast('播放列表已结束');
                    return;
                }
            }
        }
        playSong(next);
    }

    function playPrev() {
        if (playlist.length === 0) return;
        const mode = PLAY_MODES[currentModeIndex].id;
        let prev;
        if (mode === 'random') {
            prev = Math.floor(Math.random() * playlist.length);
        } else {
            prev = currentPlayIndex - 1;
            if (prev < 0) prev = (mode === 'loop') ? playlist.length - 1 : 0;
        }
        playSong(prev);
    }

    // ===================== 歌词解析 & 高亮 =====================
    function parseLRC(lrc) {
        const lines = lrc.split('\n');
        const result = [];
        const regex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/;
        for (const line of lines) {
            const match = line.match(regex);
            if (match) {
                const min = parseInt(match[1], 10);
                const sec = parseInt(match[2], 10);
                const ms  = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
                const time = min * 60 + sec + ms / 1000;
                const text = line.replace(/\[.*?\]/g, '').trim();
                if (text) result.push({ time, text });
            }
        }
        return result.sort((a, b) => a.time - b.time);
    }

    function renderLyrics(lyrics) {
        lyricsTextEl.innerHTML = '';
        lyrics.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'lyric-line';
            div.dataset.index = i;
            div.innerText = item.text;
            lyricsTextEl.appendChild(div);
        });
    }

    let lastHighlightIndex = -1;
    function updateLyricsHighlight(currentTime) {
        if (parsedLyrics.length === 0) return;
        let activeIdx = -1;
        for (let i = parsedLyrics.length - 1; i >= 0; i--) {
            if (currentTime >= parsedLyrics[i].time) { activeIdx = i; break; }
        }
        if (activeIdx === lastHighlightIndex) return;
        lastHighlightIndex = activeIdx;

        const lines = lyricsTextEl.querySelectorAll('.lyric-line');
        lines.forEach((el, i) => { el.classList.toggle('active', i === activeIdx); });
        if (activeIdx >= 0 && lines[activeIdx]) {
            lines[activeIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }

    // ===================== 初始化 =====================
    updateView();

    setTimeout(() => { searchInput.focus(); }, 300);

    if (playlist.length > 0) {
        showToast('已恢复 ' + playlist.length + ' 首歌曲', true);
    }

});
