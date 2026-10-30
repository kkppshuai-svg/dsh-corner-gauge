import glob, json, os, queue, subprocess, threading, time
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

def get_usage():
    candidates = glob.glob(os.path.join(os.environ['LOCALAPPDATA'], 'OpenAI', 'Codex', 'bin', '*', 'codex.exe'))
    if not candidates:
        raise RuntimeError('未找到 Codex 程序')
    exe = max(candidates, key=os.path.getmtime)
    proc = subprocess.Popen([exe, 'app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                            creationflags=CREATE_NO_WINDOW)
    lines = queue.Queue()
    threading.Thread(target=lambda: [lines.put(line) for line in proc.stdout], daemon=True).start()
    def send(message):
        proc.stdin.write(json.dumps(message) + '\n'); proc.stdin.flush()
    def receive(request_id):
        until = time.monotonic() + 25
        while time.monotonic() < until:
            value = json.loads(lines.get(timeout=max(0.1, until-time.monotonic())))
            if value.get('id') == request_id:
                if 'error' in value: raise RuntimeError(value['error'].get('message', '读取失败'))
                return value.get('result', {})
        raise RuntimeError('请求超时')
    try:
        send({'id':1,'method':'initialize','params':{'clientInfo':{'name':'codex_usage_widget','version':'1.0'}}})
        receive(1)
        send({'method':'initialized','params':{}})
        send({'id':2,'method':'account/rateLimits/read','params':{}})
        return receive(2).get('rateLimits') or {}
    finally:
        proc.terminate()
        try: proc.wait(timeout=3)
        except subprocess.TimeoutExpired: proc.kill()

