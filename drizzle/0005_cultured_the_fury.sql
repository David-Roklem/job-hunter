CREATE TABLE `user_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contacts_json` text DEFAULT '{}' NOT NULL,
	`signature_md` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
