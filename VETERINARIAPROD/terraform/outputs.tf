output "rds_endpoint"   { value = aws_db_instance.mysql.endpoint }
output "redis_endpoint" { value = aws_elasticache_replication_group.redis.primary_endpoint_address }
output "secrets_arn"    { value = aws_secretsmanager_secret.app_secrets.arn }
output "kms_key_id"     { value = aws_kms_key.jwt.key_id }
output "waf_acl_arn"    { value = aws_wafv2_web_acl.main.arn }
