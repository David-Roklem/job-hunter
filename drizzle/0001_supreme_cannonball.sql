CREATE TABLE `search_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`areas_json` text DEFAULT '[]' NOT NULL,
	`employment_types_json` text DEFAULT '[]' NOT NULL,
	`include_keywords_json` text DEFAULT '[]' NOT NULL,
	`exclude_keywords_json` text DEFAULT '[]' NOT NULL,
	`min_salary` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
