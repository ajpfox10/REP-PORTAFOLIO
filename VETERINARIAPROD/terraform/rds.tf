# RDS MySQL 8.0 con backups automáticos (INF8)
resource "aws_db_subnet_group" "main" {
  name       = "${var.app_name}-db-subnet"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "mysql" {
  identifier             = "${var.app_name}-mysql"
  engine                 = "mysql"
  engine_version         = "8.0"
  instance_class         = "db.t3.medium"
  allocated_storage      = 50
  max_allocated_storage  = 500
  storage_type           = "gp3"
  storage_encrypted      = true

  db_name  = "vetmanager"
  username = "vetmanager_app"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # Backups automáticos + PITR (OT-132)
  # 14-day retention: covers a full business fortnight for incident investigation,
  # GDPR right-of-erasure audits, and the monthly restore drill (OT-131).
  # AWS minimum is 1; 7 was too short for SaaS forensics.
  # If compliance requires 30 days, set to 30 — cost impact is ~2× storage.
  backup_retention_period = 14
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  # PITR logs and observability
  enabled_cloudwatch_logs_exports = ["error", "slowquery", "general"]

  # Enhanced monitoring (60-second interval) + Performance Insights (7-day free tier)
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_enhanced_monitoring.arn
  performance_insights_enabled    = true
  performance_insights_retention_period = 7   # days (free); set 731 for 2yr paid

  deletion_protection = true
  skip_final_snapshot = false
  final_snapshot_identifier = "${var.app_name}-final-snapshot"

  tags = { Name = "${var.app_name}-mysql", Environment = var.environment }
}

# IAM role for RDS Enhanced Monitoring (OT-132)
resource "aws_iam_role" "rds_enhanced_monitoring" {
  name = "${var.app_name}-rds-enhanced-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_enhanced_monitoring" {
  role       = aws_iam_role.rds_enhanced_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
