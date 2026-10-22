CREATE TABLE `subscription_overrides` (
	`user_id` text NOT NULL,
	`wallos_subscription_id` text NOT NULL,
	`rate` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subscription_overrides_rate_check" CHECK(length("subscription_overrides"."rate") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_overrides_user_subscription_unique` ON `subscription_overrides` (`user_id`,`wallos_subscription_id`);--> statement-breakpoint
CREATE INDEX `subscription_overrides_user_id_idx` ON `subscription_overrides` (`user_id`);