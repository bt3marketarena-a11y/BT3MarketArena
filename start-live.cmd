@echo off
cd /d "%~dp0"
if not exist artifacts mkdir artifacts
npm start > artifacts\live-launcher.log 2>&1
