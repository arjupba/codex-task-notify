@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0codex-notify.ps1" %*
