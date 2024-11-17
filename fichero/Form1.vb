Imports System.IO
Imports MySql.Data.MySqlClient


Public Class Form1
    Friend conexion As MySqlConnection
    Private Sub Form1_Load(sender As Object, e As EventArgs) Handles MyBase.Load
        Me.WindowState = FormWindowState.Minimized
        Me.ShowInTaskbar = False
        Timer1.Enabled = True
        NotifyIcon1.Text = "Iniciado"
    End Sub

    Private Sub iniciar_Click(sender As Object, e As EventArgs) Handles iniciar.Click

        Timer1.Enabled = True

        NotifyIcon1.Visible = True
        NotifyIcon1.BalloonTipText = "SE INICIO LA CREACION DE ARCHIVOS"
        NotifyIcon1.ShowBalloonTip(2000)
        NotifyIcon1.Text = "Iniciado"

    End Sub
    Private Sub parar_Click(sender As Object, e As EventArgs) Handles parar.Click
        Timer1.Enabled = False

        NotifyIcon1.Visible = True
        NotifyIcon1.BalloonTipText = "SE DETUVO LA CREACION DE ARCHIVOS"
        NotifyIcon1.ShowBalloonTip(2000)
        NotifyIcon1.Text = "Detenido"
    End Sub
    Private Sub NotifyIcon1_MouseDoubleClick(sender As Object, e As MouseEventArgs) Handles NotifyIcon1.MouseDoubleClick
        Me.WindowState = FormWindowState.Normal
        Me.ShowInTaskbar = True
    End Sub

    Private Sub Timer1_Tick(sender As Object, e As EventArgs) Handles Timer1.Tick
        If Conectar() Then
            If crear() Then
                '  MsgBox("archivocreado")
                NotifyIcon1.Visible = True
                NotifyIcon1.BalloonTipText = "archivo creado"
                NotifyIcon1.ShowBalloonTip(2000)
            End If

        End If

    End Sub

    Private Function Conectar() As Boolean
        Try
            conexion = New MySqlConnection()
            conexion.ConnectionString = "server=" & Me.ip.Text & ";" & "user id=" & Me.usuario.Text & ";" & "password=" & Me.passwd.Text & ";" & "port=" & "3307" & ";" & "database=" & "adms_db" & ";" '& "connect timeout=120;"
            conexion.Open()
            Return True
        Catch ex As MySqlException
            NotifyIcon1.Visible = True
            NotifyIcon1.Text = "Detenido"
            NotifyIcon1.BalloonTipText = "SE PRODUJO UN ERROR sql - SE DETUVO LA CREACION DE ARCHIVOS"
            NotifyIcon1.ShowBalloonTip(2000)
            Timer1.Enabled = False
            MessageBox.Show(ex.ToString)
            Return False
        End Try



    End Function

    Private Function crear() As Boolean
        Dim stm As String
        Dim cmd As MySqlCommand
        Dim leer As MySqlDataReader
        Dim archivo As StreamWriter
        Dim nombrea As String
        Dim dni As String
        Dim fecha As DateTime
        Dim estado As String
        Dim linea As String
        Dim path As String

        stm = "SELECT userinfo.badgenumber, checkinout.checktime, checkinout.checktype, userinfo.name " _
           & "FROM checkinout INNER JOIN userinfo ON checkinout.userid = userinfo.userid ORDER BY checkinout.checktime DESC limit 200000;"

        Try
            REM MsgBox("prueba")
            cmd = New MySqlCommand(stm, conexion)
            cmd.CommandTimeout = 0
            leer = cmd.ExecuteReader

            REM  For Each fichero As String In Directory.GetFiles(Directory.GetCurrentDirectory(), "*.txt")
            REM       File.Delete(fichero)
            REM  Next
            path = Directory.GetCurrentDirectory() & "/fichadas/"
            If Not Directory.Exists(path) Then
                Directory.CreateDirectory(path)
            End If

            nombrea = "026" & "_Fichadas_" & DateTime.Now.ToString("yyMMdd") & "_" & DateTime.Now.ToString("HHmm") & "_048350"
            REM  archivo = File.CreateText(Directory.GetCurrentDirectory() & "/" & nombrea & Second(DateTime.Now) & ".txt")
            archivo = File.CreateText(path & nombrea & ".txt")

            While leer.Read()

                dni = "DNI" & leer.Item(0).ToString()
                fecha = Convert.ToDateTime(Format("{0:dd/MM/yyyy HH:mm:ss}", leer.Item(1).ToString()))

                If leer.Item(2).ToString = "0" Then
                    estado = "E"
                Else
                    estado = "S"
                End If

                linea = String.Format("{0,-14}", dni) & "," & String.Format("{0,-19}", fecha.ToString("dd/MM/yyyy HH:mm:ss")) & "," & estado & "," & "1" & "," & String.Format("{0,-32}", leer.Item(3).ToString) & ","
                archivo.WriteLine(linea)
                REM  MsgBox(linea)
            End While

            archivo.Flush()
            archivo.Close()

            conexion.Close()
            REM My.Computer.Network.UploadFile(path & nombrea & ".txt", "ftp://10.2.250.4/fichadas/" & nombrea & ".txt", "evita", "3v1t42")

            Dim Ftp As Renci.SshNet.SftpClient = New Renci.SshNet.SftpClient("10.2.250.4", "evita", "3v1t42")
            Dim asubir As Stream = New FileStream(path & nombrea & ".txt", FileMode.Open)
            Ftp.Connect()
            If Ftp.IsConnected() Then

                Ftp.UploadFile(asubir, "/fichadas/" & nombrea & ".txt", False)
                If Ftp.Exists("/fichadas/" & nombrea & ".txt") Then
                    NotifyIcon1.Visible = True
                    NotifyIcon1.BalloonTipText = "ARCHIVO SUBIDO"
                    NotifyIcon1.ShowBalloonTip(2000)
                    Ftp.Disconnect()
                Else
                    MsgBox("no existe")
                    Ftp.Disconnect()
                End If




            Else
                MsgBox("no conectado")

            End If
            Return True

        Catch ex As MySqlException
            MessageBox.Show(ex.ToString)
            NotifyIcon1.Visible = True
            NotifyIcon1.Text = "Detenido"
            NotifyIcon1.BalloonTipText = "SE PRODUJO UN ERROR archivo - SE DETUVO LA CREACION DE ARCHIVOS"
            NotifyIcon1.ShowBalloonTip(2000)
            Timer1.Enabled = False
            Return False
        End Try

    End Function

    Private Sub SalirToolStripMenuItem_Click(sender As Object, e As EventArgs) Handles SalirToolStripMenuItem.Click
        Me.Close()
    End Sub

    Private Sub Button1_Click(sender As Object, e As EventArgs) Handles Button1.Click
        If Conectar() Then
            If crear() Then
                '  MsgBox("archivocreado")
                NotifyIcon1.Visible = True
                NotifyIcon1.BalloonTipText = "archivo creado"
                NotifyIcon1.ShowBalloonTip(2000)
            End If

        End If
    End Sub
End Class
