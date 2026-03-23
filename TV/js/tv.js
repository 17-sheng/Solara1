// TV/js/tv.js

document.addEventListener('DOMContentLoaded', () => {
    // ================= 1. 遥控器空间导航逻辑 =================
    const KEY_UP = 38, KEY_DOWN = 40, KEY_LEFT = 37, KEY_RIGHT = 39, KEY_ENTER = 13;
    
    // 我们将界面分为左（列表）和右（控制区）两个 Zone
    let currentZone = 'left'; 
    let lastLeftFocusIndex = 0; // 记忆左侧焦点
    let lastRightFocusIndex = 1; // 记忆右侧焦点（默认中间的播放键）

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
                // 如果在右侧，向左按回到左侧区域
                if (currentZone === 'right') {
                    lastRightFocusIndex = currentIndex; // 记住离开前的位置
                    currentZone = 'left';
                    const leftFocusables = getFocusables('left');
                    if (leftFocusables[lastLeftFocusIndex]) leftFocusables[lastLeftFocusIndex].focus();
                }
                e.preventDefault();
                break;
            case KEY_RIGHT:
                // 如果在左侧，向右按进入右侧控制区
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

        // 确保获取焦点的元素在可视区域内（针对长列表）
        if (document.activeElement && currentZone === 'left') {
            document.activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // ================= 2. 音乐播放与 API 逻辑 =================
    const audio = document.getElementById('audio-player');
    const songListEl = document.getElementById('song-list');
    const searchBtn = document.getElementById('search-btn');
    const btnPlay = document.getElementById('btn-play');
    
    let currentPlaylist = [];
    let currentPlayIndex = -1;

    // 默认获取焦点
    searchBtn.focus();

    // 搜索按钮点击事件（在TV上输入比较麻烦，这里可以用 prompt 模拟，实际TV开发通常调用系统虚拟键盘）
    searchBtn.addEventListener('click', () => {
        const keyword = prompt("请输入要搜索的歌曲或歌手：", "周杰伦");
        if (keyword) {
            searchSongs(keyword);
        }
    });

    // 调用原项目的 API 搜索歌曲
    async function searchSongs(keyword) {
        document.getElementById('loading').style.display = 'block';
        songListEl.innerHTML = '';
        try {
            // 注意：因为我们部署在 /TV 下，原接口在根目录，所以用 /api/... 绝对路径
            const res = await fetch(`/api/search?keywords=${encodeURIComponent(keyword)}`);
            const data = await res.json();
            
            if (data.result && data.result.songs) {
                currentPlaylist = data.result.songs;
                renderSongList(currentPlaylist);
            }
        } catch (error) {
            console.error("搜索失败", error);
            alert("搜索失败，请检查网络");
        } finally {
            document.getElementById('loading').style.display = 'none';
        }
    }

    // 渲染左侧列表
    function renderSongList(songs) {
        songListEl.innerHTML = '';
        songs.forEach((song, index) => {
            const li = document.createElement('li');
            li.className = 'song-item tv-focusable';
            li.tabIndex = 0;
            li.dataset.zone = 'left';
            
            const artistName = song.artists ? song.artists.map(a => a.name).join(', ') : '未知歌手';
            li.innerHTML = `
                <div>${index + 1}. ${song.name}</div>
                <div class="artist">${artistName}</div>
            `;
            
            // 点击/按确认键 播放该歌曲
            li.addEventListener('click', () => {
                playSong(song, index);
            });
            
            songListEl.appendChild(li);
        });

        // 渲染完后自动焦点到第一首歌
        if (songs.length > 0) {
            setTimeout(() => {
                getFocusables('left')[1].focus(); // [0]是搜索按钮，[1]是第一首歌
            }, 100);
        }
    }

    // 播放歌曲逻辑
    async function playSong(song, index) {
        currentPlayIndex = index;
        document.getElementById('song-title').innerText = song.name;
        document.getElementById('song-artist').innerText = song.artists ? song.artists.map(a => a.name).join(', ') : '';
        
        try {
            // 获取播放 URL
            const res = await fetch(`/api/song/url?id=${song.id}`);
            const data = await res.json();
            
            if (data.data && data.data[0] && data.data[0].url) {
                const url = data.data[0].url;
                audio.src = url.replace('http://', 'https://'); // 强制 HTTPS 解决混合内容问题
                audio.play();
                btnPlay.innerText = '⏸️';
                
                // 获取封面图 (原API似乎需要单独获取详情，这里简化使用默认或搜索结果中的图)
                if (song.album && song.album.id) {
                     fetchAlbumCover(song.album.id);
                }
            } else {
                alert("无版权或获取播放地址失败");
                playNext(); // 自动跳下一首
            }
        } catch (error) {
            console.error("播放失败", error);
        }
    }

    async function fetchAlbumCover(albumId) {
        try {
            const res = await fetch(`/api/album?id=${albumId}`);
            const data = await res.json();
            if (data.album && data.album.picUrl) {
                document.getElementById('album-cover').src = data.album.picUrl.replace('http://', 'https://');
            }
        } catch(e) {}
    }

    // 播放控制按钮逻辑
    btnPlay.addEventListener('click', () => {
        if (audio.paused) {
            audio.play();
            btnPlay.innerText = '⏸️';
        } else {
            audio.pause();
            btnPlay.innerText = '▶️';
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

    // 自动下一首
    audio.addEventListener('ended', playNext);
});
