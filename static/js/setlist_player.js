document.addEventListener('DOMContentLoaded', function() {
    const setlistTitle = document.getElementById('setlist-player-title');
    const songsList = document.getElementById('setlist-songs');
    const currentSongName = document.getElementById('current-song-name');
    const currentSongBpm = document.getElementById('current-song-bpm');
    const timeRemainingDisplay = document.getElementById('time-remaining');
    const prevBtn = document.getElementById('previous-btn');
    const playBtn = document.getElementById('play-btn');
    const stopBtn = document.getElementById('stop-btn');
    const nextBtn = document.getElementById('next-btn');

    let currentSetlistId = null;
    let currentSongIndex = 0;
    let currentSetlist = { songs: [] };
    let isPlayingOrLoading = false;
    let isActivelyPreloading = false;
    let preloadedSongId = null;
    let timerInterval = null;
    let currentSongDuration = 0;
    let remainingSeconds = 0;
    let currentPreloadController = null;

    // Initialize player
    const pathParts = window.location.pathname.split('/');
    currentSetlistId = parseInt(pathParts[pathParts.length - 2]);

    if (isNaN(currentSetlistId)) {
        console.error('Invalid setlist ID');
        currentSongName.textContent = "Error: Invalid Setlist ID";
        [prevBtn, playBtn, stopBtn, nextBtn].forEach(btn => btn.disabled = true);
        return;
    }

    initPlayer();

    // Helper functions
    function formatTime(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) return "--:--";
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    function startTimer(duration) {
        stopTimer();
        if (isNaN(duration) || duration <= 0) {
            updateTimerDisplay(0);
            return;
        }
        currentSongDuration = duration;
        remainingSeconds = Math.round(duration);
        updateTimerDisplay(remainingSeconds);
        timerInterval = setInterval(() => {
            remainingSeconds--;
            updateTimerDisplay(remainingSeconds);
            if (remainingSeconds <= 0) {
                stopTimer();
            }
        }, 1000);
    }

    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (!isPlayingOrLoading && currentSetlist.songs[currentSongIndex]) {
            timeRemainingDisplay.textContent = `Length: ${formatTime(currentSetlist.songs[currentSongIndex].duration || 0)}`;
        } else if (!isPlayingOrLoading) {
            timeRemainingDisplay.textContent = "Length: --:--";
        }
        remainingSeconds = 0;
    }

    function updateTimerDisplay(seconds) {
        if (timeRemainingDisplay) {
            timeRemainingDisplay.textContent = `Time: ${formatTime(seconds)}`;
        }
    }

    // Core player functions
    async function triggerPreload(songIndexToPreload) {
        if (currentPreloadController) {
            currentPreloadController.abort();
        }
        currentPreloadController = new AbortController();
        const signal = currentPreloadController.signal;

        if (songIndexToPreload < 0 || songIndexToPreload >= currentSetlist.songs.length) {
            currentPreloadController = null;
            return;
        }

        const songToPreload = currentSetlist.songs[songIndexToPreload];
        if (!songToPreload || !songToPreload.id) {
            currentPreloadController = null;
            return;
        }

        if (preloadedSongId === songToPreload.id && !isActivelyPreloading) {
            currentPreloadController = null;
            return;
        }

        console.log(`Preloading song: '${songToPreload.name}'`);
        isActivelyPreloading = true;
        preloadedSongId = null;
        if (!isPlayingOrLoading) {
            playBtn.disabled = true;
            playBtn.textContent = '⏳ Preloading...';
        }
        showNotification(`Preloading '${songToPreload.name}'...`, 'info');

        try {
            const response = await fetch(`/api/setlists/${currentSetlistId}/song/${songToPreload.id}/preload`, {
                method: 'POST',
                signal: signal
            });
            const data = await response.json();

            if (!response.ok || !data.success) {
                if (signal.aborted) return;
                throw new Error(data.error || `Failed to preload '${songToPreload.name}'`);
            }

            preloadedSongId = data.preloaded_song_id;
            console.log(`Successfully preloaded ${preloadedSongId}`);
            showNotification(`'${songToPreload.name}' is ready.`, 'success');

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error in triggerPreload:', error);
                showNotification(error.message, 'error');
                preloadedSongId = null;
            }
        } finally {
            if (currentPreloadController && currentPreloadController.signal === signal) {
                currentPreloadController = null;
            }
            isActivelyPreloading = false;

            if (!isPlayingOrLoading && !isActivelyPreloading) {
                playBtn.disabled = false;
                playBtn.textContent = '▶ Play';
            }
        }
    }

    async function playCurrentSong() {
        if (isActivelyPreloading) {
            showNotification("Please wait, song is preloading...", "info");
            return;
        }
        if (isPlayingOrLoading) return;
        if (currentSetlist.songs.length === 0 || currentSongIndex >= currentSetlist.songs.length) {
            showNotification("No valid song selected.", "warning");
            return;
        }

        isPlayingOrLoading = true;
        const songToPlay = currentSetlist.songs[currentSongIndex];
        playBtn.disabled = true;
        playBtn.textContent = '⏳ Loading...';

        try {
            const response = await fetch(`/api/setlists/${currentSetlistId}/play`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_song_index: currentSongIndex })
            });
            const responseData = await response.json();

            if (!response.ok) {
                throw new Error(responseData.error || `HTTP error! status: ${response.status}`);
            }

            if (responseData.success && responseData.current_song_index === currentSongIndex) {
                currentSongName.textContent = responseData.song_name;
                currentSongBpm.textContent = `BPM: ${responseData.song_tempo}`;
                setActiveSong(currentSongIndex);
                playBtn.textContent = '⏸ Playing';
                playBtn.disabled = false;
                startTimer(responseData.duration);
                preloadedSongId = responseData.current_song_id;
            } else {
                throw new Error(responseData.error || 'Playback failed');
            }
        } catch (error) {
            console.error('Error in playCurrentSong:', error);
            showNotification(`Playback Error: ${error.message}`, 'error');
            isPlayingOrLoading = false;
            playBtn.textContent = '▶ Play';
            playBtn.disabled = false;
            stopTimer();
            updateNowPlaying(songToPlay);
        }
    }

    async function stopPlayback() {
        console.log("Stop playback requested.");
        const songAtStop = currentSetlist.songs[currentSongIndex];

        if (currentPreloadController) {
            currentPreloadController.abort();
            currentPreloadController = null;
        }
        isActivelyPreloading = false;

        stopTimer();

        if (!isPlayingOrLoading && playBtn.textContent === '▶ Play') {
            playBtn.textContent = '▶ Play';
            playBtn.disabled = false;
            stopBtn.disabled = false;
            if (songAtStop) updateNowPlaying(songAtStop);
            return;
        }

        isPlayingOrLoading = false;
        stopBtn.disabled = true;
        stopBtn.textContent = 'Stopping...';
        playBtn.textContent = '▶ Play';
        playBtn.disabled = false;

        try {
            const response = await fetch('/api/stop', { method: 'POST' });
            const data = await response.json();
            if (!response.ok || !data.success) {
                console.warn("Backend /api/stop reported failure:", data.error || "Unknown");
            }
        } catch (error) {
            console.error('Error calling /api/stop:', error);
            showNotification('Error stopping playback: ' + error.message, 'error');
        } finally {
            playBtn.textContent = '▶ Play';
            playBtn.disabled = false;
            stopBtn.disabled = false;
            stopBtn.textContent = '⏹ Stop';
            isPlayingOrLoading = false;

            if (songAtStop) {
                updateNowPlaying(songAtStop);
            } else if (currentSetlist.songs.length > 0) {
                updateNowPlaying(currentSetlist.songs[0]);
            } else {
                timeRemainingDisplay.textContent = "Length: --:--";
            }
        }
    }

    async function handleNextSong() {
        if (currentSetlist.songs.length === 0) return;

        if (isPlayingOrLoading || isActivelyPreloading) {
            await stopPlayback();
        }
        if (isPlayingOrLoading || isActivelyPreloading) return;

        let nextIndex = currentSongIndex + 1;
        if (nextIndex >= currentSetlist.songs.length) {
            showNotification('Reached end of setlist.', 'info');
            nextIndex = currentSetlist.songs.length - 1;
            if (currentSongIndex === nextIndex) {
                triggerPreload(currentSongIndex);
                return;
            }
        }

        currentSongIndex = nextIndex;
        setActiveSong(currentSongIndex);
        updateNowPlaying(currentSetlist.songs[currentSongIndex]);
        triggerPreload(currentSongIndex);
    }

    async function handlePreviousSong() {
        if (currentSetlist.songs.length === 0) return;

        if (isPlayingOrLoading || isActivelyPreloading) {
            await stopPlayback();
        }
        if (isPlayingOrLoading || isActivelyPreloading) return;

        let prevIndex = currentSongIndex - 1;
        if (prevIndex < 0) {
            showNotification('Already at the first song.', 'info');
            prevIndex = 0;
            if (currentSongIndex === prevIndex) {
                triggerPreload(currentSongIndex);
                return;
            }
        }

        currentSongIndex = prevIndex;
        setActiveSong(currentSongIndex);
        updateNowPlaying(currentSetlist.songs[currentSongIndex]);
        triggerPreload(currentSongIndex);
    }

    function initPlayer() {
        const songItems = document.querySelectorAll('.song-item');
        currentSetlist.songs = Array.from(songItems).map(item => {
            const nameEl = item.querySelector('.song-name');
            const detailsEl = item.querySelector('.song-details');
            const songId = parseInt(item.dataset.songId);
            const duration = parseFloat(item.dataset.duration) || 0;
            const tempoMatch = detailsEl ? detailsEl.textContent.match(/(\d+)\s*BPM/i) : null;

            if (!nameEl || isNaN(songId) || !tempoMatch) {
                return null;
            }

            return {
                id: songId,
                name: nameEl.textContent,
                tempo: parseInt(tempoMatch[1]),
                duration: duration
            };
        }).filter(song => song !== null);

        if (currentSetlist.songs.length === 0) {
            currentSongName.textContent = "Setlist is empty";
            [prevBtn, playBtn, stopBtn, nextBtn].forEach(btn => btn.disabled = true);
        } else {
            renderSongsList();
            setActiveSong(0);
            updateNowPlaying(currentSetlist.songs[0]);
            triggerPreload(0);
        }

        playBtn.addEventListener('click', playCurrentSong);
        stopBtn.addEventListener('click', stopPlayback);
        prevBtn.addEventListener('click', handlePreviousSong);
        nextBtn.addEventListener('click', handleNextSong);
    }

    function renderSongsList() {
        document.querySelectorAll('.song-item').forEach((item) => {
            const songId = parseInt(item.dataset.songId);
            if (!currentSetlist.songs.some(s => s.id === songId)) {
                return;
            }

            item.addEventListener('click', async () => {
                const clickedSongIndex = currentSetlist.songs.findIndex(s => s.id === songId);
                if (clickedSongIndex === -1) return;

                if (currentSongIndex === clickedSongIndex &&
                    (isPlayingOrLoading || playBtn.textContent === '⏸ Playing')) {
                    return;
                }

                if (isPlayingOrLoading || isActivelyPreloading) {
                    await stopPlayback();
                }
                if (isPlayingOrLoading || isActivelyPreloading) return;

                currentSongIndex = clickedSongIndex;
                setActiveSong(currentSongIndex);
                updateNowPlaying(currentSetlist.songs[currentSongIndex]);
                triggerPreload(currentSongIndex);
            });
        });
    }

    function setActiveSong(index) {
        document.querySelectorAll('.song-item').forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });
        const activeItem = document.querySelector(`.song-item.active`);
        if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function updateNowPlaying(song) {
        if (!song) {
            currentSongName.textContent = "Error: Song data missing";
            currentSongBpm.textContent = "BPM: --";
            timeRemainingDisplay.textContent = "Length: --:--";
            return;
        }
        currentSongName.textContent = song.name;
        currentSongBpm.textContent = `BPM: ${song.tempo}`;
        if (!isPlayingOrLoading && !isActivelyPreloading && !timerInterval) {
            timeRemainingDisplay.textContent = `Length: ${formatTime(song.duration || 0)}`;
        }
    }

    function showNotification(message, type = 'info') {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        } else {
            alert(`${type.toUpperCase()}: ${message}`);
        }
    }
});