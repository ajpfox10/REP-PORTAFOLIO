namespace tablerodecomando
{
    partial class FORMUALRIOEXPEDIENTES
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            expedientes = new ListView();
            cmbColumnas = new ComboBox();
            cmbValores = new ComboBox();
            label1 = new Label();
            label2 = new Label();
            SuspendLayout();
            // 
            // expedientes
            // 
            expedientes.Location = new Point(12, 163);
            expedientes.Name = "expedientes";
            expedientes.Size = new Size(1748, 381);
            expedientes.TabIndex = 0;
            expedientes.UseCompatibleStateImageBehavior = false;
            expedientes.View = View.Details;
            // 
            // cmbColumnas
            // 
            cmbColumnas.FormattingEnabled = true;
            cmbColumnas.Location = new Point(163, 99);
            cmbColumnas.Name = "cmbColumnas";
            cmbColumnas.Size = new Size(235, 33);
            cmbColumnas.TabIndex = 1;
            cmbColumnas.SelectedIndexChanged += cmbColumnas_SelectedIndexChanged;
            // 
            // cmbValores
            // 
            cmbValores.FormattingEnabled = true;
            cmbValores.Location = new Point(490, 99);
            cmbValores.Name = "cmbValores";
            cmbValores.Size = new Size(492, 33);
            cmbValores.TabIndex = 2;
            cmbValores.SelectedIndexChanged += cmbValores_SelectedIndexChanged;
            // 
            // label1
            // 
            label1.AutoSize = true;
            label1.Location = new Point(184, 71);
            label1.Name = "label1";
            label1.Size = new Size(184, 25);
            label1.TabIndex = 3;
            label1.Text = "COLUMNA A FILTRAR";
            // 
            // label2
            // 
            label2.AutoSize = true;
            label2.Location = new Point(684, 71);
            label2.Name = "label2";
            label2.Size = new Size(154, 25);
            label2.TabIndex = 4;
            label2.Text = "DATOS A FILTRAR";
            // 
            // FORMUALRIOEXPEDIENTES
            // 
            AutoScaleDimensions = new SizeF(10F, 25F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(1772, 594);
            Controls.Add(label2);
            Controls.Add(label1);
            Controls.Add(cmbValores);
            Controls.Add(cmbColumnas);
            Controls.Add(expedientes);
            Name = "FORMUALRIOEXPEDIENTES";
            Text = "FORMUALRIO DE EXPEDIENTES";
            WindowState = FormWindowState.Maximized;
            Load += FORMULARIOEXPEDIENTES_Load;
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private ListView expedientes;
        private ComboBox cmbColumnas;
        private ComboBox cmbValores;
        private Label label1;
        private Label label2;
    }
}