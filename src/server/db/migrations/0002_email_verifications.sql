CREATE TABLE `email_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_verifications_id_length_check" CHECK(length("email_verifications"."id") = 64)
);
--> statement-breakpoint
CREATE INDEX `email_verifications_user_id_idx` ON `email_verifications` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;