/**
 * Solara TV — 电视遥控器优化版音乐播放器（重构版）
 *
 * 模块化架构：
 *   - State       : 集中式状态管理
 *   - API         : 音乐 API 层（含 fallback、重试、防抖）
 *   - Navigator   : 遥控器焦点导航系统
 *   - Renderer    : DOM 渲染（搜索/列表/歌词/封面）
 *   - Player      : 播放引擎（音频控制、媒体会话）
 *   - UI          : 工具函数（Toast、Marquee、格式化）
 *   - App         : 初始化入口
 */

(function () {
'use strict';

/* ===================================================================
   SECTION 1: 配置常量
   =================================================================== */
const CONFIG = Object.freeze({
    API_BASE: 'https://music-api.gdstudio.xyz/api.php',
    API_FALLBACK: 'https://api.multiunblock.com/music',
    PAGE_SIZE: 30,
    DEBOUNCE_SEARCH: 300,
    MAX_RETRY: 2,
    RETRY_DELAY: 1500,
    STORAGE_KEY: 'solara_tv_state',
    SOURCES: [
        { id: 'netease', name: '网易云' },
        { id: 'kuwo',    name: '酷我' },
        { id: 'joox',    name: 'JOOX' }
    ],
    PLAY_MODES: [
        { id: 'loop',     icon: '🔁', desc: '列表循环' },
        { id: 'single',   icon: '🔂', desc: '单曲循环' },
        { id: 'random',   icon: '🔀', desc: '随机播放' },
        { id: 'sequence', icon: '⏬', desc: '顺序播放' }
    ]
});

/* ===================================================================
   SECTION 2: 集中式状态管理
   =================================================================== */
const State = {
    _state: {
        sourceIdx: 0,
        modeIdx: 0,
        view: 'search',        // 'search' | 'playlist'
        searchResults: [],
        playlist: [],
        currentPlayIdx: -1,
        parsedLyrics: [],
        isSearching: false,
        searchKeyword: '',
        searchPage: 1,
        hasMorePages: false,
        focusZone: 'ctrl',     // 'ctrl' | 'list' | 'input'
        ctrlPos: { row: 1, col: 2 },
        listFocusIdx: 0,
        _enterHandled: false
    },

    get(key) { return this._state[key]; },
    set(key, val) { this._state[key] = val; },
    update(patch) { Object.assign(this._state, patch); },

    save() {
        try {
            const snap = {
                sourceIdx: this._state.sourceIdx,
                modeIdx: this._state.modeIdx,
                playlist: this._state.playlist,
                currentPlayIdx: this._state.currentPlayIdx
            };
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(snap));
        } catch (_) {}
    },

    restore() {
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (!raw) return false;
            const snap = JSON.parse(raw);
            if (snap.playlist && Array.isArray(snap.playlist)) {
                this.update({ playlist: snap.playlist, currentPlayIdx: snap.currentPlayIdx ?? -1 });
                return true;
            }
        } catch (_) {}
        return false;
    },

    reset() {
        this.update({
            searchResults: [], searchKeyword: '', searchPage: 1,
            hasMorePages: false, isSearching: false, currentPlayIdx: -1,
            parsedLyrics: [], view: 'search', focusZone: 'ctrl',
            ctrlPos: { row: 1, col: 2 }, listFocusIdx: 0, _enterHandled: false
        });
    }
};

/* ===================================================================
   SECTION 3: API 层（含 fallback + 重试 + 错误处理）
   =================================================================== */
const API = {
    /** 通用 fetch 包装器：重试 */
    async _request(url, retries = CONFIG.MAX_RETRY) {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            } catch (_) {
                if (attempt < retries - 1) await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY * (attempt + 1)));
            }
        }
        throw new Error('API 请求失败');
    },

    async search(keyword, sourceId, page = 1) {
        const qs = `types=search&source=${sourceId}&name=${encodeURIComponent(keyword)}&count=${CONFIG.PAGE_SIZE}&pages=${page}`;
        return this._request(`${CONFIG.API_BASE}?${qs}`);
    },

    async getUrl(sourceId, songId) {
        const qs = `types=url&source=${sourceId}&id=${songId}&br=320`;
        return this._request(`${CONFIG.API_BASE}?${qs}`);
    },

    async getPic(sourceId, picId, size = 500) {
        const qs = `types=pic&source=${sourceId}&id=${picId}&size=${size}`;
        return this._request(`${CONFIG.API_BASE}?${qs}`);
    },

    async getLyric(sourceId, lyricId) {
        const qs = `types=lyric&source=${sourceId}&id=${lyricId}`;
        return this._request(`${CONFIG.API_BASE}?${qs}`);
    }
};

/* ===================================================================
   SECTION 4: 遥控器焦点导航系统
   =================================================================== */
const NAVIGATOR = (() => {
    const CTRL_GRID = [
        ['btn-go-list', 'btn-source', 'btn-mode', 'btn-view', 'btn-search'],
        ['btn-rewind',  'btn-prev',   'btn-play', 'btn-next', 'btn-forward']
    ];
    const ROWS = CTRL_GRID.length;
    const COLS = CTRL_GRID[0].length;

    function _el(id) { return document.getElementById(id); }

    function focusCtrl(row, col) {
        const id = CTRL_GRID[row]?.[col];
        if (id) _el(id)?.focus();
    }

    function _getListFocusable() {
        return Array.from(document.querySelectorAll('.tv-focusable[data-zone="list"]'));
    }

    function focusListItem(idx) {
        const items = _getListFocusable();
        if (!items.length) return;
        const i = Math.max(0, Math.min(idx, items.length - 1));
        items[i].focus({ preventScroll: false });
        State.set('listFocusIdx', i);
        if (items[i] !== _el('search-input')) {
            items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function focusFirstSong() {
        const songs = document.querySelectorAll('.song-item.tv-focusable');
        if (songs.length) {
            songs[0].focus();
            songs[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            State.set('focusZone', 'list');
            const all = _getListFocusable();
            State.set('listFocusIdx', all.indexOf(songs[0]) >= 0 ? all.indexOf(songs[0]) : 0);
        } else {
            _el('search-input')?.focus();
            State.set('focusZone', 'list');
            State.set('listFocusIdx', 0);
        }
    }

    function skipNonSong(items, idx, dir) {
        let t = idx + dir;
        while (t >= 0 && t < items.length) {
            const cls = items[t].className;
            if (!cls.includes('act-btn') && !cls.includes('del-btn')) return t;
            t += dir;
        }
        return -1;
    }

    return {
        focusCtrl,
        focusListItem,
        focusFirstSong,
        nav(dir) {
            const pos = State.get('ctrlPos');
            if (dir === 'left'  && pos.col > 0)  pos.col--;
            if (dir === 'right' && pos.col < COLS - 1) pos.col++;
            if (dir === 'up'    && pos.row > 0)  pos.row--;
            if (dir === 'down'  && pos.row < ROWS - 1) pos.row++;
            State.set('ctrlPos', pos);
            focusCtrl(pos.row, pos.col);
        },
        exitCtrlToRight() {
            State.set('focusZone', 'list');
            _el('search-input')?.focus();
            State.set('listFocusIdx', 0);
        },
        enterCtrlFromLeft() {
            State.set('focusZone', 'ctrl');
            State.set('ctrlPos', { row: 1, col: 2 });
            focusCtrl(1, 2);
        },
        getListItems: _getListFocusable,
        focusListItem,
        skipNonSong
    };
})();

/* ===================================================================
   SECTION 5: UI 工具函数
   =================================================================== */
const UI = {
    _toastTimer: null,

    showToast(msg, ok = false, duration = 2500) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg;
        el.className = 'toast show' + (ok ? ' success' : '');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
    },

    fmtTime(s) {
        if (!s || isNaN(s)) return '00:00';
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    },

    escHtml(str) {
        const d = document.createElement('div');
        d.appendChild(document.createTextNode(String(str ?? '')));
        return d.innerHTML;
    },

    artistStr(song) {
        return Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '未知歌手');
    },

    /** Marquee 长文本滚动 */
    initMarquee(el) {
        if (!el) return;
        const textEl = el.querySelector('.scroll-text');
        if (!textEl) return;

        textEl.classList.remove('marquee');
        textEl.style.removeProperty('--marquee-d');
        textEl.style.animationDuration = '';

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const cw = el.clientWidth;
                const tw = textEl.scrollWidth;
                if (tw <= cw) return;

                const orig = textEl.textContent;
                textEl.textContent = orig + '   ' + orig;
                const totalW = textEl.scrollWidth;
                const dist = totalW / 2 + 40;
                const dur = dist / 60;

                textEl.style.setProperty('--marquee-d', `-${dist}px`);
                textEl.style.animationDuration = `${dur}s`;
                textEl.classList.add('marquee');
            });
        });
    },

    initAllMarquees() {
        document.querySelectorAll('.s-detail.scroll-wrap').forEach(this.initMarquee.bind(this));
        const artistEl = document.getElementById('song-artist');
        if (artistEl) this.initMarquee(artistEl);
    },

    /** 进度条更新 */
    updateProgress(audio) {
        if (isNaN(audio.duration)) return;
        const pct = (audio.currentTime / audio.duration) * 100;
        const fill = document.getElementById('progress-fill');
        const cur = document.getElementById('progress-time-current');
        const tot = document.getElementById('progress-time-total');
        if (fill) fill.style.width = `${pct}%`;
        if (cur) cur.textContent = this.fmtTime(audio.currentTime);
        if (tot) tot.textContent = this.fmtTime(audio.duration);
    }
};

/* ===================================================================
   SECTION 6: 歌词引擎
   =================================================================== */
const LYRICS = {
    parse(lrc) {
        const result = [];
        const regex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))\]/;
        for (const line of lrc.split('\n')) {
            const m = line.match(regex);
            if (m) {
                const t = parseInt(m[1]) * 60 + parseInt(m[2]) +
                    (m[3] ? parseInt(m[3].padEnd(3, '0')) / 1000 : 0);
                const txt = line.replace(/\[.*?\]/g, '').trim();
                if (txt) result.push({ time: t, text: txt });
            }
        }
        return result.sort((a, b) => a.time - b.time);
    },

    render(container, lyrics) {
        container.innerHTML = '';
        lyrics.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'lyric-line';
            div.dataset.index = i;
            div.textContent = item.text;
            container.appendChild(div);
        });
    },

    highlight(ct, lyrics, container) {
        if (!lyrics.length || !container) return;
        let ai = -1;
        for (let i = lyrics.length - 1; i >= 0; i--) {
            if (ct >= lyrics[i].time) { ai = i; break; }
        }
        if (ai === LYRICS._lastHL) return;
        LYRICS._lastHL = ai;
        const lines = container.querySelectorAll('.lyric-line');
        lines.forEach((el, i) => el.classList.toggle('active', i === ai));
        if (ai >= 0 && lines[ai]) {
            lines[ai].scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }
};
LYRICS._lastHL = -1;

/* ===================================================================
   SECTION 7: 渲染引擎
   =================================================================== */
const Renderer = {
    _songListEl()  { return document.getElementById('song-list'); },
    _paginationEl() { return document.getElementById('pagination'); },
    _pageInfoEl()   { return document.getElementById('page-info'); },
    _loadingEl()    { return document.getElementById('loading'); },
    _btnPrevPage()  { return document.getElementById('btn-prev-page'); },
    _btnNextPage()  { return document.getElementById('btn-next-page'); },

    renderSearchResults() {
        const el = this._songListEl();
        el.innerHTML = '';
        const results = State.get('searchResults');

        if (!results.length) {
            el.innerHTML = `<div class="empty-tip"><span class="e-icon">🔍</span>暂无搜索结果<br>输入关键词开始搜索</div>`;
            this._paginationEl().style.display = 'none';
            return;
        }

        results.forEach((song, i) => {
            const globalIdx = (State.get('searchPage') - 1) * CONFIG.PAGE_SIZE + i + 1;
            const isPlaying = this._isSongPlaying(song);

            el.appendChild(this._createSongRow(song, globalIdx, isPlaying, true));
        });

        this._paginationEl().style.display = 'flex';
        this._pageInfoEl().textContent = `第 ${State.get('searchPage')} 页`;
        this._btnPrevPage().classList.toggle('disabled', State.get('searchPage') <= 1);
        this._btnNextPage().classList.toggle('disabled', !State.get('hasMorePages'));

        requestAnimationFrame(UI.initAllMarquees.bind(UI));
    },

    renderPlaylist() {
        const el = this._songListEl();
        el.innerHTML = '';
        this._paginationEl().style.display = 'none';

        if (!State.get('playlist').length) {
            el.innerHTML = `<div class="empty-tip"><span class="e-icon">📋</span>播放列表为空<br>搜索歌曲添加</div>`;
            return;
        }

        State.get('playlist').forEach((song, i) => {
            el.appendChild(this._createSongRow(song, i + 1, i === State.get('currentPlayIdx'), false));
        });

        requestAnimationFrame(UI.initAllMarquees.bind(UI));
    },

    _isSongPlaying(song) {
        const cp = State.get('currentPlayIdx');
        if (cp < 0) return false;
        const pl = State.get('playlist');
        return pl[cp] && pl[cp].id === song.id && pl[cp].source === song.source;
    },

    _createSongRow(song, idx, isPlaying, showActions) {
        const row = document.createElement('div');
        row.className = 'list-row';

        const item = document.createElement('div');
        item.className = 'song-item tv-focusable' + (isPlaying ? ' playing' : '');
        item.tabIndex = 0;
        item.dataset.zone = 'list';

        const artist = UI.artistStr(song);
        const album = song.album || '';

        item.innerHTML =
            `<span class="s-idx">${idx}</span>` +
            `<div class="s-info">` +
                `<div class="s-name">${UI.escHtml(song.name || '未知歌曲')}</div>` +
                `<div class="s-detail scroll-wrap"><span class="scroll-text">${UI.escHtml(artist)}${album ? ' · ' + UI.escHtml(album) : ''}</span></div>` +
            `</div>`;

        row.appendChild(item);

        // 点击歌曲行 → 播放（搜索模式和播放列表模式都适用）
        item.addEventListener('click', () => {
            if (showActions) {
                // 搜索模式：先添加到列表，再播放
                const pl = State.get('playlist');
                const ex = pl.findIndex(s => s.id === song.id && s.source === song.source);
                if (ex >= 0) {
                    State.set('currentPlayIdx', ex);
                } else {
                    pl.push(song);
                    State.set('playlist', pl);
                    State.set('currentPlayIdx', pl.length - 1);
                    State.save();
                }
                Player.play(State.get('currentPlayIdx'));
                UI.showToast(`正在播放: ${song.name || ''}`, true);
            } else {
                // 播放列表模式：直接播放
                const pl = State.get('playlist');
                const i = pl.findIndex(s => s.id === song.id && s.source === song.source);
                if (i >= 0) {
                    State.set('currentPlayIdx', i);
                    Player.play(i);
                }
            }
        });

        if (showActions) {
            const actions = document.createElement('div');
            actions.className = 'song-actions';

            // Play button
            const playBtn = this._createActBtn('▶️', '直接播放', 'act-play', (e) => {
                e.stopPropagation();
                const pl = State.get('playlist');
                const ex = pl.findIndex(s => s.id === song.id && s.source === song.source);
                if (ex >= 0) {
                    State.set('currentPlayIdx', ex);
                } else {
                    pl.push(song);
                    State.set('playlist', pl);
                    State.set('currentPlayIdx', pl.length - 1);
                    State.save();
                }
                Player.play(State.get('currentPlayIdx'));
                UI.showToast(`正在播放: ${song.name || ''}`, true);
            });

            // Add button
            const addBtn = this._createActBtn('➕', '添加到列表', 'act-add', (e) => {
                e.stopPropagation();
                const pl = State.get('playlist');
                if (pl.some(s => s.id === song.id && s.source === song.source)) {
                    UI.showToast('该歌曲已在列表中');
                } else {
                    pl.push(song);
                    State.set('playlist', pl);
                    State.save();
                    UI.showToast(`已添加: ${song.name || ''}`, true);
                }
            });

            actions.appendChild(playBtn);
            actions.appendChild(addBtn);
            row.appendChild(actions);
        } else {
            // 播放列表模式：渲染删除按钮
            const delBtn = document.createElement('div');
            delBtn.className = 'del-btn tv-focusable';
            delBtn.tabIndex = 0;
            delBtn.dataset.zone = 'list';
            delBtn.innerHTML = '✕';
            delBtn.title = '移除';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pl = State.get('playlist');
                const i = pl.findIndex(s => s.id === song.id && s.source === song.source);
                if (i >= 0) {
                    const wasPlaying = (State.get('currentPlayIdx') === i);
                    pl.splice(i, 1);
                    State.set('playlist', pl);
                    let newIdx = State.get('currentPlayIdx');
                    if (wasPlaying) {
                        if (pl.length > 0) {
                            newIdx = Math.min(i, pl.length - 1);
                            State.set('currentPlayIdx', newIdx);
                            Player.play(newIdx);
                        } else {
                            State.set('currentPlayIdx', -1);
                            Player.reset();
                        }
                    } else if (i < State.get('currentPlayIdx')) {
                        State.set('currentPlayIdx', newIdx - 1);
                    }
                    State.save();
                    UI.showToast('已移除', true);
                    Renderer.renderPlaylist();
                }
            });
            row.appendChild(delBtn);
        }

        return row;
    },

    _createActBtn(icon, title, extraClass, handler) {
        const btn = document.createElement('div');
        btn.className = `act-btn tv-focusable ${extraClass || ''}`;
        btn.tabIndex = 0;
        btn.dataset.zone = 'list';
        btn.innerHTML = icon;
        btn.title = title;
        btn.addEventListener('click', handler);
        return btn;
    },

    renderLyricsPlaceholder(text) {
        document.getElementById('lyrics-content').innerHTML =
            `<div class="lyrics-placeholder">${UI.escHtml(text)}</div>`;
    },

    updateSongInfo(song) {
        const titleEl = document.getElementById('song-title');
        const artistEl = document.getElementById('song-artist');
        if (titleEl) titleEl.textContent = song.name || '未知歌曲';
        if (artistEl) {
            artistEl.innerHTML = `<span class="scroll-text">${UI.escHtml(UI.artistStr(song))}</span>`;
            requestAnimationFrame(() => UI.initMarquee(artistEl));
        }
    },

    updateCover(picUrl) {
        if (!picUrl) return;
        const cover = document.getElementById('album-cover');
        const blur = document.getElementById('bg-blur');
        if (cover) cover.src = picUrl;
        if (blur) blur.style.backgroundImage = `url(${picUrl})`;
    },

    updateViewIcon() {
        const btn = document.getElementById('btn-view');
        if (!btn) return;
        const iconEl = btn.querySelector('.c-icon');
        if (iconEl) iconEl.textContent = State.get('view') === 'playlist' ? '📋' : '📂';
    }
};

/* ===================================================================
   SECTION 8: 播放引擎
   =================================================================== */
const Player = {
    _audio() { return document.getElementById('audio-player'); },
    _btnPlay() { return document.getElementById('btn-play'); },

    play(index) {
        if (index < 0 || index >= State.get('playlist').length) return;
        State.set('currentPlayIdx', index);
        const song = State.get('playlist')[index];
        const source = song.target_source || song.source || 'netease';

        Renderer.renderLyricsPlaceholder('加载中...');
        document.getElementById('lyrics-title').textContent = song.name || '歌词';
        Renderer.updateSongInfo(song);

        // Update playing state in list
        if (State.get('view') === 'playlist') {
            Renderer.renderPlaylist();
        } else {
            document.querySelectorAll('.song-item').forEach((el, i) => {
                const sr = State.get('searchResults');
                if (sr && sr[i]) {
                    el.classList.toggle('playing', sr[i].id === song.id && sr[i].source === song.source);
                }
            });
        }

        // Fetch audio URL
        API.getUrl(source, song.id)
            .then(data => {
                if (data && data.url) {
                    const url = data.url.replace(/^http:\/\//i, 'https://');
                    const audio = this._audio();
                    audio.src = url;
                    audio.play().catch(() => {});
                    const icon = this._btnPlay()?.querySelector('.c-icon');
                    if (icon) icon.textContent = '⏸';
                    return url;
                }
                throw new Error('No URL');
            })
            .then(() => {
                // Fetch cover
                if (song.pic_id) {
                    API.getPic(source, song.pic_id).then(d => {
                        if (d?.url) Renderer.updateCover(d.url.replace(/^http:\/\//i, 'https://'));
                    }).catch(() => {});
                }
                // Fetch lyrics
                if (song.lyric_id) {
                    API.getLyric(source, song.lyric_id).then(d => {
                        if (d?.lyric) {
                            const parsed = LYRICS.parse(d.lyric);
                            State.set('parsedLyrics', parsed);
                            if (parsed.length) {
                                LYRICS.render(document.getElementById('lyrics-content'), parsed);
                            } else {
                                const clean = d.lyric.replace(/\[.*?\]/g, '').trim();
                                Renderer.renderLyricsPlaceholder(clean || '纯音乐，请欣赏');
                            }
                        } else {
                            Renderer.renderLyricsPlaceholder('暂无歌词');
                        }
                    }).catch(() => Renderer.renderLyricsPlaceholder('歌词加载失败'));
                } else {
                    Renderer.renderLyricsPlaceholder('暂无歌词');
                }
            })
            .catch(err => {
                console.error(err);
                UI.showToast(`${song.name || ''} 无法播放，跳过`);
                setTimeout(() => this.next(), 500);
            });

        // Media Session API
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: song.name || '',
                artist: UI.artistStr(song),
                album: song.album || ''
            });
        }

        State.save();
    },

    toggle() {
        const audio = this._audio();
        if (audio.src) {
            if (audio.paused) {
                audio.play();
                const icon = this._btnPlay()?.querySelector('.c-icon');
                if (icon) icon.textContent = '⏸';
            } else {
                audio.pause();
                const icon = this._btnPlay()?.querySelector('.c-icon');
                if (icon) icon.textContent = '▶️';
            }
        } else if (State.get('playlist').length) {
            this.play(0);
        } else {
            UI.showToast('没有可播放的歌曲');
        }
    },

    next() {
        const pl = State.get('playlist');
        if (!pl.length) return;
        const mode = CONFIG.PLAY_MODES[State.get('modeIdx')].id;

        if (mode === 'single') {
            const audio = this._audio();
            audio.currentTime = 0;
            audio.play();
            return;
        }

        let n;
        if (mode === 'random') {
            n = pl.length > 1 ? (() => { let r; do { r = Math.floor(Math.random() * pl.length); } while (r === State.get('currentPlayIdx')); return r; })() : 0;
        } else {
            n = State.get('currentPlayIdx') + 1;
            if (n >= pl.length) {
                if (mode === 'loop') n = 0;
                else {
                    const audio = this._audio();
                    audio.pause();
                    const icon = this._btnPlay()?.querySelector('.c-icon');
                    if (icon) icon.textContent = '▶️';
                    UI.showToast('列表结束');
                    return;
                }
            }
        }
        this.play(n);
    },

    prev() {
        const pl = State.get('playlist');
        if (!pl.length) return;
        const mode = CONFIG.PLAY_MODES[State.get('modeIdx')].id;

        let p;
        if (mode === 'random') {
            p = Math.floor(Math.random() * pl.length);
        } else {
            p = State.get('currentPlayIdx') - 1;
            if (p < 0) p = mode === 'loop' ? pl.length - 1 : 0;
        }
        this.play(p);
    },

    seek(delta) {
        const audio = this._audio();
        if (audio.src && !isNaN(audio.duration)) {
            audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
            UI.showToast(delta > 0 ? `快进 ${Math.abs(delta)}s` : `快退 ${Math.abs(delta)}s`, true);
        }
    },

    reset() {
        const audio = this._audio();
        audio.pause();
        audio.src = '';
        document.getElementById('song-title').textContent = 'Solara TV';
        document.getElementById('song-artist').innerHTML = '<span class="scroll-text">准备播放</span>';
        Renderer.renderLyricsPlaceholder('等待播放...');
        document.getElementById('lyrics-title').textContent = '歌词';
        const fill = document.getElementById('progress-fill');
        if (fill) fill.style.width = '0%';
        const cur = document.getElementById('progress-time-current');
        const tot = document.getElementById('progress-time-total');
        if (cur) cur.textContent = '00:00';
        if (tot) tot.textContent = '00:00';
        Renderer.updateCover(null);
        const cover = document.getElementById('album-cover');
        if (cover) {
            cover.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect fill='%231a1a2e' width='400' height='400'/%3E%3Ctext x='200' y='200' text-anchor='middle' dominant-baseline='central' font-size='80' fill='%23444'%3E🎵%3C/text%3E%3C/svg%3E";
        }
        LYRICS._lastHL = -1;
    }
};

/* ===================================================================
   SECTION 9: 搜索管理器（防抖 + 分页）
   =================================================================== */
const SearchManager = {
    _debounceTimer: null,

    async doSearch(keyword, page = 1, append = false) {
        if (State.get('isSearching')) return;
        State.update({ isSearching: true, searchKeyword: keyword, searchPage: page });

        const loadingEl = document.getElementById('loading');
        if (!append) Renderer._songListEl().innerHTML = '';
        loadingEl.style.display = 'block';

        State.set('view', 'search');
        Renderer.updateViewIcon();

        try {
            const sourceId = CONFIG.SOURCES[State.get('sourceIdx')].id;
            const data = await API.search(keyword, sourceId, page);
            const songs = Array.isArray(data) ? data : (data.data || data.result || []);

            if (songs?.length) {
                const enriched = songs.map(s => ({ ...s, target_source: sourceId }));
                State.update({ searchResults: enriched, hasMorePages: songs.length >= CONFIG.PAGE_SIZE });
                if (State.get('view') === 'search') Renderer.renderSearchResults();
                else Renderer.renderPlaylist();
                UI.showToast(`第 ${page} 页 · ${songs.length} 首`, true);
                setTimeout(() => NAVIGATOR.focusFirstSong(), 100);
            } else {
                State.update({ searchResults: [], hasMorePages: false });
                Renderer.renderSearchResults();
                UI.showToast('未找到歌曲，试试切换音源');
            }
        } catch (err) {
            console.error(err);
            UI.showToast('搜索失败：网络错误');
        } finally {
            loadingEl.style.display = 'none';
            State.set('isSearching', false);
        }
    },

    debouncedSearch(keyword) {
        clearTimeout(this._debounceTimer);
        if (!keyword.trim()) return;
        this._debounceTimer = setTimeout(() => this.doSearch(keyword.trim()), CONFIG.DEBOUNCE_SEARCH);
    }
};

/* ===================================================================
   SECTION 10: 键盘事件绑定
   =================================================================== */
function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
        let key = e.keyCode;
        if (key === 23) key = 13; // DPAD_CENTER
        if (key === 13) State.set('_enterHandled', true);

        const ae = document.activeElement;
        const isInput = ae === document.getElementById('search-input');

        // 空格切换播放
        if (key === 32 && !isInput) { e.preventDefault(); Player.toggle(); return; }

        // 搜索输入框
        if (isInput) {
            if (key === 13) {
                e.preventDefault();
                const kw = ae.value.trim();
                if (kw) { SearchManager.doSearch(kw, 1, false); ae.blur(); }
                return;
            }
            if (key === 40) {
                e.preventDefault();
                State.set('focusZone', 'list');
                const songs = document.querySelectorAll('.song-item.tv-focusable');
                if (songs.length) {
                    songs[0].focus();
                    const all = NAVIGATOR.getListItems();
                    State.set('listFocusIdx', all.indexOf(songs[0]));
                }
                return;
            }
            if (key === 37 && ae.selectionStart === 0) {
                e.preventDefault();
                State.set('focusZone', 'ctrl');
                State.set('ctrlPos', { row: 0, col: 4 });
                NAVIGATOR.focusCtrl(0, 4);
                return;
            }
            return;
        }

        if ([37, 38, 39, 40, 13, 27].includes(key)) e.preventDefault();

        const zone = State.get('focusZone');

        if (zone === 'ctrl') {
            const pos = State.get('ctrlPos');
            switch (key) {
                case 37:
                    if (pos.col > 0) { pos.col--; State.set('ctrlPos', pos); NAVIGATOR.focusCtrl(pos.row, pos.col); }
                    break;
                case 39:
                    if (pos.col === 4) {
                        State.set('focusZone', 'list');
                        document.getElementById('search-input')?.focus();
                        State.set('listFocusIdx', 0);
                    } else {
                        pos.col++; State.set('ctrlPos', pos); NAVIGATOR.focusCtrl(pos.row, pos.col);
                    }
                    break;
                case 38: if (pos.row > 0) { pos.row--; State.set('ctrlPos', pos); NAVIGATOR.focusCtrl(pos.row, pos.col); } break;
                case 40: if (pos.row < 1) { pos.row++; State.set('ctrlPos', pos); NAVIGATOR.focusCtrl(pos.row, pos.col); } break;
                case 13: ae?.click(); break;
            }
            return;
        }

        if (zone === 'list') {
            const items = NAVIGATOR.getListItems();
            let ci = items.indexOf(ae);
            if (ci === -1) ci = 0;

            switch (key) {
                case 38: {
                    const t = NAVIGATOR.skipNonSong(items, ci, -1);
                    if (t >= 0) { items[t].focus(); State.set('listFocusIdx', t); items[t] !== document.getElementById('search-input') && items[t].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
                    break;
                }
                case 40: {
                    const t = NAVIGATOR.skipNonSong(items, ci, 1);
                    if (t >= 0) { items[t].focus(); State.set('listFocusIdx', t); items[t].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
                    break;
                }
                case 37: {
                    const cls = ae.className;
                    if (cls.includes('act-btn') || cls.includes('del-btn')) {
                        const si = ae.closest('.list-row')?.querySelector('.song-item');
                        if (si) { si.focus(); State.set('listFocusIdx', items.indexOf(si)); }
                    } else {
                        State.set('focusZone', 'ctrl');
                        const isInput = ae === document.getElementById('search-input');
                        State.set('ctrlPos', isInput ? { row: 0, col: 4 } : { row: 1, col: 2 });
                        if (isInput) {
                            NAVIGATOR.focusCtrl(0, 4);
                        } else {
                            NAVIGATOR.enterCtrlFromLeft();
                        }
                    }
                    break;
                }
                case 39: {
                    if (ae.classList.contains('song-item')) {
                        const row = ae.closest('.list-row');
                        const fb = row?.querySelector('.act-btn, .del-btn');
                        if (fb) { fb.focus(); State.set('listFocusIdx', items.indexOf(fb)); }
                    } else if (ae.classList.contains('act-btn')) {
                        const row = ae.closest('.list-row');
                        const btns = row ? Array.from(row.querySelectorAll('.act-btn')) : [];
                        const bi = btns.indexOf(ae);
                        if (bi >= 0 && bi < btns.length - 1) btns[bi + 1].focus();
                    }
                    break;
                }
                case 13: ae?.click(); break;
            }
        }
    });

    // keyup 兼容
    document.addEventListener('keyup', (e) => {
        if ((e.keyCode === 13 || e.keyCode === 23 || e.key === 'Enter') && !State.get('_enterHandled')) {
            const ae = document.activeElement;
            if (ae && ae !== document.body) { e.preventDefault(); ae.click(); }
        }
        State.set('_enterHandled', false);
    });
}

/* ===================================================================
   SECTION 11: 按钮事件绑定
   =================================================================== */
function bindButtons() {
    const $ = (id) => document.getElementById(id);

    $('btn-search')?.addEventListener('click', () => {
        const kw = $('search-input')?.value.trim();
        if (kw) { SearchManager.doSearch(kw, 1, false); }
        else { UI.showToast('请先输入关键词'); State.set('focusZone', 'list'); $('search-input')?.focus(); }
    });

    $('btn-source')?.addEventListener('click', () => {
        State.set('sourceIdx', (State.get('sourceIdx') + 1) % CONFIG.SOURCES.length);
        const s = CONFIG.SOURCES[State.get('sourceIdx')];
        const st = $('btn-source')?.querySelector('.c-text');
        if (st) st.textContent = s.name;
        UI.showToast(`音源: ${s.name}`, true);
    });

    $('btn-mode')?.addEventListener('click', () => {
        State.set('modeIdx', (State.get('modeIdx') + 1) % CONFIG.PLAY_MODES.length);
        const m = CONFIG.PLAY_MODES[State.get('modeIdx')];
        const mi = $('btn-mode')?.querySelector('.c-icon');
        if (mi) mi.textContent = m.icon;
        UI.showToast(`模式: ${m.desc}`, true);
    });

    $('btn-play')?.addEventListener('click', () => Player.toggle());
    $('btn-prev')?.addEventListener('click', () => Player.prev());
    $('btn-next')?.addEventListener('click', () => Player.next());

    $('btn-rewind')?.addEventListener('click', () => Player.seek(-10));
    $('btn-forward')?.addEventListener('click', () => Player.seek(10));

    $('btn-go-list')?.addEventListener('click', () => NAVIGATOR.focusFirstSong());

    $('btn-view')?.addEventListener('click', () => {
        State.set('view', State.get('view') === 'search' ? 'playlist' : 'search');
        Renderer.updateViewIcon();
        const pl = State.get('playlist');
        UI.showToast(State.get('view') === 'search' ? '搜索结果' : `播放列表 (${pl.length})`, true);
        if (State.get('view') === 'search') Renderer.renderSearchResults();
        else Renderer.renderPlaylist();
    });

    $('btn-prev-page')?.addEventListener('click', () => {
        if (State.get('searchPage') > 1 && State.get('searchKeyword'))
            SearchManager.doSearch(State.get('searchKeyword'), State.get('searchPage') - 1);
    });
    $('btn-next-page')?.addEventListener('click', () => {
        if (State.get('hasMorePages') && State.get('searchKeyword'))
            SearchManager.doSearch(State.get('searchKeyword'), State.get('searchPage') + 1);
    });

    // 音频事件
    const audio = $('audio-player');
    audio?.addEventListener('timeupdate', () => {
        UI.updateProgress(audio);
        const ct = audio.currentTime;
        const parsed = State.get('parsedLyrics');
        const lc = document.getElementById('lyrics-content');
        if (parsed && lc) LYRICS.highlight(ct, parsed, lc);
    });
    audio?.addEventListener('ended', () => Player.next());
    audio?.addEventListener('error', () => {
        UI.showToast('播放出错，跳下一首');
        setTimeout(() => Player.next(), 1000);
    });
}

/* ===================================================================
   SECTION 12: 初始化入口
   =================================================================== */
function init() {
    bindKeyboard();
    bindButtons();

    const restored = State.restore();
    if (restored && State.get('playlist').length) {
        UI.showToast(`已恢复 ${State.get('playlist').length} 首歌曲`, true);
    }

    // 恢复 UI 状态
    const src = CONFIG.SOURCES[State.get('sourceIdx')];
    const stEl = document.querySelector('#btn-source .c-text');
    if (stEl) stEl.textContent = src.name;
    const mode = CONFIG.PLAY_MODES[State.get('modeIdx')];
    const miEl = document.querySelector('#btn-mode .c-icon');
    if (miEl) miEl.textContent = mode.icon;

    Renderer.renderCurrentView = () => {
        if (State.get('view') === 'search') Renderer.renderSearchResults();
        else Renderer.renderPlaylist();
    };
    Renderer.renderCurrentView();

    // 初始焦点
    setTimeout(() => {
        NAVIGATOR.focusCtrl(1, 2);
    }, 300);
}

/* ===================================================================
   启动
   =================================================================== */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

})();
