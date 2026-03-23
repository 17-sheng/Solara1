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

    // ================= 三栏空间导航逻辑 =================
    let currentZone = 'left'; 
    let lastLeftIndex = 0;
    let lastMiddleIndex = 0;
    let lastRightIndex = 2; // 默认聚焦到播放键

    function getFocusables(zone) { return Array.from(document.querySelectorAll(`.tv-focusable[data-zone="${zone}"]`)); }

    // 智能处理左侧列表的上下移动（跳过同一行的删除按钮）
    function moveVerticalLeft(direction) {
        const els = getFocusables('left');
        let idx = els.indexOf(document.activeElement);
        if (idx === -1) idx = 0;

        const isInput = els[idx].tagName === 'INPUT';
        const isDelete = els[idx].classList.contains('delete-btn');
        const isSong = els[idx].classList.contains('song-item');

        if (direction === 'up') {
            if (isInput) return; // 到顶了
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
                if (els.length > 1) els[1].focus(); // 输入框往下进入第一首歌
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
        // 如果焦点在输入框，允许左右键移动光标
        if (document.activeElement.tagName === 'INPUT' && (e.keyCode === 37 || e.keyCode === 39)) {
             // 只有在按下右键且处于输入框末尾时，才允许跳转到中栏（这里简化：直接按右键跳转到中栏）
             if (e.keyCode === 39) {
                 lastLeftIndex = 0;
                 currentZone = 'middle';
                 getFocusables('middle')[lastMiddleIndex].focus();
                 e.preventDefault();
             }
             return; 
        }

        if ([37, 38, 39, 40, 13, 32].includes(e.keyCode) && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault(); // 阻止页面默认滚动
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
                    } else { // 从最左边的播放控制回到中栏
                        currentZone = 'middle';
                        getFocusables('middle')[lastMiddleIndex].focus();
                    }
                } else if (currentZone === 'middle') {
                    currentZone = 'left';
                    const leftEls = getFocusables('left');
                    if (leftEls[lastLeftIndex]) leftEls[lastLeftIndex].focus();
                } else if (currentZone === 'left') {
                    if (focusables[currentIndex].classList.contains('delete-btn')) {
                        focusables[currentIndex - 1].focus(); // 从删除键回到歌曲
                    }
                }
                break;
            case 39: // RIGHT
                if (currentZone === 'left') {
                    lastLeftIndex = currentIndex;
                    if (focusables[currentIndex].classList.contains('song-item') && focusables[currentIndex + 1]?.classList.contains('delete-btn')) {
                        focusables[currentIndex + 1].focus(); // 去删除键
                    } else { // 跨越到中栏
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
                if (document.activeElement.tagName !== 'INPUT') {
                    document.activeElement.click();
                }
                break;
        }

        if (document.activeElement && currentZone === 'left' && document.activeElement.tagName !== 'INPUT') {
            document.activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // ================= 逻辑操作绑定 =================
    searchInput.focus(); // 初始焦点

    btnSource.addEventListener('click', () => {
        currentSourceIndex = (currentSourceIndex + 1) % SOURCES.length;
        btnSource.innerText = `源: ${SOURCES[currentSourceIndex].name}`;
    });

    btnView.addEventListener('click', () => {
        currentView = currentView === 'search' ? 'playlist' : 'search';
        updateView();
    });

    function updateView() {
        btnView.innerText = currentView === 'search' ? `视图: 搜索` : `视图: 列表(${playlist.length})`;
        renderList(currentView === 'search' ? searchResults : playlist);
    }

    btnSearch.addEventListener('click', () => {
        const keyword = searchInput.value.trim();
        if (keyword) searchSongs(keyword);
        else alert("请输入搜索内容");
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
                alert("该歌曲无法播放 (可能因版权受限)");
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
        }
    }

    btnMode.addEventListener('click', () => {
        currentModeIndex = (currentModeIndex + 1) % PLAY_MODES.length;
        const mode = PLAY_MODES[currentModeIndex];
        btnMode.innerText = mode.icon;
        btnMode.title = mode.desc;
        const oldLrc = lyricsTextEl.innerText;
        lyricsTextEl.innerText = `已切换至：${mode.desc}`;
        setTimeout(() => lyricsTextEl.innerText = oldLrc, 1500);
    });

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
