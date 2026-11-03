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
for f in ('main.js', 'preload.js', 'package.json', 'afterPack.js'): shutil.copy(os.path.join(here, f), out)
Image.open(os.path.join(web, 'icons', 'icon-512.png')).save(os.path.join(out, 'build', 'icon.ico'), sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
npm = 'npm.cmd' if os.name == 'nt' else 'npm'
subprocess.check_call([npm, 'install', '--no-audit', '--no-fund'], cwd=out)

# 설치 프로그램 안내 문구 한국어 보정: 기본 번역은 「OK을 클릭하면…」이라 실제 버튼(확인)과 다르고, 일부는 영어로 나온다
import re
msg = os.path.join(out, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'messages.yml')
KO = {
    'appRunning': '${PRODUCT_NAME}이(가) 실행 중입니다.\\n「확인」을 누르면 종료합니다.\\n종료되지 않으면 직접 종료해 주세요.',
    'appCannotBeClosed': '${PRODUCT_NAME}을(를) 종료하지 못했습니다.\\n직접 종료한 뒤 「다시 시도」를 눌러 계속하세요.',
    'decompressionFailed': '파일 압축을 풀지 못했습니다. 설치 프로그램을 다시 실행해 주세요.',
    'uninstallFailed': '이전 버전의 파일을 제거하지 못했습니다. 설치 프로그램을 다시 실행해 주세요.',
}
text = open(msg, encoding='utf-8').read()
for key, ko in KO.items():
    m = re.search(r'^%s:\n((?:  .*\n)+)' % key, text, re.M)
    if not m: continue
    block = m.group(0)
    line = '  ko: "%s"\n' % ko
    if re.search(r'^  ko: .*$', block, re.M): nb = re.sub(r'^  ko: .*\n', lambda _: line, block, count=1, flags=re.M)
    else: nb = re.sub(r'(^  en: .*\n)', lambda mm: mm.group(1) + line, block, count=1, flags=re.M)
    text = text.replace(block, nb, 1)
open(msg, 'w', encoding='utf-8').write(text)
print('설치 문구 보정:', ', '.join(KO))
subprocess.check_call([npm, 'exec', '--', 'electron-builder', '--win', 'nsis', '--x64'], cwd=out)
print('완료:', os.path.join(out, 'dist', 'PDF-Gongjakso-Setup.exe'))
