CREATE TABLE `section_staff` (
	`section_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`assigned_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	PRIMARY KEY(`section_id`, `user_id`),
	FOREIGN KEY (`section_id`) REFERENCES `section`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `section_staff_user_idx` ON `section_staff` (`user_id`);