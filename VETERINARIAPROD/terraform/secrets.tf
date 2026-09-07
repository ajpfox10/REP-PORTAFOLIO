# AWS Secrets Manager (INF2)
resource "aws_secretsmanager_secret" "app_secrets" {
  name                    = "${var.app_name}/${var.environment}/secrets"
  recovery_window_in_days = 7
  tags = { Environment = var.environment }
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    DB_HOST         = aws_db_instance.mysql.endpoint
    DB_PASSWORD     = var.db_password
    REDIS_URL       = "redis://:${var.redis_token}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
    INTERNAL_SECRET = "CHANGE_AFTER_APPLY"
  })
}

# KMS key para JWT (INF3)
resource "aws_kms_key" "jwt" {
  description             = "VetManager JWT signing key"
  key_usage               = "SIGN_VERIFY"
  customer_master_key_spec = "RSA_2048"
  enable_key_rotation     = true
  tags = { Name = "${var.app_name}-jwt-key" }
}

resource "aws_kms_alias" "jwt" {
  name          = "alias/${var.app_name}/jwt"
  target_key_id = aws_kms_key.jwt.key_id
}
