@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\svn-publish.ps1" %*
