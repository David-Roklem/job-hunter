CREATE TABLE `hh_resume_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resume_template_id` integer NOT NULL,
	`hh_resume_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`resume_template_id`) REFERENCES `resume_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hh_resume_mapping_template_unique` ON `hh_resume_mapping` (`resume_template_id`);