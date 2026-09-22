CREATE TABLE `zoom_account` (
	`user_id` text PRIMARY KEY NOT NULL,
	`zoom_email` text NOT NULL,
	`zoom_user_id` text,
	`linked_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`last_sync_at` integer,
	`last_sync_error` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zoom_account_email_idx` ON `zoom_account` (`zoom_email`);