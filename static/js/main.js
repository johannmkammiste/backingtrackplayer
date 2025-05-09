// static/js/main.js
document.addEventListener('DOMContentLoaded', function() {
    // --- Navigation Active State ---
    const currentPath = window.location.pathname;
    // Select actual navigation links within the sidebar (adjust selector if needed)
    const navLinks = document.querySelectorAll('.sidebar .songs-list .song-item a, .sidebar .setlists-list .setlist-item a, .sidebar .nav-link');

    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href');
        if (!linkPath) return; // Skip if no href

        // Basic check: Exact match or starts with (for parent paths like /setlists/)
        const isActive = (linkPath === currentPath || (linkPath !== '/' && currentPath.startsWith(linkPath + '/')) || (linkPath !== '/' && currentPath === linkPath) );

        if (isActive) {
            // Check if a more specific link is also active
            let moreSpecificActive = false;
            navLinks.forEach(otherLink => {
                const otherPath = otherLink.getAttribute('href');
                if (otherPath && otherPath !== linkPath && currentPath.startsWith(otherPath) && otherPath.length > linkPath.length) {
                     const isOtherActive = (otherPath === currentPath || (otherPath !== '/' && currentPath.startsWith(otherPath + '/')));
                     if(isOtherActive)  moreSpecificActive = true;
                }
            });

            // Add 'active' class only if no more specific link is active
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
            // Remove active class if not active
             link.classList.remove('active');
             if (link.closest('.song-item')) link.closest('.song-item').classList.remove('active');
             if (link.closest('.setlist-item')) link.closest('.setlist-item').classList.remove('active');
        }
    });

    // ============================================
    // History Navigation Buttons & Real-time Clock
    // ============================================
    const historyBackBtn = document.getElementById('history-back-btn');
    const historyForwardBtn = document.getElementById('history-forward-btn');
    const clockDisplay = document.getElementById('real-time-clock');

    // History Back Button
    if (historyBackBtn) {
        historyBackBtn.addEventListener('click', () => {
            window.history.back();
        });
    }

    // History Forward Button
    if (historyForwardBtn) {
        historyForwardBtn.addEventListener('click', () => {
            window.history.forward();
        });
    }

     // Optional: Update button disabled state on navigation events
     window.addEventListener('popstate', () => {
        // Add logic here if needed to enable/disable back/forward buttons
     });

    // Real-time Clock Update Function
    function updateClock() {
        if (!clockDisplay) return; // Exit if element not found

        const now = new Date();
        let timeString;
        try {
             // Format time as HH:MM:SS (24-hour) using Estonian locale
             timeString = now.toLocaleTimeString('et-EE', {
                 hour: '2-digit',
                 minute: '2-digit',
                 second: '2-digit',
                 hour12: false
            });
        } catch (e) {
            // Fallback formatting if locale fails
             console.warn("Could not format time using 'et-EE' locale, using fallback.");
             const hours = String(now.getHours()).padStart(2, '0');
             const minutes = String(now.getMinutes()).padStart(2, '0');
             const seconds = String(now.getSeconds()).padStart(2, '0');
             timeString = `${hours}:${minutes}:${seconds}`;
        }
        clockDisplay.textContent = timeString;
    }

    // Initialize and update the clock every second
    if (clockDisplay) {
        updateClock(); // Run once immediately
        setInterval(updateClock, 1000); // Update every 1000ms (1 second)
    }

    // --- Exit Application Button Logic ---
    const exitAppBtn = document.getElementById('exit-app-btn');
    if (exitAppBtn) {
        exitAppBtn.addEventListener('click', async () => {
            // Use the globally defined showCustomConfirm
            const confirmed = await window.showCustomConfirm(
                'Are you sure you want to exit the Backing Track Player?',
                'Confirm Exit'
            );
            if (confirmed) {
                // Check if the pywebview API is available and the specific function exists
                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.request_shutdown_app === 'function') {
                    try {
                        // Use the globally defined showGlobalNotification
                        window.showGlobalNotification('Exiting application...', 'info', 2000);
                        // Call the Python function to request shutdown
                        window.pywebview.api.request_shutdown_app();
                        // After this call, the webview window should close, and the Python process will handle full exit.
                        // Further JS execution here might not be reliable.
                    } catch (error) {
                        console.error("Error calling pywebview.api.request_shutdown_app:", error);
                        window.showGlobalNotification('Could not exit application cleanly. Please close the window manually.', 'error');
                    }
                } else {
                    console.warn("pywebview.api.request_shutdown_app is not available. Cannot exit programmatically.");
                    window.showGlobalNotification('Programmatic exit not available. Please close the window manually.', 'warning');
                }
            } else {
                window.showGlobalNotification('Exit cancelled.', 'info');
            }
        });
    }
    // --- End Exit Application Button Logic ---

}); // End DOMContentLoaded


// --- Global Notification Helper Function ---
// Ensure this is defined on the window object to be globally accessible
window.showGlobalNotification = function(message, type = 'info', duration = 4000) {
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
        // Use setTimeout to remove after animation (match CSS transition duration)
        setTimeout(() => {
            // Check if the element still exists and is in the container before removing
            if (notification.parentNode === container) {
                container.removeChild(notification);
            }
        }, 500); // Must match your CSS transition duration for fade-out
    };

    // Click to dismiss
    notification.addEventListener('click', () => {
        clearTimeout(timer); // Stop auto-dismiss if clicked
        dismiss();
    });

    // Prepend to container (newest appears at top)
    container.prepend(notification);

    // Auto-dismiss timer
    timer = setTimeout(dismiss, duration);

    // Optional: Pause dismiss timer on mouseover, resume on mouseleave
    notification.addEventListener('mouseover', () => {
        clearTimeout(timer);
        notification.classList.remove('fade-out'); // Prevent fade if hovered during out-transition
    });

    notification.addEventListener('mouseleave', () => {
        // Resume timer, potentially shorter duration
        timer = setTimeout(dismiss, duration / 1.5); // Adjust resume duration as needed
    });
};
// --- End Global Notification Helper ---


// --- Custom Confirmation Modal Logic ---
// Store resolve/reject functions for the current confirmation promise
let globalConfirmResolve = null;

/**
 * Shows a custom confirmation modal.
 * @param {string} message - The message to display in the confirmation dialog.
 * @param {string} [title='Confirm Action'] - The title of the confirmation dialog.
 * @returns {Promise<boolean>} A promise that resolves to true if 'Yes' is clicked, false if 'No' is clicked.
 */
// Ensure this is defined on the window object to be globally accessible
window.showCustomConfirm = function(message, title = 'Confirm Action') {
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
};

/**
 * Cleans up global variables used by the custom confirm modal.
 * Called after the modal is actioned.
 */
function cleanupGlobalConfirmHandlers() {
    globalConfirmResolve = null;
}
// --- End Custom Confirmation Modal Logic ---
