@echo off
setlocal enabledelayedexpansion

REM ==============================================================================
REM ATLAS HISTORICO DE SECAS DO ESTADO DO RIO DE JANEIRO (CHIRPS + ERA5-Land)
REM Script de automacao para atualizacao de dados, recalculo e sincronizacao web
REM ==============================================================================

echo.
echo ==============================================================================
echo   ATLAS DE SECAS DO RIO DE JANEIRO - ATUALIZACAO AUTOMATIZADA
echo ==============================================================================
echo.

set "BASE_DIR=%~dp0"
set "SCRIPTS_DIR=%BASE_DIR%scripts"
set "WEB_DIR=%BASE_DIR%web"
set "DOCS_DIR=%BASE_DIR%..\docs\atlas-secas-rj"

echo [*] Diretorio do projeto: %BASE_DIR%
echo [*] Diretorio de web:     %WEB_DIR%
echo [*] Diretorio publico:    %DOCS_DIR%
echo.

REM 1. Localizar executavel do Rscript
set "RSCRIPT_CMD="
where Rscript >nul 2>nul
if %ERRORLEVEL% equ 0 set "RSCRIPT_CMD=Rscript"

if not defined RSCRIPT_CMD (
    for /d %%D in ("%ProgramFiles%\R\R-*") do (
        if exist "%%~fD\bin\x64\Rscript.exe" set "RSCRIPT_CMD=%%~fD\bin\x64\Rscript.exe"
    )
)

if not defined RSCRIPT_CMD (
    for /d %%D in ("%ProgramFiles%\R\R-*") do (
        if exist "%%~fD\bin\Rscript.exe" set "RSCRIPT_CMD=%%~fD\bin\Rscript.exe"
    )
)

if not defined RSCRIPT_CMD (
    for /d %%D in ("%LOCALAPPDATA%\Programs\R\R-*") do (
        if exist "%%~fD\bin\x64\Rscript.exe" set "RSCRIPT_CMD=%%~fD\bin\x64\Rscript.exe"
    )
)

if not defined RSCRIPT_CMD goto :erro_rscript

echo [+] Rscript detectado: "!RSCRIPT_CMD!"
goto :check_python

:erro_rscript
echo [ERRO] Rscript nao encontrado no PATH nem nos diretorios padrao.
echo Certifique-se de que o R esta instalado em Arquivos de Programas.
pause
exit /b 1

:check_python
REM 2. Localizar executavel do Python
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
goto :exec_pipeline

:erro_python
echo [ERRO] Python nao encontrado no PATH do sistema.
echo Certifique-se de que o Python esta instalado.
pause
exit /b 1

:exec_pipeline
echo.
echo [1/4] Executando pipeline completo de calculo em R: SPEI 3, 6, 12, 24 e ARIMA...
echo Isso pode levar alguns minutos dependendo do volume de dados...
echo.
"%RSCRIPT_CMD%" "%SCRIPTS_DIR%\generate_atlas_dataset.R"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERRO] Falha na execucao de generate_atlas_dataset.R. Verifique as mensagens acima.
    pause
    exit /b 1
)

echo.
echo [2/4] Copiando dados atualizados para a pasta local da aplicacao web...
if not exist "%WEB_DIR%\data" mkdir "%WEB_DIR%\data"
xcopy /E /I /Y "%DOCS_DIR%\data\*" "%WEB_DIR%\data\" >nul

echo.
echo [3/4] Sincronizando aplicacao web completa com a pasta de publicacao docs/atlas-secas-rj...
if not exist "%DOCS_DIR%" mkdir "%DOCS_DIR%"
xcopy /E /I /Y "%WEB_DIR%\*" "%DOCS_DIR%\" >nul

echo.
echo [4/4] Verificando integridade dos arquivos gerados...
if exist "%WEB_DIR%\data\spei_12.json" (
    echo  [OK] spei_12.json atualizado.
) else (
    echo  [ALERTA] spei_12.json nao encontrado.
)
if exist "%WEB_DIR%\data\forecast.json" (
    echo  [OK] forecast.json atualizado.
) else (
    echo  [ALERTA] forecast.json nao encontrado.
)
if exist "%WEB_DIR%\data\dates.json" (
    echo  [OK] dates.json atualizado.
) else (
    echo  [ALERTA] dates.json nao encontrado.
)

echo.
echo ==============================================================================
echo   ATUALIZACAO CONCLUIDA COM SUCESSO!
echo ==============================================================================
echo Os novos dados observados e as projecoes ja estao prontos no app local e publico.
echo.
pause
