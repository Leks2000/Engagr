"""
Engagr — Development Server
Runs Flask API + serves built frontend.
"""
import sys, os

backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backend')
sys.path.insert(0, backend_dir)
os.chdir(backend_dir)

os.environ.setdefault('TELEGRAM_BOT_TOKEN', 'dev-token-placeholder')
os.environ.setdefault('GROQ_API_KEY', 'dev-groq-placeholder')
os.environ.setdefault('APP_ENV', 'development')
os.environ.setdefault('JWT_SECRET', 'dev-jwt-secret-change-in-prod')

# Patch scheduler to avoid errors without real Telegram token
import scheduler as sched_module
sched_module.schedule_user_sessions = lambda *a, **kw: None
sched_module.get_session_logs = lambda *a, **kw: []

from main import api
from flask import send_from_directory

# Serve built frontend static files
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frontend', 'dist')

@api.route('/')
def serve_index():
    return send_from_directory(FRONTEND_DIST, 'index.html')

@api.route('/<path:path>')
def serve_static(path):
    file_path = os.path.join(FRONTEND_DIST, path)
    if os.path.isfile(file_path):
        return send_from_directory(FRONTEND_DIST, path)
    # SPA fallback
    return send_from_directory(FRONTEND_DIST, 'index.html')

if __name__ == '__main__':
    print(f"\n{'='*60}")
    print(f"  Engagr WebBridge — Development Server")
    print(f"  Backend API:  http://localhost:5000")
    print(f"  Frontend:     http://localhost:5000")
    print(f"  Health check: http://localhost:5000/health")
    print(f"{'='*60}\n")
    api.run(host='0.0.0.0', port=5000, debug=False)
