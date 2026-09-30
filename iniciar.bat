@echo off
rem Abre o Human Heart no navegador usando um mini servidor local (nao instala nada).
rem Os modulos JavaScript e o modelo 3D nao carregam com o index.html aberto direto do disco.
title Human Heart - servidor local
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\servidor.ps1"
if errorlevel 1 pause
