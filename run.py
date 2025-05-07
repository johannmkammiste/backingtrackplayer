import webview
import threading
import time # Optional: for a small delay if needed
from waitress import serve
from app import app # Your Flask app from app.py

# --- Configuration ---
HOST = '127.0.0.1'  # Run on localhost
PORT = 5001         # Port for your app
SERVER_ADDRESS = f"http://{HOST}:{PORT}"
WINDOW_TITLE = "Backing Track Player"
WINDOW_WIDTH = 1280 # Adjust to your preference
WINDOW_HEIGHT = 800 # Adjust to your preference
# --- End Configuration ---

def start_waitress_server():
    """Starts the Waitress server for the Flask app."""
    print(f"Starting Waitress server on {SERVER_ADDRESS}...")
    try:
        serve(app, host=HOST, port=PORT, threads=8) # Waitress is blocking
    except Exception as e:
        print(f"Failed to start Waitress server: {e}")
        # Optionally, you could try to signal the main pywebview thread to exit
        # For now, it will just print the error and the pywebview window might show an error page

if __name__ == '__main__':
    print("Application starting...")

    # Start the Waitress server in a separate daemon thread.
    # Daemon threads automatically exit when the main program (pywebview) exits.
    server_thread = threading.Thread(target=start_waitress_server, daemon=True)
    server_thread.start()

    print(f"Server thread started. Attempting to create pywebview window for {SERVER_ADDRESS}")

    # Optional: Give the server a moment to start up before trying to load the URL.
    # This might be helpful on slower systems like Raspberry Pi.
    # Adjust delay as needed, or make it more robust with a health check if necessary.
    time.sleep(2) # Sleep for 2 seconds

    try:
        # Create and start the pywebview window
        # The 'loaded' event can be used to confirm the page is loaded or handle initial actions
        # window_loaded = threading.Event()
        # def on_loaded():
        #     print("WebView content loaded.")
        #     window_loaded.set()

        webview.create_window(
            WINDOW_TITLE,
            SERVER_ADDRESS,
            width=WINDOW_WIDTH,
            height=WINDOW_HEIGHT,
            resizable=True,
            fullscreen=False, # Set to True for a kiosk-like experience
            # on_top=False,
            # frameless=False, # For a borderless window
            # easy_drag=True, # If frameless is True
            # minimized=False,
            # confirm_close=False, # Set to True to prompt user before closing
            # background_color='#2B2B2B', # Set a background color
            # text_select=True, # Allow text selection (default is False)
        )
        # webview.start() has a 'debug' flag for enabling web inspector (right-click -> inspect)
        # and a 'private_mode' flag (default True) for isolated sessions.
        # 'gui' can be used to specify a rendering engine (e.g., 'gtk', 'qt', 'cef') if needed,
        # but pywebview usually auto-detects.
        webview.start(debug=True) # debug=True is helpful for development

    except Exception as e:
        print(f"Failed to create or start pywebview window: {e}")
        # If pywebview fails, the server thread will continue running as a daemon
        # until the main script exits.

    print("pywebview window closed. Application will now exit.")
    # Server thread (daemon) will be terminated automatically.

#sudo apt update
#sudo apt install -y libgtk-3-dev libwebkit2gtk-4.0-dev
# Or for newer versions, it might be libwebkit2gtk-4.1-dev
# sudo apt install -y gir1.2-webkit2-4.0 # or 4.1 for GObject Introspection bindings