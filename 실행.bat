@echo off
rem PDF Gongjakso - offline launcher (no install needed)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
