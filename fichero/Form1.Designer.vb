<Global.Microsoft.VisualBasic.CompilerServices.DesignerGenerated()>
Partial Class Form1
    Inherits System.Windows.Forms.Form

    'Form reemplaza a Dispose para limpiar la lista de componentes.
    <System.Diagnostics.DebuggerNonUserCode()>
    Protected Overrides Sub Dispose(ByVal disposing As Boolean)
        Try
            If disposing AndAlso components IsNot Nothing Then
                components.Dispose()
            End If
        Finally
            MyBase.Dispose(disposing)
        End Try
    End Sub

    'Requerido por el Diseñador de Windows Forms
    Private components As System.ComponentModel.IContainer

    'NOTA: el Diseñador de Windows Forms necesita el siguiente procedimiento
    'Se puede modificar usando el Diseñador de Windows Forms.  
    'No lo modifique con el editor de código.
    <System.Diagnostics.DebuggerStepThrough()>
    Private Sub InitializeComponent()
        Me.components = New System.ComponentModel.Container()
        Dim resources As System.ComponentModel.ComponentResourceManager = New System.ComponentModel.ComponentResourceManager(GetType(Form1))
        Me.iniciar = New System.Windows.Forms.Button()
        Me.ContextMenuStrip1 = New System.Windows.Forms.ContextMenuStrip(Me.components)
        Me.SalirToolStripMenuItem = New System.Windows.Forms.ToolStripMenuItem()
        Me.Timer1 = New System.Windows.Forms.Timer(Me.components)
        Me.base = New System.Windows.Forms.TextBox()
        Me.passwd = New System.Windows.Forms.TextBox()
        Me.usuario = New System.Windows.Forms.TextBox()
        Me.ip = New System.Windows.Forms.TextBox()
        Me.NotifyIcon1 = New System.Windows.Forms.NotifyIcon(Me.components)
        Me.parar = New System.Windows.Forms.Button()
        Me.Button1 = New System.Windows.Forms.Button()
        Me.ContextMenuStrip1.SuspendLayout()
        Me.SuspendLayout()
        '
        'iniciar
        '
        Me.iniciar.Location = New System.Drawing.Point(394, 58)
        Me.iniciar.Margin = New System.Windows.Forms.Padding(4, 5, 4, 5)
        Me.iniciar.Name = "iniciar"
        Me.iniciar.Size = New System.Drawing.Size(112, 35)
        Me.iniciar.TabIndex = 0
        Me.iniciar.Text = "Iniciar"
        Me.iniciar.UseVisualStyleBackColor = True
        '
        'ContextMenuStrip1
        '
        Me.ContextMenuStrip1.ImageScalingSize = New System.Drawing.Size(24, 24)
        Me.ContextMenuStrip1.Items.AddRange(New System.Windows.Forms.ToolStripItem() {Me.SalirToolStripMenuItem})
        Me.ContextMenuStrip1.Name = "ContextMenuStrip1"
        Me.ContextMenuStrip1.Size = New System.Drawing.Size(118, 36)
        '
        'SalirToolStripMenuItem
        '
        Me.SalirToolStripMenuItem.Name = "SalirToolStripMenuItem"
        Me.SalirToolStripMenuItem.Size = New System.Drawing.Size(117, 32)
        Me.SalirToolStripMenuItem.Text = "Salir"
        '
        'Timer1
        '
        Me.Timer1.Interval = 2400000
        '
        'base
        '
        Me.base.Location = New System.Drawing.Point(63, 242)
        Me.base.Margin = New System.Windows.Forms.Padding(4, 5, 4, 5)
        Me.base.Name = "base"
        Me.base.Size = New System.Drawing.Size(218, 26)
        Me.base.TabIndex = 4
        Me.base.Text = "reloj"
        '
        'passwd
        '
        Me.passwd.Location = New System.Drawing.Point(63, 180)
        Me.passwd.Margin = New System.Windows.Forms.Padding(4, 5, 4, 5)
        Me.passwd.Name = "passwd"
        Me.passwd.PasswordChar = Global.Microsoft.VisualBasic.ChrW(42)
        Me.passwd.Size = New System.Drawing.Size(218, 26)
        Me.passwd.TabIndex = 3
        Me.passwd.Text = "appfichero"
        '
        'usuario
        '
        Me.usuario.Location = New System.Drawing.Point(63, 118)
        Me.usuario.Margin = New System.Windows.Forms.Padding(4, 5, 4, 5)
        Me.usuario.Name = "usuario"
        Me.usuario.Size = New System.Drawing.Size(218, 26)
        Me.usuario.TabIndex = 2
        Me.usuario.Text = "ficheroapp"
        '
        'ip
        '
        Me.ip.Location = New System.Drawing.Point(63, 58)
        Me.ip.Margin = New System.Windows.Forms.Padding(4, 5, 4, 5)
        Me.ip.Name = "ip"
        Me.ip.Size = New System.Drawing.Size(218, 26)
        Me.ip.TabIndex = 1
        Me.ip.Text = "127.0.0.1"
        '
        'NotifyIcon1
        '
        Me.NotifyIcon1.BalloonTipIcon = System.Windows.Forms.ToolTipIcon.Info
        Me.NotifyIcon1.ContextMenuStrip = Me.ContextMenuStrip1
        Me.NotifyIcon1.Icon = CType(resources.GetObject("NotifyIcon1.Icon"), System.Drawing.Icon)
        Me.NotifyIcon1.Text = "Hzga32"
        Me.NotifyIcon1.Visible = True
        '
        'parar
        '
        Me.parar.Location = New System.Drawing.Point(394, 142)
        Me.parar.Margin = New System.Windows.Forms.Padding(4, 5, 4, 5)
        Me.parar.Name = "parar"
        Me.parar.Size = New System.Drawing.Size(112, 35)
        Me.parar.TabIndex = 5
        Me.parar.Text = "Parar"
        Me.parar.UseVisualStyleBackColor = True
        '
        'Button1
        '
        Me.Button1.Location = New System.Drawing.Point(393, 242)
        Me.Button1.Margin = New System.Windows.Forms.Padding(4, 5, 4, 5)
        Me.Button1.Name = "Button1"
        Me.Button1.Size = New System.Drawing.Size(112, 35)
        Me.Button1.TabIndex = 6
        Me.Button1.Text = "FORZAR CARGA 40000"
        Me.Button1.UseVisualStyleBackColor = True
        '
        'Form1
        '
        Me.AutoScaleDimensions = New System.Drawing.SizeF(9.0!, 20.0!)
        Me.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font
        Me.ClientSize = New System.Drawing.Size(582, 372)
        Me.Controls.Add(Me.Button1)
        Me.Controls.Add(Me.parar)
        Me.Controls.Add(Me.base)
        Me.Controls.Add(Me.passwd)
        Me.Controls.Add(Me.usuario)
        Me.Controls.Add(Me.ip)
        Me.Controls.Add(Me.iniciar)
        Me.Margin = New System.Windows.Forms.Padding(4, 5, 4, 5)
        Me.MaximizeBox = False
        Me.Name = "Form1"
        Me.Text = "Modulo Fichero"
        Me.ContextMenuStrip1.ResumeLayout(False)
        Me.ResumeLayout(False)
        Me.PerformLayout()

    End Sub

    Friend WithEvents iniciar As Button
    Friend WithEvents ip As TextBox
    Friend WithEvents ContextMenuStrip1 As ContextMenuStrip
    Friend WithEvents usuario As TextBox
    Friend WithEvents passwd As TextBox
    Friend WithEvents base As TextBox
    Friend WithEvents Timer1 As Timer
    Friend WithEvents NotifyIcon1 As NotifyIcon
    Friend WithEvents SalirToolStripMenuItem As ToolStripMenuItem
    Friend WithEvents parar As Button
    Friend WithEvents Button1 As Button
End Class
