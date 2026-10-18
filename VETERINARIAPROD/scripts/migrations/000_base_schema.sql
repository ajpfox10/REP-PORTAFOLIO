-- ============================================================================
-- Migration 000: esquema base de VetManager Pro
--
-- Crea las tablas sobre las que trabajan las migraciones 032+ y los
-- servicios. Es idempotente (CREATE ... IF NOT EXISTS / CREATE OR REPLACE), así
-- que en una base existente no modifica nada.
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `accounts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `balance` DECIMAL(12,2) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_chat_messages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `role` VARCHAR(64) NULL,
  `session_id` VARCHAR(191) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_chat_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `message_count` INT NULL,
  `model_provider` VARCHAR(64) NULL,
  `org_id` INT UNSIGNED NULL,
  `patient_id` INT UNSIGNED NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_chat_sessions_org_id` (`org_id`),
  KEY `idx_ai_chat_sessions_patient_id` (`patient_id`),
  KEY `idx_ai_chat_sessions_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_diagnosis_suggestions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `anamnesis` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `diagnoses_json` JSON NULL,
  `model_provider` VARCHAR(64) NULL,
  `org_id` INT UNSIGNED NULL,
  `patient_id` INT UNSIGNED NULL,
  `requested_by` INT UNSIGNED NULL,
  `symptoms_json` JSON NULL,
  `urgency` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_diagnosis_suggestions_org_id` (`org_id`),
  KEY `idx_ai_diagnosis_suggestions_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_image_analyses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `assessment` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `findings_json` JSON NULL,
  `image_type` VARCHAR(64) NULL,
  `lab_result_id` INT UNSIGNED NULL,
  `model_provider` VARCHAR(64) NULL,
  `org_id` INT UNSIGNED NULL,
  `patient_id` INT UNSIGNED NULL,
  `recommendations_json` JSON NULL,
  `region` VARCHAR(255) NULL,
  `requested_by` INT UNSIGNED NULL,
  `severity` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_image_analyses_lab_result_id` (`lab_result_id`),
  KEY `idx_ai_image_analyses_org_id` (`org_id`),
  KEY `idx_ai_image_analyses_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ai_risk_assessments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `computed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `history_snapshot_json` JSON NULL,
  `org_id` INT UNSIGNED NULL,
  `overall_level` INT NULL,
  `patient_id` INT UNSIGNED NULL,
  `recommendations_json` JSON NULL,
  `risks_json` JSON NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_risk_assessments_org_id` (`org_id`),
  KEY `idx_ai_risk_assessments_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `anamnesis` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `appetite` VARCHAR(255) NULL,
  `contact_with_animals` VARCHAR(255) NULL,
  `coughing` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `current_illness_history` TEXT NULL,
  `current_medications` TEXT NULL,
  `defecation` VARCHAR(255) NULL,
  `deworming_history` TEXT NULL,
  `environment` VARCHAR(255) NULL,
  `feeding_brand` TEXT NULL,
  `feeding_type` VARCHAR(64) NULL,
  `illness_duration` TEXT NULL,
  `illness_onset` TEXT NULL,
  `locomotion_issues` VARCHAR(255) NULL,
  `medical_record_id` INT UNSIGNED NULL,
  `other_signs` TEXT NULL,
  `owner_observations` TEXT NULL,
  `previous_illnesses` TEXT NULL,
  `previous_surgeries` TEXT NULL,
  `pruritus` VARCHAR(255) NULL,
  `recent_travel` TEXT NULL,
  `sneezing` VARCHAR(255) NULL,
  `thirst` VARCHAR(255) NULL,
  `urination` VARCHAR(255) NULL,
  `vaccination_history` TEXT NULL,
  `vomiting` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_anamnesis_medical_record_id` (`medical_record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `anesthesia_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `analgesics` VARCHAR(255) NULL,
  `anesthesia_type` VARCHAR(64) NULL,
  `anesthesiologist_id` INT UNSIGNED NULL,
  `complications` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `extubation_time` VARCHAR(255) NULL,
  `induction_agents` VARCHAR(255) NULL,
  `induction_time` VARCHAR(255) NULL,
  `maintenance_agents` VARCHAR(255) NULL,
  `monitoring_chart` VARCHAR(255) NULL,
  `premedications` VARCHAR(255) NULL,
  `recovery_notes` TEXT NULL,
  `reversal_agents` VARCHAR(255) NULL,
  `surgery_id` INT UNSIGNED NULL,
  `total_anesthesia_minutes` DECIMAL(12,2) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_anesthesia_records_anesthesiologist_id` (`anesthesiologist_id`),
  KEY `idx_anesthesia_records_surgery_id` (`surgery_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `antiparasitic_products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `active_ingredient` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `dosage_guideline` VARCHAR(255) NULL,
  `interval_months` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `parasite_type` VARCHAR(64) NULL,
  `presentation` VARCHAR(255) NULL,
  `target_species` VARCHAR(64) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL,
  `key_hash` VARCHAR(255) NULL,
  `key_prefix` VARCHAR(255) NULL,
  `last_used_at` DATETIME NULL,
  `name` VARCHAR(255) NULL,
  `scopes` JSON NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_api_keys_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `appointment_types` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `color_hex` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `default_duration_minutes` INT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `organization_id` INT UNSIGNED NULL,
  `requires_prep` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_appointment_types_branch_id` (`branch_id`),
  KEY `idx_appointment_types_organization_id` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `appointments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `appointment_type_id` INT UNSIGNED NULL,
  `branch_id` INT UNSIGNED NULL,
  `cancellation_reason` TEXT NULL,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by_portal` VARCHAR(255) NULL,
  `duration_minutes` INT NULL,
  `google_event_id` VARCHAR(191) NULL,
  `is_emergency` TINYINT(1) NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  `reason` TEXT NULL,
  `scheduled_date` DATETIME NULL,
  `status` VARCHAR(64) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `vet_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_appointments_appointment_type_id` (`appointment_type_id`),
  KEY `idx_appointments_branch_id` (`branch_id`),
  KEY `idx_appointments_client_id` (`client_id`),
  KEY `idx_appointments_patient_id` (`patient_id`),
  KEY `idx_appointments_vet_id` (`vet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_log_immutable` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `audit_log_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `entry_hash` VARCHAR(255) NULL,
  `export_status` VARCHAR(64) NULL,
  `org_id` INT UNSIGNED NULL,
  `payload_json` JSON NULL,
  `prev_hash` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_log_immutable_audit_log_id` (`audit_log_id`),
  KEY `idx_audit_log_immutable_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_log_immutable_archive` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `audit_log_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `entry_hash` VARCHAR(255) NULL,
  `export_status` VARCHAR(64) NULL,
  `org_id` INT UNSIGNED NULL,
  `payload_json` JSON NULL,
  `prev_hash` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_log_immutable_archive_audit_log_id` (`audit_log_id`),
  KEY `idx_audit_log_immutable_archive_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `action` VARCHAR(64) NULL,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `duration_ms` VARCHAR(255) NULL,
  `entry_hash` VARCHAR(255) NULL,
  `ip_address` VARCHAR(45) NULL,
  `method` VARCHAR(64) NULL,
  `module` VARCHAR(255) NULL,
  `org_id` INT UNSIGNED NULL,
  `path` VARCHAR(1024) NULL,
  `prev_hash` VARCHAR(255) NULL,
  `request_body` TEXT NULL,
  `request_id` VARCHAR(191) NULL,
  `resource` VARCHAR(64) NULL,
  `resource_id` INT UNSIGNED NULL,
  `status_code` VARCHAR(64) NULL,
  `user_agent` VARCHAR(512) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_branch_id` (`branch_id`),
  KEY `idx_audit_logs_org_id` (`org_id`),
  KEY `idx_audit_logs_resource_id` (`resource_id`),
  KEY `idx_audit_logs_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `branch_integration_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `allow_patient_transfers` TINYINT(1) NOT NULL DEFAULT 0,
  `allow_stock_transfers` TINYINT(1) NOT NULL DEFAULT 0,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `require_transfer_approval` VARCHAR(255) NULL,
  `share_inventory_view` VARCHAR(255) NULL,
  `share_patient_history` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_branch_integration_settings_branch_id` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `branches` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `address` TEXT NULL,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `email` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `organization_id` INT UNSIGNED NULL,
  `phone` VARCHAR(50) NULL,
  `services_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `timezone` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_branches_branch_id` (`branch_id`),
  KEY `idx_branches_organization_id` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `breeds` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `origin` VARCHAR(255) NULL,
  `size_category` VARCHAR(64) NULL,
  `species_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_breeds_species_id` (`species_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `business_rules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `action` VARCHAR(64) NULL,
  `action_message` TEXT NULL,
  `branch_id` INT UNSIGNED NULL,
  `conditions` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT UNSIGNED NULL,
  `day_of_week` INT NULL,
  `description` TEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `org_id` INT UNSIGNED NULL,
  `priority` INT NULL,
  `rule_type` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_business_rules_branch_id` (`branch_id`),
  KEY `idx_business_rules_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cities` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `name` VARCHAR(255) NULL,
  `state_id` INT UNSIGNED NULL,
  `zip_code` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cities_state_id` (`state_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_emergency_contacts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  `email` VARCHAR(255) NULL,
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `name` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `relationship` VARCHAR(45) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_client_emergency_contacts_client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client_sessions_client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `address` TEXT NULL,
  `anonymized_at` DATETIME NULL,
  `anonymized_by` INT UNSIGNED NULL,
  `birthdate` DATE NULL,
  `branch_id` INT UNSIGNED NULL,
  `city` VARCHAR(255) NULL,
  `country_code` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `currency_id` INT UNSIGNED NULL,
  `data_governance` VARCHAR(255) NULL,
  `deleted_at` DATETIME NULL,
  `dni` TEXT NULL,
  `document_number` TEXT NULL,
  `document_number_hash` VARCHAR(255) NULL,
  `document_type` VARCHAR(64) NULL,
  `email` VARCHAR(255) NULL,
  `first_name` VARCHAR(255) NULL,
  `fiscal_condition` VARCHAR(64) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `is_anonymized` TINYINT(1) NOT NULL DEFAULT 0,
  `last_name` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `organization_id` INT UNSIGNED NULL,
  `outstanding_balance` DECIMAL(12,2) NULL,
  `phone` VARCHAR(50) NULL,
  `phone_primary` VARCHAR(255) NULL,
  `portal_password_hash` VARCHAR(255) NULL,
  `postal_code` VARCHAR(50) NULL,
  `state_id` INT UNSIGNED NULL,
  `tax_id` VARCHAR(50) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_clients_branch_id` (`branch_id`),
  KEY `idx_clients_currency_id` (`currency_id`),
  KEY `idx_clients_organization_id` (`organization_id`),
  KEY `idx_clients_state_id` (`state_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coat_colors` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `name` VARCHAR(255) NULL,
  `species_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_coat_colors_species_id` (`species_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `countries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `iso2` VARCHAR(255) NULL,
  `iso3` VARCHAR(255) NULL,
  `name` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cross_branch_access` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `granted_by` INT UNSIGNED NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `reason` TEXT NULL,
  `user_id` INT UNSIGNED NULL,
  `valid_until` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cross_branch_access_branch_id` (`branch_id`),
  KEY `idx_cross_branch_access_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `currencies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `symbol` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `data_classification_registry` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `classification` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `field_name` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `table_name` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `data_retention_policies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `action` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT UNSIGNED NULL,
  `data_type` VARCHAR(64) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `org_id` INT UNSIGNED NULL,
  `retention_days` INT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_data_retention_policies_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `deworming_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `administered_by` INT UNSIGNED NULL,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deworming_date` DATE NULL,
  `dose_administered` VARCHAR(255) NULL,
  `next_due_date` DATE NULL,
  `notes` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  `product_id` INT UNSIGNED NULL,
  `route` VARCHAR(255) NULL,
  `weight_at_treatment` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_deworming_records_branch_id` (`branch_id`),
  KEY `idx_deworming_records_patient_id` (`patient_id`),
  KEY `idx_deworming_records_product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `diagnoses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `diagnosis_code` TEXT NULL,
  `diagnosis_name` TEXT NULL,
  `diagnosis_type` VARCHAR(64) NULL,
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `medical_record_id` INT UNSIGNED NULL,
  `notes` TEXT NULL,
  `prognosis` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_diagnoses_medical_record_id` (`medical_record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `emergency_triage` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `appointment_id` INT UNSIGNED NULL,
  `chief_complaint` TEXT NULL,
  `consciousness_level` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `heart_rate` INT NULL,
  `mucous_membranes` TEXT NULL,
  `notes` TEXT NULL,
  `pain_score` DECIMAL(10,3) NULL,
  `priority` INT NULL,
  `respiratory_rate` INT NULL,
  `systolic_bp` VARCHAR(255) NULL,
  `temperature_celsius` VARCHAR(255) NULL,
  `triaged_by` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_emergency_triage_appointment_id` (`appointment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `groomer_commission_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `commission_amount` DECIMAL(12,2) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `earned_at` DATETIME NULL,
  `groomer_id` INT UNSIGNED NULL,
  `grooming_appointment_id` INT UNSIGNED NULL,
  `is_paid` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_groomer_commission_records_groomer_id` (`groomer_id`),
  KEY `idx_groomer_commission_records_grooming_appointment_id` (`grooming_appointment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `groomers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `commission_type` VARCHAR(64) NULL,
  `commission_value` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `specializations` VARCHAR(255) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_groomers_branch_id` (`branch_id`),
  KEY `idx_groomers_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grooming_appointment_services` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `grooming_appointment_id` INT UNSIGNED NULL,
  `notes` TEXT NULL,
  `price_charged` DECIMAL(12,2) NULL,
  `service_type_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_grooming_appointment_services_grooming_appointment_id` (`grooming_appointment_id`),
  KEY `idx_grooming_appointment_services_service_type_id` (`service_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grooming_appointments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivery_address` VARCHAR(255) NULL,
  `delivery_required` TINYINT(1) NOT NULL DEFAULT 0,
  `estimated_duration_minutes` INT NULL,
  `estimated_price` DECIMAL(12,2) NULL,
  `final_price` DECIMAL(12,2) NULL,
  `groomer_id` INT UNSIGNED NULL,
  `notes` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  `pickup_address` VARCHAR(255) NULL,
  `pickup_required` TINYINT(1) NOT NULL DEFAULT 0,
  `scheduled_at` DATETIME NULL,
  `status` VARCHAR(64) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_grooming_appointments_branch_id` (`branch_id`),
  KEY `idx_grooming_appointments_client_id` (`client_id`),
  KEY `idx_grooming_appointments_groomer_id` (`groomer_id`),
  KEY `idx_grooming_appointments_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grooming_ratings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NULL,
  `comment` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `groomer_friendliness_score` DECIMAL(10,3) NULL,
  `grooming_appointment_id` INT UNSIGNED NULL,
  `overall_score` DECIMAL(10,3) NULL,
  `quality_score` DECIMAL(10,3) NULL,
  `timeliness_score` DECIMAL(10,3) NULL,
  `would_recommend` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_grooming_ratings_client_id` (`client_id`),
  KEY `idx_grooming_ratings_grooming_appointment_id` (`grooming_appointment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grooming_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `after_photo_url` VARCHAR(1024) NULL,
  `before_photo_url` VARCHAR(1024) NULL,
  `behavior_observations` TEXT NULL,
  `coat_condition` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `final_price` DECIMAL(12,2) NULL,
  `grooming_appointment_id` INT UNSIGNED NULL,
  `notes` TEXT NULL,
  `products_used` VARCHAR(255) NULL,
  `recorded_by` INT UNSIGNED NULL,
  `services_performed` VARCHAR(255) NULL,
  `skin_condition` VARCHAR(64) NULL,
  `vet_referral_reason` TEXT NULL,
  `vet_referral_required` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_grooming_records_grooming_appointment_id` (`grooming_appointment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grooming_service_types` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `base_price_large` VARCHAR(255) NULL,
  `base_price_medium` VARCHAR(255) NULL,
  `base_price_small` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `description` TEXT NULL,
  `duration_min_large` VARCHAR(255) NULL,
  `duration_min_medium` VARCHAR(255) NULL,
  `duration_min_small` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `org_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_grooming_service_types_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hospitalization_medications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `dose` VARCHAR(255) NULL,
  `dose_unit` VARCHAR(64) NULL,
  `end_date` DATE NULL,
  `frequency` VARCHAR(64) NULL,
  `hospitalization_id` INT UNSIGNED NULL,
  `instructions` TEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `medication_id` INT UNSIGNED NULL,
  `prescribed_by` INT UNSIGNED NULL,
  `route` VARCHAR(255) NULL,
  `start_date` DATE NULL,
  PRIMARY KEY (`id`),
  KEY `idx_hospitalization_medications_hospitalization_id` (`hospitalization_id`),
  KEY `idx_hospitalization_medications_medication_id` (`medication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hospitalization_monitoring` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `appetite` VARCHAR(255) NULL,
  `consciousness_level` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `defecation` VARCHAR(255) NULL,
  `diastolic_bp` VARCHAR(255) NULL,
  `heart_rate` INT NULL,
  `hospitalization_id` INT UNSIGNED NULL,
  `hydration_status` TEXT NULL,
  `iv_site_status` VARCHAR(64) NULL,
  `notes` TEXT NULL,
  `pain_score` DECIMAL(10,3) NULL,
  `recorded_at` DATETIME NULL,
  `recorded_by` INT UNSIGNED NULL,
  `respiratory_rate` INT NULL,
  `spo2_percent` DECIMAL(10,3) NULL,
  `systolic_bp` VARCHAR(255) NULL,
  `temperature_celsius` VARCHAR(255) NULL,
  `urination` VARCHAR(255) NULL,
  `weight_kg` DECIMAL(10,3) NULL,
  `wound_status` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_hospitalization_monitoring_hospitalization_id` (`hospitalization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hospitalizations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admission_date` DATETIME NULL,
  `admission_diagnosis` TEXT NULL,
  `admission_weight` DECIMAL(10,3) NULL,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT UNSIGNED NULL,
  `discharge_date` DATETIME NULL,
  `discharge_diagnosis` TEXT NULL,
  `discharge_instructions` TEXT NULL,
  `estimated_discharge_date` DATE NULL,
  `follow_up_date` DATE NULL,
  `hospitalization_reason` TEXT NULL,
  `hospitalization_status` VARCHAR(64) NULL,
  `kennel_id` INT UNSIGNED NULL,
  `medical_record_id` INT UNSIGNED NULL,
  `patient_id` INT UNSIGNED NULL,
  `responsible_vet_id` INT UNSIGNED NULL,
  `special_instructions` TEXT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hospitalizations_branch_id` (`branch_id`),
  KEY `idx_hospitalizations_kennel_id` (`kennel_id`),
  KEY `idx_hospitalizations_medical_record_id` (`medical_record_id`),
  KEY `idx_hospitalizations_patient_id` (`patient_id`),
  KEY `idx_hospitalizations_responsible_vet_id` (`responsible_vet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `imaging_images` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `image_url` VARCHAR(1024) NULL,
  `imaging_study_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_imaging_images_imaging_study_id` (`imaging_study_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `imaging_orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `body_region` VARCHAR(255) NULL,
  `branch_id` INT UNSIGNED NULL,
  `clinical_indication` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `imaging_type_id` INT UNSIGNED NULL,
  `medical_record_id` INT UNSIGNED NULL,
  `order_number` VARCHAR(255) NULL,
  `ordered_at` DATETIME NULL,
  `ordered_by` INT UNSIGNED NULL,
  `patient_id` INT UNSIGNED NULL,
  `patient_preparation` VARCHAR(255) NULL,
  `priority` INT NULL,
  `sedation_required` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_imaging_orders_branch_id` (`branch_id`),
  KEY `idx_imaging_orders_imaging_type_id` (`imaging_type_id`),
  KEY `idx_imaging_orders_medical_record_id` (`medical_record_id`),
  KEY `idx_imaging_orders_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `imaging_reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conclusion` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `findings` TEXT NULL,
  `imaging_order_id` INT UNSIGNED NULL,
  `is_normal` TINYINT(1) NOT NULL DEFAULT 0,
  `recommendations` TEXT NULL,
  `reported_by` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_imaging_reports_imaging_order_id` (`imaging_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `imaging_studies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contrast_agent` VARCHAR(255) NULL,
  `contrast_used` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `dicom_study_uid` VARCHAR(255) NULL,
  `imaging_order_id` INT UNSIGNED NULL,
  `pacs_url` VARCHAR(1024) NULL,
  `performed_by` INT UNSIGNED NULL,
  `study_datetime` DATETIME NULL,
  `technique` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_imaging_studies_imaging_order_id` (`imaging_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `imaging_types` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `description` TEXT NULL,
  `estimated_duration_min` INT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `modality_code` VARCHAR(64) NULL,
  `name` VARCHAR(255) NULL,
  `requires_contrast` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_sedation` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_batches` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT UNSIGNED NULL,
  `deleted_at` DATETIME NULL,
  `expiry_date` DATE NULL,
  `item_id` INT UNSIGNED NULL,
  `lot_number` VARCHAR(255) NULL,
  `manufacture_date` DATE NULL,
  `notes` TEXT NULL,
  `purchase_order_id` INT UNSIGNED NULL,
  `quantity_available` VARCHAR(255) NULL,
  `quantity_received` VARCHAR(255) NULL,
  `supplier_id` INT UNSIGNED NULL,
  `unit_cost` DECIMAL(12,2) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_batches_branch_id` (`branch_id`),
  KEY `idx_inventory_batches_item_id` (`item_id`),
  KEY `idx_inventory_batches_purchase_order_id` (`purchase_order_id`),
  KEY `idx_inventory_batches_supplier_id` (`supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `description` TEXT NULL,
  `expiry_date` DATE NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `item_type` VARCHAR(64) NULL,
  `minimum_stock` INT NULL,
  `name` VARCHAR(255) NULL,
  `requires_prescription` TINYINT(1) NOT NULL DEFAULT 0,
  `sale_price` DECIMAL(12,2) NULL,
  `sku` VARCHAR(255) NULL,
  `stock_quantity` INT NULL,
  `supplier_id` INT UNSIGNED NULL,
  `unit` VARCHAR(64) NULL,
  `unit_cost` DECIMAL(12,2) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_items_branch_id` (`branch_id`),
  KEY `idx_inventory_items_supplier_id` (`supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_movements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `batch_id` INT UNSIGNED NULL,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT UNSIGNED NULL,
  `item_id` INT UNSIGNED NULL,
  `movement_type` VARCHAR(64) NULL,
  `notes` TEXT NULL,
  `quantity` INT NULL,
  `reference` VARCHAR(255) NULL,
  `unit_cost` DECIMAL(12,2) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_movements_batch_id` (`batch_id`),
  KEY `idx_inventory_movements_branch_id` (`branch_id`),
  KEY `idx_inventory_movements_item_id` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_stock` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `item_id` INT UNSIGNED NULL,
  `maximum_stock` INT NULL,
  `minimum_stock` INT NULL,
  `quantity_available` VARCHAR(255) NULL,
  `reorder_point` INT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_stock_branch_id` (`branch_id`),
  KEY `idx_inventory_stock_item_id` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `description` TEXT NULL,
  `discount_pct` VARCHAR(255) NULL,
  `invoice_id` INT UNSIGNED NULL,
  `quantity` INT NULL,
  `service_id` INT UNSIGNED NULL,
  `subtotal` DECIMAL(12,2) NULL,
  `tax_pct` VARCHAR(255) NULL,
  `unit_price` DECIMAL(12,2) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_invoice_items_invoice_id` (`invoice_id`),
  KEY `idx_invoice_items_service_id` (`service_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoices` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `afip_cae` VARCHAR(255) NULL,
  `afip_cae_vto` DATE NULL,
  `afip_nro_comprobante` INT NULL,
  `afip_punto_venta` INT NULL,
  `afip_tipo` INT NULL,
  `appointment_id` INT UNSIGNED NULL,
  `branch_id` INT UNSIGNED NULL,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT UNSIGNED NULL,
  `currency_id` INT UNSIGNED NULL,
  `discount_amount` DECIMAL(12,2) NULL,
  `due_date` DATE NULL,
  `invoice_number` VARCHAR(255) NULL,
  `issued_date` DATE NULL,
  `mp_preference_id` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `paid_amount` DECIMAL(12,2) NULL,
  `patient_id` INT UNSIGNED NULL,
  `status` VARCHAR(64) NULL,
  `subtotal` DECIMAL(12,2) NULL,
  `tax_amount` DECIMAL(12,2) NULL,
  `total_amount` DECIMAL(12,2) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_invoices_appointment_id` (`appointment_id`),
  KEY `idx_invoices_branch_id` (`branch_id`),
  KEY `idx_invoices_client_id` (`client_id`),
  KEY `idx_invoices_currency_id` (`currency_id`),
  KEY `idx_invoices_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kennels` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `kennel_number` INT NULL,
  `kennel_type` VARCHAR(64) NULL,
  `notes` TEXT NULL,
  `size_category` VARCHAR(64) NULL,
  `ward_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_kennels_ward_id` (`ward_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lab_order_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lab_order_id` INT UNSIGNED NULL,
  `lab_test_id` INT UNSIGNED NULL,
  `notes` TEXT NULL,
  `status` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lab_order_items_lab_order_id` (`lab_order_id`),
  KEY `idx_lab_order_items_lab_test_id` (`lab_test_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lab_orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `clinical_notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `medical_record_id` INT UNSIGNED NULL,
  `order_number` VARCHAR(255) NULL,
  `ordered_at` DATETIME NULL,
  `ordered_by` INT UNSIGNED NULL,
  `patient_id` INT UNSIGNED NULL,
  `priority` INT NULL,
  `reported_at` DATETIME NULL,
  `status` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lab_orders_branch_id` (`branch_id`),
  KEY `idx_lab_orders_medical_record_id` (`medical_record_id`),
  KEY `idx_lab_orders_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lab_panel_tests` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lab_test_id` INT UNSIGNED NULL,
  `panel_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lab_panel_tests_lab_test_id` (`lab_test_id`),
  KEY `idx_lab_panel_tests_panel_id` (`panel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lab_reference_ranges` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lab_test_id` INT UNSIGNED NULL,
  `max_value` VARCHAR(255) NULL,
  `min_value` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `sex` VARCHAR(64) NULL,
  `species_id` INT UNSIGNED NULL,
  `unit` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lab_reference_ranges_lab_test_id` (`lab_test_id`),
  KEY `idx_lab_reference_ranges_species_id` (`species_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lab_results` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `interpretation` TEXT NULL,
  `is_critical` TINYINT(1) NOT NULL DEFAULT 0,
  `lab_order_item_id` INT UNSIGNED NULL,
  `reference_range_used` VARCHAR(255) NULL,
  `reported_at` DATETIME NULL,
  `reported_by` INT UNSIGNED NULL,
  `unit` VARCHAR(64) NULL,
  `value_numeric` VARCHAR(255) NULL,
  `value_text` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lab_results_lab_order_item_id` (`lab_order_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lab_test_categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `name` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lab_test_panels` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `description` TEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `price` DECIMAL(12,2) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lab_tests` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` INT UNSIGNED NULL,
  `code` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `organization_id` INT UNSIGNED NULL,
  `price` DECIMAL(12,2) NULL,
  `turnaround_hours` INT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lab_tests_category_id` (`category_id`),
  KEY `idx_lab_tests_organization_id` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `login_history` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `email_attempted` VARCHAR(255) NULL,
  `failure_reason` TEXT NULL,
  `ip_address` VARCHAR(45) NULL,
  `organization_id` INT UNSIGNED NULL,
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `user_agent` VARCHAR(512) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_login_history_client_id` (`client_id`),
  KEY `idx_login_history_organization_id` (`organization_id`),
  KEY `idx_login_history_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `medical_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `appointment_id` INT UNSIGNED NULL,
  `body_condition_score` INT NULL,
  `chief_complaint` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `notes` TEXT NULL,
  `opened_at` DATETIME NULL,
  `patient_id` INT UNSIGNED NULL,
  `signed_at` DATETIME NULL,
  `signed_by` INT UNSIGNED NULL,
  `status` VARCHAR(64) NULL,
  `temperature_celsius` VARCHAR(255) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `vet_id` INT UNSIGNED NULL,
  `visit_date` DATE NULL,
  `weight_kg` DECIMAL(10,3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_medical_records_appointment_id` (`appointment_id`),
  KEY `idx_medical_records_patient_id` (`patient_id`),
  KEY `idx_medical_records_vet_id` (`vet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `medications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `brand_name` VARCHAR(255) NULL,
  `concentration` VARCHAR(255) NULL,
  `controlled` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `drug_class` VARCHAR(255) NULL,
  `generic_name` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `presentation` VARCHAR(255) NULL,
  `requires_rx` TINYINT(1) NOT NULL DEFAULT 0,
  `unit` VARCHAR(64) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `message_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `channel` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `error_message` TEXT NULL,
  `message_preview` TEXT NULL,
  `ml` VARCHAR(255) NULL,
  `related_entity_id` INT UNSIGNED NULL,
  `related_entity_type` VARCHAR(64) NULL,
  `sent_at` DATETIME NULL,
  `status` VARCHAR(64) NULL,
  `template_name` VARCHAR(255) NULL,
  `to_number` VARCHAR(255) NULL,
  `twilio_sid` VARCHAR(255) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_message_logs_branch_id` (`branch_id`),
  KEY `idx_message_logs_related_entity_id` (`related_entity_id`),
  KEY `idx_message_logs_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `message_logs_archive` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `channel` VARCHAR(64) NULL,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `error_message` TEXT NULL,
  `external_id` VARCHAR(191) NULL,
  `payload_json` JSON NULL,
  `recipient` VARCHAR(255) NULL,
  `status` VARCHAR(64) NULL,
  `template_name` VARCHAR(255) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_message_logs_archive_branch_id` (`branch_id`),
  KEY `idx_message_logs_archive_client_id` (`client_id`),
  KEY `idx_message_logs_archive_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notification_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `body` TEXT NULL,
  `channel` VARCHAR(64) NULL,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` VARCHAR(64) NULL,
  `title` VARCHAR(255) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notification_logs_client_id` (`client_id`),
  KEY `idx_notification_logs_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notification_logs_archive` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `body` TEXT NULL,
  `branch_id` INT UNSIGNED NULL,
  `channel` VARCHAR(64) NULL,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  `error_message` TEXT NULL,
  `external_id` VARCHAR(191) NULL,
  `status` VARCHAR(64) NULL,
  `title` VARCHAR(255) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notification_logs_archive_branch_id` (`branch_id`),
  KEY `idx_notification_logs_archive_client_id` (`client_id`),
  KEY `idx_notification_logs_archive_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `org_plugins` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `enabled_by` INT UNSIGNED NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `org_id` INT UNSIGNED NULL,
  `plugin_id` INT UNSIGNED NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_org_plugins_org_id` (`org_id`),
  KEY `idx_org_plugins_plugin_id` (`plugin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `org_role_overrides` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `added_permissions` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `org_id` INT UNSIGNED NULL,
  `removed_permissions` JSON NULL,
  `role_name` VARCHAR(255) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_org_role_overrides_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `organization_auth_policies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `organization_id` INT UNSIGNED NULL,
  `two_factor_enforced` VARCHAR(255) NULL,
  `two_factor_optional_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_organization_auth_policies_organization_id` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `organization_sso_configs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `organization_id` INT UNSIGNED NULL,
  `provider` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_organization_sso_configs_organization_id` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `organizations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `afip_cert` TEXT NULL,
  `afip_cuit` VARCHAR(50) NULL,
  `afip_key` TEXT NULL,
  `afip_production` TINYINT(1) NOT NULL DEFAULT 0,
  `afip_punto_venta` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `email` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `tax_id` VARCHAR(50) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL,
  `token_hash` VARCHAR(255) NULL,
  `used_at` DATETIME NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_password_reset_tokens_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pathology_orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `clinical_history` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `medical_record_id` INT UNSIGNED NULL,
  `order_number` VARCHAR(255) NULL,
  `ordered_at` DATETIME NULL,
  `ordered_by` INT UNSIGNED NULL,
  `pathology_type_id` INT UNSIGNED NULL,
  `patient_id` INT UNSIGNED NULL,
  `reported_at` DATETIME NULL,
  `status` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pathology_orders_branch_id` (`branch_id`),
  KEY `idx_pathology_orders_medical_record_id` (`medical_record_id`),
  KEY `idx_pathology_orders_pathology_type_id` (`pathology_type_id`),
  KEY `idx_pathology_orders_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pathology_results` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `behavior` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `diagnosis` TEXT NULL,
  `differential_diagnosis` TEXT NULL,
  `ihc_results` TEXT NULL,
  `microscopic_description` TEXT NULL,
  `pathologist_id` INT UNSIGNED NULL,
  `pathology_order_id` INT UNSIGNED NULL,
  `prognostic_notes` TEXT NULL,
  `recommendations` TEXT NULL,
  `reported_at` DATETIME NULL,
  `special_stains` VARCHAR(255) NULL,
  `tnm_m` VARCHAR(255) NULL,
  `tnm_n` VARCHAR(255) NULL,
  `tnm_stage` VARCHAR(255) NULL,
  `tnm_t` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pathology_results_pathologist_id` (`pathologist_id`),
  KEY `idx_pathology_results_pathology_order_id` (`pathology_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pathology_samples` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `anatomical_location` VARCHAR(1024) NULL,
  `collection_date` DATE NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fixation_method` VARCHAR(64) NULL,
  `macroscopic_description` TEXT NULL,
  `pathology_order_id` INT UNSIGNED NULL,
  `sample_number` VARCHAR(255) NULL,
  `sample_type` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pathology_samples_pathology_order_id` (`pathology_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pathology_types` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `patient_allergies` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `allergen` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `diagnosed_at` DATETIME NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `notes` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  `reaction_description` TEXT NULL,
  `reaction_type` VARCHAR(64) NULL,
  `severity` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_patient_allergies_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `patient_chronic_conditions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `condition_name` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `diagnosed_at` DATETIME NULL,
  `diagnosis_code` TEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `managed_with` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_patient_chronic_conditions_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `patient_grooming_profile` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `allergic_to_products` VARCHAR(255) NULL,
  `behavior_with_grooming` VARCHAR(255) NULL,
  `coat_type` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `known_issues` VARCHAR(255) NULL,
  `muzzle_required` TINYINT(1) NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  `preferred_grooming_style` VARCHAR(255) NULL,
  `preferred_products` VARCHAR(255) NULL,
  `regular_grooming_frequency` VARCHAR(64) NULL,
  `sedation_history` TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_patient_grooming_profile_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `patient_owners` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  `end_date` DATE NULL,
  `notes` TEXT NULL,
  `ownership_type` VARCHAR(64) NULL,
  `patient_id` INT UNSIGNED NULL,
  `start_date` DATE NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_patient_owners_client_id` (`client_id`),
  KEY `idx_patient_owners_patient_id` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `patient_transfers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `approved_by` INT UNSIGNED NULL,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `from_branch_id` INT UNSIGNED NULL,
  `patient_id` INT UNSIGNED NULL,
  `reason` TEXT NULL,
  `requested_by` INT UNSIGNED NULL,
  `status` VARCHAR(64) NULL,
  `to_branch_id` INT UNSIGNED NULL,
  `transfer_type` VARCHAR(64) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_patient_transfers_client_id` (`client_id`),
  KEY `idx_patient_transfers_from_branch_id` (`from_branch_id`),
  KEY `idx_patient_transfers_patient_id` (`patient_id`),
  KEY `idx_patient_transfers_to_branch_id` (`to_branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `patients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `birth_date` DATE NULL,
  `birthdate` DATE NULL,
  `body_condition_score` INT NULL,
  `branch_id` INT UNSIGNED NULL,
  `breed_id` INT UNSIGNED NULL,
  `chip_number` VARCHAR(255) NULL,
  `coat_color_id` INT UNSIGNED NULL,
  `color` VARCHAR(64) NULL,
  `color_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `date_of_birth` DATE NULL,
  `deleted_at` DATETIME NULL,
  `gender` VARCHAR(64) NULL,
  `hc_number` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `is_deceased` TINYINT(1) NOT NULL DEFAULT 0,
  `is_sterilized` TINYINT(1) NOT NULL DEFAULT 0,
  `microchip_number` VARCHAR(255) NULL,
  `name` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `organization_id` INT UNSIGNED NULL,
  `passport_number` VARCHAR(255) NULL,
  `photo_url` VARCHAR(1024) NULL,
  `sex` VARCHAR(64) NULL,
  `species_id` INT UNSIGNED NULL,
  `tattoo_code` VARCHAR(64) NULL,
  `tattoo_number` VARCHAR(255) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `weight_kg` DECIMAL(10,3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_patients_branch_id` (`branch_id`),
  KEY `idx_patients_breed_id` (`breed_id`),
  KEY `idx_patients_coat_color_id` (`coat_color_id`),
  KEY `idx_patients_color_id` (`color_id`),
  KEY `idx_patients_organization_id` (`organization_id`),
  KEY `idx_patients_species_id` (`species_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `amount` DECIMAL(12,2) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT UNSIGNED NULL,
  `invoice_id` INT UNSIGNED NULL,
  `mp_payment_id` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `paid_at` DATETIME NULL,
  `payment_method` VARCHAR(64) NULL,
  `payment_status` VARCHAR(64) NULL,
  `reference` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_payments_invoice_id` (`invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `physical_examinations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `medical_record_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_physical_examinations_medical_record_id` (`medical_record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `prescription_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `dose` VARCHAR(255) NULL,
  `dose_unit` VARCHAR(64) NULL,
  `duration_days` INT NULL,
  `frequency` VARCHAR(64) NULL,
  `instructions` TEXT NULL,
  `medication_id` INT UNSIGNED NULL,
  `medication_name` TEXT NULL,
  `organization_id` INT UNSIGNED NULL,
  `prescription_id` INT UNSIGNED NULL,
  `quantity` INT NULL,
  `route` VARCHAR(255) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_prescription_items_branch_id` (`branch_id`),
  KEY `idx_prescription_items_medication_id` (`medication_id`),
  KEY `idx_prescription_items_organization_id` (`organization_id`),
  KEY `idx_prescription_items_prescription_id` (`prescription_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `prescriptions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `medical_record_id` INT UNSIGNED NULL,
  `notes` TEXT NULL,
  `organization_id` INT UNSIGNED NULL,
  `prescribed_by` INT UNSIGNED NULL,
  `refills_allowed` INT NULL,
  `refills_used` INT NULL,
  `status` VARCHAR(64) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `valid_until` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_prescriptions_branch_id` (`branch_id`),
  KEY `idx_prescriptions_medical_record_id` (`medical_record_id`),
  KEY `idx_prescriptions_organization_id` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `price_list_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `discount_pct` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `price` DECIMAL(12,2) NULL,
  `price_list_id` VARCHAR(191) NULL,
  `service_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_price_list_items_service_id` (`service_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `price_lists` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `currency_id` INT UNSIGNED NULL,
  `description` TEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `name` VARCHAR(255) NULL,
  `valid_from` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_price_lists_branch_id` (`branch_id`),
  KEY `idx_price_lists_currency_id` (`currency_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `purchase_order_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  `expiry_date` DATE NULL,
  `item_id` INT UNSIGNED NULL,
  `lot_number` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `purchase_order_id` INT UNSIGNED NULL,
  `quantity_ordered` VARCHAR(255) NULL,
  `quantity_received` VARCHAR(255) NULL,
  `unit_cost` DECIMAL(12,2) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_purchase_order_items_item_id` (`item_id`),
  KEY `idx_purchase_order_items_purchase_order_id` (`purchase_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT UNSIGNED NULL,
  `deleted_at` DATETIME NULL,
  `expected_date` DATE NULL,
  `notes` TEXT NULL,
  `ordered_date` DATETIME NULL,
  `po_number` VARCHAR(255) NULL,
  `received_date` DATE NULL,
  `status` VARCHAR(64) NULL,
  `subtotal` DECIMAL(12,2) NULL,
  `supplier_id` INT UNSIGNED NULL,
  `total_amount` DECIMAL(12,2) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_purchase_orders_branch_id` (`branch_id`),
  KEY `idx_purchase_orders_supplier_id` (`supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminders` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `channel` VARCHAR(64) NULL,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `message` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  `related_entity_id` INT UNSIGNED NULL,
  `reminder_type` VARCHAR(64) NULL,
  `scheduled_send_at` DATETIME NULL,
  `sent_at` DATETIME NULL,
  `status` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_reminders_branch_id` (`branch_id`),
  KEY `idx_reminders_client_id` (`client_id`),
  KEY `idx_reminders_patient_id` (`patient_id`),
  KEY `idx_reminders_related_entity_id` (`related_entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `report_runs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `error_message` TEXT NULL,
  `file_size_bytes` INT NULL,
  `finished_at` DATETIME NULL,
  `format` VARCHAR(64) NULL,
  `org_id` INT UNSIGNED NULL,
  `params` JSON NULL,
  `report_type` VARCHAR(64) NULL,
  `scheduled_report_id` INT UNSIGNED NULL,
  `started_at` DATETIME NULL,
  `status` VARCHAR(64) NULL,
  `triggered_by` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_report_runs_branch_id` (`branch_id`),
  KEY `idx_report_runs_org_id` (`org_id`),
  KEY `idx_report_runs_scheduled_report_id` (`scheduled_report_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `report_runs_archive` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `error_message` TEXT NULL,
  `generated_by` INT UNSIGNED NULL,
  `metadata_json` JSON NULL,
  `output_path` VARCHAR(1024) NULL,
  `scheduled_report_id` INT UNSIGNED NULL,
  `status` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_report_runs_archive_scheduled_report_id` (`scheduled_report_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `roles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `display_name` VARCHAR(255) NULL,
  `name` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `scheduled_reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT UNSIGNED NULL,
  `day_of_month` INT NULL,
  `day_of_week` INT NULL,
  `format` VARCHAR(64) NULL,
  `frequency` VARCHAR(64) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_run_at` DATETIME NULL,
  `name` VARCHAR(255) NULL,
  `next_run_at` DATETIME NULL,
  `org_id` INT UNSIGNED NULL,
  `params` JSON NULL,
  `recipients` JSON NULL,
  `report_type` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_scheduled_reports_branch_id` (`branch_id`),
  KEY `idx_scheduled_reports_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `security_alerts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `acknowledged` VARCHAR(255) NULL,
  `acknowledged_at` DATETIME NULL,
  `acknowledged_by` INT UNSIGNED NULL,
  `alert_type` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `details` JSON NULL,
  `org_id` INT UNSIGNED NULL,
  `severity` VARCHAR(64) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_security_alerts_org_id` (`org_id`),
  KEY `idx_security_alerts_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `security_alerts_archive` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `alert_type` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `description` TEXT NULL,
  `metadata_json` JSON NULL,
  `organization_id` INT UNSIGNED NULL,
  `severity` VARCHAR(64) NULL,
  `status` VARCHAR(64) NULL,
  `title` VARCHAR(255) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_security_alerts_archive_organization_id` (`organization_id`),
  KEY `idx_security_alerts_archive_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `security_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `details` JSON NULL,
  `event_type` VARCHAR(64) NULL,
  `ip_address` VARCHAR(45) NULL,
  `org_id` INT UNSIGNED NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_security_events_org_id` (`org_id`),
  KEY `idx_security_events_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `service_categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `color_hex` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `sort_order` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `service_registry_snapshots` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `service_registry_snapshots_archive` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `health_status` VARCHAR(64) NULL,
  `metadata_json` JSON NULL,
  `service_name` VARCHAR(255) NULL,
  `service_url` VARCHAR(1024) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `services_catalog` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `base_price` DECIMAL(12,2) NULL,
  `branch_id` INT UNSIGNED NULL,
  `category_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `default_duration_min` INT NULL,
  `description` TEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `tax_pct` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_services_catalog_branch_id` (`branch_id`),
  KEY `idx_services_catalog_category_id` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `device_fingerprint` VARCHAR(255) NULL,
  `device_type` VARCHAR(64) NULL,
  `expires_at` DATETIME NULL,
  `ip_address` VARCHAR(45) NULL,
  `is_revoked` TINYINT(1) NOT NULL DEFAULT 0,
  `jti` VARCHAR(255) NULL,
  `last_activity_at` DATETIME NULL,
  `org_id` INT UNSIGNED NULL,
  `revoked_at` DATETIME NULL,
  `session_token` VARCHAR(255) NULL,
  `user_agent` VARCHAR(512) NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sessions_org_id` (`org_id`),
  KEY `idx_sessions_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `species` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `category_id` INT UNSIGNED NULL,
  `common_name` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `scientific_name` VARCHAR(255) NULL,
  `slug` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_species_category_id` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `species_categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `display_name` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `states` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NULL,
  `country_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `name` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_states_country_id` (`country_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_alerts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `alert_type` VARCHAR(64) NULL,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `current_stock` INT NULL,
  `deleted_at` DATETIME NULL,
  `expiry_date` DATE NULL,
  `item_id` INT UNSIGNED NULL,
  `notified` VARCHAR(255) NULL,
  `resolved` VARCHAR(255) NULL,
  `resolved_at` DATETIME NULL,
  `threshold` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_stock_alerts_branch_id` (`branch_id`),
  KEY `idx_stock_alerts_item_id` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_transfers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `batch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `from_branch_id` INT UNSIGNED NULL,
  `item_id` INT UNSIGNED NULL,
  `quantity` INT NULL,
  `reason` TEXT NULL,
  `requested_by` INT UNSIGNED NULL,
  `status` VARCHAR(64) NULL,
  `to_branch_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_stock_transfers_batch_id` (`batch_id`),
  KEY `idx_stock_transfers_from_branch_id` (`from_branch_id`),
  KEY `idx_stock_transfers_item_id` (`item_id`),
  KEY `idx_stock_transfers_to_branch_id` (`to_branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `subscription_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `event_type` VARCHAR(64) NULL,
  `org_id` INT UNSIGNED NULL,
  `payload` JSON NULL,
  `provider` VARCHAR(64) NULL,
  `provider_event_id` VARCHAR(191) NULL,
  `stripe_event_id` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_subscription_events_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `address` TEXT NULL,
  `contact_name` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  `email` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `org_id` INT UNSIGNED NULL,
  `payment_terms` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `tax_id` VARCHAR(50) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_suppliers_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `surgeries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `anesthesiologist_id` INT UNSIGNED NULL,
  `assistant_surgeon_id` INT UNSIGNED NULL,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `duration_minutes` INT NULL,
  `end_time` DATETIME NULL,
  `lead_surgeon_id` INT UNSIGNED NULL,
  `medical_record_id` INT UNSIGNED NULL,
  `notes` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  `preoperative_diagnosis` TEXT NULL,
  `scheduled_date` DATETIME NULL,
  `start_time` DATETIME NULL,
  `status` VARCHAR(64) NULL,
  `surgery_type_id` INT UNSIGNED NULL,
  `surgical_approach` VARCHAR(255) NULL,
  `surgical_nurse_id` INT UNSIGNED NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `urgency` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_surgeries_anesthesiologist_id` (`anesthesiologist_id`),
  KEY `idx_surgeries_assistant_surgeon_id` (`assistant_surgeon_id`),
  KEY `idx_surgeries_branch_id` (`branch_id`),
  KEY `idx_surgeries_lead_surgeon_id` (`lead_surgeon_id`),
  KEY `idx_surgeries_medical_record_id` (`medical_record_id`),
  KEY `idx_surgeries_patient_id` (`patient_id`),
  KEY `idx_surgeries_surgery_type_id` (`surgery_type_id`),
  KEY `idx_surgeries_surgical_nurse_id` (`surgical_nurse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `surgery_categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `name` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `surgery_types` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `description` TEXT NULL,
  `estimated_duration_minutes` INT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `organization_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_surgery_types_category_id` (`category_id`),
  KEY `idx_surgery_types_organization_id` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tele_digital_prescriptions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL,
  `prescription_id` INT UNSIGNED NULL,
  `session_id` VARCHAR(191) NULL,
  `signature_hash` VARCHAR(255) NULL,
  `status` VARCHAR(64) NULL,
  `vet_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tele_digital_prescriptions_prescription_id` (`prescription_id`),
  KEY `idx_tele_digital_prescriptions_vet_id` (`vet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tele_messages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `attachment_type` VARCHAR(64) NULL,
  `attachment_url` VARCHAR(1024) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `message_text` TEXT NULL,
  `sender_id` INT UNSIGNED NULL,
  `sender_type` VARCHAR(64) NULL,
  `sent_at` DATETIME NULL,
  `session_id` VARCHAR(191) NULL,
  `tm` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tele_messages_sender_id` (`sender_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tele_platforms` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `base_url` VARCHAR(1024) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `display_name` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `org_id` INT UNSIGNED NULL,
  `platform_type` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tele_platforms_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tele_pre_anamnesis` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `appetite_change` VARCHAR(255) NULL,
  `behavior_change` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `current_medications` TEXT NULL,
  `current_symptoms` VARCHAR(255) NULL,
  `media_urls` VARCHAR(255) NULL,
  `owner_concerns` VARCHAR(255) NULL,
  `recent_changes` JSON NULL,
  `session_id` VARCHAR(191) NULL,
  `submitted_by` INT UNSIGNED NULL,
  `symptoms_duration` INT NULL,
  `symptoms_onset` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tele_ratings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `comment` TEXT NULL,
  `connection_score` DECIMAL(10,3) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `overall_score` DECIMAL(10,3) NULL,
  `platform_score` DECIMAL(10,3) NULL,
  `rated_by` INT UNSIGNED NULL,
  `session_id` VARCHAR(191) NULL,
  `vet_score` DECIMAL(10,3) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tele_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `chief_complaint` TEXT NULL,
  `client_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `duration_minutes` INT NULL,
  `meeting_url` VARCHAR(1024) NULL,
  `notes` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  `platform_id` INT UNSIGNED NULL,
  `platform_name` VARCHAR(255) NULL,
  `scheduled_at` DATETIME NULL,
  `session_code` VARCHAR(64) NULL,
  `session_type` VARCHAR(64) NULL,
  `status` VARCHAR(64) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `vet_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tele_sessions_branch_id` (`branch_id`),
  KEY `idx_tele_sessions_client_id` (`client_id`),
  KEY `idx_tele_sessions_patient_id` (`patient_id`),
  KEY `idx_tele_sessions_platform_id` (`platform_id`),
  KEY `idx_tele_sessions_vet_id` (`vet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tele_shared_documents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `session_id` VARCHAR(191) NULL,
  `shared_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `billing_email` VARCHAR(255) NULL,
  `cancelled_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `current_period_end` VARCHAR(255) NULL,
  `mp_preapproval_id` VARCHAR(191) NULL,
  `next_billing_date` DATE NULL,
  `org_id` INT UNSIGNED NULL,
  `payment_provider` VARCHAR(64) NULL,
  `pending_plan` TEXT NULL,
  `plan` VARCHAR(64) NULL,
  `status` VARCHAR(64) NULL,
  `stripe_customer_id` VARCHAR(191) NULL,
  `stripe_price_id` VARCHAR(191) NULL,
  `stripe_subscription_id` VARCHAR(191) NULL,
  `subdomain` VARCHAR(64) NULL,
  `trial_ends_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tenants_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `treatments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `description` TEXT NULL,
  `dose` VARCHAR(255) NULL,
  `dose_unit` VARCHAR(64) NULL,
  `duration_days` INT NULL,
  `frequency` VARCHAR(64) NULL,
  `medical_record_id` INT UNSIGNED NULL,
  `medication_id` INT UNSIGNED NULL,
  `notes` TEXT NULL,
  `prescribed_by` INT UNSIGNED NULL,
  `route` VARCHAR(255) NULL,
  `start_date` DATE NULL,
  `treatment_type` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_treatments_medical_record_id` (`medical_record_id`),
  KEY `idx_treatments_medication_id` (`medication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `two_factor_recovery_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code_hash` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_two_factor_recovery_codes_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_fcm_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `device_name` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_used_at` DATETIME NULL,
  `org_id` INT UNSIGNED NULL,
  `platform` VARCHAR(64) NULL,
  `token` VARCHAR(255) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_fcm_tokens_branch_id` (`branch_id`),
  KEY `idx_user_fcm_tokens_org_id` (`org_id`),
  KEY `idx_user_fcm_tokens_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_roles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `assigned_at` DATETIME NULL,
  `assigned_by` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `role_id` INT UNSIGNED NULL,
  `user_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_roles_role_id` (`role_id`),
  KEY `idx_user_roles_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  `email` VARCHAR(255) NULL,
  `failed_login_attempts` INT NULL,
  `first_name` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_name` VARCHAR(255) NULL,
  `license_number` VARCHAR(255) NULL,
  `locked_until` DATETIME NULL,
  `organization_id` INT UNSIGNED NULL,
  `password` VARCHAR(255) NULL,
  `password_hash` VARCHAR(255) NULL,
  `phone` VARCHAR(50) NULL,
  `two_factor_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `two_factor_secret` TEXT NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `username` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_users_branch_id` (`branch_id`),
  KEY `idx_users_organization_id` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vaccinations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `administered_by` INT UNSIGNED NULL,
  `administration_site` VARCHAR(255) NULL,
  `batch_number` VARCHAR(255) NULL,
  `branch_id` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `dose` VARCHAR(255) NULL,
  `expiry_date` DATE NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `medical_record_id` INT UNSIGNED NULL,
  `next_due_date` DATE NULL,
  `notes` TEXT NULL,
  `patient_id` INT UNSIGNED NULL,
  `route` VARCHAR(255) NULL,
  `vaccination_date` DATETIME NULL,
  `vaccine_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vaccinations_branch_id` (`branch_id`),
  KEY `idx_vaccinations_medical_record_id` (`medical_record_id`),
  KEY `idx_vaccinations_patient_id` (`patient_id`),
  KEY `idx_vaccinations_vaccine_id` (`vaccine_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vaccine_manufacturers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `country` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `website` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vaccines` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `description` TEXT NULL,
  `disease_covered` VARCHAR(255) NULL,
  `duration_months` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `manufacturer` VARCHAR(255) NULL,
  `manufacturer_id` INT UNSIGNED NULL,
  `name` VARCHAR(255) NULL,
  `species_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vaccines_manufacturer_id` (`manufacturer_id`),
  KEY `idx_vaccines_species_id` (`species_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wards` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id` INT UNSIGNED NULL,
  `capacity` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `name` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `ward_type` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wards_branch_id` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `webhook_deliveries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `attempt_count` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `endpoint_id` INT UNSIGNED NULL,
  `error_message` TEXT NULL,
  `event_type` VARCHAR(64) NULL,
  `last_attempt_at` DATETIME NULL,
  `next_attempt_at` DATETIME NULL,
  `payload` JSON NULL,
  `response_body` TEXT NULL,
  `response_status` VARCHAR(64) NULL,
  `status` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_webhook_deliveries_endpoint_id` (`endpoint_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `webhook_endpoints` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `org_id` INT UNSIGNED NULL,
  `secret` VARCHAR(255) NULL,
  `url` VARCHAR(1024) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_webhook_endpoints_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `webhook_subscriptions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `endpoint_id` INT UNSIGNED NULL,
  `event_type` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_webhook_subscriptions_endpoint_id` (`endpoint_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `webrtc_participants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `duration_sec` VARCHAR(255) NULL,
  `identity` VARCHAR(255) NULL,
  `joined_at` DATETIME NULL,
  `left_at` DATETIME NULL,
  `role` VARCHAR(64) NULL,
  `room_id` VARCHAR(191) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `webrtc_recordings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `duration_sec` VARCHAR(255) NULL,
  `ended_at` DATETIME NULL,
  `provider_rec_id` VARCHAR(191) NULL,
  `room_id` VARCHAR(191) NULL,
  `session_id` VARCHAR(191) NULL,
  `started_at` DATETIME NULL,
  `status` VARCHAR(64) NULL,
  `storage_url` VARCHAR(1024) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `webrtc_rooms` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL,
  `host_url` VARCHAR(1024) NULL,
  `provider` VARCHAR(64) NULL,
  `provider_room_id` VARCHAR(191) NULL,
  `room_name` VARCHAR(255) NULL,
  `room_url` VARCHAR(1024) NULL,
  `session_id` VARCHAR(191) NULL,
  `status` VARCHAR(64) NULL,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `webrtc_waiting_room` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `acted_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_by` INT UNSIGNED NULL,
  `display_name` VARCHAR(255) NULL,
  `identity` VARCHAR(255) NULL,
  `joined_at` DATETIME NULL,
  `room_id` VARCHAR(191) NULL,
  `status` VARCHAR(64) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `organization_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_sessions_organization_id` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Integridad referencial esperada por migraciones posteriores ──────────────
-- La migración 035 elimina esta FK; en una instalación nueva tiene que existir.
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items'
     AND CONSTRAINT_NAME = 'fk_inv_item_branch'
);
SET @fk_sql = IF(@fk_exists = 0,
  'ALTER TABLE inventory_items ADD CONSTRAINT fk_inv_item_branch FOREIGN KEY (branch_id) REFERENCES branches (id)',
  'SELECT 1');
PREPARE fk_stmt FROM @fk_sql;
EXECUTE fk_stmt;
DEALLOCATE PREPARE fk_stmt;

-- ── Procedimientos de autenticación (bloqueo de cuenta a nivel de base) ──────
DROP PROCEDURE IF EXISTS sp_login_attempt;
CREATE PROCEDURE sp_login_attempt(IN p_email VARCHAR(255), IN p_ip VARCHAR(45))
BEGIN
  SELECT (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS locked,
         u.locked_until
    FROM users u
   WHERE u.email = p_email
   LIMIT 1;
END;

DROP PROCEDURE IF EXISTS sp_record_failed_login;
CREATE PROCEDURE sp_record_failed_login(IN p_email VARCHAR(255), IN p_ip VARCHAR(45))
BEGIN
  UPDATE users
     SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
         locked_until = IF(COALESCE(failed_login_attempts, 0) + 1 >= 5,
                           DATE_ADD(NOW(), INTERVAL 15 MINUTE),
                           locked_until)
   WHERE email = p_email;
END;

DROP PROCEDURE IF EXISTS sp_clear_failed_logins;
CREATE PROCEDURE sp_clear_failed_logins(IN p_user_id INT UNSIGNED)
BEGIN
  UPDATE users
     SET failed_login_attempts = 0,
         locked_until = NULL
   WHERE id = p_user_id;
END;

DROP PROCEDURE IF EXISTS sp_revoke_user_sessions;
CREATE PROCEDURE sp_revoke_user_sessions(IN p_user_id INT UNSIGNED)
BEGIN
  UPDATE sessions
     SET is_revoked = 1,
         revoked_at = NOW()
   WHERE user_id = p_user_id
     AND is_revoked = 0;
END;

-- ── Vistas operativas (paneles del día, alertas y KPIs por sucursal) ─────────

CREATE OR REPLACE VIEW v_today_appointments AS
SELECT a.*,
       p.name                                      AS patient_name,
       s.common_name                               AS species,
       CONCAT_WS(' ', c.first_name, c.last_name)   AS client_name,
       c.phone                                     AS client_phone,
       CONCAT_WS(' ', u.first_name, u.last_name)   AS vet_name,
       at.name                                     AS appointment_type_name
  FROM appointments a
  LEFT JOIN patients p          ON p.id = a.patient_id
  LEFT JOIN species s           ON s.id = p.species_id
  LEFT JOIN clients c           ON c.id = a.client_id
  LEFT JOIN users u             ON u.id = a.vet_id
  LEFT JOIN appointment_types at ON at.id = a.appointment_type_id
 WHERE DATE(a.scheduled_date) = CURDATE();

CREATE OR REPLACE VIEW v_vaccination_alerts AS
SELECT v.id                                        AS vaccination_id,
       v.branch_id,
       v.patient_id,
       p.name                                      AS patient_name,
       vc.name                                     AS vaccine_name,
       v.vaccination_date,
       v.next_due_date,
       DATEDIFF(v.next_due_date, CURDATE())        AS days_until_due,
       CONCAT_WS(' ', c.first_name, c.last_name)   AS client_name,
       c.phone                                     AS client_phone
  FROM vaccinations v
  JOIN patients p               ON p.id = v.patient_id
  LEFT JOIN vaccines vc         ON vc.id = v.vaccine_id
  LEFT JOIN patient_owners po   ON po.patient_id = p.id AND po.ownership_type = 'primary' AND po.deleted_at IS NULL
  LEFT JOIN clients c           ON c.id = po.client_id
 WHERE v.next_due_date IS NOT NULL
   AND v.next_due_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
   AND v.is_active = 1
   AND NOT EXISTS (
     SELECT 1 FROM vaccinations newer
      WHERE newer.patient_id = v.patient_id
        AND newer.vaccine_id = v.vaccine_id
        AND newer.vaccination_date > v.vaccination_date
   );

CREATE OR REPLACE VIEW v_deworming_alerts AS
SELECT d.id                                        AS deworming_id,
       d.branch_id,
       d.patient_id,
       p.name                                      AS patient_name,
       ap.name                                     AS product_name,
       d.deworming_date,
       d.next_due_date,
       DATEDIFF(d.next_due_date, CURDATE())        AS days_until_due,
       CONCAT_WS(' ', c.first_name, c.last_name)   AS client_name,
       c.phone                                     AS client_phone
  FROM deworming_records d
  JOIN patients p                 ON p.id = d.patient_id
  LEFT JOIN antiparasitic_products ap ON ap.id = d.product_id
  LEFT JOIN patient_owners po     ON po.patient_id = p.id AND po.ownership_type = 'primary' AND po.deleted_at IS NULL
  LEFT JOIN clients c             ON c.id = po.client_id
 WHERE d.next_due_date IS NOT NULL
   AND d.next_due_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
   AND NOT EXISTS (
     SELECT 1 FROM deworming_records newer
      WHERE newer.patient_id = d.patient_id
        AND newer.deworming_date > d.deworming_date
   );

CREATE OR REPLACE VIEW v_pending_lab_results AS
SELECT lo.*,
       p.name                                      AS patient_name,
       CONCAT_WS(' ', u.first_name, u.last_name)   AS ordered_by_name,
       TIMESTAMPDIFF(HOUR, lo.ordered_at, NOW())   AS hours_pending
  FROM lab_orders lo
  JOIN patients p    ON p.id = lo.patient_id
  LEFT JOIN users u  ON u.id = lo.ordered_by
 WHERE lo.status IN ('pending', 'in_progress', 'sample_collected');

CREATE OR REPLACE VIEW v_pending_imaging_reports AS
SELECT io.*,
       p.name                                      AS patient_name,
       it.name                                     AS imaging_type_name,
       CONCAT_WS(' ', u.first_name, u.last_name)   AS ordered_by_name
  FROM imaging_orders io
  JOIN patients p          ON p.id = io.patient_id
  LEFT JOIN imaging_types it ON it.id = io.imaging_type_id
  LEFT JOIN users u        ON u.id = io.ordered_by
 WHERE io.status NOT IN ('cancelled', 'reported')
   AND NOT EXISTS (SELECT 1 FROM imaging_reports ir WHERE ir.imaging_order_id = io.id);

CREATE OR REPLACE VIEW v_active_hospitalizations AS
SELECT h.*,
       p.name                                      AS patient_name,
       s.common_name                               AS species,
       w.name                                      AS ward_name,
       k.kennel_number,
       CONCAT_WS(' ', u.first_name, u.last_name)   AS vet_name,
       DATEDIFF(CURDATE(), DATE(h.admission_date)) AS days_admitted
  FROM hospitalizations h
  JOIN patients p     ON p.id = h.patient_id
  LEFT JOIN species s ON s.id = p.species_id
  LEFT JOIN kennels k ON k.id = h.kennel_id
  LEFT JOIN wards w   ON w.id = k.ward_id
  LEFT JOIN users u   ON u.id = h.responsible_vet_id
 WHERE h.discharge_date IS NULL;

CREATE OR REPLACE VIEW v_branch_daily_kpis AS
SELECT b.id AS branch_id,
       b.name AS branch_name,
       (SELECT COUNT(*) FROM appointments a
         WHERE a.branch_id = b.id AND DATE(a.scheduled_date) = CURDATE())              AS appointments_today,
       (SELECT COUNT(*) FROM appointments a
         WHERE a.branch_id = b.id AND DATE(a.scheduled_date) = CURDATE()
           AND a.status = 'completed')                                                AS appointments_completed,
       (SELECT COUNT(*) FROM hospitalizations h
         WHERE h.branch_id = b.id AND h.discharge_date IS NULL)                        AS hospitalized_now,
       (SELECT COALESCE(SUM(i.total_amount), 0) FROM invoices i
         WHERE i.branch_id = b.id AND DATE(i.issued_date) = CURDATE()
           AND i.status <> 'cancelled')                                               AS revenue_today
  FROM branches b;

CREATE OR REPLACE VIEW v_grooming_today AS
SELECT ga.*,
       p.name                                      AS patient_name,
       CONCAT_WS(' ', c.first_name, c.last_name)   AS client_name,
       c.phone                                     AS client_phone,
       CONCAT_WS(' ', u.first_name, u.last_name)   AS groomer_name
  FROM grooming_appointments ga
  JOIN patients p     ON p.id = ga.patient_id
  LEFT JOIN clients c ON c.id = ga.client_id
  LEFT JOIN groomers g ON g.id = ga.groomer_id
  LEFT JOIN users u   ON u.id = g.user_id
 WHERE DATE(ga.scheduled_at) = CURDATE();

CREATE OR REPLACE VIEW v_groomer_performance AS
SELECT g.id AS groomer_id,
       g.branch_id,
       CONCAT_WS(' ', u.first_name, u.last_name)   AS groomer_name,
       COUNT(ga.id)                                AS total_appointments,
       SUM(ga.status = 'completed')                AS completed_appointments,
       COALESCE(SUM(CASE WHEN ga.status = 'completed' THEN ga.final_price END), 0) AS total_revenue,
       (SELECT ROUND(AVG(gr.overall_score), 2) FROM grooming_ratings gr
         JOIN grooming_appointments ga2 ON ga2.id = gr.grooming_appointment_id
        WHERE ga2.groomer_id = g.id)              AS avg_rating
  FROM groomers g
  LEFT JOIN users u ON u.id = g.user_id
  LEFT JOIN grooming_appointments ga ON ga.groomer_id = g.id
 GROUP BY g.id, g.branch_id, u.first_name, u.last_name;

CREATE OR REPLACE VIEW v_tele_today AS
SELECT ts.*,
       p.name                                      AS patient_name,
       CONCAT_WS(' ', c.first_name, c.last_name)   AS client_name,
       CONCAT_WS(' ', u.first_name, u.last_name)   AS vet_name
  FROM tele_sessions ts
  LEFT JOIN patients p ON p.id = ts.patient_id
  LEFT JOIN clients c  ON c.id = ts.client_id
  LEFT JOIN users u    ON u.id = ts.vet_id
 WHERE DATE(ts.scheduled_at) = CURDATE();

CREATE OR REPLACE VIEW v_tele_vet_stats AS
SELECT ts.vet_id,
       ts.branch_id,
       CONCAT_WS(' ', u.first_name, u.last_name)   AS vet_name,
       COUNT(*)                                    AS total_sessions,
       SUM(ts.status = 'completed')                AS completed_sessions,
       SUM(ts.status = 'cancelled')                AS cancelled_sessions,
       ROUND(AVG(ts.duration_minutes), 1)          AS avg_duration_minutes,
       (SELECT ROUND(AVG(tr.vet_score), 2) FROM tele_ratings tr
         JOIN tele_sessions t2 ON t2.id = tr.session_id
        WHERE t2.vet_id = ts.vet_id)               AS avg_rating
  FROM tele_sessions ts
  LEFT JOIN users u ON u.id = ts.vet_id
 GROUP BY ts.vet_id, ts.branch_id, u.first_name, u.last_name;

CREATE OR REPLACE VIEW v_invoice_aging AS
SELECT i.branch_id,
       COUNT(*)                                                         AS open_invoices,
       COALESCE(SUM(i.total_amount - COALESCE(i.paid_amount, 0)), 0)    AS total_outstanding,
       COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(i.due_date, i.issued_date)) <= 0
                         THEN i.total_amount - COALESCE(i.paid_amount, 0) END), 0) AS current_amount,
       COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(i.due_date, i.issued_date)) BETWEEN 1 AND 30
                         THEN i.total_amount - COALESCE(i.paid_amount, 0) END), 0) AS overdue_1_30,
       COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(i.due_date, i.issued_date)) BETWEEN 31 AND 60
                         THEN i.total_amount - COALESCE(i.paid_amount, 0) END), 0) AS overdue_31_60,
       COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), COALESCE(i.due_date, i.issued_date)) > 60
                         THEN i.total_amount - COALESCE(i.paid_amount, 0) END), 0) AS overdue_60_plus
  FROM invoices i
 WHERE i.status IN ('issued', 'pending', 'partial', 'overdue')
 GROUP BY i.branch_id;
