# ElastiCache Redis 7 (INF5)
resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.app_name}-redis-subnet"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.app_name}-redis"
  description          = "VetManager Redis cluster"

  node_type            = "cache.t3.micro"
  num_cache_clusters   = 2
  port                 = 6379

  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.redis_token

  # Backups (INF8)
  snapshot_retention_limit = 3
  snapshot_window          = "02:00-03:00"

  tags = { Name = "${var.app_name}-redis", Environment = var.environment }
}
