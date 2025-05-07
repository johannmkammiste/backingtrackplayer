document.addEventListener('DOMContentLoaded', function () {
    // ... (Keep variables: setlistTitle, songsList, currentSongName, etc.) ...
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

    // --- NEW: Controller for cancelling preload fetch requests ---
    let currentPreloadController = null;

    const pathParts = window.location.pathname.split('/');
    currentSetlistId = parseInt(pathParts[pathParts.length - 2]);

    if (isNaN(currentSetlistId)) {
        console.error('Invalid setlist ID');
        currentSongName.textContent = "Error: Invalid Setlist ID";
        [prevBtn, playBtn, stopBtn, nextBtn].forEach(btn => btn.disabled = true);
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
        stopTimer();
        if (isNaN(duration) || duration <= 0) {
            console.warn("startTimer called with invalid duration:", duration);
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
                console.log("Timer finished.");
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

    // --- UPDATED: triggerPreload with AbortController ---
    async function triggerPreload(songIndexToPreload) {
        // Cancel previous preload fetch if it's still running
        if (currentPreloadController) {
            console.log("Aborting previous preload request...");
            currentPreloadController.abort();
        }
        // Create a new controller for the new request
        currentPreloadController = new AbortController();
        const signal = currentPreloadController.signal;

        if (songIndexToPreload < 0 || songIndexToPreload >= currentSetlist.songs.length) {
            console.warn("triggerPreload: Invalid song index", songIndexToPreload);
            currentPreloadController = null; // Reset controller
            return;
        }
        const songToPreload = currentSetlist.songs[songIndexToPreload];
        if (!songToPreload || !songToPreload.id) {
            console.error("triggerPreload: Song data is invalid for index", songIndexToPreload);
            currentPreloadController = null;
            return;
        }

        // Avoid redundant preloads if already done and not currently preloading something else
        if (preloadedSongId === songToPreload.id && !isActivelyPreloading) {
            console.log(`Song '${songToPreload.name}' (ID: ${songToPreload.id}) is already preloaded.`);
             if (!isPlayingOrLoading) { // Ensure button is correct if nothing else is happening
                 playBtn.textContent = '▶ Play';
                 playBtn.disabled = false;
             }
            currentPreloadController = null; // Reset controller
            return;
        }

        console.log(`Preloading song: '${songToPreload.name}' (ID: ${songToPreload.id})`);
        isActivelyPreloading = true;
        preloadedSongId = null; // Invalidate previous preloaded song ID until this one confirms
        // Set button state only if not currently playing
        if (!isPlayingOrLoading) {
            playBtn.disabled = true;
            playBtn.textContent = '⏳ Preloading...';
        }
        showNotification(`Preloading '${songToPreload.name}'...`, 'info');

        try {
            const response = await fetch(`/api/setlists/${currentSetlistId}/song/${songToPreload.id}/preload`, {
                method: 'POST',
                signal: signal // Pass the signal to fetch
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                 // Check if error was due to abort
                 if (signal.aborted) {
                     // Don't throw, just log and exit cleanly for aborts
                     console.log(`Preload for '${songToPreload.name}' aborted.`);
                     // Don't change preloadedSongId or button state here, let the next preload handle it
                     return; // Exit function early
                 }
                 throw new Error(data.error || `Failed to preload '${songToPreload.name}'`);
            }
            // Success!
            preloadedSongId = data.preloaded_song_id; // Store the successfully preloaded song's ID
            console.log(`Successfully preloaded ${preloadedSongId}`);
            showNotification(`'${songToPreload.name}' is ready.`, 'success');

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`Preload request for '${songToPreload.name}' was aborted.`);
            } else {
                console.error('Error in triggerPreload:', error);
                showNotification(error.message, 'error');
                preloadedSongId = null; // Clear preloaded ID on failure
            }
        } finally {
            // Check if the controller associated with *this* finished request is still the active one
             if (currentPreloadController && currentPreloadController.signal === signal) {
                 currentPreloadController = null; // This request is done, clear its controller
             }
             isActivelyPreloading = false; // Mark preloading as finished for this attempt

            // Final UI update based on the *current* state, not just this finished preload attempt
            if (!isPlayingOrLoading && !isActivelyPreloading) { // If nothing else is happening
                 playBtn.disabled = false;
                 // Set text based on whether the *currently selected* song is the one confirmed preloaded
                 if (currentSetlist.songs[currentSongIndex]?.id === preloadedSongId) {
                     playBtn.textContent = '▶ Play'; // Ready!
                 } else {
                     playBtn.textContent = '▶ Play'; // Default if preload failed or selection changed
                 }
            } else if (isPlayingOrLoading) {
                // If playback started, button text is handled by playCurrentSong/stopPlayback
            } else if (isActivelyPreloading) {
                // If *another* preload started, button text is '⏳ Preloading...'
                playBtn.textContent = '⏳ Preloading...';
                playBtn.disabled = true;
            }
        }
    }


    function initPlayer() {
        // ... (same parsing logic as before) ...
         const songItems = document.querySelectorAll('.song-item');
        currentSetlist.songs = Array.from(songItems).map(item => {
            const nameEl = item.querySelector('.song-name');
            const detailsEl = item.querySelector('.song-details');
            const songId = parseInt(item.dataset.songId);
            const duration = parseFloat(item.dataset.duration) || 0;
            const tempoMatch = detailsEl ? detailsEl.textContent.match(/(\d+)\s*BPM/i) : null;
            if (!nameEl || isNaN(songId) || !tempoMatch) {
                console.warn("Could not parse song data for item:", item);
                return null;
            }
            return { id: songId, name: nameEl.textContent, tempo: parseInt(tempoMatch[1]), duration: duration };
        }).filter(song => song !== null);


        if (currentSetlist.songs.length === 0) {
            console.warn("No valid songs found in the setlist player.");
            currentSongName.textContent = "Setlist is empty";
            [prevBtn, playBtn, stopBtn, nextBtn].forEach(btn => btn.disabled = true);
        } else {
            renderSongsList();
            setActiveSong(0);
            updateNowPlaying(currentSetlist.songs[0]);
            triggerPreload(0); // Preload the first song
        }

        playBtn.addEventListener('click', playCurrentSong);
        stopBtn.addEventListener('click', stopPlayback);
        // Link new handler names
        prevBtn.addEventListener('click', handlePreviousSong);
        nextBtn.addEventListener('click', handleNextSong);
    }

    function renderSongsList() {
        document.querySelectorAll('.song-item').forEach((item) => {
            const songId = parseInt(item.dataset.songId);
            if (!currentSetlist.songs.some(s => s.id === songId)) {
                console.warn(`Skipping event listener for item with unknown song ID: ${songId}`);
                return;
            }
            item.addEventListener('click', async () => {
                const clickedSongIndex = currentSetlist.songs.findIndex(s => s.id === songId);
                 if (clickedSongIndex === -1) return;

                if (currentSongIndex === clickedSongIndex && (isPlayingOrLoading || playBtn.textContent === '⏸ Playing')) return;

                if (isPlayingOrLoading || isActivelyPreloading) {
                    await stopPlayback(); // Stop current playback if any
                }
                 if (isPlayingOrLoading) { // Check again
                    console.warn("Song click: Previous action stop might not have completed."); return;
                 }

                currentSongIndex = clickedSongIndex;
                setActiveSong(currentSongIndex);
                updateNowPlaying(currentSetlist.songs[currentSongIndex]);
                triggerPreload(currentSongIndex); // Preload the newly selected song
            });
        });
    }

    function setActiveSong(index) {
        // ... (same as before) ...
        document.querySelectorAll('.song-item').forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });
        const activeItem = document.querySelector(`.song-item.active`);
        if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function updateNowPlaying(song) {
        // ... (same as before, ensures Length is shown when idle) ...
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

    async function playCurrentSong() {
        if (isActivelyPreloading) { // Prevent play if background preload is running
            showNotification("Please wait, song is preloading...", "info");
            return;
        }
        if (isPlayingOrLoading) { // Prevent play if already playing/loading playback
            console.log("playCurrentSong: Already playing or loading playback, request ignored.");
            return;
        }
        if (currentSetlist.songs.length === 0 || currentSongIndex >= currentSetlist.songs.length || currentSongIndex < 0) {
            showNotification("No valid song selected.", "warning");
            return;
        }

        // Now safe to proceed
        isPlayingOrLoading = true; // Mark that we are initiating playback
        const songToPlay = currentSetlist.songs[currentSongIndex];
        console.log(`playCurrentSong: Requesting playback for '${songToPlay.name}' (Index: ${currentSongIndex})`);

        playBtn.disabled = true;
        playBtn.textContent = '⏳ Loading...'; // Indicates initiating playback sequence

        try {
            const response = await fetch(`/api/setlists/${currentSetlistId}/play`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_song_index: currentSongIndex })
            });
            const responseData = await response.json();
            if (!response.ok) { throw new Error(responseData.error || `HTTP error! status: ${response.status}`); }

            if (responseData.success && responseData.current_song_index === currentSongIndex) {
                console.log("Playback started successfully by backend.");
                currentSongName.textContent = responseData.song_name;
                currentSongBpm.textContent = `BPM: ${responseData.song_tempo}`;
                setActiveSong(currentSongIndex);
                playBtn.textContent = '⏸ Playing';
                playBtn.disabled = false; // Enable stop/pause interaction
                startTimer(responseData.duration);
                preloadedSongId = responseData.current_song_id; // Update confirmed active/preloaded song
                // isPlayingOrLoading remains true
            } else {
                 throw new Error(responseData.error || 'Playback failed or backend played wrong song.');
            }
        } catch (error) {
            console.error('Error in playCurrentSong:', error);
            showNotification(`Playback Error: ${error.message}`, 'error');
            isPlayingOrLoading = false; // Reset flag on error
            playBtn.textContent = '▶ Play';
            playBtn.disabled = false;
            stopTimer();
            updateNowPlaying(songToPlay);
        }
        // If successful, isPlayingOrLoading remains true until stopPlayback is called
    }

     async function stopPlayback() {
        console.log("Stop playback requested.");
        const songAtStop = currentSetlist.songs[currentSongIndex];

        // --- Cancel ongoing preload fetch if any ---
         if (currentPreloadController) {
             console.log("Aborting any active preload request due to stop.");
             currentPreloadController.abort();
             currentPreloadController = null;
         }
         isActivelyPreloading = false;
         // -----------------------------------------

        stopTimer(); // Stop client timer

        // If not actually playing or trying to load playback, just reset UI and exit
        if (!isPlayingOrLoading && playBtn.textContent === '▶ Play') {
            console.log("Stop requested but nothing playing/loading. Ensuring UI reset.");
            playBtn.textContent = '▶ Play';
            playBtn.disabled = false;
            stopBtn.disabled = false;
            if (songAtStop) updateNowPlaying(songAtStop);
            return;
        }

        // Mark as not playing *before* API call (optimistic UI)
        isPlayingOrLoading = false;
        stopBtn.disabled = true;
        stopBtn.textContent = 'Stopping...';
        playBtn.textContent = '▶ Play';
        playBtn.disabled = false;

        try {
            const response = await fetch('/api/stop', { method: 'POST' });
             const data = await response.json();
             if (!response.ok || !data.success) {
                console.warn("Backend /api/stop reported failure or API error:", data.error || "Unknown");
             } else {
                 console.log("Playback stopped successfully by backend.");
             }
        } catch (error) {
            console.error('Error calling /api/stop:', error);
            showNotification('Error stopping playback: ' + error.message, 'error');
        } finally {
             // Final UI reset ensures consistency
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
             console.log(`stopPlayback: Function finished. isPlayingOrLoading=${isPlayingOrLoading}`);
        }
    }


    async function handleNextSong() {
        if (currentSetlist.songs.length === 0) return;
        console.log("Next song selected.");

        if (isPlayingOrLoading || isActivelyPreloading) { // Stop playback OR cancel preload UI effects
            await stopPlayback(); // stopPlayback now also cancels preload controller
        }
         if (isPlayingOrLoading || isActivelyPreloading) { // Check again
            console.warn("handleNextSong: Previous action stop/cancel might not have completed."); return;
         }

        let nextIndex = currentSongIndex + 1;
        if (nextIndex >= currentSetlist.songs.length) {
            showNotification('Reached end of setlist.', 'info');
            // Stay on the last song index
            nextIndex = currentSetlist.songs.length - 1;
             if (currentSongIndex === nextIndex) { // If already on last, just re-trigger preload
                 triggerPreload(currentSongIndex);
                 return;
            }
            // Otherwise, fall through to update UI to last song and preload it
        }

        currentSongIndex = nextIndex;
        setActiveSong(currentSongIndex);
        updateNowPlaying(currentSetlist.songs[currentSongIndex]);
        triggerPreload(currentSongIndex); // Preload the new song
    }

    async function handlePreviousSong() {
        if (currentSetlist.songs.length === 0) return;
        console.log("Previous song selected.");

        if (isPlayingOrLoading || isActivelyPreloading) {
            await stopPlayback();
        }
         if (isPlayingOrLoading || isActivelyPreloading) {
            console.warn("handlePreviousSong: Previous action stop/cancel might not have completed."); return;
         }

        let prevIndex = currentSongIndex - 1;
        if (prevIndex < 0) {
            showNotification('Already at the first song.', 'info');
            // Stay on the first song index
            prevIndex = 0;
            if (currentSongIndex === prevIndex) { // If already on first, re-trigger preload
                triggerPreload(currentSongIndex);
                return;
            }
             // Otherwise, fall through to update UI to first song and preload it
        }

        currentSongIndex = prevIndex;
        setActiveSong(currentSongIndex);
        updateNowPlaying(currentSetlist.songs[currentSongIndex]);
        triggerPreload(currentSongIndex); // Preload the new song
    }

    function showNotification(message, type = 'info') {
        // ... (same as before) ...
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        } else {
            console.warn('showNotification (global) function not found, using alert for:', message);
            alert(`${type.toUpperCase()}: ${message}`);
        }
    }
});