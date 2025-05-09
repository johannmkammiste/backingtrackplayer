document.addEventListener('DOMContentLoaded', function() {
    const setlistTitle = document.getElementById('setlist-player-title');
    const songsListEl = document.getElementById('setlist-songs'); // Renamed for clarity
    const currentSongName = document.getElementById('current-song-name');
    const currentSongBpm = document.getElementById('current-song-bpm');
    const timeRemainingDisplay = document.getElementById('time-remaining');
    const prevBtn = document.getElementById('previous-btn');
    const playBtn = document.getElementById('play-btn');
    const stopBtn = document.getElementById('stop-btn');
    const nextBtn = document.getElementById('next-btn');
    // const keyboardStatusEl = document.getElementById('keyboard-status'); // If you need to update this

    let currentSetlistId = null;
    let currentSongIndex = 0;
    let currentSetlist = { songs: [] }; // Store song details including duration
    let isPlayingOrLoading = false; // True if playing or a play/preload action is in progress
    let isActivelyPreloading = false; // Specifically for the preload state
    let preloadedSongId = null; // ID of the song that has been successfully preloaded
    let timerInterval = null;
    // let currentSongDuration = 0; // Already available in currentSetlist.songs[currentSongIndex].duration
    let remainingSeconds = 0;
    let currentPreloadController = null; // AbortController for preloading

    function _showGlobalNotification(message, type = 'info') {
        if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(message, type);
        } else {
            console.warn('setlist_player.js: window.showGlobalNotification function not found. Using alert as fallback.');
            alert(`${type.toUpperCase()}: ${message}`);
        }
    }

    const pathParts = window.location.pathname.split('/');
    currentSetlistId = parseInt(pathParts[pathParts.length - 2]);

    if (isNaN(currentSetlistId)) {
        console.error('Invalid setlist ID from URL.');
        if(currentSongName) currentSongName.textContent = "Error: Invalid Setlist ID";
        [prevBtn, playBtn, stopBtn, nextBtn].forEach(btn => { if(btn) btn.disabled = true; });
        return;
    }

    initPlayer();

    function formatTime(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) return "--:--";
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    function startTimer(duration) {
        stopTimer(); // Clear any existing timer
        if (isNaN(duration) || duration <= 0) {
            updateTimerDisplay(0); return;
        }
        remainingSeconds = Math.round(duration);
        updateTimerDisplay(remainingSeconds);
        timerInterval = setInterval(() => {
            remainingSeconds--;
            updateTimerDisplay(remainingSeconds);
            if (remainingSeconds <= 0) {
                stopTimer();
                // Optionally auto-advance or stop, handled by playback logic
            }
        }, 1000);
    }

    function stopTimer() {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        // Update display to show song length when stopped and not preloading/playing
        if (!isPlayingOrLoading && currentSetlist.songs[currentSongIndex]) {
            const songDuration = currentSetlist.songs[currentSongIndex].duration || 0;
            if(timeRemainingDisplay) timeRemainingDisplay.textContent = `Length: ${formatTime(songDuration)}`;
        } else if (!isPlayingOrLoading) {
            if(timeRemainingDisplay) timeRemainingDisplay.textContent = "Length: --:--";
        }
        remainingSeconds = 0;
    }

    function updateTimerDisplay(seconds) {
        if (timeRemainingDisplay) {
            timeRemainingDisplay.textContent = `Time: ${formatTime(seconds)}`;
        }
    }

    async function triggerPreload(songIndexToPreload) {
        if (currentPreloadController) currentPreloadController.abort(); // Abort previous preload
        currentPreloadController = new AbortController();
        const signal = currentPreloadController.signal;

        if (songIndexToPreload < 0 || songIndexToPreload >= currentSetlist.songs.length) {
            currentPreloadController = null; return;
        }
        const songToPreload = currentSetlist.songs[songIndexToPreload];
        if (!songToPreload || !songToPreload.id) {
            currentPreloadController = null; return;
        }
        if (preloadedSongId === songToPreload.id && !isActivelyPreloading) { // Already preloaded and not currently in another preload action
            currentPreloadController = null; return;
        }

        console.log(`Preloading song: '${songToPreload.name}' (ID: ${songToPreload.id})`);
        isActivelyPreloading = true;
        preloadedSongId = null; // Invalidate previous preload ID

        if (!isPlayingOrLoading && playBtn) { // Update button only if not already playing/loading
            playBtn.disabled = true;
            playBtn.textContent = '⏳ Preloading...';
        }
        _showGlobalNotification(`Preloading '${songToPreload.name}'...`, 'info');

        try {
            const response = await fetch(`/api/setlists/${currentSetlistId}/song/${songToPreload.id}/preload`, {
                method: 'POST', signal: signal
            });
            const data = await response.json();
            if (signal.aborted) { console.log('Preload aborted for', songToPreload.name); return; }
            if (!response.ok || !data.success) {
                throw new Error(data.error || `Failed to preload '${songToPreload.name}'`);
            }
            preloadedSongId = data.preloaded_song_id; // Store the ID of the successfully preloaded song
            console.log(`Successfully preloaded song ID ${preloadedSongId} ('${songToPreload.name}')`);
            _showGlobalNotification(`'${songToPreload.name}' is ready.`, 'success');
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error in triggerPreload:', error);
                _showGlobalNotification(error.message, 'error');
                preloadedSongId = null; // Clear on error
            }
        } finally {
            if (currentPreloadController && currentPreloadController.signal === signal) {
                currentPreloadController = null; // Clear controller if this was the one finishing
            }
            isActivelyPreloading = false;
            if (!isPlayingOrLoading && playBtn) { // Re-enable play button if appropriate
                playBtn.disabled = false;
                playBtn.textContent = '▶ Play';
            }
        }
    }

    async function playCurrentSong() {
        if (isActivelyPreloading) {
            _showGlobalNotification("Please wait, song is preloading...", "info"); return;
        }
        if (isPlayingOrLoading) return; // Already playing or loading to play
        if (currentSetlist.songs.length === 0 || currentSongIndex >= currentSetlist.songs.length) {
            _showGlobalNotification("No valid song selected or end of setlist.", "warning"); return;
        }

        isPlayingOrLoading = true; // Set loading state
        const songToPlay = currentSetlist.songs[currentSongIndex];
        if(playBtn) { playBtn.disabled = true; playBtn.textContent = '⏳ Loading...'; }

        try {
            // Ensure the correct song is preloaded before playing, or play directly
            if (preloadedSongId !== songToPlay.id) {
                _showGlobalNotification(`Preloading '${songToPlay.name}' before playback...`, 'info');
                await triggerPreload(currentSongIndex); // Await preload
                if (preloadedSongId !== songToPlay.id) { // Check if preload was successful for THIS song
                    throw new Error(`Preload failed for '${songToPlay.name}', cannot play.`);
                }
            }

            const response = await fetch(`/api/setlists/${currentSetlistId}/play`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_song_index: currentSongIndex }) // Backend uses this to confirm
            });
            const responseData = await response.json();
            if (!response.ok) throw new Error(responseData.error || `HTTP error! status: ${response.status}`);
            if (responseData.success && responseData.current_song_id === songToPlay.id) {
                if(currentSongName) currentSongName.textContent = responseData.song_name;
                if(currentSongBpm) currentSongBpm.textContent = `BPM: ${responseData.song_tempo}`;
                setActiveSongUI(currentSongIndex);
                if(playBtn) playBtn.textContent = '⏸ Playing'; // Now it's playing
                startTimer(responseData.duration); // responseData.duration should be from backend
                // isPlayingOrLoading remains true
            } else {
                throw new Error(responseData.error || 'Playback initiation failed on backend.');
            }
        } catch (error) {
            console.error('Error in playCurrentSong:', error);
            _showGlobalNotification(`Playback Error: ${error.message}`, 'error');
            isPlayingOrLoading = false; // Reset state on error
            if(playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }
            stopTimer(); // Ensure timer is stopped
            updateNowPlayingUI(songToPlay); // Revert UI to show current song as stopped
        } finally {
            if(playBtn) playBtn.disabled = false; // Re-enable button unless still playing
            // isPlayingOrLoading is handled by success or error path
        }
    }

    async function stopPlayback() {
        console.log("Stop playback requested.");
        const songAtStop = currentSetlist.songs[currentSongIndex];

        if (currentPreloadController) { currentPreloadController.abort(); currentPreloadController = null; }
        isActivelyPreloading = false;
        stopTimer();

        if (!isPlayingOrLoading && playBtn && playBtn.textContent === '▶ Play') { // Already stopped
            if(playBtn) playBtn.disabled = false;
            if(stopBtn) stopBtn.disabled = false; // Ensure stop button is enabled if it was disabled
            if (songAtStop) updateNowPlayingUI(songAtStop);
            return;
        }

        const wasPlaying = isPlayingOrLoading;
        isPlayingOrLoading = false; // Set state to not playing
        if(stopBtn) { stopBtn.disabled = true; stopBtn.textContent = 'Stopping...';}
        if(playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }

        try {
            const response = await fetch('/api/stop', { method: 'POST' });
            const data = await response.json();
            if (!response.ok || !data.success) {
                console.warn("Backend /api/stop reported failure or no action:", data.error || "Unknown");
                 if(wasPlaying) _showGlobalNotification("Stop command sent, but backend reported an issue.", "warning");
            } else {
                if(wasPlaying) _showGlobalNotification("Playback stopped.", "info");
            }
        } catch (error) {
            console.error('Error calling /api/stop:', error);
            _showGlobalNotification('Error stopping playback: ' + error.message, 'error');
        } finally {
            if(playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }
            if(stopBtn) { stopBtn.disabled = false; stopBtn.textContent = '⏹ Stop'; }
            // isPlayingOrLoading is already false
            if (songAtStop) updateNowPlayingUI(songAtStop);
            else if (currentSetlist.songs.length > 0) updateNowPlayingUI(currentSetlist.songs[0]); // Default to first song if current is undefined
            else if(timeRemainingDisplay) timeRemainingDisplay.textContent = "Length: --:--";
        }
    }

    async function handleNextSong() {
        if (currentSetlist.songs.length === 0) return;
        if (isPlayingOrLoading || isActivelyPreloading) await stopPlayback(); // Stop current before moving
        if (isPlayingOrLoading || isActivelyPreloading) return; // If stop failed or still busy

        let nextIndex = currentSongIndex + 1;
        if (nextIndex >= currentSetlist.songs.length) {
            _showGlobalNotification('Reached end of setlist.', 'info');
            // Optional: loop back to start or just stay on last song
            // nextIndex = 0; // Loop to start
            // For now, just stay on last and allow re-preloading it if needed
            nextIndex = currentSetlist.songs.length - 1;
            if (currentSongIndex === nextIndex && currentSetlist.songs[nextIndex]) { // If already on last song
                 updateNowPlayingUI(currentSetlist.songs[nextIndex]);
                 triggerPreload(nextIndex); // Re-preload current (last) song
                return;
            }
        }
        currentSongIndex = nextIndex;
        setActiveSongUI(currentSongIndex);
        updateNowPlayingUI(currentSetlist.songs[currentSongIndex]);
        triggerPreload(currentSongIndex); // Preload the new current song
    }

    async function handlePreviousSong() {
        if (currentSetlist.songs.length === 0) return;
        if (isPlayingOrLoading || isActivelyPreloading) await stopPlayback();
        if (isPlayingOrLoading || isActivelyPreloading) return;

        let prevIndex = currentSongIndex - 1;
        if (prevIndex < 0) {
            _showGlobalNotification('Already at the first song.', 'info');
            prevIndex = 0; // Stay at first song
             if (currentSongIndex === prevIndex && currentSetlist.songs[prevIndex]) { // If already on first song
                 updateNowPlayingUI(currentSetlist.songs[prevIndex]);
                 triggerPreload(prevIndex); // Re-preload current (first) song
                return;
            }
        }
        currentSongIndex = prevIndex;
        setActiveSongUI(currentSongIndex);
        updateNowPlayingUI(currentSetlist.songs[currentSongIndex]);
        triggerPreload(currentSongIndex);
    }

    function initPlayer() {
        const songItemsFromDOM = document.querySelectorAll('#setlist-songs .song-item');
        currentSetlist.songs = Array.from(songItemsFromDOM).map(item => {
            const nameEl = item.querySelector('.song-name');
            const detailsEl = item.querySelector('.song-details'); // Contains BPM and original duration
            const songId = parseInt(item.dataset.songId);
            const duration = parseFloat(item.dataset.duration) || 0; // Duration in seconds from backend
            const tempoMatch = detailsEl ? detailsEl.textContent.match(/(\d+)\s*BPM/i) : null;
            if (!nameEl || isNaN(songId) || !tempoMatch) return null;
            return { id: songId, name: nameEl.textContent, tempo: parseInt(tempoMatch[1]), duration: duration };
        }).filter(song => song !== null);

        if (currentSetlist.songs.length === 0) {
            if(currentSongName) currentSongName.textContent = "Setlist is empty";
            [prevBtn, playBtn, stopBtn, nextBtn].forEach(btn => { if(btn) btn.disabled = true; });
        } else {
            attachSongItemClickListeners();
            setActiveSongUI(0); // currentSongIndex is already 0
            updateNowPlayingUI(currentSetlist.songs[0]);
            triggerPreload(0); // Preload the first song
        }

        if(playBtn) playBtn.addEventListener('click', playCurrentSong);
        if(stopBtn) stopBtn.addEventListener('click', stopPlayback);
        if(prevBtn) prevBtn.addEventListener('click', handlePreviousSong);
        if(nextBtn) nextBtn.addEventListener('click', handleNextSong);
    }

    function attachSongItemClickListeners() {
        document.querySelectorAll('#setlist-songs .song-item').forEach((item) => {
            const songId = parseInt(item.dataset.songId);
            const songInSetlist = currentSetlist.songs.find(s => s.id === songId);
            if (!songInSetlist) return; // Should not happen if DOM matches currentSetlist.songs

            item.addEventListener('click', async () => {
                const clickedSongIndex = currentSetlist.songs.findIndex(s => s.id === songId);
                if (clickedSongIndex === -1) return;
                if (currentSongIndex === clickedSongIndex && (isPlayingOrLoading || (playBtn && playBtn.textContent === '⏸ Playing'))) {
                    return; // Already selected and playing/loading
                }
                if (isPlayingOrLoading || isActivelyPreloading) await stopPlayback();
                if (isPlayingOrLoading || isActivelyPreloading) return; // If stop failed or still busy

                currentSongIndex = clickedSongIndex;
                setActiveSongUI(currentSongIndex);
                updateNowPlayingUI(currentSetlist.songs[currentSongIndex]);
                triggerPreload(currentSongIndex);
            });
        });
    }

    function setActiveSongUI(index) {
        document.querySelectorAll('#setlist-songs .song-item').forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });
        const activeItem = document.querySelector('#setlist-songs .song-item.active');
        if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function updateNowPlayingUI(song) {
        if (!song) {
            if(currentSongName) currentSongName.textContent = "Error: Song data missing";
            if(currentSongBpm) currentSongBpm.textContent = "BPM: --";
            if(timeRemainingDisplay) timeRemainingDisplay.textContent = "Length: --:--";
            return;
        }
        if(currentSongName) currentSongName.textContent = song.name;
        if(currentSongBpm) currentSongBpm.textContent = `BPM: ${song.tempo}`;
        if (!isPlayingOrLoading && !isActivelyPreloading && !timerInterval) { // Only update to length if truly idle
             if(timeRemainingDisplay) timeRemainingDisplay.textContent = `Length: ${formatTime(song.duration || 0)}`;
        }
    }
});
