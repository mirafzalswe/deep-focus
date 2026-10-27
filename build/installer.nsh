; Деинсталлятор Deep Focus: перед удалением файлов просим приложение снять блокировку
; (вернуть исходные настройки системного прокси пользователя, HKCU). Права администратора не нужны.
!macro customUnInstall
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +2
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --cleanup'
!macroend
