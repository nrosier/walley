CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wallos_id` text,
	`actual_schedule_id` text,
	`status` text NOT NULL,
	`last_known_wallos_hash` text,
	`last_known_actual_hash` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "matches_status_check" CHECK("matches"."status" IN ('LINKED','MISMATCH_DETECTED','IGNORED_WALLOS','IGNORED_ACTUAL')),
	CONSTRAINT "matches_side_check" CHECK(("matches"."status" IN ('LINKED','MISMATCH_DETECTED') AND "matches"."wallos_id" IS NOT NULL AND "matches"."actual_schedule_id" IS NOT NULL) OR ("matches"."status" = 'IGNORED_WALLOS' AND "matches"."wallos_id" IS NOT NULL) OR ("matches"."status" = 'IGNORED_ACTUAL' AND "matches"."actual_schedule_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_user_wallos_unique` ON `matches` (`user_id`,`wallos_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `matches_user_actual_unique` ON `matches` (`user_id`,`actual_schedule_id`);--> statement-breakpoint
CREATE TABLE `user_configs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`wallos_url` text,
	`wallos_api_key_enc` text,
	`actual_url` text,
	`actual_password_enc` text,
	`actual_sync_key_enc` text,
	`actual_budget_id` text,
	`tolerance_percent` real DEFAULT 5 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_configs_tolerance_check" CHECK("user_configs"."tolerance_percent" >= 0 AND "user_configs"."tolerance_percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_issuer_subject_unique` ON `user_identities` (`issuer`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_user_issuer_unique` ON `user_identities` (`user_id`,`issuer`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`key_salt` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "users_email_lowercase_check" CHECK("users"."email" = lower("users"."email")),
	CONSTRAINT "users_key_salt_length_check" CHECK(length("users"."key_salt") = 32)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);