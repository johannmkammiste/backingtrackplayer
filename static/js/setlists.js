document.addEventListener('DOMContentLoaded', function() {
    if (!document.getElementById('setlist-editor')) return;

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

    initSetlistsPage();

    function initSetlistsPage() {
        loadAllSongs().then(() => {
            setupSetlistItemClickHandlers();
            const firstSetlist = document.querySelector('.setlist-item');
            if (firstSetlist) {
                firstSetlist.click();
            } else {
                showEmptyState();
            }
        });
    }

    async function loadAllSongs() {
        try {
            const response = await fetch('/api/songs', { headers: { 'Accept': 'application/json' } });
            if (!response.ok) throw new Error('Network response was not ok for loading songs');
            const data = await response.json();
            allSongs = data.songs || [];
        } catch (error) {
            console.error('Error loading songs:', error);
            _showGlobalNotification('Error loading available songs list.', 'error');
        }
    }

    function setupSetlistItemClickHandlers() {
        const setlistListContainer = document.querySelector('.setlists-list');
        if (setlistListContainer) {
            setlistListContainer.addEventListener('click', function(e) {
                const setlistItem = e.target.closest('.setlist-item');
                if (setlistItem) {
                    document.querySelectorAll('.setlists-list .setlist-item.active').forEach(i => i.classList.remove('active'));
                    setlistItem.classList.add('active');
                    loadSetlist(parseInt(setlistItem.dataset.setlistId));
                }
            });
        }
    }

    function updateSongsSelector() {
        if (!songsSelector) return;
        songsSelector.innerHTML = '';
        allSongs.forEach(song => {
            if (!currentSetlistSongs.some(s => s.id === song.id)) {
                const songItem = document.createElement('div');
                songItem.className = 'song-selector-item';
                songItem.innerHTML = `
                    <input type="checkbox" id="selector-song-${song.id}" data-song-id="${song.id}" class="song-checkbox">
                    <label for="selector-song-${song.id}" class="song-selector-name">${song.name} (${song.tempo} BPM)</label>
                `;
                songsSelector.appendChild(songItem);
            }
        });
    }

    function updateSetlistSongsList() {
        if (!setlistSongsList) return;
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
            songItem.querySelector('.move-up').addEventListener('click', () => moveSongInSetlist(index, 'up'));
            songItem.querySelector('.move-down').addEventListener('click', () => moveSongInSetlist(index, 'down'));
            songItem.querySelector('.setlist-song-remove').addEventListener('click', () => removeSongFromSetlist(index));
        });
    }

    function createNewSetlist() {
        currentSetlistId = null; isNewSetlist = true; currentSetlistSongs = [];
        if(setlistTitle) setlistTitle.textContent = 'New Setlist';
        if(setlistNameInput) setlistNameInput.value = '';
        updateSongsSelector(); updateSetlistSongsList();
        if(emptyState) emptyState.style.display = 'none';
        if(setlistForm) setlistForm.style.display = 'block';
        document.querySelectorAll('.setlists-list .setlist-item.active').forEach(i => i.classList.remove('active'));
    }

    async function loadSetlist(setlistId) {
        if (!setlistForm) return;
        setlistForm.classList.add('loading');
        try {
            const response = await fetch(`/api/setlists/${setlistId}`);
            if (!response.ok) throw new Error('Setlist not found or server error');
            const setlist = await response.json();
            if (!setlist?.id) throw new Error('Invalid setlist data received');
            currentSetlistId = setlist.id; isNewSetlist = false;
            if(setlistTitle) setlistTitle.textContent = setlist.name;
            if(setlistNameInput) setlistNameInput.value = setlist.name;
            currentSetlistSongs = [];
            (setlist.song_ids || []).forEach(songId => {
                const song = allSongs.find(s => s.id === songId);
                if (song) currentSetlistSongs.push(song);
            });
            updateSetlistSongsList(); updateSongsSelector();
            if(emptyState) emptyState.style.display = 'none';
            setlistForm.style.display = 'block';
        } catch (error) {
            console.error('Error loading setlist:', error);
            _showGlobalNotification(`Failed to load setlist: ${error.message}`, 'error');
            showEmptyState('Failed to load setlist details.');
        } finally {
            if(setlistForm) setlistForm.classList.remove('loading');
        }
    }

    function showEmptyState(message = "Select a setlist or create a new one.") {
        if(emptyState) {emptyState.innerHTML = `<p>${message}</p>`; emptyState.style.display = 'flex';}
        if(setlistForm) setlistForm.style.display = 'none';
        currentSetlistId = null;
    }

    function addSelectedSongsToSetlist() {
        if (!songsSelector) return;
        const selectedCheckboxes = songsSelector.querySelectorAll('.song-checkbox:checked');
        selectedCheckboxes.forEach(checkbox => {
            const songId = parseInt(checkbox.dataset.songId); // Use data-song-id
            const song = allSongs.find(s => s.id === songId);
            if (song && !currentSetlistSongs.some(s => s.id === songId)) {
                currentSetlistSongs.push(song);
            }
        });
        updateSongsSelector(); updateSetlistSongsList();
    }

    function moveSongInSetlist(index, direction) {
        if (direction === 'up' && index > 0) {
            [currentSetlistSongs[index - 1], currentSetlistSongs[index]] = [currentSetlistSongs[index], currentSetlistSongs[index - 1]];
        } else if (direction === 'down' && index < currentSetlistSongs.length - 1) {
            [currentSetlistSongs[index], currentSetlistSongs[index + 1]] = [currentSetlistSongs[index + 1], currentSetlistSongs[index]];
        }
        updateSetlistSongsList();
    }

    function removeSongFromSetlist(index) {
        currentSetlistSongs.splice(index, 1);
        updateSongsSelector(); updateSetlistSongsList();
    }

    // MODIFIED: To use showGlobalNotification
    async function saveSetlist() {
        if (isSaving || !setlistNameInput || !saveSetlistBtn) return;

        const setlistName = setlistNameInput.value.trim();
        if (!setlistName) {
            _showGlobalNotification('Please enter a setlist name.', 'warning');
            return;
        }
        isSaving = true; saveSetlistBtn.disabled = true; saveSetlistBtn.textContent = 'Saving...';

        const setlistData = { name: setlistName, song_ids: currentSetlistSongs.map(song => song.id) };
        try {
            const url = isNewSetlist ? '/api/setlists' : `/api/setlists/${currentSetlistId}`;
            const method = isNewSetlist ? 'POST' : 'PUT';
            const response = await fetch(url, {
                method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setlistData)
            });
            const savedSetlist = await response.json();
            if (!response.ok) throw new Error(savedSetlist.error || 'Failed to save setlist');

            if(setlistTitle) setlistTitle.textContent = savedSetlist.name;
            if(setlistNameInput) setlistNameInput.value = savedSetlist.name;
            if (isNewSetlist) {
                currentSetlistId = savedSetlist.id; isNewSetlist = false;
                addSetlistToSidebar(savedSetlist);
                // Activate the new setlist in sidebar
                document.querySelectorAll('.setlists-list .setlist-item.active').forEach(i => i.classList.remove('active'));
                const newSidebarItem = document.querySelector(`.setlists-list .setlist-item[data-setlist-id="${currentSetlistId}"]`);
                if (newSidebarItem) newSidebarItem.classList.add('active');
            } else {
                updateSetlistInSidebar(savedSetlist);
            }
            _showGlobalNotification('Setlist saved successfully!', 'success');
        } catch (error) {
            console.error('Error saving setlist:', error);
            _showGlobalNotification(`Failed to save setlist: ${error.message}`, 'error');
        } finally {
            isSaving = false; saveSetlistBtn.disabled = false; saveSetlistBtn.textContent = 'Save Setlist';
        }
    }

    function addSetlistToSidebar(setlist) {
        const setlistsListContainer = document.querySelector('.setlists-list');
        if(!setlistsListContainer) return;
        const setlistItem = document.createElement('div');
        setlistItem.className = 'setlist-item';
        setlistItem.dataset.setlistId = setlist.id;
        setlistItem.innerHTML = `
            <span class="setlist-name">${setlist.name}</span>
            <span class="song-count">${(setlist.song_ids || []).length} songs</span>`;
        setlistsListContainer.appendChild(setlistItem);
    }

    function updateSetlistInSidebar(setlist) {
        const setlistItem = document.querySelector(`.setlists-list .setlist-item[data-setlist-id="${setlist.id}"]`);
        if (setlistItem) {
            if(setlistItem.querySelector('.setlist-name')) setlistItem.querySelector('.setlist-name').textContent = setlist.name;
            if(setlistItem.querySelector('.song-count')) setlistItem.querySelector('.song-count').textContent = `${(setlist.song_ids || []).length} songs`;
        }
    }

    // MODIFIED: To use showCustomConfirm
    async function deleteSetlist() {
        if (!currentSetlistId || isNewSetlist) {
            _showGlobalNotification('No setlist selected to delete.', 'warning');
            return;
        }
        const setlistNameToDelete = setlistNameInput ? setlistNameInput.value : "this setlist";
        const confirmed = await window.showCustomConfirm(
            `Are you sure you want to delete the setlist "${setlistNameToDelete}"?`,
            'Confirm Delete Setlist'
        );

        if (confirmed) {
            try {
                const response = await fetch(`/api/setlists/${currentSetlistId}`, { method: 'DELETE' });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || 'Failed to delete setlist from server.');

                const itemToRemove = document.querySelector(`.setlists-list .setlist-item[data-setlist-id="${currentSetlistId}"]`);
                if (itemToRemove) itemToRemove.remove();
                showEmptyState('Setlist deleted successfully.');
                _showGlobalNotification('Setlist deleted.', 'success');
                currentSetlistId = null;
            } catch (error) {
                console.error('Error deleting setlist:', error);
                _showGlobalNotification(`Failed to delete setlist: ${error.message}`, 'error');
            }
        } else {
            _showGlobalNotification('Setlist deletion cancelled.', 'info');
        }
    }

    function playSetlist() {
        if (!currentSetlistId || isNewSetlist) {
            _showGlobalNotification("Please save and select a setlist to play.", "warning");
            return;
        }
        window.location.href = `/setlists/${currentSetlistId}/play`;
    }

    if(addSetlistBtn) addSetlistBtn.addEventListener('click', createNewSetlist);
    if(addSongToSetlistBtn) addSongToSetlistBtn.addEventListener('click', addSelectedSongsToSetlist);
    if(saveSetlistBtn) saveSetlistBtn.addEventListener('click', saveSetlist);
    if(deleteSetlistBtn) deleteSetlistBtn.addEventListener('click', deleteSetlist); // deleteSetlist is now async
    if(playSetlistBtn) playSetlistBtn.addEventListener('click', playSetlist);

    // Local helper to use window.showGlobalNotification
    function _showGlobalNotification(message, type = 'info') {
        if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(message, type);
        } else {
            console.warn('setlists.js: window.showGlobalNotification function not found. Using alert as fallback.');
            alert(`${type.toUpperCase()}: ${message}`);
        }
    }
});
