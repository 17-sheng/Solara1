document.addEventListener('DOMContentLoaded', () => {
    const API_BASE = 'https://music-api.gdstudio.xyz/api.php';
    
    // ================= 状态管理 =================
    const SOURCES = [
        { id: 'netease', name: '网易云' },
        { id: 'tencent', name: 'QQ音乐' },
        { id: 'kuwo', name: '酷我' },
        { id: 'joox', name: 'JOOX' },
        { id: 'apple', name: 'Apple' }
    ];
    let currentSourceIndex = 0;

    const PLAY_MODES = [
        { id: 'loop', icon: '🔁', desc: '列表循环' },
        { id: 'single', icon: '🔂', desc: '单曲循环' },
        { id: 'random', icon: '🔀', desc: '随机播放' },
        { id: 'sequence', icon: '⬇️', desc: '顺序播放' }
    ];
    let currentModeIndex = 0;

    let currentView = 'search'; // 'search' 或 'playlist'
    let searchResults = [];     // 搜索结果缓存
    let playlist = [];          // 独立播放列表
    let currentPlayIndex = -1;  // 当前播放歌曲在 playlist 中的索引

    // ================= DOM 元素 =================
    const btnSource = document.getElementById('btn-source');
    const btnSearch = document.getElementById('btn-search');
    const btnView = document.getElementById('btn-view');
    const songListEl = document.getElementById('song-list');
    const audio = document.getElementById('audio-player');
    const btnPlay = document.getElementById('btn-play');
    const btnMode = document.getElementById('btn-mode');
    const lyricsTextEl = document.getElementById('lyrics-text');

    // ================= 空间导航 (Zone: top, left, right) =================
    let currentZone = 'top'; 
    let lastTopIndex = 0, lastLeftIndex = 0, lastRightIndex = 2; // 默认聚焦播放键

    function getFocusables(zone) { return Array.from(document.querySelectorAll(`.tv-focusable[data-zone="${zone}"]`)); }

    window.addEventListener('keydown', (e) => {
        // 屏蔽部分默认按键以防页面乱滚
        if ([37, 38, 39, 40, 13, 32].includes(e.keyCode)) e.preventDefault();

        const focusables = getFocusables(currentZone);
        let currentIndex = focusables.indexOf(document.activeElement);
        if (currentIndex === -1) currentIndex = 0;

        switch (e.keyCode) {
            case 38: // UP
                if (currentZone === 'left') {
                    // 如果在列表顶部，回到 top 区
                    if (currentIndex === 0 || currentIndex === 1) { // 考虑到 song 和 delete 按钮
                        currentZone = 'top';
                        getFocusables('top')[lastTopIndex].focus();
                    } else {
                        // 列表内向上移一行 (2个元素为一行: song, delete)
                        const prevTarget = currentIndex - 2;
                        if (focusables[prevTarget]) focusables[prevTarget].focus();
                        else focusables[0].focus();
                    }
                } else if (currentZone === 'top') {
                    if (currentIndex > 0) focusables[currentIndex - 1].focus();
                } else if (currentZone === 'right') {
                    // 无操作，保持原位
                }
                break;
            case 40: // DOWN
                if (currentZone === 'top') {
                    lastTopIndex = currentIndex;
                    currentZone = 'left';
                    const leftEls = getFocusables('left');
                    if (leftEls[lastLeftIndex]) leftEls[lastLeftIndex].focus();
                    else if (leftEls.length > 0) leftEls[0].focus();
                } else if (currentZone === 'left') {
                    // 列表内向下移一行
                    if (currentIndex + 2 < focusables.length) focusables[currentIndex + 2].focus();
                }
                break;
            case 37: // LEFT
                if (currentZone === 'right') {
                    lastRightIndex = currentIndex;
                    currentZone = 'left';
                    const leftEls = getFocusables('left');
                    if (leftEls[lastLeftIndex]) leftEls[lastLeftIndex].focus();
                    else if (leftEls.length > 0) leftEls[0].focus();
                } else if (currentZone === 'left') {
                    // 左移（比如从删除按钮回到歌曲主体）
                    if (currentIndex > 0) focusables[currentIndex - 1].focus();
                } else if (currentZone === 'top') {
                    if (currentIndex > 0) focusables[currentIndex - 1].focus();
                }
                break;
            case 39: // RIGHT
                if (currentZone === 'left') {
                    lastLeftIndex = currentIndex;
                    // 判断右侧是否有元素（同一行的删除按钮）
                    if (focusables[currentIndex + 1] && focusables[currentIndex + 1].classList.contains('delete-btn')) {
                        focusables[currentIndex + 1].focus();
                    } else {
                        // 进入右侧播放控制区
                        currentZone = 'right';
                        const rightEls = getFocusables('right');
                        if (rightEls[lastRightIndex]) rightEls[lastRightIndex].focus();
                    }
                } else if (currentZone === 'top') {
                    if (currentIndex < focusables.length - 1) focusables[currentIndex + 1].focus();
                } else if (currentZone === 'right') {
                    if (currentIndex < focusables.length - 1) focusables[currentIndex + 1].focus();
                }
                break;
            case 13: // ENTER
            case 32: // SPACE
                if (document.activeElement) document.activeElement.click();
                break;
        }

        if (document.activeElement && currentZone === 'left') {
            document.activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // ================= 顶部操作栏逻辑 =================
    btnSource.focus(); // 初始焦点

    // 切换搜索源
    btnSource.addEventListener('click', () => {
        currentSourceIndex = (currentSourceIndex + 1) % SOURCES.length;
        btnSource.innerText = `源: ${SOURCES[currentSourceIndex].name}`;
    });

    // 切换视图
    btnView.addEventListener('click', () => {
        currentView = currentView === 'search' ? 'playlist' : 'search';
        updateView();
    });

    function updateView() {
        btnView.innerText = currentView === 'search' ? `视图: 搜索结果` : `视图: 播放列表(${playlist.length})`;
        renderList(currentView === 'search' ? searchResults : playlist);
    }

    // 搜索交互
    btnSearch.addEventListener('click', () => {
        const keyword = prompt("请输入要搜索的歌曲或歌手：", "");
        if (keyword) searchSongs(keyword);
    });

    // ================= 搜索与列表渲染 =================
    async function searchSongs(keyword) {
        document.getElementById('loading').style.display = 'block';
        songListEl.innerHTML = '';
        currentView = 'search'; // 搜索后自动切到搜索视图
        
        const source = SOURCES[currentSourceIndex].id;
        try {
            const url = `${API_BASE}?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=30`;
            const res = await fetch(url);
            const data = await res.json();
            
            const songs = Array.isArray(data) ? data : (data.data || data.result || []);
            if (songs && songs.length > 0) {
                // 将当前源信息注入歌曲对象
                searchResults = songs.map(s => ({ ...s, target_source: source }));
                updateView();
            } else {
                alert("未找到歌曲，请尝试切换音乐源");
            }
        } catch (error) {
            console.error(error);
            alert("搜索失败，网络错误或API受限");
        } finally {
            document.getElementById('loading').style.display = 'none';
        }
    }

    function renderList(listToRender) {
        songListEl.innerHTML = '';
        if (listToRender.length === 0) {
            songListEl.innerHTML = `<div style="padding: 20px; color:#aaa;">列表为空</div>`;
            return;
        }

        listToRender.forEach((song, index) => {
            const row = document.createElement('div');
            row.className = 'list-row';

            // 歌曲主体按钮
            const songDiv = document.createElement('div');
            songDiv.className = `song-item tv-focusable ${currentView === 'playlist' && currentPlayIndex === index ? 'playing' : ''}`;
            songDiv.tabIndex = 0;
            songDiv.dataset.zone = 'left';
            
            const artistName = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '未知歌手');
            songDiv.innerHTML = `
                <div>${index + 1}. ${song.name}</div>
                <div class="artist">${artistName} - ${song.album || '未知专辑'}</div>
            `;
            
            // 点击事件
            songDiv.addEventListener('click', () => {
                if (currentView === 'search') {
                    // 搜索视图：添加到播放列表并立刻播放
                    playlist.push(song);
                    currentPlayIndex = playlist.length - 1; // 播放最后一首
                    playSongFromPlaylist(currentPlayIndex);
                } else {
                    // 播放列表视图：直接播放
                    playSongFromPlaylist(index);
                }
            });
            row.appendChild(songDiv);

            // 如果是播放列表视图，添加删除按钮
            if (currentView === 'playlist') {
                const delBtn = document.createElement('div');
                delBtn.className = 'delete-btn tv-focusable';
                delBtn.tabIndex = 0;
                delBtn.dataset.zone = 'left';
                delBtn.innerHTML = '🗑️';
                
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    playlist.splice(index, 1);
                    // 修正当前播放索引
                    if (currentPlayIndex === index) {
                        audio.pause();
                        if (playlist.length > 0) playNext(); // 删除当前播放，播下一首
                        else currentPlayIndex = -1;
                    } else if (currentPlayIndex > index) {
                        currentPlayIndex--; 
                    }
                    updateView();
                });
                row.appendChild(delBtn);
            }

            songListEl.appendChild(row);
        });
    }

    // ================= 播放控制引擎 =================
    async function playSongFromPlaylist(index) {
        if (index < 0 || index >= playlist.length) return;
        currentPlayIndex = index;
        const song = playlist[index];
        
        // 刷新列表 UI (高亮正在播放的行)
        if (currentView === 'playlist') updateView();
        
        const artistName = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '');
        document.getElementById('song-title').innerText = song.name;
        document.getElementById('song-artist').innerText = artistName;
        lyricsTextEl.innerText = "正在获取资源...";
        
        const source = song.target_source || song.source || 'netease';

        try {
            // 获取 URL
            const urlRes = await fetch(`${API_BASE}?types=url&source=${source}&id=${song.id}`);
            const urlData = await urlRes.json();
            
            if (urlData && urlData.url) {
                audio.src = urlData.url.replace(/^http:\/\//i, 'https://');
                audio.play();
                btnPlay.innerText = '⏸️';
            } else {
                alert("该歌曲无法播放 (可能因版权受限)");
                playNext();
                return;
            }

            // 获取封面
            if (song.pic_id) {
                const picRes = await fetch(`${API_BASE}?types=pic&source=${source}&id=${song.pic_id}&size=500`);
                const picData = await picRes.json();
                if (picData && picData.url) document.getElementById('album-cover').src = picData.url.replace(/^http:\/\//i, 'https://');
            }

            // 获取歌词
            if (song.lyric_id) {
                const lrcRes = await fetch(`${API_BASE}?types=lyric&source=${source}&id=${song.lyric_id}`);
                const lrcData = await lrcRes.json();
                if (lrcData && lrcData.lyric) {
                    lyricsTextEl.innerText = lrcData.lyric.replace(/\[.*?\]/g, '').trim() || "纯音乐，请欣赏";
                } else {
                    lyricsTextEl.innerText = "暂无歌词";
                }
            }
        } catch (error) {
            console.error("播放流程出错", error);
            lyricsTextEl.innerText = "获取失败";
        }
    }

    // 循环模式切换
    btnMode.addEventListener('click', () => {
        currentModeIndex = (currentModeIndex + 1) % PLAY_MODES.length;
        const mode = PLAY_MODES[currentModeIndex];
        btnMode.innerText = mode.icon;
        btnMode.title = mode.desc;
        // 给出简单的提示 (由于TV没法悬停看title，所以暂时用歌词区域闪一下提示)
        const oldLrc = lyricsTextEl.innerText;
        lyricsTextEl.innerText = `已切换至：${mode.desc}`;
        setTimeout(() => lyricsTextEl.innerText = oldLrc, 1500);
    });

    // 播放逻辑
    btnPlay.addEventListener('click', () => {
        if (audio.src) {
            if (audio.paused) { audio.play(); btnPlay.innerText = '⏸️'; } 
            else { audio.pause(); btnPlay.innerText = '▶️'; }
        }
    });

    document.getElementById('btn-prev').addEventListener('click', playPrev);
    document.getElementById('btn-next').addEventListener('click', playNext);

    function playNext() {
        if (playlist.length === 0) return;
        const mode = PLAY_MODES[currentModeIndex].id;
        
        if (mode === 'single') {
            audio.currentTime = 0;
            audio.play();
            return;
        }

        let nextIndex = currentPlayIndex;
        if (mode === 'random') {
            nextIndex = Math.floor(Math.random() * playlist.length);
        } else {
            nextIndex++;
            if (nextIndex >= playlist.length) {
                if (mode === 'loop') nextIndex = 0;
                else if (mode === 'sequence') {
                    // 顺序播放到底部，停止
                    audio.pause();
                    btnPlay.innerText = '▶️';
                    return; 
                }
            }
        }
        playSongFromPlaylist(nextIndex);
    }

    function playPrev() {
        if (playlist.length === 0) return;
        const mode = PLAY_MODES[currentModeIndex].id;
        
        let prevIndex = currentPlayIndex - 1;
        if (mode === 'random') {
            prevIndex = Math.floor(Math.random() * playlist.length);
        } else if (prevIndex < 0) {
            prevIndex = mode === 'loop' ? playlist.length - 1 : 0;
        }
        playSongFromPlaylist(prevIndex);
    }

    // 歌曲结束自动触发
    audio.addEventListener('ended', playNext);
});
