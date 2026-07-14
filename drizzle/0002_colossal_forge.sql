CREATE TABLE `telegram_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`username` text NOT NULL,
	`title` text,
	`last_message_id` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_channels_username_unique` ON `telegram_channels` (`username`);--> statement-breakpoint
CREATE INDEX `telegram_channels_source_id_idx` ON `telegram_channels` (`source_id`);