CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`auth_method` text NOT NULL,
	`csrf_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_id_length_check" CHECK(length("sessions"."id") = 64),
	CONSTRAINT "sessions_auth_method_check" CHECK("sessions"."auth_method" IN ('local','oidc')),
	CONSTRAINT "sessions_csrf_hash_length_check" CHECK(length("sessions"."csrf_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);