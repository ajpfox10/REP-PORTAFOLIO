namespace tablerodecomando
{
    partial class Formprincipal
    {
        /// <summary>
        ///  Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        ///  Clean up any resources being used.
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
        ///  Required method for Designer support - do not modify
        ///  the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            button1 = new Button();
            button2 = new Button();
            SuspendLayout();
            // 
            // button1
            // 
            button1.Location = new Point(233, 174);
            button1.Name = "button1";
            button1.Size = new Size(187, 118);
            button1.TabIndex = 0;
            button1.Text = "EXPEDIENTES DE NOMBRAMIENTO";
            button1.UseVisualStyleBackColor = true;
            button1.Click += button1_Click;
            // 
            // button2
            // 
            button2.Location = new Point(605, 174);
            button2.Name = "button2";
            button2.Size = new Size(224, 118);
            button2.TabIndex = 1;
            button2.Text = "VER AGENTES POR SECTOR";
            button2.UseVisualStyleBackColor = true;
            button2.Click += button2_Click;
            // 
            // Formprincipal
            // 
            AutoScaleDimensions = new SizeF(10F, 25F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(1742, 619);
            Controls.Add(button2);
            Controls.Add(button1);
            Name = "Formprincipal";
            Text = "TABLERO DE COMANDO ";
            Load += Formprincipal_Load;
            ResumeLayout(false);
        }

        #endregion

        private Button button1;
        private Button button2;
    }
}