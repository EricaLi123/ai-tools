' Launch any command passed as argv with a hidden window.
' Used for logon autostart so codex-session-watch does not need a visible console.

Dim shell, command, index

If WScript.Arguments.Count = 0 Then
    WScript.Quit 1
End If

Set shell = CreateObject("WScript.Shell")
command = ""

For index = 0 To WScript.Arguments.Count - 1
    If index > 0 Then
        command = command & " "
    End If
    command = command & QuoteArg(WScript.Arguments(index))
Next

shell.Run command, 0, False

Function QuoteArg(value)
    QuoteArg = """" & Replace(value, """", """""") & """"
End Function
