import webview
import threading
import time
import os
import traceback
import sys
import atexit

from waitress import serve
from app import app, audio_player

# --- Configuration ---
HOST = '127.0.0.1'
PORT = 5001
SERVER_ADDRESS = f"http://{HOST}:{PORT}"
WINDOW_TITLE = "Backing Track Player"
WINDOW_WIDTH = 1280
WINDOW_HEIGHT = 800
# --- End Configuration ---

# Event to signal shutdown from the API to the app_lifecycle thread
shutdown_event = threading.Event()

# Lock and flag to ensure cleanup logic runs only once
_cleanup_lock = threading.Lock()
_cleanup_has_run = False


def perform_final_cleanup_if_needed():
    """
    Performs critical resource cleanup (like audio_player.shutdown).
    Designed to be called safely multiple times (e.g., by API and atexit)
    but will only execute the cleanup logic once.
    """
    global _cleanup_has_run
    with _cleanup_lock:
        if _cleanup_has_run:
            print("perform_final_cleanup_if_needed: Cleanup has already been performed or is in progress.")
            return
        print("perform_final_cleanup_if_needed: Setting cleanup flag and starting cleanup...")
        _cleanup_has_run = True  # Set flag immediately inside lock to prevent re-entry

    print("perform_final_cleanup_if_needed: Starting final resource cleanup...")
    if audio_player:
        print("perform_final_cleanup_if_needed: Calling audio_player.shutdown()...")
        try:
            audio_player.shutdown()
            print("perform_final_cleanup_if_needed: audio_player.shutdown() completed.")
        except Exception as e:
            print(f"perform_final_cleanup_if_needed: Error during audio_player.shutdown(): {e}")
            traceback.print_exc()
    else:
        print("perform_final_cleanup_if_needed: No audio_player instance to shut down.")

    print("perform_final_cleanup_if_needed: Final resource cleanup finished.")


# Register the guarded cleanup function with atexit
atexit.register(perform_final_cleanup_if_needed)


class Api:
    """
    API class exposed to JavaScript.
    """

    def request_shutdown_app(self):
        """
        Called from JavaScript to initiate the application shutdown sequence.
        It sets an event that the app_lifecycle thread is waiting for.
        """
        print("Api.request_shutdown_app: Shutdown signal received. Setting event.")
        shutdown_event.set()


def app_lifecycle(window_ref):
    """
    This function runs in a separate thread after pywebview starts.
    It waits for a shutdown signal (set by Api.request_shutdown_app),
    then performs cleanup and destroys the pywebview window.
    """
    print("app_lifecycle: Thread started. Waiting for shutdown signal...")
    shutdown_event.wait()  # Block until the shutdown_event is set

    print("app_lifecycle: Shutdown signal received.")

    # Perform critical cleanup BEFORE destroying the window
    print("app_lifecycle: Initiating cleanup before window destruction...")
    perform_final_cleanup_if_needed()  # Call the guarded cleanup function

    if window_ref:
        print("app_lifecycle: Destroying pywebview window...")
        try:
            window_ref.destroy()
            print("app_lifecycle: pywebview window.destroy() command issued.")
        except Exception as e:
            print(f"app_lifecycle: Error destroying window: {e}")
            traceback.print_exc()
    else:
        print("app_lifecycle: No window reference to destroy.")

    print("app_lifecycle: Thread finished.")
    # When this function returns, the thread managed by webview.start for this function will terminate.
    # This should allow the main webview.start() call to unblock.


def start_waitress_server():
    """Starts the Waitress server for the Flask app in a daemon thread."""
    print(f"Starting Waitress server on {SERVER_ADDRESS}...")
    try:
        serve(app, host=HOST, port=PORT, threads=8)
    except Exception as e:
        print(f"Failed to start Waitress server: {e}")
        # Optionally, signal main thread that server failed if critical
        # For now, assuming if server fails, pywebview might not load anyway.


if __name__ == '__main__':
    print("Application starting...")

    # Start the Flask/Waitress server in a daemon thread
    # Daemon threads are automatically terminated when the main program exits
    server_thread = threading.Thread(target=start_waitress_server, daemon=True)
    server_thread.start()

    print(f"Server thread started. Attempting to create pywebview window for {SERVER_ADDRESS}")
    time.sleep(2)  # Give server a moment to start up

    main_window = None  # Keep a reference to the main window
    try:
        api_instance = Api()

        main_window = webview.create_window(
            WINDOW_TITLE,
            SERVER_ADDRESS,
            width=WINDOW_WIDTH,
            height=WINDOW_HEIGHT,
            resizable=True,
            fullscreen=True,
            text_select=True,
            js_api=api_instance
        )
        webview.settings['ALLOW_DOWNLOADS'] = True

        print("Starting pywebview event loop with app_lifecycle function...")
        # webview.start() will block the main thread until all pywebview windows are closed
        # OR until the function passed (app_lifecycle) returns.
        webview.start(app_lifecycle, main_window)

        print("pywebview event loop has concluded (app_lifecycle returned or all windows closed).")

    except SystemExit as e:
        print(f"pywebview loop or app_lifecycle terminated by SystemExit: {e}")
    except KeyboardInterrupt:
        print("Application interrupted by user (Ctrl+C). Initiating shutdown...")
        if main_window and not shutdown_event.is_set():
            print("Ctrl+C: Setting shutdown event to trigger cleanup and window close...")
            shutdown_event.set()  # Signal app_lifecycle to proceed
            # Wait for app_lifecycle to finish if it was running
            # This might be tricky if app_lifecycle is stuck; relying on finally block
            time.sleep(1)  # Give app_lifecycle a moment
    except Exception as e:
        print(f"An error occurred during the pywebview window lifecycle: {e}")
        traceback.print_exc()
    finally:
        print("Reached finally block in run.py.")

        # Ensure cleanup runs if it hasn't been triggered by the API path.
        # This primarily catches cases like direct window close if not handled by pywebview's own exit.
        print("Finally block: Ensuring final cleanup is performed if needed...")
        perform_final_cleanup_if_needed()  # This is guarded, so safe to call again.

        print("Application attempting to exit via sys.exit(0) from finally block...")
        # A brief pause can sometimes help other threads (like daemonized Waitress) to shut down cleaner.
        time.sleep(0.5)
        sys.exit(0)  # Standard exit, will trigger any remaining atexit handlers not yet run.

