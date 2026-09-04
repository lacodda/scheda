; File associations, delegated to the application itself.
;
; The NSIS template ships an APP_ASSOCIATE macro, but it registers a type by
; writing the extension key's default value — which claims the type outright and
; takes .md away from whichever editor the user had chosen. scheda offers the
; type instead, and the logic for that lives in Rust (src/associations.rs) where
; it is readable and tested, rather than duplicated in installer script.
;
; Both hooks are quiet: a registration that fails is not a reason to fail an
; install, and the user can always pick scheda through "Open with".

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering scheda as a markdown handler"
  nsExec::ExecToLog '"$INSTDIR\${MAINBINARYNAME}.exe" --register'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing the markdown registration"
  nsExec::ExecToLog '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister'
  Pop $0
!macroend
