ALTER TABLE `matches` ADD `last_known_wallos_amount_cents` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `last_known_wallos_price_minor` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `last_known_wallos_currency` text;--> statement-breakpoint
ALTER TABLE `user_configs` ADD `currency_drift_percent` real DEFAULT 2 NOT NULL;