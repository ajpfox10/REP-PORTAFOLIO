# terraform/main.tf — VetManager Pro Infrastructure
# Requiere: terraform >= 1.5, AWS provider >= 5.0
# Uso: terraform init && terraform plan && terraform apply

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket = "vetmanager-terraform-state"
    key    = "prod/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# Variables
variable "aws_region"    { default = "us-east-1" }
variable "environment"   { default = "production" }
variable "app_name"      { default = "vetmanager" }
variable "db_password"   { sensitive = true }
variable "redis_token"   { sensitive = true }
