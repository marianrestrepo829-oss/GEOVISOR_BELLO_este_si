@echo off
title Geovisor de Bello
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Iniciar_Geovisor.ps1"
if errorlevel 1 pause
