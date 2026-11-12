@echo off
setlocal enabledelayedexpansion

REM ==============================================================================
REM ATLAS HISTORICO DE SECAS DO ESTADO DO RIO DE JANEIRO (1981-2025)
REM Script para inicializar servidor local e abrir a aplicacao web no navegador
REM ==============================================================================

title Atlas de Secas do Rio de Janeiro - Servidor Web Local
color 0b

set "PORT=8080"
set "BASE_DIR=%~dp0"
set "WEB_DIR=%BASE_DIR%web"

echo.
echo ==============================================================================
echo   ATLAS HISTORICO DE SECAS DO RIO DE JANEIRO - INICIANDO APLICACAO WEB
echo ==============================================================================
echo.
echo [*] Diretorio web: %WEB_DIR%
echo [*] Porta local:   %PORT%
echo.

REM 1. Localizar executavel do Python
set "PYTHON_CMD="
where python >nul 2>nul
if %ERRORLEVEL% equ 0 set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
    if exist "C:\Python314\python.exe" set "PYTHON_CMD=C:\Python314\python.exe"
)

if not defined PYTHON_CMD (
    for /d %%P in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
        if exist "%%~fP\python.exe" set "PYTHON_CMD=%%~fP\python.exe"
    )
)

if not defined PYTHON_CMD goto :erro_python

echo [+] Python detectado: "!PYTHON_CMD!"
echo [+] Abrindo o Atlas no navegador padrao...
echo.

REM 2. Abre a URL no navegador padrao do sistema
start http://localhost:%PORT%

REM 3. Inicia o servidor HTTP na pasta web
echo ==============================================================================
echo   SERVIDOR ATIVO EM: http://localhost:%PORT%
echo ==============================================================================
echo.
echo Dica: Pressione Ctrl + C ou feche esta janela para encerrar o servidor.
echo.

cd /d "%WEB_DIR%"
"!PYTHON_CMD!" -m http.server %PORT%

goto :fim

:erro_python
echo [ERRO] Python nao foi encontrado no sistema.
echo Certifique-se de que o Python esta instalado para rodar o servidor HTTP local.
echo.
pause
exit /b 1

:fim
