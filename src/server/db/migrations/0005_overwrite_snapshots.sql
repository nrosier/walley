CREATE TABLE `overwrite_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`match_id` text NOT NULL,
	`target` text NOT NULL,
	`target_id` text NOT NULL,
	`values_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "overwrite_snapshots_target_check" CHECK("overwrite_snapshots"."target" IN ('wallos','actual'))
);
--> statement-breakpoint
CREATE INDEX `overwrite_snapshots_user_id_idx` ON `overwrite_snapshots` (`user_id`);