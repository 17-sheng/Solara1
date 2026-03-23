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

    let currentView = 'search'; 
    let searchResults = [];     
    let playlist = [];          
    let currentPlayIndex = -1;  

    // ================= DOM 元素 =================
    const searchInput = document.getElementById('search-input');
    const btnSearch = document.getElementById('btn-search');
    const btnSource = document.getElementById('btn-source');
    const btnView = document.getElementById('btn-view');
    const songListEl = document.getElementById('song-list');
    const audio = document.getElementById('audio-player');
    const btnPlay = document.getElementById('btn-play');
    const btnMode = document.getElementById('btn-mode');
    const lyricsTextEl = document.getElementById('lyrics-text');
    const toastEl = document.getElementById('toast');

    // ================= 替代弹窗的 Toast 提示机制 =================
    let toastTimeout;
    function showToast(message, isSuccess = false) {
        toastEl.innerText = message;
        if (isSuccess) toastEl.classList.add('success');
        else toastEl.classList.remove('success');
        
        toastEl.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastEl.classList.remove('show');
        }, 3000);
    }

    // ================= 三栏空间导航逻辑 =================
    let currentZone = 'left'; 
    let lastLeftIndex = 0;
    let lastMiddleIndex = 0;
    let lastRightIndex = 2; // 默认聚焦到播放键

    function getFocusables(zone) { return Array.from(document.querySelectorAll(`.tv-focusable[data-zone="${zone}"]`)); }

    function moveVerticalLeft(direction) {
        const els = getFocusables('left');
        let idx = els.indexOf(document.activeElement);
        if (idx === -1) idx = 0;

        const isInput = els[idx].tagName === 'INPUT';
        const isDelete = els[idx].classList.contains('delete-btn');
        const isSong = els[idx].classList.contains('song-item');

        if (direction === 'up') {
            if (isInput) return; 
            if (isSong) {
                let target = idx - 1;
                while(target >= 0 && els[target].classList.contains('delete-btn')) target--;
                els[target].focus();
            } else if (isDelete) {
                let target = idx - 1;
                while(target >= 0 && !els[target].classList.contains('delete-btn') && els[target].tagName !== 'INPUT') target--;
                if (target >= 0) els[target].focus();
            }
        } else if (direction === 'down') {
            if (isInput) {
                if (els.length > 1) els[1].focus();
            } else if (isSong) {
                let target = idx + 1;
                while(target < els.length && els[target].classList.contains('delete-btn')) target++;
                if (target < els.length) els[target].focus();
            } else if (isDelete) {
                let target = idx + 1;
                while(target < els.length && !els[target].classList.contains('delete-btn')) target++;
                if (target < els.length) els[target].focus();
            }
        }
    }

    window.addEventListener('keydown', (e) => {
        // 如果焦点在输入框，特殊处理
        if (document.activeElement.tagName === 'INPUT') {
            if (e.keyCode === 13) {
                // 如果软键盘按下了确认/搜索键，直接触发搜索
                const keyword = searchInput.value.trim();
                if (keyword) {
                    searchInput.blur(); // 隐藏软键盘
                    searchSongs(keyword);
                }
                return;
            }
            if (e.keyCode === 39) { // 遥控器右键：进入中栏
                lastLeftIndex = 0;
                currentZone = 'middle';
                getFocusables('middle')[lastMiddleIndex].focus();
                e.preventDefault();
                return;
            }
            if (e.keyCode === 40) { // 遥控器下键：进入列表
                moveVerticalLeft('down');
                e.preventDefault();
                return;
            }
            // 允许左右移动输入框内的光标
            return; 
        }

        // 屏蔽常规元素的默认滚动
        if ([37, 38, 39, 40, 13, 32].includes(e.keyCode)) {
            e.preventDefault(); 
        }

        const focusables = getFocusables(currentZone);
        let currentIndex = focusables.indexOf(document.activeElement);
        if (currentIndex === -1) currentIndex = 0;

        switch (e.keyCode) {
            case 38: // UP
                if (currentZone === 'left') moveVerticalLeft('up');
                else if (currentZone === 'middle') {
                    if (currentIndex > 0) focusables[currentIndex - 1].focus();
                }
                break;
            case 40: // DOWN
                if (currentZone === 'left') moveVerticalLeft('down');
                else if (currentZone === 'middle') {
                    if (currentIndex < focusables.length - 1) focusables[currentIndex + 1].focus();
                }
                break;
            case 37: // LEFT
                if (currentZone === 'right') {
                    if (currentIndex > 0) {
                        focusables[currentIndex - 1].focus();
                    } else { 
                        currentZone = 'middle';
                        getFocusables('middle')[lastMiddleIndex].focus();
                    }
                } else if (currentZone === 'middle') {
                    currentZone = 'left';
                    const leftEls = getFocusables('left');
                    if (leftEls[lastLeftIndex]) leftEls[lastLeftIndex].focus();
                } else if (currentZone === 'left') {
                    if (focusables[currentIndex].classList.contains('delete-btn')) {
                        focusables[currentIndex - 1].focus(); 
                    }
                }
                break;
            case 39: // RIGHT
                if (currentZone === 'left') {
                    lastLeftIndex = currentIndex;
                    if (focusables[currentIndex].classList.contains('song-item') && focusables[currentIndex + 1]?.classList.contains('delete-btn')) {
                        focusables[currentIndex + 1].focus(); 
                    } else { 
                        currentZone = 'middle';
                        getFocusables('middle')[lastMiddleIndex].focus();
                    }
                } else if (currentZone === 'middle') {
                    lastMiddleIndex = currentIndex;
                    currentZone = 'right';
                    getFocusables('right')[lastRightIndex].focus();
                } else if (currentZone === 'right') {
                    if (currentIndex < focusables.length - 1) focusables[currentIndex + 1].focus();
                }
                break;
            case 13: // ENTER
            case 32: // SPACE
                document.activeElement.click();
                break;
        }

        if (document.activeElement && currentZone === 'left' && document.activeElement.tagName !== 'INPUT') {
            document.activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // ================= 逻辑操作绑定 =================
    searchInput.focus(); 

    btnSource.addEventListener('click', () => {
        currentSourceIndex = (currentSourceIndex + 1) % SOURCES.length;
        btnSource.innerText = `源: ${SOURCES[currentSourceIndex].name}`;
        showToast(`已切换至: ${SOURCES[currentSourceIndex].name}`, true);
    });

    btnView.addEventListener('click', () => {
        currentView = currentView === 'search' ? 'playlist' : 'search';
        updateView();
    });

    function updateView() {
        btnView.innerText = currentView === 'search' ? `视图: 搜索` : `视图: 列表(${playlist.length})`;
        renderList(currentView === 'search' ? searchResults : playlist);
    }

    // 点击中间的搜索按钮读取输入框的值
    btnSearch.addEventListener('click', () => {
        const keyword = searchInput.value.trim();
        if (keyword) {
            searchSongs(keyword);
        } else {
            showToast("搜索内容不能为空！");
            // 引导用户回到输入框
            currentZone = 'left';
            searchInput.focus();
        }
    });

    // 搜索与渲染逻辑
    async function searchSongs(keyword) {
        document.getElementById('loading').style.display = 'block';
        songListEl.innerHTML = '';
        currentView = 'search'; 
        
        const source = SOURCES[currentSourceIndex].id;
        try {
            const url = `${API_BASE}?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=30`;
            const res = await fetch(url);
            const data = await res.json();
            
            const songs = Array.isArray(data) ? data : (data.data || data.result || []);
            if (songs && songs.length > 0) {
                searchResults = songs.map(s => ({ ...s, target_source: source }));
                updateView();
                showToast("搜索完成", true);
            } else {
                showToast("未找到相关歌曲，请尝试切换音乐源");
            }
        } catch (error) {
            console.error(error);
            showToast("搜索失败：网络错误或 API 调用频繁");
        } finally {
            document.getElementById('loading').style.display = 'none';
        }
    }

    function renderList(listToRender) {
        songListEl.innerHTML = '';
        if (listToRender.length === 0) {
            const tipText = currentView === 'search' ? '暂无搜索结果' : '播放列表为空，快去搜索添加吧';
            songListEl.innerHTML = `<div style="padding: 20px; color:#aaa;">${tipText}</div>`;
            return;
        }

        listToRender.forEach((song, index) => {
            const row = document.createElement('div');
            row.className = 'list-row';

            const songDiv = document.createElement('div');
            songDiv.className = `song-item tv-focusable ${currentView === 'playlist' && currentPlayIndex === index ? 'playing' : ''}`;
            songDiv.tabIndex = 0;
            songDiv.dataset.zone = 'left';
            
            const artistName = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '未知歌手');
            songDiv.innerHTML = `
                <div>${index + 1}. ${song.name}</div>
                <div class="artist">${artistName} - ${song.album || '未知专辑'}</div>
            `;
            
            songDiv.addEventListener('click', () => {
                if (currentView === 'search') {
                    playlist.push(song);
                    currentPlayIndex = playlist.length - 1;
                    playSongFromPlaylist(currentPlayIndex);
                    showToast("已添加到播放列表", true);
                } else {
                    playSongFromPlaylist(index);
                }
            });
            row.appendChild(songDiv);

            if (currentView === 'playlist') {
                const delBtn = document.createElement('div');
                delBtn.className = 'delete-btn tv-focusable';
                delBtn.tabIndex = 0;
                delBtn.dataset.zone = 'left';
                delBtn.innerHTML = '🗑️';
                
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    playlist.splice(index, 1);
                    showToast("已从列表中移除");
                    if (currentPlayIndex === index) {
                        audio.pause();
                        if (playlist.length > 0) playNext(); 
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

    // 播放引擎
    async function playSongFromPlaylist(index) {
        if (index < 0 || index >= playlist.length) return;
        currentPlayIndex = index;
        const song = playlist[index];
        
        if (currentView === 'playlist') updateView();
        
        const artistName = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '');
        document.getElementById('song-title').innerText = song.name;
        document.getElementById('song-artist').innerText = artistName;
        lyricsTextEl.innerText = "正在获取资源...";
        
        const source = song.target_source || song.source || 'netease';

        try {
            const urlRes = await fetch(`${API_BASE}?types=url&source=${source}&id=${song.id}`);
            const urlData = await urlRes.json();
            
            if (urlData && urlData.url) {
                audio.src = urlData.url.replace(/^http:\/\//i, 'https://');
                audio.play();
                btnPlay.innerText = '⏸️';
            } else {
                showToast(`[${song.name}] 无法播放，可能是版权限制`);
                playNext();
                return;
            }

            if (song.pic_id) {
                const picRes = await fetch(`${API_BASE}?types=pic&source=${source}&id=${song.pic_id}&size=500`);
                const picData = await picRes.json();
                if (picData && picData.url) document.getElementById('album-cover').src = picData.url.replace(/^http:\/\//i, 'https://');
            }

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
            console.error(error);
            lyricsTextEl.innerText = "获取失败";
            showToast("网络异常，无法获取播放地址");
        }
    }

    btnMode.addEventListener('click', () => {
        currentModeIndex = (currentModeIndex + 1) % PLAY_MODES.length;
        const mode = PLAY_MODES[currentModeIndex];
        btnMode.innerText = mode.icon;
        btnMode.title = mode.desc;
        showToast(`循环模式: ${mode.desc}`, true);
    });

    btnPlay.addEventListener('click', () => {
        if (audio.src) {
            if (audio.paused) { audio.play(); btnPlay.innerText = '⏸️'; } 
            else { audio.pause(); btnPlay.innerText = '▶️'; }
        } else {
            showToast("当前没有可播放的歌曲");
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

    audio.addEventListener('ended', playNext);
});
