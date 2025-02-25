namespace tablerodecomando
{
    partial class agentesporservicio
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
            AGENTEXSERVICIO = new ListView();
            comboBoxServicios = new ComboBox();
            comboBox2 = new ComboBox();
            label1 = new Label();
            SuspendLayout();
            // 
            // AGENTEXSERVICIO
            // 
            AGENTEXSERVICIO.Location = new Point(12, 157);
            AGENTEXSERVICIO.Name = "AGENTEXSERVICIO";
            AGENTEXSERVICIO.Size = new Size(1739, 317);
            AGENTEXSERVICIO.TabIndex = 0;
            AGENTEXSERVICIO.UseCompatibleStateImageBehavior = false;
            // 
            // comboBoxServicios
            // 
            comboBoxServicios.FormattingEnabled = true;
            comboBoxServicios.Location = new Point(182, 93);
            comboBoxServicios.Name = "comboBoxServicios";
            comboBoxServicios.Size = new Size(231, 33);
            comboBoxServicios.TabIndex = 1;
            // 
            // comboBox2
            // 
            comboBox2.FormattingEnabled = true;
            comboBox2.Location = new Point(541, 64);
            comboBox2.Name = "comboBox2";
            comboBox2.Size = new Size(182, 33);
            comboBox2.TabIndex = 2;
            // 
            // label1
            // 
            label1.AutoSize = true;
            label1.Location = new Point(250, 64);
            label1.Name = "label1";
            label1.Size = new Size(98, 25);
            label1.TabIndex = 3;
            label1.Text = "SERVICIOS";
            // 
            // agentesporservicio
            // 
            AutoScaleDimensions = new SizeF(10F, 25F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(1763, 505);
            Controls.Add(label1);
            Controls.Add(comboBox2);
            Controls.Add(comboBoxServicios);
            Controls.Add(AGENTEXSERVICIO);
            Name = "agentesporservicio";
            Text = "AGENTES  POR SERVICIO";
            WindowState = FormWindowState.Maximized;
            ResumeLayout(false);
            PerformLayout();
        }

        #endregion

        private ListView AGENTEXSERVICIO;
        private ComboBox comboBoxServicios;
        private ComboBox comboBox2;
        private Label label1;
    }
}