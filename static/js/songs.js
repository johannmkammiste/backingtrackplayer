document.addEventListener('DOMContentLoaded', function () {
    // Constants
    const MAX_LOGICAL_CHANNELS = 16; // Should match backend

    // DOM Elements
    const addSongBtn = document.getElementById('add-song-btn');
    const emptyState = document.getElementById('empty-state');
    const songForm = document.getElementById('song-form');
    const songTitle = document.getElementById('song-title');
    const songNameInput = document.getElementById('song-name');
    const songTempoInput = document.getElementById('song-tempo');
    const uploadArea = document.getElementById('upload-area');
    const fileUpload = document.getElementById('file-upload');
    const tracksList = document.getElementById('tracks-list');
    const saveSongBtn = document.getElementById('save-song');
    const deleteSongBtn = document.getElementById('delete-song');

    // State Variables
    let currentSongId = null;
    let isNewSong = false;
    let isSaving = false;

    // --- Initialization ---
    setupSongItemClickHandlers();
    addSongBtn.addEventListener('click', createNewSong);
    fileUpload.addEventListener('change', handleFileUpload);
    saveSongBtn.addEventListener('click', saveSong);
    deleteSongBtn.addEventListener('click', deleteSong);
    setupDragAndDrop();

    // --- Functions ---

    function setupSongItemClickHandlers() {
        // Use event delegation on the list container for potentially dynamic items
        const songsListContainer = document.querySelector('.songs-list');
        if (songsListContainer) {
            songsListContainer.addEventListener('click', function (e) {
                const targetItem = e.target.closest('.song-item');
                if (targetItem) {
                    document.querySelectorAll('.song-item').forEach(i => {
                        i.classList.remove('active');
                    });
                    targetItem.classList.add('active');
                    loadSong(parseInt(targetItem.dataset.songId));
                }
            });
        }
    }

    function setupDragAndDrop() {
        if (!uploadArea) return;
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files) {
                fileUpload.files = e.dataTransfer.files;
                handleFileUpload();
            }
        });
    }

    function createNewSong() {
        currentSongId = null;
        isNewSong = true;
        emptyState.style.display = 'none';
        songForm.style.display = 'block'; // Ensure form is visible
        songTitle.textContent = 'New Song';
        songNameInput.value = '';
        songTempoInput.value = '120';
        tracksList.innerHTML = ''; // Clear previous tracks
        // Deactivate any selected song in the sidebar
        document.querySelectorAll('.song-item.active').forEach(item => item.classList.remove('active'));
    }

    async function loadSong(songId) {
        console.log(`Loading song ID: ${songId}`);
        emptyState.style.display = 'none';
        songForm.style.display = 'block';
        songForm.classList.add('loading'); // Add loading indicator class

        try {
            const response = await fetch(`/api/songs/${songId}`);
            if (!response.ok) {
                throw new Error(`Song not found (HTTP ${response.status})`);
            }
            const song = await response.json();

            currentSongId = song.id;
            isNewSong = false;
            songTitle.textContent = song.name;
            songNameInput.value = song.name;
            songTempoInput.value = song.tempo;
            tracksList.innerHTML = ''; // Clear existing tracks before adding new ones

            // Ensure audio_tracks is an array before iterating
            (song.audio_tracks || []).forEach(track => {
                addTrackToUI(track);
            });

            // Update active state in sidebar
            document.querySelectorAll('.song-item').forEach(item => {
                item.classList.toggle('active', parseInt(item.dataset.songId) === song.id);
            });

        } catch (error) {
            console.error('Error loading song:', error);
            showEmptyState(`Failed to load song: ${error.message}`);
            currentSongId = null; // Reset current song ID on error
        } finally {
            songForm.classList.remove('loading'); // Remove loading indicator
        }
    }

    function showEmptyState(message = "Select a song from the list or create a new one") {
        emptyState.innerHTML = `<p>${message}</p>`;
        emptyState.style.display = 'flex'; // Use flex to center content
        songForm.style.display = 'none';
        currentSongId = null; // Reset state
        isNewSong = false;
    }

    async function handleFileUpload() {
        if (isNewSong || currentSongId === null) {
             showGlobalNotification("Please save the new song before uploading tracks.", "warning");
             fileUpload.value = ''; // Clear the file input
             return;
        }
        const files = fileUpload.files;
        if (!files || files.length === 0) return;

        const uploadButtonLabel = document.querySelector('.upload-button');
        if (uploadButtonLabel) uploadButtonLabel.textContent = 'Uploading...';
        uploadArea.classList.add('uploading'); // Add visual feedback

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('files[]', files[i]);
        }
        const uploadUrl = `/api/songs/${currentSongId}/upload`;
        console.log(`Uploading to: ${uploadUrl}`);

        try {
            const response = await fetch(uploadUrl, { method: 'POST', body: formData });
            // Always try to parse JSON, even for errors, as backend might send error details
            const data = await response.json();

             if (!response.ok) {
                 // Throw an error with message from backend if possible
                 throw new Error(data.error || `Upload failed with status: ${response.status}`);
             }

            console.log("Upload response data:", data);

            // Handle partial success (some files uploaded, some failed)
            if (data.tracks && data.tracks.length > 0) {
                data.tracks.forEach(track => { addTrackToUI(track); });
                 showGlobalNotification(`${data.tracks.length} new track(s) added successfully.`, 'success');
            }
            if (data.errors && data.errors.length > 0) {
                const errorMessages = data.errors.join(', ');
                showGlobalNotification(`Upload issues: ${errorMessages}`, 'warning');
            }
            if (!data.tracks && !data.errors) {
                // Should not happen with current backend logic, but handle defensively
                throw new Error('Unknown upload response from server.');
            }

        } catch (error) {
            console.error('Upload error:', error);
            showGlobalNotification(`Upload error: ${error.message}`, 'error');
        } finally {
             fileUpload.value = ''; // Clear the file input regardless of outcome
             if (uploadButtonLabel) uploadButtonLabel.textContent = 'Upload Audio Files';
             uploadArea.classList.remove('uploading'); // Remove visual feedback
         }
    }


    function addTrackToUI(track) {
        if (!track || typeof track !== 'object') {
             console.error("Invalid track data passed to addTrackToUI:", track);
             return;
        }
        const trackElement = document.createElement('div');
        trackElement.className = 'track-item';
        trackElement.dataset.trackId = track.id;

        const isStereoChecked = track.is_stereo ? 'checked' : '';
        // Treat output_channel from backend as 1-based for initial display logic
        const initialChannelOneBased = track.output_channel || 1; // Default to 1 if undefined
        const initialNextChannelOneBased = initialChannelOneBased + 1;

        // Generate <option> elements for the channel select dropdown
        let channelOptionsHtml = '';
        for (let i = 1; i <= MAX_LOGICAL_CHANNELS; i++) {
             // Value is 1-based, display text is 1-based
             const selected = (initialChannelOneBased === i) ? 'selected' : '';
             channelOptionsHtml += `<option value="${i}" ${selected}>${i}</option>`;
        }

        trackElement.innerHTML = `
            <div class="track-info">
                <span class="track-name">${track.file_path || 'Unknown File'}</span>
            </div>
            <div class="track-controls">
                <div class="track-control-row">
                    <label class="track-control-label">Output Channel:</label>
                    <select class="channel-select">
                        ${channelOptionsHtml}
                    </select>
                </div>
                <div class="track-control-row">
                     <label class="track-control-label">Stereo:</label>
                     <input type="checkbox" class="is-stereo-checkbox" ${isStereoChecked}>
                     <span class="stereo-hint">(Requires Ch ${initialChannelOneBased} & ${initialNextChannelOneBased})</span>
                </div>
                <div class="track-control-row">
                    <label class="track-control-label">Volume:</label>
                    <div class="volume-control">
                        <input type="range" class="volume-slider" min="0" max="1" step="0.01" value="${track.volume ?? 1.0}">
                        <span class="volume-value">${Math.round((track.volume ?? 1.0) * 100)}%</span>
                    </div>
                </div>
                <div class="delete-track-container">
                    <button class="delete-track action-button delete">Delete Track</button>
                 </div>
            </div>
        `;

        tracksList.appendChild(trackElement);

        // --- Add event listeners for the new track ---
        const channelSelect = trackElement.querySelector('.channel-select');
        const stereoCheckbox = trackElement.querySelector('.is-stereo-checkbox');
        const stereoHint = trackElement.querySelector('.stereo-hint');
        const volumeSlider = trackElement.querySelector('.volume-slider');
        const volumeValue = trackElement.querySelector('.volume-value');
        const deleteButton = trackElement.querySelector('.delete-track');

        // Function to update the stereo hint text based on the current channel selection
        const updateHint = () => {
             const currentSelectedChannelOneBased = parseInt(channelSelect.value, 10); // Value is now 1-based
             const nextChannelOneBased = currentSelectedChannelOneBased + 1;
             stereoHint.textContent = `(Requires Ch ${currentSelectedChannelOneBased} & ${nextChannelOneBased} mapping)`;
        };

        // Listener for channel changes
        channelSelect.addEventListener('change', (e) => {
             const selectedChannelOneBased = parseInt(e.target.value, 10); // Value is 1-based
             updateTrack(track.id, { output_channel: selectedChannelOneBased }); // Send 1-based value
             updateHint(); // Update hint text
        });

        // Listener for stereo checkbox changes
        stereoCheckbox.addEventListener('change', (e) => {
            updateTrack(track.id, { is_stereo: e.target.checked });
            stereoHint.style.display = e.target.checked ? 'inline' : 'none'; // Show/hide hint
        });

        // Initial state for stereo hint display
        stereoHint.style.display = track.is_stereo ? 'inline' : 'none';
        // updateHint(); // Initial hint text is set via innerHTML now


        // Listeners for volume control
        if (volumeSlider && volumeValue) {
            // Update display and send on 'input' for immediate feedback
            volumeSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                volumeValue.textContent = `${Math.round(value * 100)}%`;
                // Optionally debounce this if performance is an issue
                updateTrack(track.id, { volume: value });
            });
            // Optionally update only on 'change' (when mouse released) if 'input' is too frequent
            // volumeSlider.addEventListener('change', (e) => {
            //     const value = parseFloat(e.target.value);
            //     updateTrack(track.id, { volume: value });
            // });
        }

        // Listener for delete button
        if(deleteButton) {
            deleteButton.addEventListener('click', () => {
                 deleteTrack(track.id, trackElement);
            });
        }
    }

    // Function to send track updates to the backend
    async function updateTrack(trackId, data) {
        if (!currentSongId) return;
        console.log(`Updating track ${trackId} with:`, data); // Log 1-based channel being sent

        try {
            const response = await fetch(`/api/songs/${currentSongId}/tracks/${trackId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json(); // Always try to parse JSON

            if (!response.ok) {
                 throw new Error(result.error || `HTTP error ${response.status}`);
            }

            if (result && result.success) {
                 console.log(`Track ${trackId} updated successfully.`);
                 // Maybe add a subtle temporary success indicator?
            } else {
                 // Handle cases where backend returns success: false explicitly
                 console.error('Backend reported failure updating track:', result);
                 throw new Error(result.error || 'Backend reported failure.');
            }
        } catch (error) {
            console.error('Error updating track:', error);
            showGlobalNotification(`Error updating track: ${error.message}`, 'error');
        }
    }


    // Function to delete a track
    async function deleteTrack(trackId, trackElement) {
        if (!currentSongId) return;
         if (confirm(`Are you sure you want to delete this track? This may also delete the associated audio file if unused.`)) {
             try {
                 const response = await fetch(`/api/songs/${currentSongId}/tracks/${trackId}`, { method: 'DELETE' });
                 const data = await response.json(); // Always try parsing

                 if (!response.ok) {
                     throw new Error(data.error || `HTTP error ${response.status}`);
                 }

                 if (data.success) {
                     trackElement.remove(); // Remove from UI
                     showGlobalNotification(data.message || 'Track deleted successfully.', 'success');
                 } else {
                     throw new Error(data.error || 'Backend reported failure deleting track.');
                 }
             } catch (error) {
                 console.error('Error deleting track:', error);
                 showGlobalNotification(`Error deleting track: ${error.message}`, 'error');
             }
         }
    }

    // Function to save song metadata (name, tempo)
    async function saveSong() {
        if (isSaving) return;
        saveSongBtn.disabled = true;
        saveSongBtn.textContent = 'Saving...';
        isSaving = true;

        // --- Validation ---
        const songName = songNameInput.value.trim();
        if (!songName) {
            showGlobalNotification('Please enter a song name.', 'warning');
            saveSongBtn.disabled = false;
            saveSongBtn.textContent = 'Save Song';
            isSaving = false;
            return;
        }
        const tempo = parseInt(songTempoInput.value, 10);
        if (isNaN(tempo) || tempo < 40 || tempo > 300) {
            showGlobalNotification('Please enter a valid tempo between 40 and 300.', 'error');
            saveSongBtn.disabled = false;
            saveSongBtn.textContent = 'Save Song';
            isSaving = false;
            return;
        }
        // --- End Validation ---

        const songData = { name: songName, tempo: tempo };
        const url = isNewSong ? '/api/songs' : `/api/songs/${currentSongId}`;
        const method = isNewSong ? 'POST' : 'PUT';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(songData)
            });
            const savedSong = await response.json(); // Always parse

            if (!response.ok) {
                 throw new Error(savedSong.error || `Failed to save song (HTTP ${response.status})`);
            }

            // --- Update UI ---
            songTitle.textContent = savedSong.name; // Update title display
            if (isNewSong) {
                // If it was a new song, update state and add to sidebar
                currentSongId = savedSong.id;
                isNewSong = false;
                addSongToSidebar(savedSong); // Add to list
                // Highlight the newly added song
                 document.querySelectorAll('.song-item').forEach(item => {
                    item.classList.toggle('active', parseInt(item.dataset.songId) === currentSongId);
                 });
            } else {
                // If updating existing, update sidebar entry
                updateSongInSidebar(savedSong);
            }
             showGlobalNotification('Song saved successfully!', 'success');

        } catch (error) {
            console.error('Error saving song:', error);
            showGlobalNotification(`Error saving song: ${error.message}`, 'error');
        } finally {
            isSaving = false;
            saveSongBtn.disabled = false;
            saveSongBtn.textContent = 'Save Song';
        }
    }

    // Function to add a song item to the sidebar list
    function addSongToSidebar(song) {
        const songsListContainer = document.querySelector('.songs-list');
        if (!songsListContainer) return; // Safety check

        // Check if item already exists to prevent duplicates
        if (songsListContainer.querySelector(`.song-item[data-song-id="${song.id}"]`)) {
            console.warn(`Song item ${song.id} already exists in sidebar.`);
            return;
        }

        const songItem = document.createElement('div');
        songItem.className = 'song-item';
        songItem.dataset.songId = song.id;
        songItem.innerHTML = `
            <span class="song-name">${song.name}</span>
            <span class="song-tempo">${song.tempo} BPM</span>
        `;
        // Click listener is handled by delegation in setupSongItemClickHandlers

        songsListContainer.appendChild(songItem);
    }

    // Function to update an existing song item in the sidebar
    function updateSongInSidebar(song) {
        const songItem = document.querySelector(`.song-item[data-song-id="${song.id}"]`);
        if (songItem) {
            songItem.querySelector('.song-name').textContent = song.name;
            songItem.querySelector('.song-tempo').textContent = `${song.tempo} BPM`;
        }
    }

    // Function to delete the currently loaded song
    async function deleteSong() {
        if (!currentSongId || isNewSong) {
             showGlobalNotification('No song selected to delete.', 'warning');
             return;
        }

        if (confirm(`Are you sure you want to delete the song "${songNameInput.value}"? This will also delete associated audio files if they aren't used by other songs, and cannot be undone.`)) {
            try {
                const response = await fetch(`/api/songs/${currentSongId}`, { method: 'DELETE' });
                const data = await response.json(); // Always parse

                if (!response.ok) {
                     throw new Error(data.error || `HTTP error ${response.status}`);
                }

                if (data.success) {
                    // Remove from sidebar
                    const songItem = document.querySelector(`.song-item[data-song-id="${currentSongId}"]`);
                    if (songItem) { songItem.remove(); }
                    // Reset view
                    showEmptyState('Song deleted.'); // Show confirmation in empty state
                    showGlobalNotification(data.message || 'Song deleted successfully.', 'success');
                } else {
                     throw new Error(data.error || 'Backend reported failure deleting song.');
                }
            } catch (error) {
                 console.error('Error deleting song:', error);
                 showGlobalNotification(`Error deleting song: ${error.message}`, 'error');
             }
        }
    }

     // --- Notification Helper ---
     // Ensure this exists, either here or globally in main.js
     function showGlobalNotification(message, type = 'info') {
         if (typeof window.showNotification === 'function') {
             window.showNotification(message, type); // Call global function if it exists
         } else {
             // Fallback if global function is missing
             console.warn('showNotification function not found globally, using alert.');
             alert(`${type.toUpperCase()}: ${message}`);
         }
     }

}); // End DOMContentLoaded