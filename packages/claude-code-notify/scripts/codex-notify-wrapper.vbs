Option Explicit

Dim shell
Dim env
Dim command
Dim exitCode
Dim payload

If WScript.Arguments.Count < 1 Then
    WScript.Quit 1
End If

payload = WScript.Arguments.Item(0)

Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("Process")

env("CLAUDE_CODE_NOTIFY_PAYLOAD") = payload
command = shell.ExpandEnvironmentStrings("%ComSpec%") & " /d /c claude-code-notify.cmd"
exitCode = shell.Run(command, 0, True)
env("CLAUDE_CODE_NOTIFY_PAYLOAD") = ""

WScript.Quit exitCode
