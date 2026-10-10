#!/usr/bin/env python3
"""Диагностика исходящей сети песочницы: DNS, TCP 80/443, HTTP."""
import socket
import urllib.request

print('--- dns ---')
try:
    s = socket.create_connection(('192.168.65.7', 53), timeout=5)
    s.close()
    print('docker-dns: ok')
except Exception as e:
    print('docker-dns: FAIL', str(e)[:100])

for host in ('1.1.1.1', '8.8.8.8'):
    try:
        s = socket.create_connection((host, 53), timeout=5)
        s.close()
        print(host, ': ok')
    except Exception as e:
        print(host, ': FAIL', str(e)[:100])

print('--- resolve ---')
try:
    print('example.com =', socket.gethostbyname('example.com'))
except Exception as e:
    print('resolve: FAIL', str(e)[:120])

print('--- http ---')
try:
    r = urllib.request.urlopen('http://example.com', timeout=15)
    print('http:', r.status, len(r.read()), 'bytes')
except Exception as e:
    print('http: FAIL', str(e)[:200])
