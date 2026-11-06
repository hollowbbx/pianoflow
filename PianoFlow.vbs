' ============================================================================
' PianoFlow - Abre la app en su propia ventana, sin ventana negra.
' Usalo con doble clic (o con el ícono "PianoFlow" del escritorio).
' ============================================================================
Option Explicit
Dim sh, fso, dir, url, py
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:8085/"

' 1) Servidor local en segundo plano (invisible). Si ya estaba andando, este intento se cierra solo.
py = ""
On Error Resume Next
If sh.Run("cmd /c where pythonw >nul 2>nul", 0, True) = 0 Then
  py = "pythonw"
ElseIf sh.Run("cmd /c where pyw >nul 2>nul", 0, True) = 0 Then
  py = "pyw"
End If
On Error GoTo 0

If py = "" Then
  ' Sin Python: abre el archivo directo (funciona, pero sin modo app instalable)
  sh.Run """" & dir & "\index.html""", 1, False
  WScript.Quit
End If

sh.Run py & " """ & dir & "\servidor.py""", 0, False
WScript.Sleep 800

' 2) Abre PianoFlow como app (ventana propia). Edge; si no, Chrome; si no, el navegador por defecto.
On Error Resume Next
sh.Run "msedge --app=" & url, 1, False
If Err.Number <> 0 Then
  Err.Clear
  sh.Run "chrome --app=" & url, 1, False
  If Err.Number <> 0 Then
    Err.Clear
    sh.Run url, 1, False
  End If
End If
