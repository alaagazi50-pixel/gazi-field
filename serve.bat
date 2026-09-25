@echo off
REM Serves GAZI FIELD at http://localhost:8080 (service workers need http://localhost or https://)
cd /d "%~dp0"
echo GAZI FIELD running at http://localhost:8080
python -m http.server 8080
