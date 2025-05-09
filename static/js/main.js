// static/js/main.js
document.addEventListener('DOMContentLoaded', function() {
    // --- Navigation Active State ---
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.sidebar .songs-list .song-item a, .sidebar .setlists-list .setlist-item a, .sidebar .nav-link');

    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href');
        if (!linkPath) return;

        const isActive = (linkPath === currentPath || (linkPath !== '/' && currentPath.startsWith(linkPath + '/')) || (linkPath !== '/' && currentPath === linkPath) );

        if (isActive) {
            let moreSpecificActive = false;
            navLinks.forEach(otherLink => {
                const otherPath = otherLink.getAttribute('href');
                if (otherPath && otherPath !== linkPath && currentPath.startsWith(otherPath) && otherPath.length > linkPath.length) {
                     const isOtherActive = (otherPath === currentPath || (otherPath !== '/' && currentPath.startsWith(otherPath + '/')));
                     if(isOtherActive) {
                        moreSpecificActive = true;
                     }
                }
            });

            if (!moreSpecificActive) {
                link.classList.add('active');
                 if (link.closest('.song-item')) link.closest('.song-item').classList.add('active');
                 if (link.closest('.setlist-item')) link.closest('.setlist-item').classList.add('active');
            } else {
                 link.classList.remove('active');
                 if (link.closest('.song-item')) link.closest('.song-item').classList.remove('active');
                 if (link.closest('.setlist-item')) link.closest('.setlist-item').classList.remove('active');
            }
        } else {
             link.classList.remove('active');
             if (link.closest('.song-item')) link.closest('.song-item').classList.remove('active');
             if (link.closest('.setlist-item')) link.closest('.setlist-item').classList.remove('active');
        }
    });

    // History Navigation Buttons & Real-time Clock
    const historyBackBtn = document.getElementById('history-back-btn');
    const historyForwardBtn = document.getElementById('history-forward-btn');
    const clockDisplay = document.getElementById('real-time-clock');

    if (historyBackBtn) {
        historyBackBtn.addEventListener('click', () => window.history.back());
    }
    if (historyForwardBtn) {
        historyForwardBtn.addEventListener('click', () => window.history.forward());
    }
    window.addEventListener('popstate', () => { /* Optional: Update button states */ });

    function updateClock() {
        if (!clockDisplay) return;
        const now = new Date();
        let timeString;
        try {
             timeString = now.toLocaleTimeString('et-EE', {
                 hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            });
        } catch (e) {
             console.warn("Could not format time using 'et-EE' locale, using fallback.");
             const hours = String(now.getHours()).padStart(2, '0');
             const minutes = String(now.getMinutes()).padStart(2, '0');
             const seconds = String(now.getSeconds()).padStart(2, '0');
             timeString = `${hours}:${minutes}:${seconds}`;
        }
        clockDisplay.textContent = timeString;
    }
    if (clockDisplay) { updateClock(); setInterval(updateClock, 1000); }
});


// --- Global Notification Helper Function ---
function showGlobalNotification(message, type = 'info', duration = 4000) {
    const container = document.getElementById('notification-container');
    if (!container) {
        console.error('Notification container not found. Falling back to alert.');
        alert(`${type.toUpperCase()}: ${message}`); // Fallback
        return;
    }

    const notification = document.createElement('div');
    notification.className = `notification-item ${type}`;
    notification.textContent = message;
    let timer;

    const dismiss = () => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentNode === container) {
                container.removeChild(notification);
            }
        }, 500);
    };

    notification.addEventListener('click', () => {
        clearTimeout(timer);
        dismiss();
    });
    container.prepend(notification);
    timer = setTimeout(dismiss, duration);

    notification.addEventListener('mouseover', () => {
        clearTimeout(timer);
        notification.classList.remove('fade-out');
    });
    notification.addEventListener('mouseleave', () => {
        timer = setTimeout(dismiss, duration / 1.5);
    });
}

// --- Custom Confirmation Modal Logic ---
// Store resolve/reject functions for the current confirmation promise
let globalConfirmResolve = null;

/**
 * Shows a custom confirmation modal.
 * @param {string} message - The message to display in the confirmation dialog.
 * @param {string} [title='Confirm Action'] - The title of the confirmation dialog.
 * @returns {Promise<boolean>} A promise that resolves to true if 'Yes' is clicked, false if 'No' is clicked.
 */
function showCustomConfirm(message, title = 'Confirm Action') {
    return new Promise((resolve) => {
        globalConfirmResolve = resolve; // Store the resolve function globally for this instance

        const modal = document.getElementById('custom-confirm-modal');
        const titleEl = document.getElementById('custom-confirm-title');
        const messageEl = document.getElementById('custom-confirm-message');
        const btnYes = document.getElementById('custom-confirm-btn-yes');
        const btnNo = document.getElementById('custom-confirm-btn-no');

        if (!modal || !titleEl || !messageEl || !btnYes || !btnNo) {
            console.error('Custom confirm modal elements not found. Falling back to native confirm.');
            // Fallback to native confirm if modal elements are missing
            if (window.confirm(`${title}\n${message}`)) {
                resolve(true);
            } else {
                resolve(false);
            }
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.style.display = 'flex'; // Show the modal

        // Define handlers for the buttons
        const yesHandler = () => {
            modal.style.display = 'none';
            if (globalConfirmResolve) globalConfirmResolve(true);
            cleanupGlobalConfirmHandlers();
        };

        const noHandler = () => {
            modal.style.display = 'none';
            if (globalConfirmResolve) globalConfirmResolve(false);
            cleanupGlobalConfirmHandlers();
        };

        // Clone and replace buttons to remove any previous event listeners
        const newBtnYes = btnYes.cloneNode(true);
        btnYes.parentNode.replaceChild(newBtnYes, btnYes);

        const newBtnNo = btnNo.cloneNode(true);
        btnNo.parentNode.replaceChild(newBtnNo, btnNo);

        // Add new event listeners
        newBtnYes.addEventListener('click', yesHandler);
        newBtnNo.addEventListener('click', noHandler);
    });
}

/**
 * Cleans up global variables used by the custom confirm modal.
 * Called after the modal is actioned.
 */
function cleanupGlobalConfirmHandlers() {
    globalConfirmResolve = null;
    // Note: Event listeners are on cloned nodes, so direct removal isn't strictly necessary here
    // if the old nodes are truly gone. But if not cloning, you'd remove listeners from original btnYes, btnNo.
}
// --- End Custom Confirmation Modal Logic ---
