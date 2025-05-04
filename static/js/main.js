// static/js/main.js
document.addEventListener('DOMContentLoaded', function() {
    // --- Navigation Active State ---
    const currentPath = window.location.pathname;
    // Select actual navigation links within the sidebar (adjust selector if needed)
    const navLinks = document.querySelectorAll('.sidebar .songs-list .song-item a, .sidebar .setlists-list .setlist-item a, .sidebar .nav-link'); // Example selectors, adapt to your actual nav links

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
                    // Check if the other link is actually considered active based on the same logic
                     const isOtherActive = (otherPath === currentPath || (otherPath !== '/' && currentPath.startsWith(otherPath + '/')));
                     if(isOtherActive) {
                        moreSpecificActive = true;
                     }
                }
            });

            // Add 'active' class only if no more specific link is active
            if (!moreSpecificActive) {
                // Add class to the appropriate element (might be the link itself or its parent)
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
        // Optional: Disable initially if no back history (might not be reliable)
        // historyBackBtn.disabled = history.length <= 1;
    }

    // History Forward Button
    if (historyForwardBtn) {
        historyForwardBtn.addEventListener('click', () => {
            window.history.forward();
        });
        // Optional: Disable initially if no forward history (harder to check reliably)
    }

     // Optional: Update button disabled state on navigation events (might be needed for reliability)
     window.addEventListener('popstate', () => {
        // Check history state here if needed, e.g., using history.length or session storage flags
        // if (historyBackBtn) historyBackBtn.disabled = history.length <= 1;
        // Enabling/disabling forward is tricky without more state management
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
    // ============================================
    // End History/Clock Logic
    // ============================================

}); // End DOMContentLoaded


// --- Notification Helper Function ---
function showNotification(message, type = 'info', duration = 4000) {
    const container = document.getElementById('notification-container');
    if (!container) {
        console.error('Notification container not found.');
        alert(`${type.toUpperCase()}: ${message}`); // Fallback
        return;
    }

    const notification = document.createElement('div');
    notification.className = `notification-item ${type}`;
    notification.textContent = message;

    let timer; // Declare timer variable

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
}
// --- End Notification Helper ---