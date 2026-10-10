#!/usr/bin/env python3
"""Управление Chromium через DevTools Protocol (внутри work-computer).
Запуск: python3 /opt/work/cdp.py <op> '<json-параметры>' → JSON {"ok":...} в stdout.
Только стандартная библиотека (сырой WebSocket-клиент): зависимости не нужны.

Операции: version | open {url} | snapshot {} | click {ref} | type {ref,text?,fromEnv?,submit?}
          | select {ref,value} | nav {action: back|reload}
 refs — номера из snapshot (действуют, пока страница не изменилась).
"""
import base64
import json
import os
import socket
import struct
import sys
import time
import urllib.request

HOST, PORT = '127.0.0.1', 9222

INTERACTIVE = {
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
    'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'tab', 'spinbutton', 'slider', 'togglebutton',
}


def http_json(path, method='GET'):
    req = urllib.request.Request(f'http://{HOST}:{PORT}{path}', method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode('utf-8'))


class WSConn:
    def __init__(self, sock, buf=b''):
        self.s = sock
        self.buf = buf

    def send(self, obj):
        payload = json.dumps(obj).encode('utf-8')
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            head = bytes([0x81, 0x80 | n])
        elif n < 65536:
            head = bytes([0x81, 0x80 | 126]) + struct.pack('!H', n)
        else:
            head = bytes([0x81, 0x80 | 127]) + struct.pack('!Q', n)
        self.s.sendall(head + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload)))

    def _fill(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise RuntimeError('websocket закрыт')
            self.buf += chunk

    def recv(self):
        parts = []
        while True:
            self._fill(2)
            b1, b2 = self.buf[0], self.buf[1]
            fin, opcode = b1 & 0x80, b1 & 0x0F
            ln = b2 & 0x7F
            pos = 2
            if ln == 126:
                self._fill(4)
                ln = struct.unpack('!H', self.buf[2:4])[0]
                pos = 4
            elif ln == 127:
                self._fill(10)
                ln = struct.unpack('!Q', self.buf[2:10])[0]
                pos = 10
            if b2 & 0x80:
                pos += 4
            self._fill(pos + ln)
            payload = self.buf[pos:pos + ln]
            if b2 & 0x80:
                mask = self.buf[pos - 4:pos]
                payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
            self.buf = self.buf[pos + ln:]
            if opcode == 0x8:
                raise RuntimeError('websocket закрыт пиром')
            if opcode in (0x9, 0xA):
                continue
            parts.append(payload)
            if fin:
                break
        return b''.join(parts).decode('utf-8')


def ws_connect(url):
    assert url.startswith('ws://')
    rest = url[5:]
    hostport, path = rest.split('/', 1)
    host, _, port = hostport.partition(':')
    port = int(port or 80)
    s = socket.create_connection((host, port), timeout=10)
    s.settimeout(30)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall(f'GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n'
              f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
              f'Sec-WebSocket-Version: 13\r\n\r\n'.encode())
    data = b''
    while b'\r\n\r\n' not in data:
        chunk = s.recv(4096)
        if not chunk:
            raise RuntimeError('ws handshake: нет ответа')
        data += chunk
    status = data.split(b'\r\n', 1)[0].decode()
    if '101' not in status:
        raise RuntimeError('ws handshake: ' + status[:80])
    return WSConn(s, data.split(b'\r\n\r\n', 1)[1])


class CDP:
    def __init__(self):
        try:
            targets = http_json('/json/list')
        except Exception as e:
            raise RuntimeError('Chromium не отвечает на :9222 — запустите через browser_open')
        page = next((t for t in targets
                     if t.get('type') == 'page' and t.get('webSocketDebuggerUrl')
                     and not t.get('url', '').startswith('chrome')), None)
        if not page:
            page = http_json('/json/new?about:blank', method='PUT')
        self.ws = ws_connect(page['webSocketDebuggerUrl'])
        self.seq = 0

    def call(self, method, params=None):
        self.seq += 1
        want = self.seq
        self.ws.send({'id': want, 'method': method, 'params': params or {}})
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == want:
                if 'error' in msg:
                    raise RuntimeError(str(msg['error'].get('message', msg['error']))[:300])
                return msg.get('result', {})

    def evaluate(self, expr):
        r = self.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True})
        if r.get('exceptionDetails'):
            raise RuntimeError('js: ' + str(r['exceptionDetails'])[:200])
        return (r.get('result') or {}).get('value')

    def wait_ready(self, timeout=20):
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                if self.evaluate('document.readyState') == 'complete':
                    return
            except RuntimeError:
                pass
            time.sleep(0.5)

    def ax_map(self):
        tree = self.call('Accessibility.getFullAXTree', {})
        refs, items, n = {}, [], 0
        for node in tree.get('nodes', []):
            role = (node.get('role') or {}).get('value', '')
            name = (node.get('name') or {}).get('value', '')
            val = (node.get('value') or {}).get('value', '')
            checked = ((node.get('checked') or {}).get('value', '') or '').lower()
            if role in INTERACTIVE and (name or role in ('textbox', 'searchbox', 'combobox')):
                n += 1
                refs[n] = node
                state = ''
                if role == 'checkbox':
                    state = ' [x]' if checked == 'true' else ' [ ]'
                items.append({'ref': n, 'role': role, 'name': name, 'value': val, 'state': state,
                              'backend': node.get('backendDOMNodeId')})
            elif role in ('heading', 'StaticText', 'image', 'link') and name and len(items) < 400:
                items.append({'role': role, 'name': name[:160]})
        return refs, items

    def snapshot_text(self):
        url = self.evaluate('location.href')
        title = self.evaluate('document.title')
        _, items = self.ax_map()
        lines = [f'Страница: {title or "(без названия)"} — {url}']
        for it in items:
            if 'ref' in it:
                extra = f'="{it["value"]}"' if it['value'] else ''
                lines.append(f'[{it["ref"]}] {it["role"]} "{it["name"]}"{extra}{it["state"]}')
            else:
                lines.append(f'    {it["role"]}: "{it["name"]}"')
        return {'url': url, 'title': title, 'text': '\n'.join(lines)[:9000]}


def op_open(cdp, p):
    url = str(p.get('url', '')).strip()
    if not (url.startswith('http://') or url.startswith('https://')):
        raise RuntimeError('только http/https: ' + url[:120])
    cdp.call('Page.navigate', {'url': url})
    cdp.wait_ready()
    return cdp.snapshot_text()


def op_click(cdp, p):
    refs, _ = cdp.ax_map()
    node = refs.get(int(p.get('ref', 0)))
    if not node or not node.get('backendDOMNodeId'):
        raise RuntimeError('нет элемента [' + str(p.get('ref')) + '] — обновите snapshot')
    try:
        cdp.call('DOM.scrollIntoViewIfNeeded', {'backendNodeId': node['backendDOMNodeId']})
    except RuntimeError:
        pass
    box = cdp.call('DOM.getBoxModel', {'backendNodeId': node['backendDOMNodeId']})
    q = (box.get('model') or {}).get('content') or []
    if len(q) < 8:
        raise RuntimeError('элемент без координат (невидим?)')
    x = (q[0] + q[4]) / 2
    y = (q[1] + q[5]) / 2
    for t in ('mousePressed', 'mouseReleased'):
        cdp.call('Input.dispatchMouseEvent', {
            'type': t, 'x': x, 'y': y, 'button': 'left', 'buttons': 1, 'clickCount': 1})
    before = cdp.evaluate('location.href')
    t0 = time.time()
    while time.time() - t0 < 8:
        try:
            if cdp.evaluate('location.href') != before:
                cdp.wait_ready()
                break
        except RuntimeError:
            pass
        time.sleep(0.5)
    final = cdp.evaluate('location.href')
    return {'label': f'клик [{p.get("ref")}] {node_role(node)} "{node_name(node)}"',
            'x': round(x), 'y': round(y), 'url': final}


def node_role(node):
    return (node.get('role') or {}).get('value', '')


def node_name(node):
    return (node.get('name') or {}).get('value', '')


def op_type(cdp, p):
    refs, _ = cdp.ax_map()
    node = refs.get(int(p.get('ref', 0)))
    if not node or not node.get('backendDOMNodeId'):
        raise RuntimeError('нет элемента [' + str(p.get('ref')) + '] — обновите snapshot')
    if p.get('fromEnv'):
        text = os.environ.get(p['fromEnv'], '')
        shown = '(секрет из окружения)'
    else:
        text = str(p.get('text', ''))
        shown = '«' + text[:60] + ('…' if len(text) > 60 else '') + '»'
    if not text:
        raise RuntimeError('пустой ввод')
    cdp.call('DOM.focus', {'backendNodeId': node['backendDOMNodeId']})
    cdp.call('Input.insertText', {'text': text})
    if p.get('submit'):
        for t in ('keyDown', 'keyUp'):
            cdp.call('Input.dispatchKeyEvent', {
                'type': t, 'key': 'Enter', 'code': 'Enter',
                'windowsVirtualKeyCode': 13, 'text': '\r' if t == 'keyDown' else ''})
    time.sleep(0.5)
    return {'label': f'ввод {shown} в [{p.get("ref")}]', 'chars': len(text)}


def op_select(cdp, p):
    refs, _ = cdp.ax_map()
    node = refs.get(int(p.get('ref', 0)))
    if not node or not node.get('backendDOMNodeId'):
        raise RuntimeError('нет элемента [' + str(p.get('ref')) + '] — обновите snapshot')
    resolved = cdp.call('DOM.resolveNode', {'backendNodeId': node['backendDOMNodeId']})
    obj = (resolved.get('object') or {}).get('objectId')
    if not obj:
        raise RuntimeError('не резолвится узел')
    r = cdp.call('Runtime.callFunctionOn', {
        'objectId': obj,
        'functionDeclaration': 'function(v){var o=Array.from(this.options).find(function(o){return o.value===v||o.text===v});'
                               'if(!o)return "no:"+v;this.value=o.value;'
                               'this.dispatchEvent(new Event("input",{bubbles:true}));'
                               'this.dispatchEvent(new Event("change",{bubbles:true}));return o.text;}',
        'arguments': [{'value': str(p.get('value', ''))}],
        'returnByValue': True})
    v = (r.get('result') or {}).get('value', '')
    if isinstance(v, str) and v.startswith('no:'):
        raise RuntimeError('нет варианта «' + str(p.get('value', ''))[:80] + '»')
    return {'label': f'выбрано «{v}» в [{p.get("ref")}]'}


def op_nav(cdp, p):
    action = p.get('action', 'reload')
    if action == 'back':
        cdp.evaluate('history.back()')
    else:
        cdp.evaluate('location.reload()')
    cdp.wait_ready()
    return cdp.snapshot_text()


def op_eval(cdp, p):
    expr = str(p.get('expr', ''))[:2000]
    if not expr:
        raise RuntimeError('нужен expr')
    return {'value': cdp.evaluate(expr)}


OPS = {
    'version': lambda cdp, p: http_json('/json/version'),
    'open': op_open,
    'snapshot': lambda cdp, p: cdp.snapshot_text(),
    'click': op_click,
    'type': op_type,
    'select': op_select,
    'nav': op_nav,
    'eval': op_eval,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in OPS:
        print(json.dumps({'ok': False, 'error': 'операции: ' + ', '.join(sorted(OPS))}))
        return 2
    try:
        params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    except Exception:
        print(json.dumps({'ok': False, 'error': 'параметры — JSON'}))
        return 2
    try:
        cdp = CDP()
        print(json.dumps({'ok': True, 'result': OPS[sys.argv[1]](cdp, params)}, ensure_ascii=False))
        return 0
    except RuntimeError as e:
        print(json.dumps({'ok': False, 'error': str(e)[:500]}, ensure_ascii=False))
        return 1
    except Exception as e:  # сеть/протокол: сырая ошибка для диагностики
        print(json.dumps({'ok': False, 'error': type(e).__name__ + ': ' + str(e)[:300]}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
