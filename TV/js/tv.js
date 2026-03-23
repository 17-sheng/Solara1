// TV/js/tv.js

document.addEventListener('DOMContentLoaded', () => {
    // ================= 1. 基础配置与 API 设置 =================
    const API_BASE = 'https://music-api.gdstudio.xyz/api.php';
    const DEFAULT_SOURCE = 'netease'; // 根据文档，稳定源推荐 netease
    
    // ================= 2. 遥控器空间导航逻辑 =================
    const KEY_UP = 38, KEY_DOWN = 40, KEY_LEFT = 37, KEY_RIGHT = 39, KEY_ENTER = 13;
    let currentZone = 'left'; 
    let lastLeftFocusIndex = 0; 
    let lastRightFocusIndex = 1; // 右侧默认焦点落在播放按钮上

    function getFocusables(zone) {
        return Array.from(document.querySelectorAll(`.tv-focusable[data-zone="${zone}"]`));
    }

    window.addEventListener('keydown', (e) => {
        const focusables = getFocusables(currentZone);
        let currentIndex = focusables.indexOf(document.activeElement);

        switch (e.keyCode) {
            case KEY_UP:
                if (currentIndex > 0) focusables[currentIndex - 1].focus();
                e.preventDefault();
                break;
            case KEY_DOWN:
                if (currentIndex < focusables.length - 1) focusables[currentIndex + 1].focus();
                e.preventDefault();
                break;
            case KEY_LEFT:
                if (currentZone === 'right') {
                    lastRightFocusIndex = currentIndex; 
                    currentZone = 'left';
                    const leftFocusables = getFocusables('left');
                    if (leftFocusables[lastLeftFocusIndex]) leftFocusables[lastLeftFocusIndex].focus();
                }
                e.preventDefault();
                break;
            case KEY_RIGHT:
                if (currentZone === 'left') {
                    lastLeftFocusIndex = Math.max(0, currentIndex);
                    currentZone = 'right';
                    const rightFocusables = getFocusables('right');
                    if (rightFocusables[lastRightFocusIndex]) rightFocusables[lastRightFocusIndex].focus();
                }
                e.preventDefault();
                break;
            case KEY_ENTER:
                if (document.activeElement) document.activeElement.click();
                e.preventDefault();
                break;
        }

        if (document.activeElement && currentZone === 'left') {
            document.activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // ================= 3. 音乐播放与 GD Studio API 逻辑 =================
    const audio = document.getElementById('audio-player');
    const songListEl = document.getElementById('song-list');
    const searchBtn = document.getElementById('search-btn');
    const btnPlay = document.getElementById('btn-play');
    const lyricsTextEl = document.getElementById('lyrics-text');
    
    let currentPlaylist = [];
    let currentPlayIndex = -1;

    // 初始化焦点
    searchBtn.focus();

    // 搜索交互
    searchBtn.addEventListener('click', () => {
        const keyword = prompt("请输入要搜索的歌曲或歌手：", "周杰伦");
        if (keyword) {
            searchSongs(keyword);
        }
    });

    // 搜索 API
    async function searchSongs(keyword) {
        document.getElementById('loading').style.display = 'block';
        songListEl.innerHTML = '';
        try {
            // 使用 GD Studio 的搜索接口
            const url = `${API_BASE}?types=search&source=${DEFAULT_SOURCE}&name=${encodeURIComponent(keyword)}&count=30`;
            const res = await fetch(url);
            const data = await res.json();
            
            // MKOnlinePlayer API 通常直接返回数组，或者包在对象里
            const songs = Array.isArray(data) ? data : (data.data || data.result || []);
            
            if (songs && songs.length > 0) {
                currentPlaylist = songs;
                renderSongList(currentPlaylist);
            } else {
                alert("未找到歌曲，请尝试更换关键词");
            }
        } catch (error) {
            console.error("搜索失败", error);
            alert("搜索失败，网络错误或API受限(5分钟50次)");
        } finally {
            document.getElementById('loading').style.display = 'none';
        }
    }

    // 渲染歌曲列表
    function renderSongList(songs) {
        songListEl.innerHTML = '';
        songs.forEach((song, index) => {
            const li = document.createElement('li');
            li.className = 'song-item tv-focusable';
            li.tabIndex = 0;
            li.dataset.zone = 'left';
            
            // GD Studio API 返回的 artist 是一个数组
            const artistName = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '未知歌手');
            
            li.innerHTML = `
                <div>${index + 1}. ${song.name}</div>
                <div class="artist">${artistName} - ${song.album || '未知专辑'}</div>
            `;
            
            li.addEventListener('click', () => {
                playSong(song, index);
            });
            
            songListEl.appendChild(li);
        });

        // 自动聚焦到第一首歌
        if (songs.length > 0) {
            setTimeout(() => {
                const focusables = getFocusables('left');
                if (focusables.length > 1) focusables[1].focus(); 
            }, 100);
        }
    }

    // 核心：获取播放地址、封面、歌词并播放
    async function playSong(song, index) {
        currentPlayIndex = index;
        const artistName = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || '');
        
        document.getElementById('song-title').innerText = song.name;
        document.getElementById('song-artist').innerText = artistName;
        lyricsTextEl.innerText = "正在获取音频和歌词...";
        
        const source = song.source || DEFAULT_SOURCE;

        try {
            // 1. 获取播放 URL
            const urlRes = await fetch(`${API_BASE}?types=url&source=${source}&id=${song.id}`);
            const urlData = await urlRes.json();
            
            if (urlData && urlData.url) {
                audio.src = urlData.url.replace(/^http:\/\//i, 'https://'); // 强制 HTTPS
                audio.play();
                btnPlay.innerText = '⏸️';
            } else {
                alert("该歌曲无法播放 (可能因版权受限)");
                playNext();
                return;
            }

            // 2. 获取专辑封面 (使用 pic_id)
            if (song.pic_id) {
                const picRes = await fetch(`${API_BASE}?types=pic&source=${source}&id=${song.pic_id}&size=500`);
                const picData = await picRes.json();
                if (picData && picData.url) {
                    document.getElementById('album-cover').src = picData.url.replace(/^http:\/\//i, 'https://');
                }
            }

            // 3. 获取歌词 (使用 lyric_id)
            if (song.lyric_id) {
                const lrcRes = await fetch(`${API_BASE}?types=lyric&source=${source}&id=${song.lyric_id}`);
                const lrcData = await lrcRes.json();
                if (lrcData && lrcData.lyric) {
                    // 这里做一个简单的歌词展示，真正的滚动解析比较复杂，先展示文本
                    const cleanLyric = lrcData.lyric.replace(/\[.*?\]/g, '').trim();
                    lyricsTextEl.innerText = cleanLyric || "纯音乐，请欣赏";
                } else {
                    lyricsTextEl.innerText = "暂无歌词";
                }
            }

        } catch (error) {
            console.error("播放流程出错", error);
            lyricsTextEl.innerText = "获取失败";
        }
    }

    // ================= 4. 播放控制 =================
    btnPlay.addEventListener('click', () => {
        if (audio.src) {
            if (audio.paused) {
                audio.play();
                btnPlay.innerText = '⏸️';
            } else {
                audio.pause();
                btnPlay.innerText = '▶️';
            }
        }
    });

    document.getElementById('btn-prev').addEventListener('click', () => {
        if (currentPlayIndex > 0) {
            playSong(currentPlaylist[currentPlayIndex - 1], currentPlayIndex - 1);
        }
    });

    document.getElementById('btn-next').addEventListener('click', playNext);

    function playNext() {
        if (currentPlayIndex < currentPlaylist.length - 1) {
            playSong(currentPlaylist[currentPlayIndex + 1], currentPlayIndex + 1);
        }
    }

    audio.addEventListener('ended', playNext);
});
