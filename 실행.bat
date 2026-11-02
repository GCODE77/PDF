@echo off
rem PDF Studio local launcher (open http://localhost:8772 in a browser)
cd /d "%~dp0"
start "" http://localhost:8772/
python -m http.server 8772
