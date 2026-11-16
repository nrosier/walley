PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_configs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`wallos_url` text,
	`wallos_api_key_enc` text,
	`actual_url` text,
	`actual_password_enc` text,
	`actual_sync_key_enc` text,
	`actual_budget_id` text,
	`tolerance_percent` real DEFAULT 5 NOT NULL,
	`currency_drift_percent` real DEFAULT 2 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_configs_tolerance_check" CHECK("__new_user_configs"."tolerance_percent" >= 0 AND "__new_user_configs"."tolerance_percent" <= 100),
	CONSTRAINT "user_configs_currency_drift_check" CHECK("__new_user_configs"."currency_drift_percent" >= 0 AND "__new_user_configs"."currency_drift_percent" <= 10)
);
--> statement-breakpoint
INSERT INTO `__new_user_configs`("user_id", "wallos_url", "wallos_api_key_enc", "actual_url", "actual_password_enc", "actual_sync_key_enc", "actual_budget_id", "tolerance_percent", "currency_drift_percent") SELECT "user_id", "wallos_url", "wallos_api_key_enc", "actual_url", "actual_password_enc", "actual_sync_key_enc", "actual_budget_id", "tolerance_percent", "currency_drift_percent" FROM `user_configs`;--> statement-breakpoint
DROP TABLE `user_configs`;--> statement-breakpoint
ALTER TABLE `__new_user_configs` RENAME TO `user_configs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;