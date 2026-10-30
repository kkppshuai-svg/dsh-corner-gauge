import ctypes, json, os, subprocess, sys, threading, time, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from codex_usage import get_usage, CREATE_NO_WINDOW

BASE=Path(__file__).resolve().parent
EDGE=Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
CLIENT=BASE.parent/'lib'/'client.js'
HTML=BASE/'index.html'
cache={'time':0,'value':None}; lock=threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}': self.send_error(403); return
        if self.path=='/quota':
            try:
                with lock:
                    if time.monotonic()-cache['time']>60 or cache['value'] is None:
                        raw=get_usage(); cache['value']={k:raw.get(k) for k in ('primary','secondary')}; cache['time']=time.monotonic()
                    data=json.dumps(cache['value']).encode()
                self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(data)
            except Exception: self.send_error(503)
        elif self.path in ('/','/client.js'):
            file=HTML if self.path=='/' else CLIENT
            data=file.read_bytes(); self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8' if self.path=='/' else 'text/javascript; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(data)
        else: self.send_error(404)

if not EDGE.exists() or not CLIENT.exists(): raise SystemExit('Missing Edge or gauge project client')
kernel=ctypes.windll.kernel32
kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_bool,ctypes.c_wchar_p]
kernel.CreateMutexW.restype=ctypes.c_void_p
mutex=kernel.CreateMutexW(None,False,'Local\\CodexOriginalUsageGauge')
if not mutex or kernel.GetLastError()==183: raise SystemExit('Gauge is already running')
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
def warm_cache():
    try:
        with lock:
            raw=get_usage()
            cache['value']={k:raw.get(k) for k in ('primary','secondary')}
            cache['time']=time.monotonic()
    except Exception: pass
warm=threading.Thread(target=warm_cache,daemon=True)
warm.start()
warm.join(timeout=8)
screen=ctypes.windll.user32; width=570; height=260
screen.FindWindowW.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p]
screen.FindWindowW.restype=ctypes.c_void_p
screen.SetWindowPos.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_uint]
pos=f"{max(0,screen.GetSystemMetrics(0)-width-30)},{max(0,screen.GetSystemMetrics(1)-height-90)}"
profile=str(Path(os.environ['LOCALAPPDATA'])/'CodexGauge'/'edge-profile')
proc=subprocess.Popen([str(EDGE),f'--app=http://127.0.0.1:{server.server_port}/',f'--user-data-dir={profile}',f'--window-size={width},{height}',f'--window-position={pos}','--no-first-run','--disable-features=msEdgeSidebarV2'],creationflags=CREATE_NO_WINDOW)
for _ in range(80):
    time.sleep(.25)
    hwnd=screen.FindWindowW(None,'Codex 原版用量仪表')
    if hwnd:
        # Remove Edge's native title bar and frame while preserving the real project UI.
        get_style=screen.GetWindowLongW; set_style=screen.SetWindowLongW
        get_style.argtypes=[ctypes.c_void_p,ctypes.c_int]; set_style.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_long]
        style=get_style(hwnd,-16)
        set_style(hwnd,-16,style & ~(0x00C00000 | 0x00040000))
        screen.SetWindowPos(hwnd,-1,0,0,0,0,0x0001|0x0002|0x0010|0x0020)
        # Edge draws an additional title bar in its client area; clip that strip.
        screen.GetDpiForWindow.argtypes=[ctypes.c_void_p]
        screen.GetDpiForWindow.restype=ctypes.c_uint
        screen.SetWindowRgn.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_bool]
        gdi=ctypes.windll.gdi32
        gdi.CreateRectRgn.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int]
        gdi.CreateRectRgn.restype=ctypes.c_void_p
        dpi=screen.GetDpiForWindow(hwnd) or 96
        region=gdi.CreateRectRgn(0,round(30*dpi/96),5000,5000)
        if not screen.SetWindowRgn(hwnd,region,True): gdi.DeleteObject(region)
        break
proc.wait()
server.shutdown()
