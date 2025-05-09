import webview
import threading
import time  # Optional: for a small delay if needed
from waitress import serve
from app import app  # Your Flask app from app.py
import os  # For path normalization

# --- Configuration ---
HOST = '127.0.0.1'  # Run on localhost
PORT = 5001  # Port for your app
SERVER_ADDRESS = f"http://{HOST}:{PORT}"
WINDOW_TITLE = "Backing Track Player"
WINDOW_WIDTH = 1280  # Adjust to your preference
WINDOW_HEIGHT = 800  # Adjust to your preference


# --- End Configuration ---

class Api:
    """
    API class to expose Python functions to JavaScript via pywebview.
    """

    def select_audio_directory(self):
        """
        Opens a folder selection dialog and returns the selected path.
        Returns None if the dialog is cancelled.
        """
        try:
            # Access the main window (assuming it's the first and only one)
            if not webview.windows:
                print("Error: No pywebview window found to attach the dialog to.")
                return None

            main_window = webview.windows[0]

            # webview.FOLDER_DIALOG opens a dialog to select a folder.
            # It returns a tuple of selected paths, or None if cancelled.
            # For a single folder selection, we expect a tuple with one item.
            result = main_window.create_file_dialog(webview.FOLDER_DIALOG)

            if result and len(result) > 0:
                # Normalize the path to ensure consistent format
                selected_path = os.path.normpath(result[0])
                print(f"Folder selected via pywebview dialog: {selected_path}")
                return selected_path
            else:
                print("Folder selection cancelled or no folder selected.")
                return None
        except Exception as e:
            print(f"Error in select_audio_directory: {e}")
            traceback.print_exc()  # Print full traceback for debugging
            return None


def start_waitress_server():
    """Starts the Waitress server for the Flask app."""
    print(f"Starting Waitress server on {SERVER_ADDRESS}...")
    try:
        serve(app, host=HOST, port=PORT, threads=8)  # Waitress is blocking
    except Exception as e:
        print(f"Failed to start Waitress server: {e}")


if __name__ == '__main__':
    print("Application starting...")

    # Import traceback for the Api class if not already globally imported
    import traceback

    server_thread = threading.Thread(target=start_waitress_server, daemon=True)
    server_thread.start()

    print(f"Server thread started. Attempting to create pywebview window for {SERVER_ADDRESS}")
    time.sleep(2)  # Sleep for 2 seconds to allow server to start

    try:
        api_instance = Api()  # Create an instance of our API class

        # Create the window. The js_api instance will be able to access this window.
        main_window = webview.create_window(  # Store the created window instance
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
        webview.start(debug=False)

    except Exception as e:
        print(f"Failed to create or start pywebview window: {e}")

    print("pywebview window closed. Application will now exit.")
