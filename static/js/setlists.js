document.addEventListener('DOMContentLoaded', function() {
    // Only execute on setlists page
    if (!document.getElementById('setlist-editor')) return;

    // DOM Elements
    const addSetlistBtn = document.getElementById('add-setlist-btn');
    const emptyState = document.getElementById('empty-state');
    const setlistForm = document.getElementById('setlist-form');
    const setlistTitle = document.getElementById('setlist-title');
    const setlistNameInput = document.getElementById('setlist-name');
    const songsSelector = document.getElementById('songs-selector');
    const addSongToSetlistBtn = document.getElementById('add-song-to-setlist');
    const setlistSongsList = document.getElementById('setlist-songs-list');
    const saveSetlistBtn = document.getElementById('save-setlist');
    const deleteSetlistBtn = document.getElementById('delete-setlist');
    const playSetlistBtn = document.getElementById('play-setlist');

    let currentSetlistId = null;
    let isNewSetlist = false;
    let isSaving = false;
    let allSongs = [];
    let currentSetlistSongs = [];

    // Initialize the page
    initSetlistsPage();

    function initSetlistsPage() {
        loadAllSongs().then(() => {
            setupSetlistItemClickHandlers();

            // If there are setlists, load the first one by default
            const firstSetlist = document.querySelector('.setlist-item');
            if (firstSetlist) {
                firstSetlist.click();
            }
        });
    }

    async function loadAllSongs() {
        try {
            const response = await fetch('/api/songs', {
                headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            allSongs = data.songs || [];
            console.log('Loaded songs:', allSongs);
        } catch (error) {
            console.error('Error loading songs:', error);
        }
    }

    function setupSetlistItemClickHandlers() {
        document.querySelector('.setlists-list').addEventListener('click', function(e) {
            const setlistItem = e.target.closest('.setlist-item');
            if (setlistItem) {
                // Remove active class from all items
                document.querySelectorAll('.setlist-item').forEach(i => {
                    i.classList.remove('active');
                });

                // Add active class to clicked item
                setlistItem.classList.add('active');

                // Load the setlist
                loadSetlist(parseInt(setlistItem.dataset.setlistId));
            }
        });
    }

    function updateSongsSelector() {
        songsSelector.innerHTML = '';

        allSongs.forEach(song => {
            // Only show songs not already in the setlist
            if (!currentSetlistSongs.some(s => s.id === song.id)) {
                const songItem = document.createElement('div');
                songItem.className = 'song-selector-item';

                songItem.innerHTML = `
                    <input type="checkbox" id="song-${song.id}" class="song-checkbox">
                    <label for="song-${song.id}" class="song-selector-name">${song.name} (${song.tempo} BPM)</label>
                `;

                songsSelector.appendChild(songItem);
            }
        });
    }

    function updateSetlistSongsList() {
        setlistSongsList.innerHTML = '';

        currentSetlistSongs.forEach((song, index) => {
            const songItem = document.createElement('div');
            songItem.className = 'setlist-song-item';
            songItem.dataset.songId = song.id;

            songItem.innerHTML = `
                <div class="setlist-song-name">${index + 1}. ${song.name} (${song.tempo} BPM)</div>
                <div class="setlist-song-actions">
                    <span class="setlist-song-move move-up" title="Move up">↑</span>
                    <span class="setlist-song-move move-down" title="Move down">↓</span>
                    <span class="setlist-song-remove" title="Remove">✕</span>
                </div>
            `;

            setlistSongsList.appendChild(songItem);

            // Add event listeners for the new song item
            songItem.querySelector('.move-up').addEventListener('click', () => moveSongInSetlist(index, 'up'));
            songItem.querySelector('.move-down').addEventListener('click', () => moveSongInSetlist(index, 'down'));
            songItem.querySelector('.setlist-song-remove').addEventListener('click', () => removeSongFromSetlist(index));
        });
    }

    function createNewSetlist() {
        currentSetlistId = null;
        isNewSetlist = true;
        currentSetlistSongs = [];
        setlistTitle.textContent = 'New Setlist';
        setlistNameInput.value = '';
        updateSongsSelector();
        updateSetlistSongsList();
        emptyState.style.display = 'none';
        setlistForm.style.display = 'block';

        // Remove active class from all setlist items
        document.querySelectorAll('.setlist-item').forEach(i => {
            i.classList.remove('active');
        });
    }

    function loadSetlist(setlistId) {
        console.log('Loading setlist:', setlistId);

        fetch(`/api/setlists/${setlistId}`)
            .then(response => {
                if (!response.ok) throw new Error('Setlist not found');
                return response.json();
            })
            .then(setlist => {
                if (!setlist?.id) throw new Error('Invalid setlist data');

                currentSetlistId = setlist.id;
                setlistTitle.textContent = setlist.name;
                setlistNameInput.value = setlist.name;
                currentSetlistSongs = [];

                // Match song IDs with full song data
                setlist.song_ids?.forEach(songId => {
                    const song = allSongs.find(s => s.id === songId);
                    if (song) currentSetlistSongs.push(song);
                });

                updateSetlistSongsList();
                updateSongsSelector();
                emptyState.style.display = 'none';
                setlistForm.style.display = 'block';
            })
            .catch(error => {
                console.error('Error loading setlist:', error);
                showEmptyState('Failed to load setlist');
            });
    }

    function showEmptyState(message = "Select a setlist from the list or create a new one") {
        emptyState.innerHTML = `<p>${message}</p>`;
        emptyState.style.display = 'block';
        setlistForm.style.display = 'none';
    }

    function addSelectedSongsToSetlist() {
        const selectedCheckboxes = songsSelector.querySelectorAll('.song-checkbox:checked');

        selectedCheckboxes.forEach(checkbox => {
            const songId = parseInt(checkbox.id.replace('song-', ''));
            const song = allSongs.find(s => s.id === songId);

            if (song && !currentSetlistSongs.some(s => s.id === songId)) {
                currentSetlistSongs.push(song);
            }
        });

        updateSongsSelector();
        updateSetlistSongsList();
    }

    function moveSongInSetlist(index, direction) {
        if (direction === 'up' && index > 0) {
            // Swap with previous song
            [currentSetlistSongs[index - 1], currentSetlistSongs[index]] =
                [currentSetlistSongs[index], currentSetlistSongs[index - 1]];
        } else if (direction === 'down' && index < currentSetlistSongs.length - 1) {
            // Swap with next song
            [currentSetlistSongs[index], currentSetlistSongs[index + 1]] =
                [currentSetlistSongs[index + 1], currentSetlistSongs[index]];
        }

        updateSetlistSongsList();
    }

    function removeSongFromSetlist(index) {
        currentSetlistSongs.splice(index, 1);
        updateSongsSelector();
        updateSetlistSongsList();
    }

    async function saveSetlist() {
        if (isSaving) return;
        isSaving = true;
        saveSetlistBtn.disabled = true;
        saveSetlistBtn.textContent = 'Saving...';

        if (!setlistNameInput.value.trim()) {
            alert('Please enter a setlist name');
            isSaving = false;
            saveSetlistBtn.disabled = false;
            saveSetlistBtn.textContent = 'Save Setlist';
            return;
        }

        const setlistData = {
            name: setlistNameInput.value,
            song_ids: currentSetlistSongs.map(song => song.id)
        };

        try {
            let response;

            if (isNewSetlist) {
                // Create new setlist
                response = await fetch('/api/setlists', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(setlistData)
                });
            } else {
                // Update existing setlist
                response = await fetch(`/api/setlists/${currentSetlistId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(setlistData)
                });
            }

            if (!response.ok) {
                throw new Error('Failed to save setlist');
            }

            const savedSetlist = await response.json();

            // Update UI
            setlistTitle.textContent = savedSetlist.name;
            setlistNameInput.value = savedSetlist.name;

            if (isNewSetlist) {
                // For new setlists, update the ID and add to sidebar
                currentSetlistId = savedSetlist.id;
                isNewSetlist = false;
                addSetlistToSidebar(savedSetlist);
            } else {
                // For existing setlists, update the sidebar item
                updateSetlistInSidebar(savedSetlist);
            }

            // Show success message
            const successMsg = document.createElement('div');
            successMsg.className = 'save-success';
            successMsg.textContent = 'Changes saved!';
            setlistForm.appendChild(successMsg);
            setTimeout(() => successMsg.remove(), 2000);

        } catch (error) {
            console.error('Error saving setlist:', error);
            alert('Failed to save setlist');
        } finally {
            isSaving = false;
            saveSetlistBtn.disabled = false;
            saveSetlistBtn.textContent = 'Save Setlist';
        }
    }

    function addSetlistToSidebar(setlist) {
        const setlistsList = document.querySelector('.setlists-list');
        const setlistItem = document.createElement('div');
        setlistItem.className = 'setlist-item';
        setlistItem.dataset.setlistId = setlist.id;

        setlistItem.innerHTML = `
            <span class="setlist-name">${setlist.name}</span>
            <span class="song-count">${setlist.song_ids.length} songs</span>
        `;

        setlistsList.appendChild(setlistItem);
    }

    function updateSetlistInSidebar(setlist) {
        const setlistItem = document.querySelector(`.setlist-item[data-setlist-id="${setlist.id}"]`);
        if (setlistItem) {
            setlistItem.querySelector('.setlist-name').textContent = setlist.name;
            setlistItem.querySelector('.song-count').textContent = `${setlist.song_ids.length} songs`;
        }
    }

    function deleteSetlist() {
        if (!currentSetlistId || isNewSetlist) return;

        if (confirm('Are you sure you want to delete this setlist?')) {
            fetch(`/api/setlists/${currentSetlistId}`, {
                method: 'DELETE'
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        // Remove from sidebar
                        const setlistItem = document.querySelector(`.setlist-item[data-setlist-id="${currentSetlistId}"]`);
                        if (setlistItem) {
                            setlistItem.remove();
                        }

                        // Reset form
                        currentSetlistId = null;
                        showEmptyState();
                    }
                });
        }
    }

    function playSetlist() {
        if (!currentSetlistId || isNewSetlist) return;

        // Navigate to the play page for this setlist
        window.location.href = `/setlists/${currentSetlistId}/play`;
    }

    // Event Listeners
    addSetlistBtn.addEventListener('click', createNewSetlist);
    addSongToSetlistBtn.addEventListener('click', addSelectedSongsToSetlist);
    saveSetlistBtn.addEventListener('click', saveSetlist);
    deleteSetlistBtn.addEventListener('click', deleteSetlist);
    playSetlistBtn.addEventListener('click', playSetlist);
});