# 설치 파일(Setup.exe) 만들기: 한글 경로 문제를 피하려고 임시 폴더(영문 경로)에서 빌드한다.
#   사용: python build.py  [빌드폴더, 기본 %TEMP%/pdfg-build]
import os, shutil, subprocess, sys
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); web = os.path.dirname(here)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('TEMP', '.'), 'pdfg-build')
shutil.rmtree(os.path.join(out, 'app'), ignore_errors=True)
os.makedirs(os.path.join(out, 'build'), exist_ok=True)
skip = shutil.ignore_patterns('.git', 'desktop', 'candidates', '*.zip', '실행.bat', 'server.ps1', 'dist', 'node_modules')
shutil.copytree(web, os.path.join(out, 'app'), ignore=skip)
for f in ('main.js', 'preload.js', 'package.json'): shutil.copy(os.path.join(here, f), out)
Image.open(os.path.join(web, 'icons', 'icon-512.png')).save(os.path.join(out, 'build', 'icon.ico'), sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
npm = 'npm.cmd' if os.name == 'nt' else 'npm'
subprocess.check_call([npm, 'install', '--no-audit', '--no-fund'], cwd=out)
subprocess.check_call([npm, 'exec', '--', 'electron-builder', '--win', 'nsis', '--x64'], cwd=out)
print('완료:', os.path.join(out, 'dist', 'PDF-Gongjakso-Setup.exe'))
