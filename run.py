import webbrowser
from waitress import serve

from app import app # Assuming your app is named 'app' in 'app.py'

HOST = '127.0.0.1' # Run on localhost only
PORT = 5001        # Choose a port for your app
SERVER_ADDRESS = f"http://{HOST}:{PORT}"
# --- End Configuration ---

def run_app():
    """Starts the browser and then the Waitress server."""
    print(f"Attempting to open browser at: {SERVER_ADDRESS}")
    # Open the browser *before* starting the blocking server
    webbrowser.open(SERVER_ADDRESS)

    # Optional delay: Sometimes helps ensure the browser doesn't open
    # *too* quickly before the server is listening, though browsers usually retry.
    # time.sleep(1)

    print(f"Starting Waitress server on {SERVER_ADDRESS}...")
    # serve() blocks execution and runs the server until interrupted (Ctrl+C)
    # Use a sensible number of threads for a local app
    serve(app, host=HOST, port=PORT, threads=4)

if __name__ == '__main__':
    run_app()