document.addEventListener('DOMContentLoaded', function () {
    const setlistTitle = document.getElementById('setlist-player-title');
    const songsList = document.getElementById('setlist-songs');
    const currentSongName = document.getElementById('current-song-name');
    const currentSongBpm = document.getElementById('current-song-bpm');
    const timeRemainingDisplay = document.getElementById('time-remaining'); // Get timer element
    const prevBtn = document.getElementById('previous-btn');
    const playBtn = document.getElementById('play-btn');
    const stopBtn = document.getElementById('stop-btn');
    const nextBtn = document.getElementById('next-btn');

    // [State variables - Add timer variables]
    let currentSetlistId = null;
    let currentSongIndex = 0;
    let currentSetlist = { songs: [] };
    let isPlayingOrLoading = false;
    let timerInterval = null; // To hold the setInterval ID
    let currentSongDuration = 0; // To store duration of the current song
    let remainingSeconds = 0; // To track remaining time

    const pathParts = window.location.pathname.split('/');
    currentSetlistId = parseInt(pathParts[pathParts.length - 2]);

    if (isNaN(currentSetlistId)) {
        console.error('Invalid setlist ID');
        currentSongName.textContent = "Error: Invalid Setlist ID";
        prevBtn.disabled = true; playBtn.disabled = true; stopBtn.disabled = true; nextBtn.disabled = true;
        return;
    }

    initPlayer();

    // --- NEW: Helper function to format time ---
    function formatTime(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) {
            return "--:--";
        }
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    function startTimer(duration) {
        stopTimer(); // Clear any existing timer first
        if (isNaN(duration) || duration <= 0) {
             console.warn("startTimer called with invalid duration:", duration);
             updateTimerDisplay(0); // Display 0:00 if duration is invalid
             return;
        }

        currentSongDuration = duration;
        remainingSeconds = Math.round(duration);
        console.log(`Timer started. Duration: ${duration}s, Remaining: ${remainingSeconds}s`);
        updateTimerDisplay(remainingSeconds); // Show initial time

        timerInterval = setInterval(() => {
            remainingSeconds--;
            updateTimerDisplay(remainingSeconds);
            // console.log(`Timer tick: ${remainingSeconds}s left`); // Optional: verbose logging

            if (remainingSeconds <= 0) {
                console.log("Timer finished.");
                stopTimer();
                // Optional: Automatically go to next song when timer finishes?
                // playNextSong(); // Be careful with automatic actions
            }
        }, 1000); // Update every second
    }

    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
            console.log("Timer stopped.");
        }
        // Reset display when stopped, unless you want it to hold the last value
        // updateTimerDisplay(0); // Or display "--:--" or currentSongDuration? Let's reset.
         if (timeRemainingDisplay) timeRemainingDisplay.textContent = "Time: --:--";
         remainingSeconds = 0;
         currentSongDuration = 0; // Reset duration too
    }

    function updateTimerDisplay(seconds) {
        if (timeRemainingDisplay) {
            timeRemainingDisplay.textContent = `Time: ${formatTime(seconds)}`;
        }
    }

    // --- Modified/Existing Functions ---
    function initPlayer() {
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
             return { id: songId, name: nameEl.textContent, tempo: parseInt(tempoMatch[1]), duration: duration }; // Store duration
        }).filter(song => song !== null);

        if (currentSetlist.songs.length === 0) {
             console.warn("No valid songs found in the setlist player.");
             currentSongName.textContent = "Setlist is empty or contains errors";
             playBtn.disabled = true; nextBtn.disabled = true; prevBtn.disabled = true;
        } else {
            renderSongsList();
        }

        playBtn.addEventListener('click', playCurrentSong);
        stopBtn.addEventListener('click', stopPlayback);
        prevBtn.addEventListener('click', playPreviousSong);
        nextBtn.addEventListener('click', playNextSong);
    }

    function renderSongsList() {
        document.querySelectorAll('.song-item').forEach((item) => { // No index needed here
            const songId = parseInt(item.dataset.songId);
            if (!currentSetlist.songs.some(s => s.id === songId)) {
                 console.warn(`Skipping event listener for item with unknown song ID: ${songId}`);
                 return;
            }
            item.addEventListener('click', () => {
                const clickedSongIndex = currentSetlist.songs.findIndex(s => s.id === songId);
                if (clickedSongIndex !== -1) {
                     console.log(`Song item clicked: Index ${clickedSongIndex}, ID ${songId}`);
                     if(isPlayingOrLoading && currentSongIndex === clickedSongIndex) {
                          console.log("Clicked active song while playing/loading - ignoring");
                          return; // Don't interrupt if clicking the currently playing song
                     }
                     // *** Stop timer when selecting a new song ***
                     stopTimer();
                     // If already playing, stop before switching
                     if (isPlayingOrLoading) {
                         stopPlayback().then(() => { // Wait for stop before updating index/display
                             currentSongIndex = clickedSongIndex;
                             setActiveSong(currentSongIndex);
                             updateNowPlaying(currentSetlist.songs[currentSongIndex]);
                         });
                     } else {
                         currentSongIndex = clickedSongIndex;
                         setActiveSong(currentSongIndex);
                         updateNowPlaying(currentSetlist.songs[currentSongIndex]);
                     }
                } else { console.error(`Could not find clicked song ID ${songId} in parsed setlist.`); }
            });
        });
        if (currentSetlist.songs.length > 0) {
            setActiveSong(0);
            updateNowPlaying(currentSetlist.songs[0]);
             updateTimerDisplay(currentSetlist.songs[0]?.duration || 0);
             timeRemainingDisplay.textContent = `Length: ${formatTime(currentSetlist.songs[0]?.duration || 0)}`; // Show Length initially
        }
    }

    function setActiveSong(index) {
        document.querySelectorAll('.song-item').forEach((item, i) => {
             if (item) { item.classList.toggle('active', i === index); }
        });
        const activeItem = document.querySelector(`.song-item.active`); // Simpler selector
        if (activeItem && typeof activeItem.scrollIntoView === 'function') {
              activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
         }
    }

    function updateNowPlaying(song) {
        if (!song) {
             console.warn("updateNowPlaying called with invalid song data.");
             currentSongName.textContent = "Error: Song data missing";
             currentSongBpm.textContent = "BPM: --";
             timeRemainingDisplay.textContent = "Length: --:--"; // Reset time display too
             return;
        }
        currentSongName.textContent = song.name;
        currentSongBpm.textContent = `BPM: ${song.tempo}`;
        // *** Update display to show LENGTH when not playing ***
        if (!isPlayingOrLoading && !timerInterval) {
             timeRemainingDisplay.textContent = `Length: ${formatTime(song.duration || 0)}`;
        }
    }

   async function playCurrentSong() {
        if (isPlayingOrLoading) {
             console.log("playCurrentSong: Already playing or loading, request ignored.");
             return;
        }
        isPlayingOrLoading = true;

        if (currentSetlist.songs.length === 0 || currentSongIndex >= currentSetlist.songs.length) {
            console.log("playCurrentSong: No valid song selected or setlist empty.");
            showNotification("No song selected or setlist empty.", "warning");
            isPlayingOrLoading = false;
            return;
        }

        const targetUrl = `/api/setlists/${currentSetlistId}/play`;
        console.log(`playCurrentSong: Attempting to fetch URL: ${targetUrl}`);
        console.log(`playCurrentSong: Sending song index: ${currentSongIndex}`);

        playBtn.disabled = true;
        playBtn.textContent = '⏳ Loading...';
        stopTimer(); // Ensure any previous timer is stopped

        try {
            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_song_index: currentSongIndex })
            });
            const responseData = await response.json();
            if (!response.ok) { throw new Error(responseData.error || JSON.stringify(responseData) || `HTTP error! status: ${response.status}`); }
            console.log("playCurrentSong: Received data:", responseData);

            if (responseData.success) {
                console.log("playCurrentSong: Success reported by backend.");
                if (responseData.current_song_index === currentSongIndex) {
                    currentSongName.textContent = responseData.song_name;
                    currentSongBpm.textContent = `BPM: ${responseData.song_tempo}`;
                    setActiveSong(currentSongIndex);
                    playBtn.textContent = '⏸ Playing';
                    // *** Start timer with duration from API response ***
                    startTimer(responseData.duration);
                } else {
                     console.log("playCurrentSong: Backend played a different song index than expected.");
                     playBtn.textContent = '▶ Play';
                     isPlayingOrLoading = false; // Reset loading flag
                }
            } else {
                 console.error("playCurrentSong: Backend reported failure.", responseData);
                 showNotification(responseData.error || 'Playback failed (unknown reason)', 'error');
                 playBtn.textContent = '▶ Play';
                 isPlayingOrLoading = false; // Reset flag
                 stopTimer(); // Make sure timer is stopped on failure
            }
        } catch (error) {
            console.error('Error in playCurrentSong fetch/processing:', error);
            showNotification(`Error: ${error.message || 'Could not initiate playback.'}`, 'error');
            playBtn.textContent = '▶ Play';
            isPlayingOrLoading = false; // Reset flag
            stopTimer(); // Make sure timer is stopped on error
        } finally {
            // Button state is handled within success/error paths now
            if (playBtn.textContent !== '⏸ Playing') {
                 playBtn.disabled = false;
                 isPlayingOrLoading = false; // Ensure reset if we reach here unexpectedly without playing
            }
            console.log(`playCurrentSong: Function finished. isPlayingOrLoading=${isPlayingOrLoading}`);
        }
    }

    async function stopPlayback() {
        // No need to check isPlayingOrLoading here, stop should always be possible if active
        // if (!isPlayingOrLoading && playBtn.textContent === '▶ Play') {
        //     console.log("Stop requested but nothing seems to be playing/loading.");
        //     return;
        // }
        console.log("Stop playback requested.");
        // *** Stop timer immediately on stop request ***
        stopTimer();

        stopBtn.disabled = true;
        stopBtn.textContent = 'Stopping...';
        const wasAlreadyStopped = playBtn.textContent === '▶ Play'; // Check state before fetch

        try {
            const response = await fetch('/api/stop', { method: 'POST' });
             const data = await response.json(); // Assume JSON response
             if (!response.ok) { throw new Error(data.error || `Stop failed: ${response.statusText}`); }

            if (data.success) {
                 console.log("Playback stopped successfully by backend.");
            } else {
                 // Log backend failure but proceed with UI reset
                 console.warn("Backend reported failure stopping playback:", data.error);
            }
        } catch (error) {
            console.error('Error stopping playback via API:', error);
            // Show error but still try to reset UI state
            showNotification('Error stopping playback: ' + error.message, 'error');
        } finally {
             // Always reset UI state after stop attempt
             playBtn.textContent = '▶ Play';
             playBtn.disabled = false;
             isPlayingOrLoading = false; // Reset flag
             stopBtn.disabled = false;
             stopBtn.textContent = '⏹ Stop';
             // Restore display to show song length after stopping
             if(currentSetlist.songs[currentSongIndex]) {
                updateNowPlaying(currentSetlist.songs[currentSongIndex]);
             } else {
                 timeRemainingDisplay.textContent = "Time: --:--"; // Reset if no song selected
             }
             console.log(`stopPlayback: Function finished. isPlayingOrLoading=${isPlayingOrLoading}`);
        }
    }

    async function playNextSong() {
        if (currentSetlist.songs.length === 0) return;
        console.log("Next song requested.");
        // Stop current playback and timer *before* fetching next song info
        await stopPlayback();
        if (isPlayingOrLoading) {
             console.warn("playNextSong: Previous playback stop failed or still processing.");
             return;
        }
        try {
             const response = await fetch(`/api/setlists/${currentSetlistId}/control`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ action: 'next', current_index: currentSongIndex })
             });
             const data = await response.json();
             if (response.ok && data.success && data.action === 'next') {
                 currentSongIndex = data.current_song_index;
                 setActiveSong(currentSongIndex);
                 updateNowPlaying(currentSetlist.songs[currentSongIndex]); // Update display to show new song length
                 // playCurrentSong(); // Uncomment to autoplay next
             } else if (data.action === 'end_of_setlist_reached'){
                  showNotification(data.message || 'Reached end of setlist.', 'info');
             } else {
                 throw new Error(data.error || 'Failed to get next song index from backend.');
             }
        } catch (error) {
            console.error('Error navigating to next song:', error);
             showNotification(`Error going to next song: ${error.message}`, 'error');
        }
    }

    async function playPreviousSong() {
        if (currentSetlist.songs.length === 0) return;
        console.log("Previous song requested.");
         // Stop current playback and timer *before* fetching previous song info
         await stopPlayback();
         if (isPlayingOrLoading) {
             console.warn("playPreviousSong: Previous playback stop failed or still processing.");
             return;
         }
        try {
            const response = await fetch(`/api/setlists/${currentSetlistId}/control`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ action: 'previous', current_index: currentSongIndex })
             });
             const data = await response.json();
             if (response.ok && data.success && data.action === 'previous') {
                 currentSongIndex = data.current_song_index;
                 setActiveSong(currentSongIndex);
                 updateNowPlaying(currentSetlist.songs[currentSongIndex]); // Update display to show new song length
                 // playCurrentSong(); // Uncomment to autoplay previous
            } else {
                 // Don't throw error for "Already at first song"
                 if(data.error !== 'Already at the first song') {
                     throw new Error(data.error || 'Failed to get previous song index from backend.');
                 } else {
                     console.log("Already at first song."); // Just log it
                 }
             }
        } catch (error) {
            console.error('Error navigating to previous song:', error);
            showNotification(`Error going to previous song: ${error.message}`, 'error');
        }
    }

     // Assumes showNotification is defined globally (e.g., in main.js)
     function showNotification(message, type = 'info') {
         if (typeof window.showNotification === 'function') { // Check window scope
             window.showNotification(message, type); // Call global function
         } else {
             console.warn('showNotification function not found, using alert.');
             alert(`${type.toUpperCase()}: ${message}`);
         }
     }

});